from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.db import Session
from app.models import User, UserSession
from app.security import token_hash

COOKIE = "nt_session"


async def get_db() -> AsyncIterator[AsyncSession]:
    async with Session() as db:
        yield db


async def user_by_token(db: AsyncSession, token: str | None) -> User | None:
    if not token:
        return None
    return await db.scalar(
        select(User)
        .join(UserSession, UserSession.user_id == User.id)
        .where(UserSession.token_hash == token_hash(token), UserSession.expires_at > clock.now())
    )


async def current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    user = await user_by_token(db, request.cookies.get(COOKIE))
    if user is None:
        raise HTTPException(401, "Нужно войти")
    return user
