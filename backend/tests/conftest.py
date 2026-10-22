import os
import subprocess
from datetime import UTC, datetime

import asyncpg
import httpx
import pytest

TEST_DSN = os.environ.get("TEST_DATABASE_DSN", "postgresql://notetaker:notetaker@localhost:5433/notetaker_test")
# До импорта приложения: оно берёт адрес базы из окружения.
os.environ["DATABASE_URL"] = TEST_DSN.replace("postgresql://", "postgresql+asyncpg://", 1)
MAILPIT = os.environ.get("MAILPIT_URL", "http://localhost:8025")

T0 = datetime(2026, 10, 22, 12, 0, tzinfo=UTC)
TABLES = "email_outbox, notifications, reminder_jobs, occurrence_overrides, note_tags, notes, tags, sessions, users"


@pytest.fixture(scope="session", autouse=True)
def migrated_db():
    """Схема тестовой базы — та же, что даёт миграция (а не create_all)."""
    subprocess.run(["alembic", "upgrade", "head"], check=True, env=dict(os.environ), capture_output=True)


@pytest.fixture
async def conn():
    """Соединение внутри транзакции, которая откатывается после теста."""
    c = await asyncpg.connect(TEST_DSN)
    tr = c.transaction()
    await tr.start()
    try:
        yield c
    finally:
        await tr.rollback()
        await c.close()


@pytest.fixture
async def user_id(conn):
    return await conn.fetchval("INSERT INTO users (email, password_hash) VALUES ('a@example.com', 'x') RETURNING id")


@pytest.fixture
async def clean():
    c = await asyncpg.connect(TEST_DSN)
    await c.execute(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE")
    await c.close()


@pytest.fixture
async def sql(clean):
    """Прямой доступ к тестовой базе — проверить задания и письма."""
    c = await asyncpg.connect(TEST_DSN)
    yield c
    await c.close()


class Clock:
    def __init__(self, monkeypatch):
        self.now = T0
        monkeypatch.setattr("app.clock.now", lambda: self.now)

    def set(self, value: datetime) -> datetime:
        self.now = value
        return value


@pytest.fixture
def clock(monkeypatch):
    return Clock(monkeypatch)


@pytest.fixture
async def client(clean, clock):
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/auth/register", json={"email": "feni@example.com", "password": "secret1", "timezone": "Asia/Bishkek"})
        assert r.status_code == 201, r.text
        yield c


@pytest.fixture
async def mailpit():
    async with httpx.AsyncClient(base_url=MAILPIT) as m:
        await m.delete("/api/v1/messages")
        yield m
