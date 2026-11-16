import io
import re
import unicodedata
from pypdf import PdfReader

MAX_PAGES = 100
MAX_TEXT = 400_000


def readable_text(text: str):
    # Some Vietnamese PDF fonts expose Unicode glyph names instead of characters.
    # Decode only explicit four-digit Unicode names; never guess lost characters.
    text = re.sub(r"/uni([0-9a-fA-F]{4})", lambda match: chr(int(match[1], 16)), text)
    text = unicodedata.normalize("NFC", text)
    if any((ord(c) < 32 and c not in "\r\n\t\f") or 0xD800 <= ord(c) <= 0xDFFF for c in text):
        raise ValueError("pdf_corrupt_font_encoding_requires_replacement_or_ocr")
    return text


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
        text = readable_text(page.extract_text() or "").strip()
        total += len(text)
        if total > MAX_TEXT:
            raise ValueError("pdf_text_limit")
        if text:
            pages.append({"page": number, "text": text})
    if not pages:
        raise ValueError("pdf_has_no_extractable_text")
    return {"page_count": len(reader.pages), "pages": pages}
