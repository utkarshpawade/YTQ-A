"""Environment driven configuration for the YouTube Q&A backend.

Every knob is read from the process environment (seeded from a local ``.env``
file during development) so the exact same code runs unchanged on a Hugging
Face Space, where secrets are injected as environment variables.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()

GROQ = "groq"
GEMINI = "gemini"

_PROVIDER_ALIASES = {
    "groq": GROQ,
    "gemini": GEMINI,
    "google": GEMINI,
    "google-genai": GEMINI,
    "googlegenai": GEMINI,
}

# Always trusted during local development, regardless of ALLOWED_ORIGINS.
DEFAULT_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
)

# Lets every Vercel preview deployment talk to the Space without redeploying.
VERCEL_ORIGIN_REGEX = r"https://.*\.vercel\.app"


class ConfigError(RuntimeError):
    """Raised when the backend is missing credentials it needs to answer."""


def _missing_key_message(variable: str, purpose: str) -> str:
    return (
        f"{variable} is missing, and it is required for {purpose}. Add it to "
        "backend/.env for local runs, or as a secret on your deployment host."
    )


def _text(name: str, default: str = "") -> str:
    value = os.getenv(name)
    return value.strip() if value and value.strip() else default


def _integer(name: str, default: int) -> int:
    try:
        return int(_text(name, str(default)))
    except ValueError:
        return default


def _decimal(name: str, default: float) -> float:
    try:
        return float(_text(name, str(default)))
    except ValueError:
        return default


def _csv(name: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in _text(name).split(",") if part.strip())


def _resolve_provider(groq_key: str, google_key: str) -> str:
    """Explicit LLM_PROVIDER wins; otherwise pick whichever key is present."""
    requested = _text("LLM_PROVIDER").lower()
    if requested:
        provider = _PROVIDER_ALIASES.get(requested)
        if provider is None:
            raise ConfigError(
                f"LLM_PROVIDER='{requested}' is not supported. Use 'groq' or 'gemini'."
            )
        return provider
    if groq_key:
        return GROQ
    if google_key:
        return GEMINI
    return GROQ


@dataclass(frozen=True)
class Settings:
    provider: str
    groq_api_key: str
    groq_model: str
    google_api_key: str
    gemini_model: str
    embedding_model: str
    chunk_size: int
    chunk_overlap: int
    retriever_k: int
    temperature: float
    max_cached_videos: int
    transcript_languages: tuple[str, ...]
    allowed_origins: tuple[str, ...]
    proxy_url: str

    @property
    def model_name(self) -> str:
        return self.groq_model if self.provider == GROQ else self.gemini_model

    @property
    def has_llm_credentials(self) -> bool:
        key = self.groq_api_key if self.provider == GROQ else self.google_api_key
        return bool(key)

    @property
    def has_embedding_credentials(self) -> bool:
        """Embeddings always go through the Gemini API, whichever LLM answers."""
        return bool(self.google_api_key)

    @property
    def has_credentials(self) -> bool:
        return self.has_llm_credentials and self.has_embedding_credentials

    def require_llm_credentials(self) -> None:
        if self.has_llm_credentials:
            return
        variable = "GROQ_API_KEY" if self.provider == GROQ else "GOOGLE_API_KEY"
        raise ConfigError(_missing_key_message(variable, f"the {self.provider} chat model"))

    def require_embedding_credentials(self) -> None:
        if self.has_embedding_credentials:
            return
        raise ConfigError(_missing_key_message("GOOGLE_API_KEY", "transcript embeddings"))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    groq_key = _text("GROQ_API_KEY")
    google_key = _text("GOOGLE_API_KEY")

    configured_origins = _csv("ALLOWED_ORIGINS")
    if "*" in configured_origins:
        origins: tuple[str, ...] = ("*",)
    else:
        origins = tuple(dict.fromkeys(DEFAULT_ORIGINS + configured_origins))

    return Settings(
        provider=_resolve_provider(groq_key, google_key),
        groq_api_key=groq_key,
        groq_model=_text("GROQ_MODEL", "openai/gpt-oss-20b"),
        google_api_key=google_key,
        gemini_model=_text("GEMINI_MODEL", "gemini-2.5-flash"),
        embedding_model=_text("EMBEDDING_MODEL", "models/gemini-embedding-001"),
        chunk_size=_integer("CHUNK_SIZE", 1000),
        chunk_overlap=_integer("CHUNK_OVERLAP", 150),
        retriever_k=_integer("RETRIEVER_K", 4),
        temperature=_decimal("LLM_TEMPERATURE", 0.2),
        max_cached_videos=_integer("MAX_CACHED_VIDEOS", 8),
        transcript_languages=_csv("TRANSCRIPT_LANGUAGES") or ("en", "en-US", "en-GB"),
        allowed_origins=origins,
        proxy_url=_text("TRANSCRIPT_PROXY_URL"),
    )
