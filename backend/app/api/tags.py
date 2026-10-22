from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import current_user, get_db
from app.events import emit
from app.models import Note, Tag, User, note_tags
from app.schemas import TagIn, TagOut, TagPatch, TagWithCount

router = APIRouter(prefix="/api/tags", tags=["теги"])
DUPLICATE = "Тег с таким именем уже есть"


async def _get(db: AsyncSession, user: User, tag_id: int) -> Tag:
    tag = await db.scalar(select(Tag).where(Tag.id == tag_id, Tag.user_id == user.id))
    if tag is None:
        raise HTTPException(404, "Тег не найден")
    return tag


@router.get("", response_model=list[TagWithCount])
async def list_tags(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Теги со счётчиком заметок (без корзины) — видно, какой тег живой, а какой можно удалить."""
    count = (
        select(func.count())
        .select_from(note_tags.join(Note, Note.id == note_tags.c.note_id))
        .where(note_tags.c.tag_id == Tag.id, Note.deleted_at.is_(None))
        .scalar_subquery()
    )
    rows = await db.execute(select(Tag, count).where(Tag.user_id == user.id).order_by(func.lower(Tag.name)))
    return [TagWithCount(id=t.id, name=t.name, color=t.color, count=n) for t, n in rows]


@router.post("", response_model=TagOut, status_code=201)
async def create_tag(data: TagIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    tag = Tag(user_id=user.id, name=data.name, color=data.color)
    db.add(tag)
    try:
        await db.flush()
    except IntegrityError:
        raise HTTPException(409, DUPLICATE)
    await emit(db, user.id, "tags")
    await db.commit()
    return tag


@router.patch("/{tag_id}", response_model=TagOut)
async def update_tag(tag_id: int, data: TagPatch, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    tag = await _get(db, user, tag_id)
    if data.name is not None:
        tag.name = data.name
    if data.color is not None:
        tag.color = data.color
    try:
        await db.flush()
    except IntegrityError:
        raise HTTPException(409, DUPLICATE)
    await emit(db, user.id, "tags")
    await db.commit()
    return tag


@router.delete("/{tag_id}", status_code=204)
async def delete_tag(tag_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    # Связи с заметками удаляются каскадом, сами заметки остаются.
    await db.delete(await _get(db, user, tag_id))
    await emit(db, user.id, "tags")
    await db.commit()
