import base64
import io
from pathlib import Path
import fitz
from PIL import Image
from app.config import get_settings

PAGE_RENDER_SCALE = 1.8


def inspect_pdf(path: str) -> tuple[int, list[dict], bool]:
    with fitz.open(path) as doc:
        if doc.page_count > get_settings().max_pdf_pages:
            raise ValueError("PDF exceeds configured page limit")
        pages, searchable = [], False
        for index, page in enumerate(doc):
            rect = page.rect
            text = page.get_text("text").strip()
            searchable = searchable or bool(text)
            pages.append({"page_index": index, "width": rect.width, "height": rect.height, "rotation": page.rotation})
        return doc.page_count, pages, searchable


def page_images(path: str, max_pages: int | None = None) -> list[str]:
    output = []
    with fitz.open(path) as doc:
        for page in list(doc)[:max_pages]:
            pix = page.get_pixmap(matrix=fitz.Matrix(PAGE_RENDER_SCALE, PAGE_RENDER_SCALE), alpha=False)
            output.append(base64.b64encode(pix.tobytes("png")).decode("ascii"))
    return output


def render_page_png(path: str, page_index: int, scale: float = PAGE_RENDER_SCALE) -> bytes:
    with fitz.open(path) as doc:
        if page_index < 0 or page_index >= doc.page_count:
            raise IndexError("Page index is outside the PDF")
        page = doc[page_index]
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        return pix.tobytes("png")


def image_as_base64(path: str) -> str:
    with Image.open(path) as image:
        image.verify()
    return base64.b64encode(Path(path).read_bytes()).decode("ascii")


def render_filled(source: str, fields: list[dict], destination: str) -> None:
    doc = fitz.open(source)
    try:
        for item in fields:
            if not item.get("value"):
                continue
            page = doc[item["page_index"]]
            x0, y0, x1, y1 = item["bbox_norm"]
            rect = fitz.Rect(x0 * page.rect.width, y0 * page.rect.height, x1 * page.rect.width, y1 * page.rect.height)
            if item.get("field_type") in {"checkbox", "radio"}:
                if str(item["value"]).lower() in {"true", "yes", "1", "checked"}:
                    page.insert_textbox(rect, "X", fontsize=max(7, min(12, rect.height * .8)), align=1)
            else:
                size = max(5, min(11, rect.height * .65))
                page.insert_textbox(rect, str(item["value"]), fontsize=size, fontname="helv", color=(0, 0, 0))
        Path(destination).parent.mkdir(parents=True, exist_ok=True)
        doc.save(destination, garbage=4, deflate=True)
    finally:
        doc.close()

