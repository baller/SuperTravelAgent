from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import PlanPatch
from app.db.session import get_session
from app.domain.schemas import PatchDecisionRequest, PlanPatchData
from app.services.patches import (
    PatchError,
    VersionConflictError,
    apply_patch,
    patch_data,
    reject_patch,
)

router = APIRouter(prefix="/patches", tags=["patches"])


@router.get("/{patch_id}", response_model=PlanPatchData)
async def get_patch(patch_id: UUID, session: AsyncSession = Depends(get_session)) -> PlanPatchData:
    row = await session.get(PlanPatch, patch_id)
    if not row:
        raise HTTPException(status_code=404, detail="Patch 不存在")
    return patch_data(row)


@router.post("/{patch_id}/apply")
async def post_apply_patch(
    patch_id: UUID,
    payload: PatchDecisionRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        _, version = await apply_patch(session, patch_id, payload.idempotency_key)
    except VersionConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except PatchError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"patch_id": str(patch_id), "state": "APPLIED", "version": version.version}


@router.post("/{patch_id}/reject")
async def post_reject_patch(
    patch_id: UUID,
    payload: PatchDecisionRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        row = await reject_patch(session, patch_id)
    except PatchError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"patch_id": str(row.id), "state": row.state}

