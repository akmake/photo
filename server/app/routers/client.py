"""
The client's side of a gallery — no account, just the link and an optional code.
This is what the photographer sends; the whole point of the platform's second
half (docs/CLIENT-GALLERY.md).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Gallery, GalleryImage, GallerySelection
from ..services.storage import get_storage

router = APIRouter(prefix="/g", tags=["client-gallery"])


def _gallery_by_token(db: Session, token: str) -> Gallery:
    g = db.scalar(select(Gallery).where(Gallery.token == token))
    if g is None or g.status != "published":
        raise HTTPException(404, "הגלריה לא נמצאה או אינה פתוחה")
    return g


class OpenIn(BaseModel):
    code: str | None = None


@router.post("/{token}/open")
def open_gallery(token: str, body: OpenIn, db: Session = Depends(get_db)) -> dict:
    g = _gallery_by_token(db, token)
    if g.access_code and (body.code or "").strip() != g.access_code:
        raise HTTPException(401, "קוד גישה שגוי")
    storage = get_storage()
    return {
        "title": g.title,
        "client_name": g.client_name,
        "images": [
            {
                "id": im.id,
                "thumb_url": storage.public_url(im.thumb_key) if im.thumb_key else None,
                "preview_url": storage.public_url(im.preview_key) if im.preview_key else None,
                "selected": bool(im.selection and im.selection.selected),
                "note": im.selection.note if im.selection else "",
            }
            for im in sorted(g.images, key=lambda x: x.ordering)
        ],
    }


class SelectIn(BaseModel):
    code: str | None = None
    image_id: int
    selected: bool = True
    note: str = ""


@router.post("/{token}/select")
def select_image(token: str, body: SelectIn, db: Session = Depends(get_db)) -> dict:
    g = _gallery_by_token(db, token)
    if g.access_code and (body.code or "").strip() != g.access_code:
        raise HTTPException(401, "קוד גישה שגוי")

    im = db.get(GalleryImage, body.image_id)
    if im is None or im.gallery_id != g.id:
        raise HTTPException(404, "תמונה לא נמצאה")

    sel = im.selection
    if sel is None:
        sel = GallerySelection(gallery_id=g.id, image_id=im.id)
        db.add(sel)
    sel.selected = body.selected
    sel.note = body.note
    db.commit()
    return {"ok": True, "image_id": im.id, "selected": sel.selected}
