# YouTube Q&A RAG Backend

FastAPI service that fetches a YouTube transcript, indexes it in FAISS using
Gemini `gemini-embedding-001` embeddings, and answers questions with a free LLM
API, citing `[MM:SS]` timestamps from the transcript.

There are no local model weights: embeddings are an API call, so the process
stays near 200 MB and boots with nothing to download.

## Endpoints

| Method | Path                 | Purpose                                            |
| ------ | -------------------- | -------------------------------------------------- |
| `GET`  | `/`                  | Service index                                       |
| `GET`  | `/api/health`        | Provider, model and cache status                    |
| `POST` | `/api/process-video` | `{ "url": "..." }` - fetch transcript, build index  |
| `POST` | `/api/chat`          | `{ "video_id", "question", "history" }` - answer    |
| `GET`  | `/docs`              | OpenAPI documentation                               |

## Environment

`GOOGLE_API_KEY` is always required because it serves the retrieval embeddings.
The Groq key is only needed when Groq is the generation provider.

| Name              | Required            | Notes                                       |
| ----------------- | ------------------- | ------------------------------------------- |
| `GOOGLE_API_KEY`  | always              | Serves the embeddings, and Gemini generation |
| `GROQ_API_KEY`    | when provider=groq  | Free key from console.groq.com               |
| `LLM_PROVIDER`    | no                  | `groq` or `gemini`; auto-detected when unset |
| `ALLOWED_ORIGINS` | no                  | Extra browser origins, comma separated       |

Optional tuning: `GROQ_MODEL`, `GEMINI_MODEL`, `EMBEDDING_MODEL`, `CHUNK_SIZE`,
`CHUNK_OVERLAP`, `RETRIEVER_K`, `LLM_TEMPERATURE`, `MAX_CACHED_VIDEOS`,
`TRANSCRIPT_LANGUAGES`, `TRANSCRIPT_PROXY_URL`.

## Deployment

`render.yaml` at the repository root defines this service as a Render Blueprint
(free plan, `rootDir: backend`). Any host that runs a long-lived uvicorn process
works the same way:

```bash
uvicorn app:app --host 0.0.0.0 --port $PORT --workers 1
```

Keep it to a single worker. The vector store lives in the process, so extra
workers would each hold their own copy and miss each other's cache.

## Notes

- Vector indexes live in memory and are capped by `MAX_CACHED_VIDEOS`. A restart
  clears them, and the frontend re-indexes on the next request.
- On Render's free plan the service sleeps after 15 minutes idle; the next
  request pays a cold start and re-indexes whatever video it needs.
- Free-tier Gemini embeddings allow 100 requests/minute. Videos beyond roughly
  an hour can exceed that on a single index build.
- YouTube rate-limits datacenter IPs. If transcript fetches start failing once
  deployed, set `TRANSCRIPT_PROXY_URL` to route requests through a proxy.
