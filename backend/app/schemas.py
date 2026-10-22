import uuid
from datetime import date, datetime
from typing import Literal
from zoneinfo import available_timezones

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
COLOR = r"^#[0-9a-fA-F]{6}$"
Freq = Literal["none", "daily", "weekly", "monthly"]
Offset = Literal[10, 60, 1440]
TIMEZONES = available_timezones()


def check_tz(tz: str | None) -> str | None:
    if tz is not None and tz not in TIMEZONES:
        raise ValueError("Неизвестный часовой пояс")
    return tz


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- вход и настройки ---
class Credentials(BaseModel):
    email: str = Field(pattern=EMAIL, max_length=320)
    password: str = Field(min_length=6, max_length=200)
    timezone: str | None = None  # из браузера при регистрации

    _tz = field_validator("timezone")(check_tz)


class UserOut(ORM):
    id: int
    email: str
    timezone: str


class SettingsIn(BaseModel):
    email: str | None = Field(None, pattern=EMAIL, max_length=320)
    timezone: str | None = None

    _tz = field_validator("timezone")(check_tz)


# --- теги ---
class TagIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    color: str = Field("#5cb0ee", pattern=COLOR)

    @field_validator("name")
    @classmethod
    def strip(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Пустое имя тега")
        return v.strip()


class TagPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=50)
    color: str | None = Field(None, pattern=COLOR)

    @field_validator("name")
    @classmethod
    def strip(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("Пустое имя тега")
        return v.strip() if v else v


class TagOut(ORM):
    id: int
    name: str
    color: str


# --- заметки ---
class NoteFields(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=500)
    body: str | None = Field(None, max_length=20000)
    start_at: AwareDatetime | None = None
    is_active: bool | None = None
    freq: Freq | None = None
    until: date | None = None
    reminders: list[Offset] | None = None
    tag_ids: list[int] | None = None
    important: bool | None = None
    urgent: bool | None = None
    focus_on: date | None = None  # день, когда заметка — одно из трёх главных дел

    @field_validator("title")
    @classmethod
    def strip_title(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("Пустой заголовок")
        return v.strip() if v else v

    @field_validator("reminders")
    @classmethod
    def uniq(cls, v: list[int] | None) -> list[int] | None:
        return sorted(set(v)) if v is not None else v


class NoteIn(NoteFields):
    title: str = Field(min_length=1, max_length=500)
    start_at: AwareDatetime
    body: str = ""
    is_active: bool = True
    freq: Freq = "none"
    reminders: list[Offset] = []
    tag_ids: list[int] = []
    important: bool = False
    urgent: bool = False

    @model_validator(mode="after")
    def until_needs_freq(self):
        if self.until and self.freq == "none":
            raise ValueError("Дата окончания бывает только у повторяющейся заметки")
        return self


class NotePatch(NoteFields):
    version: int  # версия, которую видел клиент; устарела → 409


class NoteOut(ORM):
    id: uuid.UUID
    title: str
    body: str
    start_at: datetime
    tz: str
    is_active: bool
    freq: str
    until: date | None
    reminders: list[int]
    tags: list[TagOut]
    important: bool
    urgent: bool
    focus_on: date | None
    version: int
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class NotePage(BaseModel):
    items: list[NoteOut]
    total: int
    next_cursor: str | None


class TrashItem(NoteOut):
    purge_at: datetime


class OccurrenceOut(BaseModel):
    id: str
    note_id: uuid.UUID
    original_start: datetime
    start: datetime
    title: str
    body: str
    is_active: bool
    freq: str
    tags: list[TagOut]
    important: bool
    urgent: bool
    version: int


class OccurrencePatch(BaseModel):
    version: int
    title: str | None = Field(None, min_length=1, max_length=500)
    body: str | None = None
    start_at: AwareDatetime | None = None
    is_active: bool | None = None


class Upcoming(BaseModel):
    now: datetime
    focus: list[NoteOut]  # «Фокус дня» — до трёх главных дел на сегодня
    today: list[OccurrenceOut]
    week: list[OccurrenceOut]
    past: list[OccurrenceOut]


class Quadrant(BaseModel):
    total: int
    items: list[NoteOut]


class Matrix(BaseModel):
    """Матрица Эйзенхауэра: do — важно и срочно, plan — важно, delegate — срочно, drop — ни то ни другое."""

    do: Quadrant
    plan: Quadrant
    delegate: Quadrant
    drop: Quadrant


class NotificationOut(ORM):
    id: int
    kind: str
    title: str
    body: str
    note_id: uuid.UUID | None
    occurrence_start: datetime | None
    fired_at: datetime
    shown_at: datetime | None
