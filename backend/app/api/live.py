"""Уведомления в интерфейсе и WebSocket для живых обновлений."""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.db import Session
from app.deps import COOKIE, current_user, get_db, user_by_token
from app.events import emit
from app.models import Notification, User
from app.realtime import hub
from app.schemas import NotificationOut

router = APIRouter(prefix="/api", tags=["уведомления"])


@router.get("/notifications", response_model=list[NotificationOut])
async def list_notifications(unshown: bool = False, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """unshown=true — то, что ещё не всплывало (за последние сутки): показать один раз при открытии."""
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unshown:
        stmt = stmt.where(Notification.shown_at.is_(None), Notification.fired_at > clock.now() - timedelta(days=1))
    return (await db.scalars(stmt.order_by(Notification.fired_at.desc()).limit(50))).all()


@router.post("/notifications/{notification_id}/shown", response_model=NotificationOut)
async def mark_shown(notification_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    n = await db.scalar(select(Notification).where(Notification.id == notification_id, Notification.user_id == user.id))
    if n is None:
        raise HTTPException(404, "Уведомление не найдено")
    if n.shown_at is None:
        n.shown_at = clock.now()
        await emit(db, user.id, "notification_shown", id=n.id)
        await db.commit()
    return n


@router.websocket("/ws")
async def websocket(ws: WebSocket):
    async with Session() as db:
        user = await user_by_token(db, ws.cookies.get(COOKIE))
    if user is None:
        await ws.close(code=4401)
        return
    await ws.accept()
    hub.add(user.id, ws)
    try:
        while True:
            await ws.receive_text()  # клиент шлёт ping; нам важен только факт соединения
    except WebSocketDisconnect:
        pass
    finally:
        hub.remove(user.id, ws)
