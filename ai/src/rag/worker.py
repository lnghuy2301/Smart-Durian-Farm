"""PDF parsing in a separate, time-limited process; stdout is protocol only."""
import json
import sys
from .extract import extract_pdf

try:
    data = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
    if len(data) > 10 * 1024 * 1024:
        raise ValueError("pdf_size_limit")
    print(json.dumps(extract_pdf(data), ensure_ascii=True))
except Exception:
    # Parser exceptions can contain document content or local filesystem paths.
    print(json.dumps({"error": "pdf_extraction_failed"}))
    sys.exit(1)
