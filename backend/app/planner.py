"""Планировщик напоминаний: replan() вызывается в той же транзакции, что и любое изменение заметки.

Правила:
- ожидающие задания заметки удаляются и создаются заново — так перенос времени или интервала переносит напоминания;
- заметка неактивна или в корзине — заданий нет;
- создаются только задания с fire_at в будущем — прошедшие не досылаются (реактивация после срока, восстановление);
- уникальный ключ + ON CONFLICT DO NOTHING — уже отправленное напоминание второй раз не создастся.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Note, OccurrenceOverride, ReminderJob
from app.recurrence import expand

# Повторы планируются на неделю вперёд; worker раз в 10 минут дописывает следующие.
HORIZON = timedelta(days=7)


async def load_overrides(db: AsyncSession, note_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict[datetime, OccurrenceOverride]]:
    out: dict[uuid.UUID, dict[datetime, OccurrenceOverride]] = {i: {} for i in note_ids}
    if note_ids:
        rows = await db.scalars(select(OccurrenceOverride).where(OccurrenceOverride.note_id.in_(note_ids)))
        for ov in rows:
            out[ov.note_id][ov.original_start] = ov
    return out


async def replan(db: AsyncSession, note: Note, now: datetime) -> None:
    await db.execute(delete(ReminderJob).where(ReminderJob.note_id == note.id, ReminderJob.status == "pending"))
    if note.deleted_at is not None or not note.is_active or not note.reminders:
        return
    max_offset = timedelta(minutes=max(note.reminders))
    if note.freq == "none":
        frm, to = note.start_at, note.start_at + timedelta(seconds=1)
    else:
        frm, to = now, now + HORIZON + max_offset
    overrides = (await load_overrides(db, [note.id]))[note.id]
    rows = []
    for occ in expand(note, overrides, frm, to):
        if not occ.is_active:
            continue
        for offset in note.reminders:
            fire_at = occ.start - timedelta(minutes=offset)
            if fire_at <= now or (note.freq != "none" and fire_at > now + HORIZON):
                continue
            rows.append(
                {
                    "user_id": note.user_id,
                    "note_id": note.id,
                    "occurrence_start": occ.original_start,
                    "offset_min": offset,
                    "fire_at": fire_at,
                }
            )
    if rows:
        await db.execute(pg_insert(ReminderJob).values(rows).on_conflict_do_nothing())
