"""Общие операции над заметками: доступ, версии, теги, вхождения."""

import uuid
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Note, Tag, User
from app.planner import load_overrides
from app.recurrence import MARGIN, Occurrence, expand
from app.schemas import NoteOut, OccurrenceOut, Prefs, TagOut

TRASH_DAYS = 30


async def get_note(db: AsyncSession, user: User, note_id: uuid.UUID, *, lock: bool = False) -> Note:
    stmt = select(Note).where(Note.id == note_id, Note.user_id == user.id)
    if lock:
        # Строка заблокирована до конца транзакции: две одновременные правки проверяют версию по очереди.
        stmt = stmt.with_for_update(of=Note)
    note = await db.scalar(stmt)
    if note is None:
        raise HTTPException(404, "Заметка не найдена")
    return note


def check_version(note: Note, version: int) -> None:
    if note.version != version:
        raise HTTPException(
            409,
            detail={
                "message": "Заметку уже изменили в другом месте",
                "current": NoteOut.model_validate(note).model_dump(mode="json"),
            },
        )


def touch(note: Note, now: datetime) -> None:
    note.version += 1
    note.updated_at = now


async def resolve_tags(db: AsyncSession, user: User, ids: list[int]) -> list[Tag]:
    if not ids:
        return []
    tags = list(await db.scalars(select(Tag).where(Tag.user_id == user.id, Tag.id.in_(ids))))
    if len(tags) != len(set(ids)):
        raise HTTPException(400, "Нет такого тега")
    return tags


async def occurrences_for(db: AsyncSession, user: User, frm: datetime, to: datetime) -> list[Occurrence]:
    notes = (
        await db.scalars(
            select(Note).where(
                Note.user_id == user.id,
                Note.deleted_at.is_(None),
                or_(
                    and_(Note.freq == "none", Note.start_at >= frm, Note.start_at < to),
                    and_(
                        Note.freq != "none",
                        Note.start_at < to + MARGIN,
                        or_(Note.until.is_(None), Note.until >= (frm - MARGIN).date()),
                    ),
                ),
            )
        )
    ).all()
    overrides = await load_overrides(db, [n.id for n in notes if n.freq != "none"])
    occs = [o for n in notes for o in expand(n, overrides.get(n.id, {}), frm, to)]
    occs.sort(key=lambda o: o.start)
    return occs


def occurrence_out(o: Occurrence) -> OccurrenceOut:
    return OccurrenceOut(
        id=o.id,
        note_id=o.note.id,
        original_start=o.original_start,
        start=o.start,
        title=o.title,
        body=o.body,
        is_active=o.is_active,
        freq=o.note.freq,
        tags=[TagOut.model_validate(t) for t in o.note.tags],
        important=o.note.important,
        urgent=o.note.urgent,
        version=o.note.version,
    )


def purge_at(note: Note) -> datetime:
    return note.deleted_at + timedelta(days=TRASH_DAYS)


async def check_focus_limit(db: AsyncSession, user: User, day, note_id: uuid.UUID | None) -> None:
    if day is None:
        return
    stmt = select(func.count()).where(Note.user_id == user.id, Note.focus_on == day, Note.deleted_at.is_(None))
    if note_id is not None:  # сама заметка не в счёт (повторная отметка того же дня)
        stmt = stmt.where(Note.id != note_id)
    taken = await db.scalar(stmt)
    limit = Prefs.model_validate(user.prefs or {}).focus_limit  # по умолчанию 3, настраивается 1–6
    if taken >= limit:
        raise HTTPException(409, f"В фокусе дня уже {taken} из {limit} — уберите одну заметку, чтобы добавить новую")
