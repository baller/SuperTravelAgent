from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from functools import lru_cache
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import KnowledgeDocument

if TYPE_CHECKING:
    from fastembed import TextEmbedding


@lru_cache(maxsize=1)
def embedding_model() -> TextEmbedding:
    # RAG is intentionally outside the current Agent main path. Keep the
    # dormant storage code import-safe without installing an embedding runtime.
    from fastembed import TextEmbedding

    return TextEmbedding(model_name=get_settings().embedding_model)


async def embed_texts(texts: list[str]) -> list[list[float]]:
    def run() -> list[list[float]]:
        return [vector.tolist() for vector in embedding_model().embed(texts)]

    return await asyncio.to_thread(run)


def chunk_text(content: str, size: int = 520, overlap: int = 80) -> list[str]:
    normalized = "\n".join(line.strip() for line in content.splitlines() if line.strip())
    if len(normalized) <= size:
        return [normalized]
    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(start + size, len(normalized))
        chunks.append(normalized[start:end])
        if end == len(normalized):
            break
        start = max(start + 1, end - overlap)
    return chunks


async def store_reference_text(
    session: AsyncSession,
    *,
    user_id: UUID,
    trip_id: UUID | None,
    title: str,
    content: str,
    content_type: str,
    city: str | None,
) -> list[KnowledgeDocument]:
    chunks = chunk_text(content)
    embeddings = await embed_texts(chunks)
    rows = [
        KnowledgeDocument(
            user_id=user_id,
            trip_id=trip_id,
            title=f"{title} · {index + 1}/{len(chunks)}",
            content=chunk,
            content_type=content_type,
            city=city,
            source="user_text",
            embedding=embedding,
        )
        for index, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=True))
    ]
    session.add_all(rows)
    await session.commit()
    return rows


async def retrieve_context(
    session: AsyncSession,
    *,
    user_id: UUID,
    query: str,
    trip_id: UUID | None = None,
    city: str | None = None,
    limit: int = 6,
) -> list[dict[str, Any]]:
    filters = [KnowledgeDocument.user_id == user_id]
    if trip_id:
        filters.append((KnowledgeDocument.trip_id == trip_id) | (KnowledgeDocument.trip_id.is_(None)))
    if city:
        filters.append((KnowledgeDocument.city == city) | (KnowledgeDocument.city.is_(None)))
    filters.append(
        (KnowledgeDocument.valid_until.is_(None))
        | (KnowledgeDocument.valid_until >= datetime.now(UTC))
    )

    document_count = await session.scalar(select(func.count(KnowledgeDocument.id)).where(*filters))
    if not document_count:
        return []
    [query_embedding] = await embed_texts([query])

    vector_rows = (
        await session.execute(
            select(
                KnowledgeDocument,
                KnowledgeDocument.embedding.cosine_distance(query_embedding).label("distance"),
            )
            .where(*filters, KnowledgeDocument.embedding.is_not(None))
            .order_by("distance")
            .limit(limit * 2)
        )
    ).all()
    text_query = func.plainto_tsquery("simple", query)
    text_vector = func.to_tsvector("simple", KnowledgeDocument.content)
    text_rows = (
        await session.execute(
            select(KnowledgeDocument, func.ts_rank(text_vector, text_query).label("rank"))
            .where(*filters, text_vector.op("@@")(text_query))
            .order_by(func.ts_rank(text_vector, text_query).desc())
            .limit(limit * 2)
        )
    ).all()

    scores: dict[UUID, float] = {}
    docs: dict[UUID, KnowledgeDocument] = {}
    for rank, (document, distance) in enumerate(vector_rows, start=1):
        if distance is not None and float(distance) <= 0.55:
            docs[document.id] = document
            scores[document.id] = scores.get(document.id, 0) + 1 / (60 + rank)
    for rank, (document, _) in enumerate(text_rows, start=1):
        docs[document.id] = document
        scores[document.id] = scores.get(document.id, 0) + 1 / (60 + rank)

    ordered = sorted(scores, key=scores.get, reverse=True)[:limit]
    return [
        {
            "id": str(document_id),
            "title": docs[document_id].title,
            "content": docs[document_id].content,
            "source": docs[document_id].source,
            "city": docs[document_id].city,
            "score": scores[document_id],
        }
        for document_id in ordered
    ]
