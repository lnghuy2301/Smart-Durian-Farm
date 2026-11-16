# AI worker

Private loopback FastAPI service for YOLO11s-cls image classification and bounded PDF extraction. NestJS owns authentication, RAG retrieval, Groq/Gemini calls and persistence.

See [architecture](../docs/ARCHITECTURE.md), [setup and tests](../docs/RUNBOOK.md) and [deployment gates](../docs/DEPLOYMENT.md).

- Weights: `models/disease/best.pt` (not committed).
- Original PDFs: `data/rag/pdfs/`; prepared durian-only corpus: `data/rag/prepared/`.
- Private assets: `storage/diagnostics/` and `storage/rag-documents/`.
- Start from repository root: `npm run dev:ai`; test: `npm run test:ai`.
- The checked inference lock is from Windows CPU. Verify platform-specific wheels and actual model loading before Linux deployment.
- The worker has no public API, account credentials or hardware-control tools. No model/answer is fabricated when dependencies or providers are unavailable.
