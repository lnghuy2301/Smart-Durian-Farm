# Chat provider boundary

Chat orchestration, per-Farmer conversations and retrieval live in the NestJS
AI module. A provider adapter will implement its ChatProvider contract after
the user selects the API vendor. No placeholder model returns live answers.
This Python service currently owns local image inference and PDF extraction;
it never receives account credentials, writes conversations or controls IoT.
