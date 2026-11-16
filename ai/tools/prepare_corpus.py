"""Create bounded derivative PDFs with an original-page manifest; never edits originals."""
import hashlib
import io
import json
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.rag.extract import extract_pdf  # noqa: E402


def digest(data):
    return hashlib.sha256(data).hexdigest()


def parts(reader, pages):
    with pymupdf.open() as writer:
        for n in pages:
            writer.insert_pdf(reader, from_page=n - 1, to_page=n - 1)
        # Shared resource dictionaries can retain all original images even in
        # one extracted page. Remove unused references, without resampling.
        for page in writer:
            page.clean_contents(sanitize=True)
        data = writer.tobytes(garbage=4, deflate=True, no_new_id=True)
    # Split instead of reducing image resolution: the original visual evidence
    # and page order remain intact. No silent truncation to satisfy API limits.
    if len(data) > 10 * 1024 * 1024 or len(pages) > 100:
        if len(pages) == 1:
            raise ValueError("single_page_exceeds_file_limit")
        half = len(pages) // 2
        yield from parts(reader, pages[:half])
        yield from parts(reader, pages[half:])
        return
    extracted = extract_pdf(data)
    yield pages, data, extracted


def prepare(root, plan):
    inbox, output = root / "data/rag/pdfs", root / "data/rag/prepared"
    output.mkdir(parents=True, exist_ok=True)
    entries, reports = [], []
    for item in plan["sources"]:
        name = item["filename"]
        if Path(name).name != name or "/" in name or "\\" in name:
            raise ValueError("source_name_must_be_basename")
        path = inbox / name
        if path.is_symlink() or path.stat().st_size > 64 * 1024 * 1024:
            raise ValueError("invalid_source_file")
        data = path.read_bytes()
        if digest(data) != item["sha256"]:
            raise ValueError("source_checksum_changed: " + name)
        reader = pymupdf.open(stream=data, filetype="pdf")
        selected = [n for first, last in item["ranges"] for n in range(first, last + 1)]
        if not selected or selected != sorted(set(selected)) or min(selected) < 1 or max(selected) > len(reader):
            raise ValueError("invalid_source_page_ranges")
        # Start with <=80 pages, then split further by actual bytes if needed.
        for offset in range(0, len(selected), 80):
            for page_map, pdf, text in parts(reader, selected[offset:offset + 80]):
                filename = f"{path.stem}__p{page_map[0]:03d}-{page_map[-1]:03d}.pdf"
                target = output / filename
                if target.is_symlink():
                    raise ValueError("prepared_file_is_symlink")
                if target.exists() and target.read_bytes() != pdf:
                    raise ValueError("prepared_file_changed_use_new_source_plan")
                if not target.exists():
                    with target.open("xb") as handle:
                        handle.write(pdf)
                title = ("[Dự thảo/Tham khảo] " if item["is_draft"] else "") + item["title"]
                title = title[:95] + f" (trang {page_map[0]}–{page_map[-1]})"
                entries.append({"filename": filename, "title": title, "sha256": digest(pdf), "source": {
                    "filename": name, "sha256": item["sha256"], "page_map": page_map, "is_draft": item["is_draft"],
                }})
                reports.append({"filename": filename, "bytes": len(pdf), "pages": len(page_map), "text_pages": len(text["pages"]), "characters": sum(len(v["text"]) for v in text["pages"])})
        reader.close()
    manifest = {"format": "smart-durian-prepared-v1", "entries": entries}
    # Replace only the generated manifest after all derivatives validate. Old
    # files remain untouched and are not implicitly activated by a folder scan.
    manifest_path = output / "manifest.json"
    if manifest_path.is_symlink():
        raise ValueError("manifest_is_symlink")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return reports


if __name__ == "__main__":
    plan = json.loads((ROOT / "corpus.sources.json").read_text(encoding="utf-8"))
    print(json.dumps(prepare(ROOT, plan), ensure_ascii=True, indent=2))
