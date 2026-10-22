from datetime import UTC, date, datetime, timedelta

from app.models import Note
from app.recurrence import series_starts


def note(start, freq, tz="Asia/Bishkek", until=None):
    return Note(start_at=start, freq=freq, tz=tz, until=until)


def local(xs, tz):
    from zoneinfo import ZoneInfo

    return [x.astimezone(ZoneInfo(tz)).strftime("%Y-%m-%d %H:%M") for x in xs]


def test_monthly_31st_falls_back_to_last_day():
    n = note(datetime(2026, 1, 31, 4, 0, tzinfo=UTC), "monthly")
    xs = list(series_starts(n, datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 5, 1, tzinfo=UTC)))
    assert [x.date().isoformat() for x in xs] == ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]


def test_until_is_inclusive():
    n = note(datetime(2026, 10, 1, 3, 0, tzinfo=UTC), "weekly", until=date(2026, 10, 15))
    xs = list(series_starts(n, datetime(2026, 9, 1, tzinfo=UTC), datetime(2026, 12, 1, tzinfo=UTC)))
    assert [x.day for x in xs] == [1, 8, 15]


def test_daily_keeps_local_time_across_dst():
    # В Берлине 25.10.2026 переход на зимнее время: в UTC время сдвигается, по местному — всё 09:00.
    n = note(datetime(2026, 10, 23, 7, 0, tzinfo=UTC), "daily", tz="Europe/Berlin")
    xs = list(series_starts(n, datetime(2026, 10, 23, tzinfo=UTC), datetime(2026, 10, 28, tzinfo=UTC)))
    assert local(xs, "Europe/Berlin") == [f"2026-10-{d} 09:00" for d in (23, 24, 25, 26, 27)]
    assert [x.hour for x in xs] == [7, 7, 8, 8, 8]


def test_window_far_from_start_is_fast_and_exact():
    n = note(datetime(2020, 1, 1, 3, 0, tzinfo=UTC), "daily")
    xs = list(series_starts(n, datetime(2026, 10, 22, tzinfo=UTC), datetime(2026, 10, 24, tzinfo=UTC)))
    assert len(xs) == 2


def test_single_note():
    start = datetime(2026, 10, 22, 12, 0, tzinfo=UTC)
    n = note(start, "none")
    assert list(series_starts(n, start - timedelta(days=1), start + timedelta(days=1))) == [start]
    assert list(series_starts(n, start + timedelta(seconds=1), start + timedelta(days=1))) == []
