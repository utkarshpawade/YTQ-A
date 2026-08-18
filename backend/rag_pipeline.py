"""Retrieval-augmented generation over a single YouTube transcript.

Everything here is free tier by design: embeddings run locally on CPU through
sentence-transformers, the vector index is in-process FAISS, and generation is
delegated to whichever free LLM API the environment is configured for.
"""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Sequence

from config import GEMINI, GROQ, ConfigError, Settings, get_settings
from transcript import (
    TranscriptChunk,
    TranscriptError,
    chunk_segments,
    extract_video_id,
    fetch_transcript,
    fetch_video_details,
    format_timestamp,
    watch_url,
)

logger = logging.getLogger(__name__)

MAX_HISTORY_TURNS = 6
SOURCE_PREVIEW_CHARS = 320

SYSTEM_PROMPT = """You are a careful assistant that answers questions about one specific YouTube video.

You are given excerpts from that video's transcript. Each excerpt is labelled with the
timestamp range it covers, like [04:12 - 05:01].

Rules:
1. Answer only from the excerpts. Never invent facts that are not in them.
2. If the excerpts do not contain the answer, say so plainly and suggest what the video
   does cover instead. Do not fall back on outside knowledge.
3. Cite your evidence inline with a single square-bracket timestamp taken from the
   start of the relevant excerpt label, for example [04:12]. Never write a range like
   [04:12 - 05:01]. Cite the moment the point is actually made.
4. Every claim of substance needs at least one citation.
5. Be direct and concise. Use short paragraphs or bullets, and match the language of the
   question."""

HUMAN_PROMPT = """{history}Transcript excerpts:
{context}

Question: {question}

Answer with inline [MM:SS] citations."""


class PipelineError(RuntimeError):
    """Raised with a message that is safe to show to the end user."""


class VideoNotIndexedError(PipelineError):
    """The requested video has not been processed (or was evicted from cache)."""


@dataclass
class VideoIndex:
    """A processed video: its FAISS store plus what the UI needs to render it."""

    video_id: str
    title: str
    author: str
    thumbnail: str
    language: str
    duration: float
    chunk_count: int
    segment_count: int
    vectorstore: Any = field(repr=False, default=None)

    def as_dict(self) -> dict[str, Any]:
        return {
            "video_id": self.video_id,
            "title": self.title,
            "author": self.author,
            "thumbnail": self.thumbnail,
            "language": self.language,
            "duration": round(self.duration, 2),
            "duration_label": format_timestamp(self.duration),
            "chunk_count": self.chunk_count,
            "segment_count": self.segment_count,
        }


class VideoStore:
    """Thread safe, size capped cache of processed videos.

    A Space restart wipes this, which is fine: reprocessing a video takes a few
    seconds and keeps the free tier well inside its memory budget.
    """

    def __init__(self, max_items: int) -> None:
        self._items: OrderedDict[str, VideoIndex] = OrderedDict()
        self._lock = threading.Lock()
        self._max_items = max(max_items, 1)

    def get(self, video_id: str) -> VideoIndex | None:
        with self._lock:
            index = self._items.get(video_id)
            if index is not None:
                self._items.move_to_end(video_id)
            return index

    def put(self, index: VideoIndex) -> None:
        with self._lock:
            self._items[index.video_id] = index
            self._items.move_to_end(index.video_id)
            while len(self._items) > self._max_items:
                evicted, _ = self._items.popitem(last=False)
                logger.info("Evicted cached video %s", evicted)

    def video_ids(self) -> list[str]:
        with self._lock:
            return list(self._items)


_store = VideoStore(get_settings().max_cached_videos)
_embeddings: Any = None
_embeddings_lock = threading.Lock()
_llm_cache: dict[tuple[str, str, float], Any] = {}
_llm_lock = threading.Lock()


def get_embeddings(settings: Settings | None = None) -> Any:
    """Load the local MiniLM encoder once and share it across requests."""
    global _embeddings
    if _embeddings is not None:
        return _embeddings
    settings = settings or get_settings()
    with _embeddings_lock:
        if _embeddings is None:
            from langchain_huggingface import HuggingFaceEmbeddings

            logger.info("Loading embedding model %s", settings.embedding_model)
            _embeddings = HuggingFaceEmbeddings(
                model_name=settings.embedding_model,
                model_kwargs={"device": "cpu"},
                encode_kwargs={"normalize_embeddings": True},
            )
    return _embeddings


def get_llm(settings: Settings | None = None) -> Any:
    """Build the chat model for the configured provider (Groq or Gemini)."""
    settings = settings or get_settings()
    settings.require_credentials()
    key = (settings.provider, settings.model_name, settings.temperature)
    if key in _llm_cache:
        return _llm_cache[key]

    with _llm_lock:
        if key in _llm_cache:
            return _llm_cache[key]
        if settings.provider == GROQ:
            from langchain_groq import ChatGroq

            llm = ChatGroq(
                model=settings.groq_model,
                temperature=settings.temperature,
                api_key=settings.groq_api_key,
                max_retries=2,
                timeout=60,
            )
        elif settings.provider == GEMINI:
            from langchain_google_genai import ChatGoogleGenerativeAI

            llm = ChatGoogleGenerativeAI(
                model=settings.gemini_model,
                temperature=settings.temperature,
                google_api_key=settings.google_api_key,
                max_retries=2,
                timeout=60,
            )
        else:  # pragma: no cover - guarded by config validation
            raise ConfigError(f"Unknown LLM provider '{settings.provider}'.")
        logger.info("Initialised %s model %s", settings.provider, settings.model_name)
        _llm_cache[key] = llm
    return llm


def _build_chain(settings: Settings) -> Any:
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.prompts import ChatPromptTemplate

    prompt = ChatPromptTemplate.from_messages(
        [("system", SYSTEM_PROMPT), ("human", HUMAN_PROMPT)]
    )
    return prompt | get_llm(settings) | StrOutputParser()


def _build_vectorstore(chunks: Sequence[TranscriptChunk], settings: Settings) -> Any:
    from langchain_community.vectorstores import FAISS

    return FAISS.from_texts(
        texts=[chunk.text for chunk in chunks],
        embedding=get_embeddings(settings),
        metadatas=[chunk.metadata for chunk in chunks],
    )


def process_video(url: str, settings: Settings | None = None) -> VideoIndex:
    """Fetch, chunk, embed and cache a video transcript."""
    settings = settings or get_settings()
    video_id = extract_video_id(url)

    cached = _store.get(video_id)
    if cached is not None:
        logger.info("Reusing cached index for %s", video_id)
        return cached

    segments, language = fetch_transcript(video_id, settings.transcript_languages)
    chunks = chunk_segments(segments, settings.chunk_size, settings.chunk_overlap)
    if not chunks:
        raise TranscriptError("The transcript could not be split into searchable chunks.")

    details = fetch_video_details(video_id)
    index = VideoIndex(
        video_id=video_id,
        title=details.get("title") or f"YouTube video {video_id}",
        author=details.get("author", ""),
        thumbnail=details.get("thumbnail", ""),
        language=language,
        duration=segments[-1].end,
        chunk_count=len(chunks),
        segment_count=len(segments),
        vectorstore=_build_vectorstore(chunks, settings),
    )
    _store.put(index)
    logger.info("Indexed %s into %d chunks", video_id, len(chunks))
    return index


def _format_context(documents: Sequence[Any]) -> str:
    blocks = []
    for document in documents:
        metadata = document.metadata
        label = f"[{metadata.get('timestamp', '00:00')} - {metadata.get('end_timestamp', '00:00')}]"
        blocks.append(f"{label}\n{document.page_content}")
    return "\n\n".join(blocks)


def _format_history(history: Sequence[dict[str, str]] | None) -> str:
    if not history:
        return ""
    turns = [
        turn
        for turn in history
        if turn.get("content") and turn.get("role") in {"user", "assistant"}
    ][-MAX_HISTORY_TURNS:]
    if not turns:
        return ""
    lines = [
        f"{'User' if turn['role'] == 'user' else 'Assistant'}: {turn['content'].strip()}"
        for turn in turns
    ]
    return "Earlier in this conversation:\n" + "\n".join(lines) + "\n\n"


def _as_source(document: Any, video_id: str) -> dict[str, Any]:
    metadata = document.metadata
    start = float(metadata.get("start", 0.0))
    text = document.page_content.strip()
    if len(text) > SOURCE_PREVIEW_CHARS:
        text = text[:SOURCE_PREVIEW_CHARS].rsplit(" ", 1)[0] + "..."
    return {
        "timestamp": metadata.get("timestamp", format_timestamp(start)),
        "end_timestamp": metadata.get("end_timestamp", ""),
        "start": start,
        "end": float(metadata.get("end", start)),
        "text": text,
        "url": watch_url(video_id, start),
    }


def answer_question(
    video_id: str,
    question: str,
    history: Sequence[dict[str, str]] | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Answer a question about an already indexed video."""
    settings = settings or get_settings()
    question = (question or "").strip()
    if not question:
        raise PipelineError("Ask a question about the video.")

    index = _store.get(video_id)
    if index is None:
        raise VideoNotIndexedError(
            "This video is not loaded yet. Submit the video URL again to re-index it."
        )

    retriever = index.vectorstore.as_retriever(
        search_type="mmr",
        search_kwargs={"k": settings.retriever_k, "fetch_k": settings.retriever_k * 4},
    )
    documents = retriever.invoke(question)
    if not documents:
        return {
            "answer": "I could not find anything about that in this video's transcript.",
            "sources": [],
        }

    chain = _build_chain(settings)
    try:
        answer = chain.invoke(
            {
                "context": _format_context(documents),
                "question": question,
                "history": _format_history(history),
            }
        )
    except ConfigError:
        raise
    except Exception as exc:  # noqa: BLE001 - surface provider errors to the user
        logger.exception("LLM call failed")
        raise PipelineError(f"The language model call failed: {exc}") from exc

    return {
        "answer": (answer or "").strip(),
        "sources": [_as_source(document, index.video_id) for document in documents],
    }


def provider_status(settings: Settings | None = None) -> dict[str, Any]:
    """Small snapshot of the runtime used by the health endpoint."""
    settings = settings or get_settings()
    return {
        "provider": settings.provider,
        "model": settings.model_name,
        "embedding_model": settings.embedding_model,
        "credentials_configured": settings.has_credentials,
        "embeddings_loaded": _embeddings is not None,
        "cached_videos": _store.video_ids(),
    }


def warm_embeddings() -> None:
    """Preload the encoder so the first request does not pay the download cost."""
    try:
        get_embeddings()
    except Exception:  # noqa: BLE001 - warmup is best effort
        logger.exception("Embedding warmup failed")
