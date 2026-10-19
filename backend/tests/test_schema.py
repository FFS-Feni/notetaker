"""База сама не даёт записать неверные данные — даже если в коде ошибка."""

from datetime import datetime, timezone

import asyncpg
import pytest

T = datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc)


async def add_note(conn, user_id, **kw):
    cols = {"user_id": user_id, "title": "Планёрка", "start_at": T, "tz": "Asia/Bishkek", **kw}
    names = ", ".join(cols)
    marks = ", ".join(f"${i}" for i in range(1, len(cols) + 1))
    return await conn.fetchval(f"INSERT INTO notes ({names}) VALUES ({marks}) RETURNING id", *cols.values())


async def test_email_unique_ignoring_case(conn, user_id):
    with pytest.raises(asyncpg.UniqueViolationError):
        async with conn.transaction():
            await conn.execute("INSERT INTO users (email, password_hash) VALUES ('A@Example.com', 'x')")


async def test_tag_name_unique_per_user_ignoring_case(conn, user_id):
    other = await conn.fetchval("INSERT INTO users (email, password_hash) VALUES ('b@example.com', 'x') RETURNING id")
    await conn.execute("INSERT INTO tags (user_id, name) VALUES ($1, 'Работа')", user_id)
    await conn.execute("INSERT INTO tags (user_id, name) VALUES ($1, 'работа')", other)  # у другого — можно
    with pytest.raises(asyncpg.UniqueViolationError):
        async with conn.transaction():
            await conn.execute("INSERT INTO tags (user_id, name) VALUES ($1, 'РАБОТА')", user_id)


async def test_tag_color_must_be_hex(conn, user_id):
    with pytest.raises(asyncpg.CheckViolationError):
        async with conn.transaction():
            await conn.execute("INSERT INTO tags (user_id, name, color) VALUES ($1, 'x', 'red')", user_id)


async def test_note_defaults(conn, user_id):
    note_id = await add_note(conn, user_id)
    row = await conn.fetchrow("SELECT is_active, freq, reminders, version, deleted_at FROM notes WHERE id = $1", note_id)
    assert dict(row) == {"is_active": True, "freq": "none", "reminders": [], "version": 1, "deleted_at": None}


@pytest.mark.parametrize(
    "kw",
    [
        {"title": "   "},  # пустой заголовок
        {"reminders": [15]},  # бывают только 10 минут, час, день
        {"freq": "yearly"},
        {"until": T.date()},  # дата окончания без повтора
    ],
)
async def test_note_rejects_invalid(conn, user_id, kw):
    with pytest.raises(asyncpg.CheckViolationError):
        async with conn.transaction():
            await add_note(conn, user_id, **kw)


async def test_one_override_per_occurrence(conn, user_id):
    note_id = await add_note(conn, user_id, freq="daily")
    await conn.execute("INSERT INTO occurrence_overrides (note_id, original_start, cancelled) VALUES ($1, $2, true)", note_id, T)
    with pytest.raises(asyncpg.UniqueViolationError):
        async with conn.transaction():
            await conn.execute("INSERT INTO occurrence_overrides (note_id, original_start) VALUES ($1, $2)", note_id, T)


async def test_reminder_job_not_duplicated(conn, user_id):
    """Повторное планирование того же напоминания ничего не добавляет — основа «ровно одного письма»."""
    note_id = await add_note(conn, user_id, reminders=[10])
    insert = """INSERT INTO reminder_jobs (user_id, note_id, occurrence_start, offset_min, fire_at)
                VALUES ($1, $2, $3::timestamptz, 10, $3::timestamptz - interval '10 minutes') ON CONFLICT DO NOTHING"""
    assert await conn.execute(insert, user_id, note_id, T) == "INSERT 0 1"
    assert await conn.execute(insert, user_id, note_id, T) == "INSERT 0 0"


async def test_outbox_idempotency_key_unique(conn, user_id):
    insert = """INSERT INTO email_outbox (idempotency_key, user_id, to_addr, subject, body)
                VALUES ('reminder:1', $1, 'a@example.com', 's', 'b') ON CONFLICT DO NOTHING"""
    assert await conn.execute(insert, user_id) == "INSERT 0 1"
    assert await conn.execute(insert, user_id) == "INSERT 0 0"


async def test_search_finds_cyrillic_substring_ignoring_case(conn, user_id):
    await add_note(conn, user_id, title="Позвонить в Банк", body="")
    await add_note(conn, user_id, title="Другое", body="обсудить банковскую карту")
    await add_note(conn, user_id, title="Не про то", body="")
    found = await conn.fetch(
        "SELECT title FROM notes WHERE user_id = $1 AND (title ILIKE $2 OR body ILIKE $2) ORDER BY title", user_id, "%банк%"
    )
    assert [r["title"] for r in found] == ["Другое", "Позвонить в Банк"]


async def test_deleting_note_cascades(conn, user_id):
    note_id = await add_note(conn, user_id, reminders=[10])
    tag_id = await conn.fetchval("INSERT INTO tags (user_id, name) VALUES ($1, 't') RETURNING id", user_id)
    await conn.execute("INSERT INTO note_tags VALUES ($1, $2)", note_id, tag_id)
    await conn.execute(
        "INSERT INTO reminder_jobs (user_id, note_id, occurrence_start, offset_min, fire_at) VALUES ($1, $2, $3, 10, $3)",
        user_id, note_id, T,
    )
    await conn.execute("DELETE FROM notes WHERE id = $1", note_id)
    assert await conn.fetchval("SELECT count(*) FROM note_tags WHERE note_id = $1", note_id) == 0
    assert await conn.fetchval("SELECT count(*) FROM reminder_jobs WHERE note_id = $1", note_id) == 0
    assert await conn.fetchval("SELECT count(*) FROM tags WHERE id = $1", tag_id) == 1  # тег остаётся
