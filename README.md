# YouTube Q&A

Ask questions about any YouTube video and jump straight to the moment the answer
is given. The backend retrieves the video transcript, indexes it locally, and
answers with citations like `[04:12]` - clicking one seeks the embedded player
to that second.

Runs entirely on free tiers: local CPU embeddings, in-process FAISS, a free LLM
API (Groq or Gemini), a Hugging Face Space for the API, and Vercel for the UI.

## Architecture

```text
UrlInput -> POST /api/process-video
                 |
                 +-> youtube-transcript-api -> caption snippets
                 +-> chunker keeps [start, end] on every chunk
                 +-> all-MiniLM-L6-v2 (local CPU) -> FAISS index (in memory)

ChatBox  -> POST /api/chat
                 |
                 +-> MMR retrieval over that index
                 +-> excerpts labelled "[04:12 - 05:01]" go into the prompt
                 +-> Groq llama-3.1-8b-instant / Gemini 1.5 Flash
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
| Embeddings | `all-MiniLM-L6-v2` via `langchain-huggingface`  | free, runs on CPU, no key |
| Vector DB  | FAISS in process                                 | free, no service to host |
| LLM        | Groq `llama-3.1-8b-instant` or Gemini `1.5-flash` | free API tiers |
| Backend    | HF Space, Gradio SDK (no Docker)                 | free 2 vCPU / 16 GB |
| Frontend   | Vercel static build                              | free hobby tier |

Transcripts are chunked snippet-by-snippet so every chunk keeps the start and
end second of the span it covers. Those timestamps go into the prompt, come back
as inline citations, and the UI turns them into seek buttons.

## Project structure

```text
backend/
  app.py            FastAPI app, CORS, error handling, Gradio mount
  config.py         Env-driven settings, Groq/Gemini provider detection
  transcript.py     URL parsing, transcript fetch, timestamped chunking
  rag_pipeline.py   Embeddings, FAISS store, retrieval + generation
  schemas.py        Pydantic request/response models
  requirements.txt
  README.md         Hugging Face Space card (sdk: gradio)
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

Embeddings run locally, so no key is needed for retrieval.

## Local setup

### Backend

Python 3.10-3.12 is recommended - `faiss-cpu` and `torch` wheels lag behind the
newest Python releases.

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
- Gradio smoke test: <http://127.0.0.1:8000/>

The first request downloads the ~90 MB embedding model; later runs use the cache.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env               # VITE_API_BASE_URL=http://127.0.0.1:8000
npm run dev
```

Open <http://localhost:5173>, paste a YouTube URL, and ask away.

## Deployment

### Backend on Hugging Face Spaces

1. Create a Space: **SDK = Gradio**, hardware = free CPU basic.
2. Push `backend/` to the Space repo (its `README.md` carries the Space config):

   ```bash
   git clone https://huggingface.co/spaces/<user>/<space> hf-space
   cp backend/* hf-space/
   cd hf-space && git add . && git commit -m "deploy backend" && git push
   ```

3. Under **Settings -> Variables and secrets** add:
   - secret `GROQ_API_KEY` (or `GOOGLE_API_KEY`)
   - variable `LLM_PROVIDER` = `groq` or `gemini` (optional; auto-detected)
   - variable `ALLOWED_ORIGINS` = your Vercel URL, e.g. `https://ytqa.vercel.app`
4. The Space serves the API at `https://<user>-<space>.hf.space/api/...`.

`*.vercel.app` origins are already allowed by a CORS regex, so preview
deployments work without extra configuration.

### Frontend on Vercel

1. Import the repo and set **Root Directory** to `frontend`.
2. Framework preset: Vite (build `npm run build`, output `dist`).
3. Add environment variable `VITE_API_BASE_URL` = your Space URL, for example
   `https://<user>-<space>.hf.space`.
4. Deploy. `vercel.json` handles SPA rewrites and asset caching.

Vite inlines env vars at build time, so change `VITE_API_BASE_URL` then redeploy.

## Configuration reference

| Variable               | Default                                  | Purpose                              |
| ---------------------- | ---------------------------------------- | ------------------------------------ |
| `LLM_PROVIDER`         | auto                                     | `groq` or `gemini`                    |
| `GROQ_MODEL`           | `llama-3.1-8b-instant`                   | Groq chat model                       |
| `GEMINI_MODEL`         | `gemini-1.5-flash`                       | Gemini chat model                     |
| `EMBEDDING_MODEL`      | `sentence-transformers/all-MiniLM-L6-v2` | Local encoder                         |
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
  IPs. Set `TRANSCRIPT_PROXY_URL` on the Space.
- **"This video is not loaded yet"** - the Space restarted and the in-memory
  index was dropped. Submit the URL again.
- **CORS errors** - add the exact frontend origin to `ALLOWED_ORIGINS` (scheme
  included, no trailing slash).
- **`npm run` fails on Windows** - the repository path contains `&`, which breaks
  npm's default `cmd.exe` script shell. `frontend/.npmrc` switches it to bash;
  renaming the folder to something like `YTQA` also fixes it for good.
