---
title: YouTube RAG Backend
emoji: 🚀
colorFrom: blue
colorTo: red
sdk: gradio
sdk_version: 4.44.1
app_file: app.py
pinned: false
short_description: FastAPI RAG service that answers questions about YouTube videos
---

# YouTube Q&A RAG Backend

FastAPI service that fetches a YouTube transcript, indexes it with local
`all-MiniLM-L6-v2` embeddings in FAISS, and answers questions with a free LLM
API, citing `[MM:SS]` timestamps from the transcript.

A minimal Gradio demo is mounted at `/` so the Space runs on the Gradio SDK with
no Dockerfile; the JSON API used by the frontend lives under `/api`.

## Endpoints

| Method | Path                 | Purpose                                            |
| ------ | -------------------- | -------------------------------------------------- |
| `GET`  | `/`                  | Gradio smoke-test UI                                |
| `GET`  | `/api/health`        | Provider, model and cache status                    |
| `POST` | `/api/process-video` | `{ "url": "..." }` - fetch transcript, build index  |
| `POST` | `/api/chat`          | `{ "video_id", "question", "history" }` - answer    |
| `GET`  | `/docs`              | OpenAPI documentation                               |

## Space secrets

Set these under **Settings -> Variables and secrets**. Only one LLM key is
needed.

| Name              | Kind     | Notes                                              |
| ----------------- | -------- | -------------------------------------------------- |
| `GROQ_API_KEY`    | secret   | Free key from console.groq.com                      |
| `GOOGLE_API_KEY`  | secret   | Free key from aistudio.google.com (Gemini)          |
| `LLM_PROVIDER`    | variable | `groq` or `gemini`; auto-detected when unset        |
| `ALLOWED_ORIGINS` | variable | Your Vercel URL, comma separated                    |

Optional tuning: `GROQ_MODEL`, `GEMINI_MODEL`, `EMBEDDING_MODEL`, `CHUNK_SIZE`,
`CHUNK_OVERLAP`, `RETRIEVER_K`, `LLM_TEMPERATURE`, `MAX_CACHED_VIDEOS`,
`TRANSCRIPT_LANGUAGES`, `TRANSCRIPT_PROXY_URL`.

## Notes

- The embedding model (~90 MB) downloads on first boot and is then cached in the
  Space image layer; the free 2 vCPU / 16 GB tier handles it comfortably.
- Vector indexes live in memory and are capped by `MAX_CACHED_VIDEOS`. A Space
  restart clears them, and the frontend simply re-indexes on the next request.
- YouTube rate-limits datacenter IPs. If transcript fetches start failing on the
  Space, set `TRANSCRIPT_PROXY_URL` to route requests through a proxy.
