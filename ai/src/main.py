import hmac
import io
import json
import os
import subprocess
import sys
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from PIL import Image, ImageOps
from .diagnosis.classifier import Classifier

ROOT = Path(__file__).resolve().parents[1]
Image.MAX_IMAGE_PIXELS = 16_000_000


def create_app(classifier=None, token=None):
    secret = token if token is not None else os.getenv("AI_INTERNAL_TOKEN", "")
    model = classifier or Classifier(ROOT / "models/disease/best.pt", os.getenv("AI_DEVICE", "cpu"))
    app = FastAPI(title="Smart Durian internal AI", docs_url=None, redoc_url=None, openapi_url=None)

    def authorize(authorization: str = Header(default="")):
        if len(secret) < 32 or not hmac.compare_digest(authorization, "Bearer " + secret):
            raise HTTPException(401, "Unauthorized internal service")

    @app.get("/health", dependencies=[Depends(authorize)])
    def health():
        return {"status": "ok", "model_file_present": model.path.is_file(), "task": "classify"}

    async def payload(request: Request, limit: int):
        data = bytearray()
        async for block in request.stream():
            data.extend(block)
            if len(data) > limit:
                raise HTTPException(413, "File too large")
        return bytes(data)

    @app.post("/v1/classify", dependencies=[Depends(authorize)])
    async def classify(request: Request):
        data = await payload(request, 5 * 1024 * 1024)
        try:
            with Image.open(io.BytesIO(data)) as source:
                if source.format not in ("JPEG", "PNG"):
                    raise ValueError("format")
                if source.width * source.height > 16_000_000:
                    raise ValueError("pixel_limit")
                source.verify()
            with Image.open(io.BytesIO(data)) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
        except Exception:
            raise HTTPException(422, "Invalid JPEG/PNG image") from None
        try:
            # Heavy synchronous inference runs in a worker thread, not the ASGI loop.
            from starlette.concurrency import run_in_threadpool
            return await run_in_threadpool(model.predict, image)
        except Exception:
            raise HTTPException(503, "Classification model not ready or busy") from None

    @app.post("/v1/extract-pdf", dependencies=[Depends(authorize)])
    async def extract(request: Request):
        data = await payload(request, 10 * 1024 * 1024)
        try:
            from starlette.concurrency import run_in_threadpool
            result = await run_in_threadpool(subprocess.run, [sys.executable, "-m", "src.rag.worker"],
                                            input=data, capture_output=True, timeout=25, cwd=ROOT)
            if result.returncode != 0 or len(result.stdout) > 3_000_000:
                raise ValueError("extract")
            return json.loads(result.stdout)
        except Exception:
            raise HTTPException(422, "PDF cannot be extracted within limits; scan-only PDFs need OCR first") from None
    return app
