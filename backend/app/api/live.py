"""Уведомления в интерфейсе и WebSocket для живых обновлений."""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.db import Session
from app.deps import COOKIE, current_user, get_db, user_by_token
from app.events import emit
from app.api.calendar import _override
from app.history import record, snapshot
from app.models import Note, Notification, ReminderJob, User
from app.notes import touch
from app.planner import replan
from app.realtime import hub
from app.schemas import NotificationOut, SnoozeIn

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


async def _reminder(db: AsyncSession, user: User, notification_id: int) -> tuple[Notification, ReminderJob, Note]:
    n = await db.scalar(select(Notification).where(Notification.id == notification_id, Notification.user_id == user.id))
    job = await db.get(ReminderJob, n.job_id) if n and n.job_id else None
    note = await db.scalar(select(Note).where(Note.id == job.note_id).with_for_update(of=Note)) if job else None
    if n is None or job is None or note is None or note.deleted_at is not None:
        raise HTTPException(404, "Напоминание уже неактуально")
    return n, job, note


async def _handled(db: AsyncSession, user: User, n: Notification) -> None:
    n.shown_at = n.shown_at or clock.now()
    await emit(db, user.id, "notification_handled", id=n.id)  # закрыть уведомление во всех вкладках


@router.post("/notifications/{notification_id}/snooze", response_model=NotificationOut)
async def snooze(notification_id: int, data: SnoozeIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """«Напомнить позже»: ещё одно напоминание о том же вхождении через N минут (переживает правку заметки)."""
    n, job, note = await _reminder(db, user, notification_id)
    if not note.is_active:
        raise HTTPException(409, "Заметка уже отмечена сделанной")
    db.add(ReminderJob(user_id=user.id, note_id=note.id, occurrence_start=job.occurrence_start, offset_min=job.offset_min,
                       fire_at=clock.now() + timedelta(minutes=data.minutes), snooze=True))
    await _handled(db, user, n)
    await db.commit()
    return n


@router.post("/notifications/{notification_id}/done", response_model=NotificationOut)
async def mark_done(notification_id: int, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """«Готово» прямо из уведомления: обычная заметка становится неактивной, у повтора — только это вхождение."""
    n, job, note = await _reminder(db, user, notification_id)
    now = clock.now()
    before = snapshot(note)
    if note.freq == "none":
        note.is_active = False
    else:
        (await _override(db, note, job.occurrence_start, now)).is_active = False
    touch(note, now)
    await db.flush()
    await replan(db, note, now)
    if note.freq == "none":
        await record(db, note, user, request, "updated", before)
    else:
        await record(db, note, user, request, "occurrence", changes={"occurrence": [job.occurrence_start.isoformat(), "сделано"]})
    await emit(db, user.id, "notes", id=str(note.id), version=note.version)
    await _handled(db, user, n)
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
