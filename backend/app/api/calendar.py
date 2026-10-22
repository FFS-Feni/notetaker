"""Календарь, правка отдельных вхождений серии и экран «Ближайшее»."""

import uuid
from datetime import UTC, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.deps import current_user, get_db
from app.events import emit
from app.models import Note, OccurrenceOverride, User
from app.notes import check_version, get_note, occurrence_out, occurrences_for, touch
from app.planner import replan
from app.recurrence import series_starts
from app.schemas import NoteOut, OccurrenceOut, OccurrencePatch, Upcoming

router = APIRouter(prefix="/api", tags=["календарь"])
Scope = Literal["this", "following"]


@router.get("/occurrences", response_model=list[OccurrenceOut])
async def list_occurrences(
    frm: datetime = Query(alias="from"),
    to: datetime = Query(),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    if to <= frm or to - frm > timedelta(days=100):
        raise HTTPException(400, "Период — от 1 секунды до 100 дней")
    return [occurrence_out(o) for o in await occurrences_for(db, user, frm, to)]


async def _series_for_occurrence(db: AsyncSession, user: User, note_id: uuid.UUID, start: datetime, version: int) -> Note:
    note = await get_note(db, user, note_id, lock=True)
    if note.deleted_at is not None:
        raise HTTPException(409, "Заметка в корзине")
    check_version(note, version)
    if note.freq == "none":
        raise HTTPException(400, "Заметка не повторяется — меняйте её целиком")
    if start not in set(series_starts(note, start, start + timedelta(seconds=1))):
        raise HTTPException(404, "Нет такого вхождения")
    return note


async def _override(db: AsyncSession, note: Note, start: datetime, now: datetime) -> OccurrenceOverride:
    ov = await db.scalar(
        select(OccurrenceOverride).where(OccurrenceOverride.note_id == note.id, OccurrenceOverride.original_start == start)
    )
    if ov is None:
        ov = OccurrenceOverride(note_id=note.id, original_start=start, cancelled=False, version=0)
        db.add(ov)
    ov.version += 1
    ov.updated_at = now
    return ov


def _split_day(note: Note, start: datetime):
    zone = ZoneInfo(note.tz)
    return start.astimezone(zone).date(), note.start_at.astimezone(zone).date()


@router.patch("/notes/{note_id}/occurrences/{start}", response_model=NoteOut)
async def update_occurrence(
    note_id: uuid.UUID,
    start: datetime,
    data: OccurrencePatch,
    scope: Scope = "this",
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """scope=this — исключение только для этого вхождения; following — серия делится, прошлое не меняется."""
    note = await _series_for_occurrence(db, user, note_id, start, data.version)
    now = clock.now()
    fields = {k: v for k, v in data.model_dump(exclude_unset=True, exclude={"version"}).items() if v is not None}
    affected = [note]
    if scope == "this":
        ov = await _override(db, note, start, now)
        for key, value in fields.items():
            setattr(ov, key, value)
    else:
        day, first_day = _split_day(note, start)
        if day <= first_day:
            # Это первое вхождение — «это и следующие» = вся серия.
            for key, value in fields.items():
                setattr(note, key, value)
        else:
            new = Note(
                user_id=note.user_id,
                title=fields.get("title", note.title),
                body=fields.get("body", note.body),
                start_at=fields.get("start_at", start),
                tz=note.tz,
                is_active=fields.get("is_active", note.is_active),
                freq=note.freq,
                until=note.until,
                reminders=list(note.reminders),
                version=1,
                created_at=now,
                updated_at=now,
                split_from=note.id,
                tags=list(note.tags),
            )
            note.until = day - timedelta(days=1)
            await db.execute(
                delete(OccurrenceOverride).where(OccurrenceOverride.note_id == note.id, OccurrenceOverride.original_start >= start)
            )
            db.add(new)
            affected.append(new)
    touch(note, now)
    await db.flush()
    for n in affected:
        await replan(db, n, now)
    await emit(db, user.id, "notes", id=str(note.id), version=note.version)
    await db.commit()
    return note


@router.delete("/notes/{note_id}/occurrences/{start}", status_code=204)
async def delete_occurrence(
    note_id: uuid.UUID,
    start: datetime,
    version: int,
    scope: Scope = "this",
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    note = await _series_for_occurrence(db, user, note_id, start, version)
    now = clock.now()
    if scope == "this":
        (await _override(db, note, start, now)).cancelled = True
    else:
        day, first_day = _split_day(note, start)
        if day <= first_day:
            note.deleted_at = now  # удалить с первого вхождения = вся серия в корзину
        else:
            note.until = day - timedelta(days=1)
            await db.execute(
                delete(OccurrenceOverride).where(OccurrenceOverride.note_id == note.id, OccurrenceOverride.original_start >= start)
            )
    touch(note, now)
    await db.flush()
    await replan(db, note, now)
    await emit(db, user.id, "notes", id=str(note.id), version=note.version)
    await db.commit()


@router.get("/upcoming", response_model=Upcoming)
async def upcoming(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Сегодня (до полуночи по поясу пользователя), следующие 7 дней и прошедшие активные за 7 дней."""
    now = clock.now()
    zone = ZoneInfo(user.timezone)
    end_today = datetime.combine(now.astimezone(zone).date() + timedelta(days=1), time(), zone).astimezone(UTC)
    week_end = max(now + timedelta(days=7), end_today)
    occs = await occurrences_for(db, user, now - timedelta(days=7), week_end)
    return Upcoming(
        now=now,
        today=[occurrence_out(o) for o in occs if now <= o.start < end_today],
        week=[occurrence_out(o) for o in occs if end_today <= o.start < week_end],
        past=[occurrence_out(o) for o in reversed(occs) if o.start < now and o.is_active],
    )
