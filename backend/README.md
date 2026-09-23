# YouTube Q&A API

Node.js/Express backend for the YouTube Q&A application. It fetches captions, creates Gemini embeddings, performs in-memory MMR retrieval, and calls either Groq or Gemini for a timestamp-cited answer.

## Run

```bash
cp .env.example .env
npm install
npm run dev
```

Production:

```bash
npm ci
npm start
```

## Test

```bash
npm test
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Runtime and cache status |
| `POST` | `/api/process-video` | Fetch and index a video transcript |
| `POST` | `/api/chat` | Answer a question about an indexed video |
| `GET` | `/docs` | Swagger UI |

`GOOGLE_API_KEY` is always required for embeddings. `GROQ_API_KEY` is required when `LLM_PROVIDER=groq`. See [the project README](../README.md) and [.env.example](.env.example) for all settings.

The index is an LRU in-memory cache. Run one Node process per service instance if requests must share the same indexed videos.
