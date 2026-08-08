from uuid import UUID

from sqlalchemy import select

from app.core.config import get_settings
from app.db.models import User
from app.db.session import SessionFactory


async def ensure_default_user() -> None:
    settings = get_settings()
    user_id = UUID(settings.default_user_id)
    async with SessionFactory() as session:
        user = await session.scalar(select(User).where(User.id == user_id))
        if user is None:
            session.add(User(id=user_id, display_name="本地旅行者"))
            await session.commit()

