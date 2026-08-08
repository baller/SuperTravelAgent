from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_session
from app.domain.schemas import ReferenceTextRequest
from app.services.memory import store_reference_text
from app.services.trips import get_trip_model

router = APIRouter(prefix="/trips", tags=["memory"])


@router.post("/{trip_id}/reference-text", status_code=status.HTTP_201_CREATED)
async def add_reference_text(
    trip_id: UUID,
    payload: ReferenceTextRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    trip = await get_trip_model(session, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip 不存在")
    rows = await store_reference_text(
        session,
        user_id=UUID(get_settings().default_user_id),
        trip_id=trip.id,
        title=payload.title,
        content=payload.content,
        content_type=payload.content_type,
        city=payload.city,
    )
    return {"trip_id": str(trip.id), "chunks": len(rows), "source": "user_text"}

