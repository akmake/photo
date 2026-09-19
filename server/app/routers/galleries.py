"""
Client galleries — the area the photographer sends to the client (the second
half of the platform). Decisions come from docs/CLIENT-GALLERY.md:

* Only derived previews/thumbs are uploaded, never the original RAW.
* The VPS is the brain (who opened which gallery, who marked what); the bytes sit
  in object storage (local disk in dev, B2 in prod) behind a CDN.

The photographer's app (engine) creates a gallery, registers each frame, and
uploads its two small sizes. The client opens a link, marks selections and notes,
and the app pulls those choices back to start editing.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import Gallery, GalleryImage, GallerySelection, User
from ..services.storage import get_storage

router = APIRouter(prefix="/galleries", tags=["galleries"])


# ------------------------------------------------------------- owner: manage

class GalleryIn(BaseModel):
    title: str = ""
    client_name: str = ""
    access_code: str | None = None


class ImageIn(BaseModel):
    filename: str
    width: int = 0
    height: int = 0
    ordering: int = 0


def _own_gallery(db: Session, user: User, gallery_id: int) -> Gallery:
    g = db.get(Gallery, gallery_id)
    if g is None or g.user_id != user.id:
        raise HTTPException(404, "גלריה לא נמצאה")
    return g


@router.post("")
def create_gallery(body: GalleryIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    g = Gallery(
        user_id=user.id,
        title=body.title.strip(),
        client_name=body.client_name.strip(),
        access_code=(body.access_code or None),
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return {"id": g.id, "token": g.token, "status": g.status}


@router.get("")
def list_galleries(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(Gallery).where(Gallery.user_id == user.id).order_by(Gallery.id.desc())).all()
    return {
        "galleries": [
            {
                "id": g.id,
                "title": g.title,
                "client_name": g.client_name,
                "token": g.token,
                "status": g.status,
                "images": len(g.images),
            }
            for g in rows
        ]
    }


@router.get("/{gallery_id}")
def get_gallery(gallery_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    g = _own_gallery(db, user, gallery_id)
    storage = get_storage()
    return {
        "id": g.id,
        "title": g.title,
        "client_name": g.client_name,
        "token": g.token,
        "access_code": g.access_code,
        "status": g.status,
        "images": [
            {
                "id": im.id,
                "filename": im.filename,
                "preview_url": storage.public_url(im.preview_key) if im.preview_key else None,
                "thumb_url": storage.public_url(im.thumb_key) if im.thumb_key else None,
                "selected": bool(im.selection and im.selection.selected),
                "note": im.selection.note if im.selection else "",
            }
            for im in sorted(g.images, key=lambda x: x.ordering)
        ],
    }


@router.post("/{gallery_id}/images")
def register_image(gallery_id: int, body: ImageIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    g = _own_gallery(db, user, gallery_id)
    im = GalleryImage(
        gallery_id=g.id,
        filename=body.filename,
        width=body.width,
        height=body.height,
        ordering=body.ordering,
    )
    db.add(im)
    db.flush()
    im.preview_key = f"{g.token}/{im.id}_preview.jpg"
    im.thumb_key = f"{g.token}/{im.id}_thumb.jpg"
    db.commit()
    db.refresh(im)
    return {"id": im.id, "preview_key": im.preview_key, "thumb_key": im.thumb_key}


async def _store_upload(db: Session, user: User, gallery_id: int, image_id: int, which: str, file: UploadFile) -> dict:
    g = _own_gallery(db, user, gallery_id)
    im = db.get(GalleryImage, image_id)
    if im is None or im.gallery_id != g.id:
        raise HTTPException(404, "תמונה לא נמצאה")
    key = im.preview_key if which == "preview" else im.thumb_key
    data = await file.read()
    get_storage().put(key, data, content_type=file.content_type or "image/jpeg")
    return {"ok": True, "key": key, "bytes": len(data)}


@router.put("/{gallery_id}/images/{image_id}/preview")
async def upload_preview(gallery_id: int, image_id: int, file: UploadFile, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return await _store_upload(db, user, gallery_id, image_id, "preview", file)


@router.put("/{gallery_id}/images/{image_id}/thumb")
async def upload_thumb(gallery_id: int, image_id: int, file: UploadFile, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return await _store_upload(db, user, gallery_id, image_id, "thumb", file)


@router.post("/{gallery_id}/publish")
def publish(gallery_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    g = _own_gallery(db, user, gallery_id)
    if not g.images:
        raise HTTPException(400, "אין תמונות בגלריה")
    g.status = "published"
    db.commit()
    return {"id": g.id, "status": g.status, "token": g.token}


@router.get("/{gallery_id}/selections")
def owner_selections(gallery_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """What the app pulls back: the client's picks, by original filename."""
    g = _own_gallery(db, user, gallery_id)
    picks = []
    for im in g.images:
        if im.selection and im.selection.selected:
            picks.append({"filename": im.filename, "note": im.selection.note})
    return {"gallery_id": g.id, "selected": picks, "count": len(picks)}


# ------------------------------------------------------------- assets (dev)

@router.get("/asset/{token}/{name}")
def serve_asset(token: str, name: str) -> Response:
    """Dev-only byte serving. In production the CDN serves these, not the API."""
    storage = get_storage()
    key = f"{token}/{name}"
    if not storage.exists(key):
        raise HTTPException(404, "לא נמצא")
    return Response(content=storage.get(key), media_type="image/jpeg")
