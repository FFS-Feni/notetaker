"""Таблицы Notetaker.

Все моменты времени — timestamptz (в базе UTC). Пояс пользователя нужен только для отображения,
пояс серии (notes.tz) — чтобы повтор «в 9:00» оставался 9:00 по местному времени.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Table,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

REMINDER_OFFSETS = (10, 60, 1440)  # за 10 минут, за час, за день
FREQS = ("none", "daily", "weekly", "monthly")


def _id():
    return mapped_column(BigInteger, Identity(), primary_key=True)


def _now():
    return mapped_column(DateTime(timezone=True), server_default=func.now())


def _user_fk(ondelete="CASCADE", nullable=False):
    return mapped_column(BigInteger, ForeignKey("users.id", ondelete=ondelete), nullable=nullable)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (Index("uq_users_email_lower", text("lower(email)"), unique=True),)

    id: Mapped[int] = _id()
    email: Mapped[str] = mapped_column(Text)  # и логин, и адрес для писем
    password_hash: Mapped[str] = mapped_column(Text)
    timezone: Mapped[str] = mapped_column(Text, server_default="Asia/Bishkek")
    created_at: Mapped[datetime] = _now()


class UserSession(Base):
    __tablename__ = "sessions"

    # В cookie — сам токен, в базе — его sha256: утечка таблицы не даёт войти.
    token_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[int] = _user_fk()
    created_at: Mapped[datetime] = _now()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


note_tags = Table(
    "note_tags",
    Base.metadata,
    Column("note_id", UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", BigInteger, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True, index=True),
)


class Tag(Base):
    __tablename__ = "tags"
    __table_args__ = (
        Index("uq_tags_user_name", "user_id", text("lower(name)"), unique=True),
        CheckConstraint("color ~ '^#[0-9a-fA-F]{6}$'", name="color_hex"),
        CheckConstraint("length(btrim(name)) > 0", name="name_not_empty"),
    )

    id: Mapped[int] = _id()
    user_id: Mapped[int] = _user_fk()
    name: Mapped[str] = mapped_column(Text)
    color: Mapped[str] = mapped_column(Text, server_default="#5cb0ee")
    created_at: Mapped[datetime] = _now()


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (
        CheckConstraint("freq IN ('none', 'daily', 'weekly', 'monthly')", name="freq"),
        CheckConstraint("reminders <@ ARRAY[10, 60, 1440]", name="reminders"),
        CheckConstraint("until IS NULL OR freq <> 'none'", name="until_needs_freq"),
        CheckConstraint("length(btrim(title)) > 0", name="title_not_empty"),
        Index("ix_notes_user_start", "user_id", "start_at", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_notes_user_updated", "user_id", "updated_at", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_notes_user_trash", "user_id", "deleted_at", postgresql_where=text("deleted_at IS NOT NULL")),
        # Повторяющиеся заметки попадают в любой период — их календарь берёт отдельно.
        Index("ix_notes_user_recurring", "user_id", postgresql_where=text("freq <> 'none' AND deleted_at IS NULL")),
        # Поиск подстроки (в том числе по-русски) по всем заметкам, а не по видимой части списка.
        Index("ix_notes_title_trgm", "title", postgresql_using="gin", postgresql_ops={"title": "gin_trgm_ops"}),
        Index("ix_notes_body_trgm", "body", postgresql_using="gin", postgresql_ops={"body": "gin_trgm_ops"}),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[int] = _user_fk()
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text, server_default="")
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    tz: Mapped[str] = mapped_column(Text)  # пояс серии, берётся из настроек при создании
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    freq: Mapped[str] = mapped_column(Text, server_default="none")
    until: Mapped[date | None] = mapped_column(Date)  # последний день повторов, включительно
    reminders: Mapped[list[int]] = mapped_column(ARRAY(Integer), server_default="{}")  # минуты до момента заметки
    version: Mapped[int] = mapped_column(Integer, server_default="1")
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = _now()
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Матрица Эйзенхауэра: две независимые отметки → четыре квадранта.
    important: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    urgent: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    # «Фокус дня»: в какой день (по поясу пользователя) заметка — одно из трёх главных дел.
    focus_on: Mapped[date | None] = mapped_column(Date)
    # Серия, от которой отделили «начиная с этого дня».
    split_from: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("notes.id", ondelete="SET NULL"))

    tags: Mapped[list[Tag]] = relationship(secondary=note_tags, lazy="selectin", order_by=Tag.name)


class OccurrenceOverride(Base):
    """Исключение для одного вхождения серии. NULL в поле — «как в серии»."""

    __tablename__ = "occurrence_overrides"
    __table_args__ = (UniqueConstraint("note_id", "original_start"),)

    id: Mapped[int] = _id()
    note_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"))
    original_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))  # какое вхождение (по правилу серии)
    cancelled: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    title: Mapped[str | None] = mapped_column(Text)
    body: Mapped[str | None] = mapped_column(Text)
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool | None] = mapped_column(Boolean)
    version: Mapped[int] = mapped_column(Integer, server_default="1")
    updated_at: Mapped[datetime] = _now()


class ReminderJob(Base):
    """Одно напоминание об одном вхождении. Ключ уникальности не даёт создать второе такое же."""

    __tablename__ = "reminder_jobs"
    __table_args__ = (
        UniqueConstraint("note_id", "occurrence_start", "offset_min", "fire_at"),
        CheckConstraint("status IN ('pending', 'sent', 'skipped')", name="status"),
        CheckConstraint("offset_min IN (10, 60, 1440)", name="offset"),
        Index("ix_reminder_jobs_due", "fire_at", postgresql_where=text("status = 'pending'")),
    )

    id: Mapped[int] = _id()
    user_id: Mapped[int] = _user_fk()
    note_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), index=True)
    occurrence_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))  # исходное время вхождения
    offset_min: Mapped[int] = mapped_column(Integer)
    fire_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(Text, server_default="pending")
    late: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))  # отправлено после простоя сервера
    created_at: Mapped[datetime] = _now()
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Notification(Base):
    """Уведомление в интерфейсе. shown_at заполняется, когда вкладка его показала, — после F5 оно не всплывёт."""

    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint("kind IN ('reminder', 'missed')", name="kind"),
        Index("ix_notifications_unshown", "user_id", "fired_at", postgresql_where=text("shown_at IS NULL")),
    )

    id: Mapped[int] = _id()
    user_id: Mapped[int] = _user_fk()
    note_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("notes.id", ondelete="SET NULL"))
    job_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("reminder_jobs.id", ondelete="SET NULL"), unique=True)
    kind: Mapped[str] = mapped_column(Text, server_default="reminder")
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text, server_default="")
    occurrence_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fired_at: Mapped[datetime] = _now()
    shown_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EmailOutbox(Base):
    """Очередь писем. Пишется в той же транзакции, что и срабатывание напоминания; ключ — «reminder:<job_id>»."""

    __tablename__ = "email_outbox"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'sent', 'failed')", name="status"),
        Index("ix_email_outbox_pending", "created_at", postgresql_where=text("status = 'pending'")),
    )

    id: Mapped[int] = _id()
    idempotency_key: Mapped[str] = mapped_column(Text, unique=True)
    user_id: Mapped[int | None] = _user_fk(ondelete="SET NULL", nullable=True)
    to_addr: Mapped[str] = mapped_column(Text)
    subject: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="pending")
    attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _now()
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
