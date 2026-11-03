import hashlib
import re
from pathlib import Path
from fastapi import HTTPException, UploadFile
from app.config import get_settings


ALLOWED = {"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg"}


def safe_name(name: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(name).name).strip("._")
    return stem[:120] or "upload"


async def save_upload(file: UploadFile, scope: str, object_id: str) -> tuple[str, str, int]:
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED:
        raise HTTPException(415, "Only PDF, PNG, and JPEG files are accepted")
    data = await file.read(get_settings().max_upload_mb * 1024 * 1024 + 1)
    if len(data) > get_settings().max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "File exceeds configured upload limit")
    signatures = {"application/pdf": b"%PDF-", "image/png": b"\x89PNG", "image/jpeg": b"\xff\xd8\xff"}
    if not data.startswith(signatures[content_type]):
        raise HTTPException(400, "File content does not match its declared type")
    digest = hashlib.sha256(data).hexdigest()
    directory = get_settings().storage_root / "uploads" / scope / object_id
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{digest[:16]}-{safe_name(file.filename or 'upload')}{ALLOWED[content_type] if not Path(file.filename or '').suffix else ''}"
    path.write_bytes(data)
    return str(path.resolve()), digest, len(data)


def private_path(uri: str) -> Path:
    path = Path(uri).resolve()
    root = get_settings().storage_root.resolve()
    if root not in path.parents:
        raise HTTPException(403, "Invalid storage path")
    return path

