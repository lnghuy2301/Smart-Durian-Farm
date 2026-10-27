# Chat provider boundary

Chat orchestration, per-Farmer conversations and retrieval live in the NestJS
AI module. A provider adapter will implement its ChatProvider contract after
the user selects the API vendor. No placeholder model returns live answers.
This Python service currently owns local image inference and PDF extraction;
it never receives account credentials, writes conversations or controls IoT.
# Gemini27/10

Adapter thật ở `apps/api/src/ai/gemini.provider.ts`; cấu hình qua GEMINI_API_KEY/GEMINI_MODEL trong .env. Xem [hướng dẫn](../../../docs/GEMINI_CHATBOT_IMPLEMENTATION.md). Python không giữ key hoặc gọi Gemini; Nest xử lý auth, RAG và Mongo dùng chung. Thông tin provider pending dưới đây là checkpoint nền tảng.
