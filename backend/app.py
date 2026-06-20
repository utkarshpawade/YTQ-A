"""FastAPI application for the YouTube Q&A RAG backend.

Deployed to a Hugging Face Space using the Gradio SDK: a tiny Gradio demo is
mounted at "/" so the Space boots without a Dockerfile, while the real JSON API
lives under "/api" for the Vercel frontend to call.
"""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from config import VERCEL_ORIGIN_REGEX, ConfigError, get_settings
from rag_pipeline import (
    PipelineError,
    VideoNotIndexedError,
    answer_question,
    process_video,
    provider_status,
    warm_embeddings,
)
from schemas import (
    ErrorResponse,
    HealthResponse,
    ProcessVideoRequest,
    ProcessVideoResponse,
    QueryRequest,
    QueryResponse,
)
from transcript import TranscriptError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("youtube_rag")

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Download/load the embedding model in the background at boot."""
    logger.info(
        "Starting with provider=%s model=%s credentials=%s",
        settings.provider,
        settings.model_name,
        settings.has_credentials,
    )
    threading.Thread(target=warm_embeddings, name="embedding-warmup", daemon=True).start()
    yield


app = FastAPI(
    title="YouTube Q&A RAG API",
    description="Ask questions about any YouTube video and get answers with clickable timestamps.",
    version="1.0.0",
    lifespan=lifespan,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_origin_regex=VERCEL_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# --- Error handling ---------------------------------------------------------
# The pipeline raises exceptions whose messages are written for end users, so
# they are forwarded verbatim instead of collapsing into a generic 500.


@app.exception_handler(TranscriptError)
async def handle_transcript_error(_: Request, exc: TranscriptError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(VideoNotIndexedError)
async def handle_missing_video(_: Request, exc: VideoNotIndexedError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(ConfigError)
async def handle_config_error(_: Request, exc: ConfigError) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(PipelineError)
async def handle_pipeline_error(_: Request, exc: PipelineError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"detail": str(exc)})


# --- API --------------------------------------------------------------------


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    status = provider_status(settings)
    return HealthResponse(status="ok" if status["credentials_configured"] else "degraded", **status)


@app.post(
    "/api/process-video",
    response_model=ProcessVideoResponse,
    tags=["rag"],
    summary="Fetch a transcript and build its vector index",
)
async def process_video_endpoint(payload: ProcessVideoRequest) -> ProcessVideoResponse:
    index = await run_in_threadpool(process_video, payload.url, settings)
    return ProcessVideoResponse(**index.as_dict())


@app.post(
    "/api/chat",
    response_model=QueryResponse,
    tags=["rag"],
    summary="Answer a question about an indexed video",
)
async def chat_endpoint(payload: QueryRequest) -> QueryResponse:
    history = [turn.model_dump() for turn in payload.history]
    result = await run_in_threadpool(
        answer_question, payload.video_id, payload.question, history, settings
    )
    return QueryResponse(
        video_id=payload.video_id,
        question=payload.question,
        answer=result["answer"],
        sources=result["sources"],
    )


# --- Gradio mount -----------------------------------------------------------
# Hugging Face Spaces running the Gradio SDK need a Gradio app to serve, which
# lets this FastAPI app deploy without a Dockerfile. The demo below doubles as a
# smoke test page for the deployed Space.

import gradio as gr  # noqa: E402


def _demo_ask(url: str, question: str) -> str:
    if not url or not question:
        return "Paste a YouTube URL and ask a question."
    try:
        index = process_video(url, settings)
        result = answer_question(index.video_id, question, None, settings)
    except (TranscriptError, PipelineError, ConfigError) as exc:
        return f"Error: {exc}"
    citations = ", ".join(source["timestamp"] for source in result["sources"])
    return f"{result['answer']}\n\nRetrieved from: {citations}"


with gr.Blocks(title="YouTube Q&A RAG Backend") as demo:
    gr.Markdown(
        "# YouTube Q&A RAG Backend\n"
        "This Space hosts the FastAPI service behind the YouTube Q&A app.\n\n"
        "- `POST /api/process-video` - index a video transcript\n"
        "- `POST /api/chat` - ask a question and get timestamped citations\n"
        "- `GET /api/health` - provider and model status\n"
        "- `GET /docs` - interactive OpenAPI docs\n\n"
        "The box below is a quick smoke test that uses the same pipeline."
    )
    url_input = gr.Textbox(label="YouTube URL", placeholder="https://www.youtube.com/watch?v=...")
    question_input = gr.Textbox(label="Question", placeholder="What is this video about?")
    answer_output = gr.Textbox(label="Answer", lines=8)
    gr.Button("Ask", variant="primary").click(
        _demo_ask, inputs=[url_input, question_input], outputs=answer_output
    )

app = gr.mount_gradio_app(app, demo, path="/")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT") or os.getenv("GRADIO_SERVER_PORT") or 7860)
    uvicorn.run(app, host="0.0.0.0", port=port)
