from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import User, UserPreference
from app.db.session import get_session

router = APIRouter(prefix="/profile", tags=["profile"])


class ProfileUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)


def _preference_data(item: UserPreference) -> dict:
    return {
        "id": str(item.id),
        "key": item.key,
        "value": item.value,
        "state": item.state,
        "evidence_count": len(item.evidence or []),
        "updated_at": item.updated_at,
    }


@router.get("")
async def get_profile(session: AsyncSession = Depends(get_session)) -> dict:
    user_id = UUID(get_settings().default_user_id)
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="本地用户不存在")
    preferences = (
        await session.scalars(
            select(UserPreference)
            .where(UserPreference.user_id == user_id)
            .order_by(UserPreference.updated_at.desc())
        )
    ).all()
    return {
        "id": str(user.id),
        "display_name": user.display_name,
        "account_mode": "local",
        "preferences": [_preference_data(item) for item in preferences],
    }


@router.patch("")
async def update_profile(
    payload: ProfileUpdate,
    session: AsyncSession = Depends(get_session),
) -> dict:
    user_id = UUID(get_settings().default_user_id)
    user = await session.scalar(select(User).where(User.id == user_id).with_for_update())
    if not user:
        raise HTTPException(status_code=404, detail="本地用户不存在")
    user.display_name = " ".join(payload.display_name.split())[:120]
    await session.commit()
    return await get_profile(session)


@router.delete(
    "/preferences/{preference_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_preference(
    preference_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> Response:
    user_id = UUID(get_settings().default_user_id)
    preference = await session.scalar(
        select(UserPreference).where(
            UserPreference.id == preference_id,
            UserPreference.user_id == user_id,
        )
    )
    if not preference:
        raise HTTPException(status_code=404, detail="旅行偏好不存在")
    await session.delete(preference)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
