import io
from pypdf import PdfReader

MAX_PAGES = 100
MAX_TEXT = 400_000


def extract_pdf(data: bytes):
    if not data.startswith(b"%PDF-"):
        raise ValueError("invalid_pdf")
    reader = PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted:
        raise ValueError("encrypted_pdf_not_supported")
    if not 0 < len(reader.pages) <= MAX_PAGES:
        raise ValueError("pdf_page_limit")
    pages = []
    total = 0
    for number, page in enumerate(reader.pages, 1):
        content = page.get_contents()
        if content and len(content.get_data()) > 3_000_000:
            raise ValueError("pdf_content_limit")
        text = (page.extract_text() or "").strip()
        total += len(text)
        if total > MAX_TEXT:
            raise ValueError("pdf_text_limit")
        if text:
            pages.append({"page": number, "text": text})
    if not pages:
        raise ValueError("pdf_has_no_extractable_text")
    return {"page_count": len(reader.pages), "pages": pages}
