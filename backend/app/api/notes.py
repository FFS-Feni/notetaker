import base64
import uuid
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import and_, exists, func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.deps import current_user, get_db
from app.events import emit
from app.history import record, snapshot
from app.models import Note, NoteEvent, Tag, User, note_tags
from app.quickadd import parse as parse_quick
from app.notes import check_focus_limit, check_version, get_note, purge_at, resolve_tags, touch
from app.planner import replan
from app.schemas import Matrix, NoteEventOut, NoteIn, NoteOut, NotePage, NotePatch, Prefs, Quadrant, QuickIn, QuickParsed, TrashItem

router = APIRouter(prefix="/api", tags=["заметки"])
NOT_NULL = {"title", "body", "start_at", "is_active", "freq", "reminders", "important", "urgent", "triaged", "checklist"}


def _ids(raw: str | None, what: str) -> list[int]:
    try:
        return [int(x) for x in (raw or "").split(",") if x]
    except ValueError:
        raise HTTPException(400, f"{what} — числа через запятую")


def _search(stmt, q: str | None, tags: str | None, colors: str | None):
    """Общие фильтры списка и корзины: подстрока в заголовке/тексте, любой из тегов, любой из цветов."""
    if q and q.strip():
        pattern = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(or_(Note.title.ilike(pattern, escape="\\"), Note.body.ilike(pattern, escape="\\")))
    if tag_ids := _ids(tags, "tags"):
        stmt = stmt.where(exists().where(note_tags.c.note_id == Note.id, note_tags.c.tag_id.in_(tag_ids)))
    if colors:
        wanted = [c for c in colors.split(",") if c]
        cond = Note.color.in_([c for c in wanted if c != "none"])
        stmt = stmt.where(or_(cond, Note.color.is_(None)) if "none" in wanted else cond)
    return stmt


def _enc(value: datetime, note_id: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{value.isoformat()}|{note_id}".encode()).decode()


def _dec(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        value, note_id = base64.urlsafe_b64decode(cursor.encode()).decode().split("|")
        return datetime.fromisoformat(value), uuid.UUID(note_id)
    except ValueError:
        raise HTTPException(400, "Неверный курсор")


@router.get("/notes", response_model=NotePage)
async def list_notes(
    q: str | None = None,
    tags: str | None = Query(None, description="id тегов через запятую — заметка с любым из них"),
    status: Literal["all", "active", "inactive"] = "all",
    important: bool | None = None,
    urgent: bool | None = None,
    color: str | None = Query(None, description="цвета через запятую; none — без цвета"),
    triaged: bool | None = None,
    frm: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
    sort: Literal["start", "updated"] = "start",
    order: Literal["asc", "desc"] = "asc",
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Поиск и фильтры считает база по всем заметкам; страницы — по курсору, без OFFSET."""
    stmt = _search(select(Note).where(Note.user_id == user.id, Note.deleted_at.is_(None)), q, tags, color)
    if triaged is not None:
        stmt = stmt.where(Note.triaged.is_(triaged))
    if status != "all":
        stmt = stmt.where(Note.is_active.is_(status == "active"))
    if important is not None:
        stmt = stmt.where(Note.important.is_(important))
    if urgent is not None:
        stmt = stmt.where(Note.urgent.is_(urgent))
    if frm or to:
        once = [Note.freq == "none"]
        repeating = [Note.freq != "none"]
        if frm:
            once.append(Note.start_at >= frm)
            repeating.append(or_(Note.until.is_(None), Note.until >= frm.date()))
        if to:
            once.append(Note.start_at < to)
            repeating.append(Note.start_at < to)
        stmt = stmt.where(or_(and_(*once), and_(*repeating)))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    col = Note.start_at if sort == "start" else Note.updated_at
    if cursor:
        value, last_id = _dec(cursor)
        key, after = tuple_(col, Note.id), tuple_(value, last_id)
        stmt = stmt.where(key > after if order == "asc" else key < after)
    if order == "asc":
        stmt = stmt.order_by(col.asc(), Note.id.asc())
    else:
        stmt = stmt.order_by(col.desc(), Note.id.desc())
    rows = (await db.scalars(stmt.limit(limit + 1))).all()
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _enc(last.start_at if sort == "start" else last.updated_at, last.id)
    return NotePage(items=rows, total=total, next_cursor=next_cursor)


@router.post("/notes", response_model=NoteOut, status_code=201)
async def create_note(data: NoteIn, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    now = clock.now()
    note = Note(
        user_id=user.id,
        title=data.title,
        body=data.body,
        start_at=data.start_at,
        tz=user.timezone,  # пояс серии фиксируется при создании
        is_active=data.is_active,
        freq=data.freq,
        until=data.until,
        reminders=data.reminders,
        important=data.important,
        urgent=data.urgent,
        focus_on=data.focus_on,
        color=data.color,
        triaged=data.triaged or data.important or data.urgent,
        checklist=[i.model_dump() for i in data.checklist or []],
        version=1,
        created_at=now,
        updated_at=now,
        tags=await resolve_tags(db, user, data.tag_ids),
    )
    await check_focus_limit(db, user, data.focus_on, None)
    db.add(note)
    await db.flush()
    await replan(db, note, now)
    await record(db, note, user, request, "created")
    await emit(db, user.id, "notes", id=str(note.id))
    await db.commit()
    return note


async def _quick(db: AsyncSession, user: User, text: str) -> QuickParsed:
    now = clock.now()
    p = parse_quick(text, now, user.timezone)
    tags = {t.name.lower(): t for t in await db.scalars(select(Tag).where(Tag.user_id == user.id))}
    start = p.start_at or (now + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    return QuickParsed(
        title=p.title, start_at=start, freq=p.freq,
        reminders=p.reminders if p.reminders is not None else Prefs.model_validate(user.prefs or {}).default_reminders,
        important=p.important, urgent=p.urgent, color=p.color,
        tag_ids=[tags[n.lower()].id for n in p.tags if n.lower() in tags],
        new_tags=list(dict.fromkeys(n for n in p.tags if n.lower() not in tags)),
        hints=p.hints,
    )


@router.post("/notes/parse", response_model=QuickParsed)
async def parse_note(data: QuickIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Что поняли из строки — для подсказки, пока человек печатает. Ничего не создаёт."""
    return await _quick(db, user, data.text)


@router.post("/notes/quick", response_model=NoteOut, status_code=201)
async def quick_note(data: QuickIn, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Заметка одной строкой: «завтра в 9 позвонить маме #дом !важно». Новые теги создаются сами."""
    q = await _quick(db, user, data.text)
    if not q.title:
        raise HTTPException(422, "Напишите, что сделать — например, «завтра в 9 позвонить маме»")
    for name in q.new_tags:
        tag = Tag(user_id=user.id, name=name, color="#868e96")
        db.add(tag)
        await db.flush()
        q.tag_ids.append(tag.id)
    note_in = NoteIn(title=q.title, start_at=q.start_at, freq=q.freq, reminders=q.reminders, important=q.important,
                     urgent=q.urgent, color=q.color, tag_ids=q.tag_ids)
    return await create_note(note_in, request, user, db)


@router.get("/notes/{note_id}/history", response_model=list[NoteEventOut])
async def note_history(note_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Кто, когда, откуда и что менял — новые сверху."""
    await get_note(db, user, note_id)
    rows = await db.execute(
        select(NoteEvent, User.name, User.email)
        .outerjoin(User, User.id == NoteEvent.user_id)
        .where(NoteEvent.note_id == note_id)
        .order_by(NoteEvent.at.desc(), NoteEvent.id.desc())
        .limit(100)
    )
    return [
        NoteEventOut(id=e.id, at=e.at, action=e.action, changes=e.changes, device=e.device,
                     user_name=name or (email.split("@")[0] if email else "—"))
        for e, name, email in rows
    ]


@router.get("/notes/{note_id}", response_model=NoteOut)
async def read_note(note_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await get_note(db, user, note_id)


@router.patch("/notes/{note_id}", response_model=NoteOut)
async def update_note(note_id: uuid.UUID, data: NotePatch, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    note = await get_note(db, user, note_id, lock=True)
    if note.deleted_at is not None:
        raise HTTPException(409, "Заметка в корзине — сначала восстановите её")
    check_version(note, data.version)
    if "focus_on" in data.model_fields_set:
        await check_focus_limit(db, user, data.focus_on, note.id)
    now = clock.now()
    before = snapshot(note)
    fields = data.model_dump(exclude_unset=True, exclude={"version", "tag_ids"})
    for key, value in fields.items():
        if value is None and key in NOT_NULL:
            continue
        setattr(note, key, value)  # checklist уже словари: model_dump выше
    if data.tag_ids is not None:
        note.tags = await resolve_tags(db, user, data.tag_ids)
    if note.freq == "none":
        note.until = None
    if (data.important or data.urgent) and "triaged" not in data.model_fields_set:
        note.triaged = True  # отметили «важно/срочно» — задача разобрана
    touch(note, now)
    await replan(db, note, now)
    await record(db, note, user, request, "updated", before)
    await emit(db, user.id, "notes", id=str(note.id), version=note.version)
    await db.commit()
    return note


@router.delete("/notes/{note_id}", status_code=204)
async def trash_note(note_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    note = await get_note(db, user, note_id, lock=True)
    if note.deleted_at is None:
        now = clock.now()
        note.deleted_at = now
        touch(note, now)
        await replan(db, note, now)  # в корзине — напоминаний нет
        await record(db, note, user, request, "trashed")
        await emit(db, user.id, "notes", id=str(note.id))
        await db.commit()


@router.get("/matrix", response_model=Matrix)
async def matrix(limit: int = Query(50, ge=1, le=200), user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Разобранные активные задачи по блокам «важно × срочно». Сначала самые ранние — просроченное наверху.
    Неразобранные (triaged = false) сюда не попадают — они в списке «Неразобранные» на доске."""
    base = select(Note).where(Note.user_id == user.id, Note.deleted_at.is_(None), Note.is_active, Note.triaged)
    out = {}
    for name, important, urgent in (("do", True, True), ("plan", True, False), ("delegate", False, True), ("drop", False, False)):
        stmt = base.where(Note.important.is_(important), Note.urgent.is_(urgent))
        total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
        items = (await db.scalars(stmt.order_by(Note.start_at, Note.id).limit(limit))).all()
        out[name] = Quadrant(total=total, items=items)
    return Matrix(**out)


@router.get("/trash", response_model=list[TrashItem])
async def list_trash(
    q: str | None = None,
    tags: str | None = None,
    color: str | None = None,
    deleted_from: datetime | None = None,
    deleted_to: datetime | None = None,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Корзина с теми же фильтрами, что и список, плюс период удаления."""
    stmt = _search(select(Note).where(Note.user_id == user.id, Note.deleted_at.is_not(None)), q, tags, color)
    if deleted_from:
        stmt = stmt.where(Note.deleted_at >= deleted_from)
    if deleted_to:
        stmt = stmt.where(Note.deleted_at < deleted_to)
    notes = await db.scalars(stmt.order_by(Note.deleted_at.desc()).limit(500))
    return [TrashItem(**NoteOut.model_validate(n).model_dump(), purge_at=purge_at(n)) for n in notes]


@router.post("/trash/{note_id}/restore", response_model=NoteOut)
async def restore_note(note_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    note = await get_note(db, user, note_id, lock=True)
    if note.deleted_at is None:
        raise HTTPException(409, "Заметка не в корзине")
    now = clock.now()
    note.deleted_at = None
    touch(note, now)
    await replan(db, note, now)  # вернутся только напоминания, чей срок ещё не наступил
    await record(db, note, user, request, "restored")
    await emit(db, user.id, "notes", id=str(note.id))
    await db.commit()
    return note


@router.delete("/trash/{note_id}", status_code=204)
async def delete_forever(note_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    note = await get_note(db, user, note_id, lock=True)
    if note.deleted_at is None:
        raise HTTPException(409, "Удалить навсегда можно только из корзины")
    await db.delete(note)
    await emit(db, user.id, "notes", id=str(note_id))
    await db.commit()
