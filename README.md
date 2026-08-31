# YouTube Q&A

Ask questions about any YouTube video and jump straight to the moment the answer
is given. The backend retrieves the video transcript, indexes it locally, and
answers with citations like `[04:12]` - clicking one seeks the embedded player
to that second.

Runs entirely on free tiers: hosted Gemini embeddings, in-process FAISS, a free
LLM API (Groq or Gemini), and Vercel for the UI. No local model weights, so the
backend image stays small enough for any free hosting tier.

## Architecture

```text
UrlInput -> POST /api/process-video
                 |
                 +-> youtube-transcript-api -> caption snippets
                 +-> chunker keeps [start, end] on every chunk
                 +-> gemini-embedding-001 (API) -> FAISS index (in memory)

ChatBox  -> POST /api/chat
                 |
                 +-> MMR retrieval over that index
                 +-> excerpts labelled "[04:12 - 05:01]" go into the prompt
                 +-> Groq openai/gpt-oss-20b / Gemini 2.5 Flash
                 |
                 v
        answer with inline [04:12] citations  +  source list with start seconds
                 |
                 v
        click a citation -> VideoPlayer.seekTo(252) -> iframe jumps to 4m 12s
```

**Why it stays free**

| Concern    | Choice                                          | Cost |
| ---------- | ----------------------------------------------- | ---- |
| Embeddings | `gemini-embedding-001` via the Gemini API        | free tier, no local weights |
| Vector DB  | FAISS in process                                 | free, no service to host |
| LLM        | Groq `openai/gpt-oss-20b` or Gemini `2.5-flash` | free API tiers |
| Backend    | Any host that runs FastAPI (~180 MB image)       | fits free tiers |
| Frontend   | Vercel static build                              | free hobby tier |

Transcripts are chunked snippet-by-snippet so every chunk keeps the start and
end second of the span it covers. Those timestamps go into the prompt, come back
as inline citations, and the UI turns them into seek buttons.

## Project structure

```text
backend/
  app.py            FastAPI app, CORS, error handling, routes
  config.py         Env-driven settings, Groq/Gemini provider detection
  transcript.py     URL parsing, transcript fetch, timestamped chunking
  rag_pipeline.py   Embeddings, FAISS store, retrieval + generation
  schemas.py        Pydantic request/response models
  requirements.txt
  README.md         Backend and deployment notes
frontend/
  src/components/   VideoPlayer.jsx, ChatBox.jsx, UrlInput.jsx
  src/api.js        Backend client (VITE_API_BASE_URL)
  src/timestamps.js [MM:SS] parsing shared by chat and player
  vercel.json       SPA rewrites
```

## API keys

You only need one LLM key; both providers have a free tier.

- **Groq** (default): create a key at <https://console.groq.com/keys>.
- **Gemini**: create a key at <https://aistudio.google.com/app/apikey>.

`GOOGLE_API_KEY` is always required, because retrieval embeddings are served by
the Gemini API even when `LLM_PROVIDER=groq`.

## Local setup

### Backend

Python 3.10 or newer. There is no `torch` dependency, so recent Python releases
work without waiting for wheels; 3.14 is tested.

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate      # Windows Git Bash; use .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env               # then paste your key into .env
uvicorn app:app --reload --port 8000
```

- API docs: <http://127.0.0.1:8000/docs>
- Health check: <http://127.0.0.1:8000/api/health>

Nothing is downloaded at boot - embeddings are an API call, so the first request
is as fast as every later one.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env               # VITE_API_BASE_URL=http://127.0.0.1:8000
npm run dev
```

Open <http://localhost:5173>, paste a YouTube URL, and ask away.

## Deployment

### Backend on Render

`render.yaml` at the repository root is a Render Blueprint, so the service is
defined in code rather than clicked together.

1. In Render, choose **New -> Blueprint** and select this repository. It reads
   `render.yaml` and proposes a free web service rooted at `backend/`.
2. Render prompts for the values marked `sync: false`:
   - `GOOGLE_API_KEY` - required always, it serves the embeddings
   - `GROQ_API_KEY` - required while `LLM_PROVIDER=groq`
   - `ALLOWED_ORIGINS` - only for a custom domain; leave blank otherwise
3. Apply. The first build takes a few minutes; afterwards every push to `main`
   redeploys automatically.
4. The API is served at `https://<service>.onrender.com/api/...`, and
   `/api/health` is the configured health check.

`*.vercel.app` origins are already allowed by a CORS regex, so preview
deployments work without extra configuration.

On the free plan the service sleeps after 15 minutes idle, so the first request
after a quiet spell pays a cold start.

### Frontend on Vercel

1. Import the repo and set **Root Directory** to `frontend`.
2. Framework preset: Vite (build `npm run build`, output `dist`).
3. Add environment variable `VITE_API_BASE_URL` = your Render URL, for example
   `https://youtube-qa-api.onrender.com` (no trailing slash).
4. Deploy. `vercel.json` handles SPA rewrites and asset caching.

Vite inlines env vars at build time, so change `VITE_API_BASE_URL` then redeploy.

## Configuration reference

| Variable               | Default                                  | Purpose                              |
| ---------------------- | ---------------------------------------- | ------------------------------------ |
| `LLM_PROVIDER`         | auto                                     | `groq` or `gemini`                    |
| `GROQ_MODEL`           | `openai/gpt-oss-20b`                     | Groq chat model                       |
| `GEMINI_MODEL`         | `gemini-2.5-flash`                       | Gemini chat model                     |
| `EMBEDDING_MODEL`      | `models/gemini-embedding-001`            | Gemini embedding model                |
| `CHUNK_SIZE`           | `1000`                                   | Characters per transcript chunk       |
| `CHUNK_OVERLAP`        | `150`                                    | Overlap between chunks                |
| `RETRIEVER_K`          | `4`                                      | Chunks retrieved per question         |
| `LLM_TEMPERATURE`      | `0.2`                                    | Generation temperature                |
| `MAX_CACHED_VIDEOS`    | `8`                                      | In-memory FAISS indexes kept          |
| `TRANSCRIPT_LANGUAGES` | `en,en-US,en-GB`                         | Preferred caption languages           |
| `TRANSCRIPT_PROXY_URL` | unset                                    | Proxy for YouTube transcript requests |
| `ALLOWED_ORIGINS`      | localhost dev ports                      | Extra CORS origins                    |

## Troubleshooting

- **"No transcript is available"** - the video has captions disabled, or none in
  the configured languages. Try another video or extend `TRANSCRIPT_LANGUAGES`.
- **Transcript fetches fail only in production** - YouTube blocks many datacenter
  IPs. Set `TRANSCRIPT_PROXY_URL` on the backend service.
- **"This video is not loaded yet"** - the service restarted or slept and the
  in-memory index was dropped. Submit the URL again.
- **CORS errors** - add the exact frontend origin to `ALLOWED_ORIGINS` (scheme
  included, no trailing slash).
- **`npm run` fails on Windows** - the repository path contains `&`, which breaks
  npm's default `cmd.exe` script shell. `frontend/.npmrc` switches it to bash;
  renaming the folder to something like `YTQA` also fixes it for good.
