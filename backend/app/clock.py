"""Единый источник «сейчас». Тесты подменяют now(), чтобы не ждать 10 минут до напоминания."""

from datetime import UTC, datetime


def now() -> datetime:
    return datetime.now(UTC)
