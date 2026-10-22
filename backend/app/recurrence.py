"""Развёртка повторов и исключений отдельных вхождений.

Вхождения не хранятся: они вычисляются для нужного периода в «настенном» времени пояса серии —
«каждый день в 9:00» остаётся 9:00 и при переходе на летнее время, и после смены пояса в настройках.
"""

import calendar
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.models import Note, OccurrenceOverride

STEP_DAYS = {"daily": 1, "weekly": 7}
# Исключение может перенести вхождение на другой день — берём серию с запасом, потом фильтруем по новому времени.
MARGIN = timedelta(days=31)


def _add_months(d: date, months: int, day: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    y += d.year
    m += 1
    # 31-е в коротком месяце → последний день месяца.
    return date(y, m, min(day, calendar.monthrange(y, m)[1]))


def series_starts(note: Note, frm: datetime, to: datetime) -> Iterator[datetime]:
    """Исходные моменты вхождений серии в [frm, to), в UTC."""
    if note.freq == "none":
        if frm <= note.start_at < to:
            yield note.start_at
        return
    zone = ZoneInfo(note.tz)
    local = note.start_at.astimezone(zone)
    base, wall = local.date(), local.time().replace(tzinfo=None)
    frm_local = frm.astimezone(zone).date()
    # Не перебираем с начала серии: прыгаем почти к frm.
    if note.freq == "monthly":
        k = max(0, (frm_local.year - base.year) * 12 + frm_local.month - base.month - 1)
    else:
        k = max(0, (frm_local - base).days // STEP_DAYS[note.freq] - 1)
    while True:
        if note.freq == "monthly":
            d = _add_months(base, k, base.day)
        else:
            d = base + timedelta(days=STEP_DAYS[note.freq] * k)
        if note.until and d > note.until:
            return
        at = datetime.combine(d, wall, zone).astimezone(UTC)
        if at >= to:
            return
        if at >= frm:
            yield at
        k += 1


@dataclass
class Occurrence:
    note: Note
    original_start: datetime
    start: datetime
    title: str
    body: str
    is_active: bool

    @property
    def id(self) -> str:
        return f"{self.note.id}:{self.original_start.isoformat()}"


def expand(note: Note, overrides: dict[datetime, OccurrenceOverride], frm: datetime, to: datetime) -> list[Occurrence]:
    out = []
    for orig in series_starts(note, frm - MARGIN, to + MARGIN):
        ov = overrides.get(orig)
        if ov and ov.cancelled:
            continue
        start = ov.start_at if ov and ov.start_at else orig
        if not frm <= start < to:
            continue
        out.append(
            Occurrence(
                note=note,
                original_start=orig,
                start=start,
                title=ov.title if ov and ov.title is not None else note.title,
                body=ov.body if ov and ov.body is not None else note.body,
                is_active=note.is_active and not (ov and ov.is_active is False),
            )
        )
    return out
