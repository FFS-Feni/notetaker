"""Ввод одной строкой: «завтра в 9 позвонить маме #дом !важно каждую неделю напомнить за час».

Распознаётся: день (сегодня, завтра, послезавтра, день недели, 25.10, 25 октября, через N минут/часов/дней/недель),
время (в 9, в 9:30, в 7 вечера, утром, днём, вечером), повтор (каждый день / неделю / месяц, каждый понедельник),
напоминание (напомнить за 10 минут / час / день), теги (#дом — существующий или новый), приоритет (!важно, !срочно, !!),
цвет (*красный, *синий …). Всё остальное — заголовок. Даты и время — в поясе пользователя.
"""

import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

WEEKDAYS = {"понедельник": 0, "вторник": 1, "сред": 2, "четверг": 3, "пятниц": 4, "суббот": 5, "воскресень": 6}
MONTHS = {"январ": 1, "феврал": 2, "март": 3, "апрел": 4, "ма": 5, "июн": 6, "июл": 7, "август": 8,
          "сентябр": 9, "октябр": 10, "ноябр": 11, "декабр": 12}
COLORS = {"красн": "red", "оранж": "orange", "жёлт": "yellow", "желт": "yellow", "зелён": "green", "зелен": "green",
          "бирюз": "teal", "син": "blue", "голуб": "blue", "фиолет": "violet", "сер": "gray"}
PARTS = {"утром": 9, "утра": 9, "днём": 13, "днем": 13, "дня": 13, "вечером": 19, "вечера": 19, "ночью": 23, "ночи": 23}
WEEKDAY_RE = r"(понедельник|вторник|сред[уа]|четверг|пятниц[уа]|суббот[уа]|воскресенье)"
MONTH_RE = r"(январ[яь]|феврал[яь]|марта?|апрел[яь]|ма[яй]|июн[яь]|июл[яь]|августа?|сентябр[яь]|октябр[яь]|ноябр[яь]|декабр[яь])"


@dataclass
class Parsed:
    title: str = ""
    start_at: datetime | None = None
    freq: str = "none"
    reminders: list[int] | None = None
    important: bool = False
    urgent: bool = False
    color: str | None = None
    tags: list[str] = field(default_factory=list)  # имена тегов (как написал пользователь)
    hints: list[str] = field(default_factory=list)  # что распознано — показываем, пока человек печатает


def _date(year: int, month: int, d: int, not_before: date | None) -> date | None:
    """Дата без года, которая уже прошла, — значит, в следующем году. Несуществующая (31.02) — не распознана."""
    try:
        out = date(year, month, d)
        return date(year + 1, month, d) if not_before and out < not_before else out
    except ValueError:
        return None


def _weekday(word: str) -> int:
    return next(v for k, v in WEEKDAYS.items() if word.startswith(k))


def parse(text: str, now: datetime, tz: str) -> Parsed:
    zone = ZoneInfo(tz)
    local = now.astimezone(zone)
    today = local.date()
    p = Parsed()
    s = f" {text} "
    day: date | None = None
    at: time | None = None
    exact: datetime | None = None  # «через 2 часа» — сразу момент

    def take(pattern: str):
        nonlocal s
        m = re.search(pattern, s, re.IGNORECASE)
        if m:
            s = s[: m.start()] + " " + s[m.end():]
        return m

    while m := take(r"(?<!\S)#([\w-]+)"):
        p.tags.append(m.group(1))
    if take(r"(?<!\S)!!(?!\S)"):
        p.important = p.urgent = True
    if take(r"(?<!\S)!важн\w*"):
        p.important = True
    if take(r"(?<!\S)!срочн\w*"):
        p.urgent = True
    if m := take(r"(?<!\S)\*(\w+)"):
        p.color = next((v for k, v in COLORS.items() if m.group(1).lower().startswith(k)), None)

    if m := take(r"\bнапомн\w*\s+за\s+(10\s*мин\w*|час|день|сутки)\b"):
        unit = m.group(1).lower()
        p.reminders = [10 if unit.startswith("10") else 60 if unit == "час" else 1440]

    if m := take(rf"\bкажд\w*\s+{WEEKDAY_RE}\b"):
        p.freq = "weekly"
        wd = _weekday(m.group(1).lower())
        day = today + timedelta(days=(wd - today.weekday()) % 7 or 7)
    elif m := take(r"\b(каждый\s+день|ежедневно|каждую\s+неделю|еженедельно|каждый\s+месяц|ежемесячно)\b"):
        w = m.group(1).lower()
        p.freq = "daily" if ("день" in w or "дневн" in w) else "weekly" if "недел" in w else "monthly"

    if m := take(r"\bчерез\s+(\d+|полчаса|час|день|неделю|месяц)\s*(минут\w*|мин|час\w*|дн\w*|день|недел\w*)?"):
        n_raw, unit = m.group(1).lower(), (m.group(2) or "").lower()
        if n_raw == "полчаса":
            exact = now + timedelta(minutes=30)
        else:
            n = 1 if not n_raw.isdigit() else int(n_raw)
            unit = unit or n_raw
            if unit.startswith("мин"):
                exact = now + timedelta(minutes=n)
            elif unit.startswith("час"):
                exact = now + timedelta(hours=n)
            elif unit.startswith(("дн", "день")):
                day = today + timedelta(days=n)
            elif unit.startswith("недел"):
                day = today + timedelta(weeks=n)
            elif unit.startswith("месяц"):
                day = today + timedelta(days=30 * n)

    if m := take(r"\b(сегодня|завтра|послезавтра)\b"):
        day = today + timedelta(days={"сегодня": 0, "завтра": 1, "послезавтра": 2}[m.group(1).lower()])
    elif m := take(rf"\b(?:в|во)?\s*{WEEKDAY_RE}\b"):
        wd = _weekday(m.group(1).lower())
        day = today + timedelta(days=(wd - today.weekday()) % 7 or 7)
    elif m := take(rf"\b(\d{{1,2}})\s+{MONTH_RE}\b"):
        month = next(v for k, v in MONTHS.items() if m.group(2).lower().startswith(k))
        day = _date(today.year, month, int(m.group(1)), today)
    elif m := take(r"\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b"):
        year = int(m.group(3)) if m.group(3) else None
        if year is not None and year < 100:
            year += 2000
        day = _date(year or today.year, int(m.group(2)), int(m.group(1)), None if year else today)

    if m := take(r"\b(?:в|к)\s+(\d{1,2})(?::(\d{2}))?(?:\s*(утра|дня|вечера|ночи))?\b"):
        h, mi, part = int(m.group(1)), int(m.group(2) or 0), (m.group(3) or "").lower()
        if part in ("дня", "вечера") and h < 12:
            h += 12
        if part == "ночи" and h == 12:
            h = 0
        at = time(h % 24, mi)
    elif m := take(r"\b(\d{1,2}):(\d{2})\b"):
        at = time(int(m.group(1)) % 24, int(m.group(2)))
    elif m := take(r"\b(утром|днём|днем|вечером|ночью)\b"):
        at = time(PARTS[m.group(1).lower()], 0)

    if exact:
        p.start_at = exact.replace(second=0, microsecond=0)
    elif day or at:
        d = day or today
        t = at or time(9, 0)
        start = datetime.combine(d, t, zone)
        if day is None and start <= now:  # «в 9 утра», а 9 уже прошло — значит, завтра
            start = datetime.combine(today + timedelta(days=1), t, zone)
        p.start_at = start

    title = re.sub(r"\s+", " ", s).strip(" ,.;:-—")
    p.title = title[:1].upper() + title[1:] if title else ""
    if p.start_at:
        p.hints.append(p.start_at.astimezone(zone).strftime("%d.%m.%Y %H:%M"))
    if p.freq != "none":
        p.hints.append({"daily": "каждый день", "weekly": "каждую неделю", "monthly": "каждый месяц"}[p.freq])
    if p.reminders:
        p.hints.append({10: "напомнить за 10 минут", 60: "напомнить за час", 1440: "напомнить за день"}[p.reminders[0]])
    if p.important:
        p.hints.append("важно")
    if p.urgent:
        p.hints.append("срочно")
    p.hints += [f"#{t}" for t in p.tags]
    return p
