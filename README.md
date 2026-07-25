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
