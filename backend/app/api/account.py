from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.config import settings
from app.deps import COOKIE, current_user, get_db
from app.events import emit
from app.models import User, UserSession
from app.schemas import Credentials, Prefs, SettingsIn, UserOut
from app.security import hash_password, new_token, token_hash, verify_password

router = APIRouter(prefix="/api", tags=["вход и настройки"])
SESSION_DAYS = 30


async def _start_session(db: AsyncSession, response: Response, user: User) -> None:
    token = new_token()
    now = clock.now()
    db.add(UserSession(token_hash=token_hash(token), user_id=user.id, created_at=now, expires_at=now + timedelta(days=SESSION_DAYS)))
    await db.commit()
    response.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", path="/")


@router.post("/auth/register", response_model=UserOut, status_code=201)
async def register(data: Credentials, response: Response, db: AsyncSession = Depends(get_db)):
    user = User(
        email=data.email.strip(),
        password_hash=hash_password(data.password),
        timezone=data.timezone or settings.default_timezone,
        prefs={},
        created_at=clock.now(),
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        raise HTTPException(409, "Такая почта уже зарегистрирована")
    await _start_session(db, response, user)
    return user


@router.post("/auth/login", response_model=UserOut)
async def login(data: Credentials, response: Response, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(func.lower(User.email) == data.email.strip().lower()))
    if user is None or not verify_password(user.password_hash, data.password):
        raise HTTPException(401, "Неверная почта или пароль")
    await _start_session(db, response, user)
    return user


@router.post("/auth/logout", status_code=204)
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    if token := request.cookies.get(COOKIE):
        await db.execute(delete(UserSession).where(UserSession.token_hash == token_hash(token)))
        await db.commit()
    response.delete_cookie(COOKIE, path="/")


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)):
    return user


@router.get("/settings", response_model=UserOut)
async def get_settings(user: User = Depends(current_user)):
    return user


@router.patch("/settings", response_model=UserOut)
async def update_settings(data: SettingsIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    # Пояс влияет только на отображение: моменты заметок и напоминаний хранятся в UTC и не меняются.
    if data.email is not None:
        user.email = data.email.strip()
    if data.timezone is not None:
        user.timezone = data.timezone
    if data.prefs is not None:
        try:  # сливаем с текущими и проверяем целиком — в базу не попадёт неверное значение
            user.prefs = Prefs.model_validate({**(user.prefs or {}), **data.prefs}).model_dump()
        except ValidationError as e:
            raise HTTPException(422, "; ".join(err["msg"].removeprefix("Value error, ") for err in e.errors()))
    await emit(db, user.id, "settings")
    try:
        await db.commit()
    except IntegrityError:
        raise HTTPException(409, "Эта почта уже занята")
    return user
