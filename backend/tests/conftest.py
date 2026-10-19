import os
import subprocess

import asyncpg
import pytest

TEST_DSN = os.environ.get("TEST_DATABASE_DSN", "postgresql://notetaker:notetaker@localhost:5433/notetaker_test")


@pytest.fixture(scope="session", autouse=True)
def migrated_db():
    """Схема тестовой базы — та же, что даёт миграция (а не create_all)."""
    env = {**os.environ, "DATABASE_URL": TEST_DSN.replace("postgresql://", "postgresql+asyncpg://", 1)}
    subprocess.run(["alembic", "upgrade", "head"], check=True, env=env, capture_output=True)


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
