"""Фоновый процесс: напоминания, письма, продление повторов, очистка корзины.

Запуск: python -m app.worker. Работает отдельно от API: напоминания не зависят от того,
сколько копий API запущено и перезапускалось ли оно.
"""

import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from email.message import EmailMessage
from zoneinfo import ZoneInfo

import aiosmtplib
from sqlalchemy import delete, func, select

from app import clock
from app.config import settings
from app.db import Session
from app.events import emit
from app.models import EmailOutbox, Note, Notification, OccurrenceOverride, ReminderJob, User, UserSession
from app.planner import replan

log = logging.getLogger("worker")

# Задание старше этого считается пропущенным во время простоя (а не просто взятым на секунду позже).
LATE_AFTER = timedelta(minutes=1)
TRASH_DAYS = 30
MAX_ATTEMPTS = 5
OFFSET_TEXT = {10: "через 10 минут", 60: "через час", 1440: "через день"}


def _when(at: datetime, tz: str) -> str:
    return at.astimezone(ZoneInfo(tz)).strftime("%d.%m.%Y %H:%M")


async def dispatch_due(now: datetime) -> int:
    """Созревшие задания → письмо в очередь + уведомление во вкладки. Возвращает число отправленных.

    FOR UPDATE SKIP LOCKED: два worker’а не возьмут одно задание. Всё — в одной транзакции.
    Политика простоя: если задание просрочено больше чем на минуту, а событие ещё впереди — отправляем
    с пометкой «с опозданием»; событие уже прошло — skipped и одно сводное уведомление.
    """
    sent = 0
    async with Session() as db, db.begin():
        jobs = (
            await db.scalars(
                select(ReminderJob)
                .where(ReminderJob.status == "pending", ReminderJob.fire_at <= now)
                .order_by(ReminderJob.fire_at)
                .limit(100)
                .with_for_update(skip_locked=True)
            )
        ).all()
        missed: dict[int, int] = defaultdict(int)
        for job in jobs:
            note = await db.get(Note, job.note_id)
            ov = await db.scalar(
                select(OccurrenceOverride).where(
                    OccurrenceOverride.note_id == job.note_id, OccurrenceOverride.original_start == job.occurrence_start
                )
            )
            active = (
                note is not None
                and note.deleted_at is None
                and note.is_active
                and not (ov and (ov.cancelled or ov.is_active is False))
            )
            if not active:  # страховка на случай гонки с деактивацией
                job.status = "skipped"
                continue
            start = ov.start_at if ov and ov.start_at else job.occurrence_start
            late = now - job.fire_at > LATE_AFTER
            if late and start <= now:
                job.status = "skipped"
                missed[job.user_id] += 1
                continue
            user = await db.get(User, job.user_id)
            title = ov.title if ov and ov.title else note.title
            when = _when(start, user.timezone)
            if late:  # «через 10 минут» уже неправда — пишем, сколько осталось на самом деле
                left = max(1, round((start - now).total_seconds() / 60))
                lead = f"осталось {left} мин (с опозданием: сервер был недоступен)"
            else:
                lead = OFFSET_TEXT[job.offset_min]
            job.status, job.sent_at, job.late = "sent", now, late
            notification = Notification(
                user_id=user.id, note_id=note.id, job_id=job.id, kind="reminder", title=title,
                body=f"{lead} · {when}", occurrence_start=job.occurrence_start, fired_at=now,
            )
            db.add(notification)
            db.add(
                EmailOutbox(
                    idempotency_key=f"reminder:{job.id}",
                    user_id=user.id,
                    to_addr=user.email,
                    subject=f"Напоминание: {title} — {when}",
                    body=f"{title}\n{lead}: {when} ({user.timezone})\n\n{note.body}\n\nОткрыть Notetaker: {settings.app_url}",
                )
            )
            await db.flush()
            # Текст — прямо в событии: каждая открытая вкладка покажет его сразу, не дожидаясь запроса.
            await emit(db, user.id, "notification", id=notification.id, kind="reminder", title=title, body=notification.body)
            sent += 1
        for user_id, count in missed.items():
            summary = Notification(
                user_id=user_id, kind="missed", title="Пропущенные напоминания",
                body=f"Пока сервер не работал, прошло напоминаний: {count}. Их события уже прошли, письма не отправлялись.",
                fired_at=now,
            )
            db.add(summary)
            await db.flush()
            await emit(db, user_id, "notification", id=summary.id, kind="missed", title=summary.title, body=summary.body)
    return sent


async def send_mail(limit: int = 20) -> int:
    """Очередь писем → SMTP. Message-ID = ключ задания: если упадём между отправкой и отметкой, почта склеит дубль."""
    sent = 0
    async with Session() as db, db.begin():
        mails = (
            await db.scalars(
                select(EmailOutbox).where(EmailOutbox.status == "pending").order_by(EmailOutbox.id).limit(limit).with_for_update(skip_locked=True)
            )
        ).all()
        for m in mails:
            msg = EmailMessage()
            msg["From"] = settings.mail_from
            msg["To"] = m.to_addr
            msg["Subject"] = m.subject
            msg["Message-ID"] = f"<{m.idempotency_key.replace(':', '-')}@notetaker.local>"
            msg.set_content(m.body)
            try:
                await aiosmtplib.send(msg, hostname=settings.smtp_host, port=settings.smtp_port, timeout=10)
                m.status, m.sent_at = "sent", clock.now()
                sent += 1
            except Exception as e:  # SMTP недоступен — попробуем позже
                m.attempts += 1
                m.last_error = str(e)[:500]
                if m.attempts >= MAX_ATTEMPTS:
                    m.status = "failed"
                log.warning("письмо %s не ушло: %s", m.id, e)
    return sent


async def extend_horizon(now: datetime) -> None:
    """Повторяющимся заметкам дописываются задания на неделю вперёд (уже отправленные не дублируются)."""
    async with Session() as db, db.begin():
        notes = await db.scalars(
            select(Note).where(Note.freq != "none", Note.deleted_at.is_(None), Note.is_active, func.cardinality(Note.reminders) > 0)
        )
        for note in notes:
            await replan(db, note, now)


async def purge_trash(now: datetime) -> int:
    async with Session() as db, db.begin():
        rows = (
            await db.execute(
                delete(Note).where(Note.deleted_at < now - timedelta(days=TRASH_DAYS)).returning(Note.user_id)
            )
        ).all()
        for user_id in {r.user_id for r in rows}:
            await emit(db, user_id, "notes")
        # Заодно — просроченные сессии входа: они уже не работают, просто занимают место.
        await db.execute(delete(UserSession).where(UserSession.expires_at < now))
    return len(rows)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    log.info("worker запущен")
    last_horizon = last_purge = datetime.min.replace(tzinfo=clock.now().tzinfo)
    while True:
        now = clock.now()
        try:
            if (n := await dispatch_due(now)):
                log.info("напоминаний отправлено: %s", n)
            await send_mail()
            if now - last_horizon > timedelta(minutes=10):
                await extend_horizon(now)
                last_horizon = now
            if now - last_purge > timedelta(hours=1):
                if (n := await purge_trash(now)):
                    log.info("из корзины удалено: %s", n)
                last_purge = now
        except Exception:
            log.exception("ошибка цикла worker’а")
        await asyncio.sleep(1)


if __name__ == "__main__":
    asyncio.run(main())
