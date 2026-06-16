"""Pydantic request/response models for the public API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ProcessVideoRequest(BaseModel):
    url: str = Field(
        ...,
        min_length=1,
        description="Any YouTube URL shape, or a bare 11 character video id.",
        examples=["https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    )

    @field_validator("url")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("url must not be empty")
        return value


class ProcessVideoResponse(BaseModel):
    video_id: str
    title: str
    author: str = ""
    thumbnail: str = ""
    language: str = ""
    duration: float = 0.0
    duration_label: str = "00:00"
    chunk_count: int = 0
    segment_count: int = 0
    status: Literal["ready"] = "ready"


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class QueryRequest(BaseModel):
    video_id: str = Field(..., min_length=1, description="Id returned by /api/process-video.")
    question: str = Field(..., min_length=1, max_length=1000)
    history: list[ChatTurn] = Field(
        default_factory=list,
        description="Previous turns, oldest first. Only the most recent few are used.",
    )

    @field_validator("video_id", "question")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("field must not be empty")
        return value


class Source(BaseModel):
    timestamp: str
    end_timestamp: str = ""
    start: float
    end: float = 0.0
    text: str
    url: str


class QueryResponse(BaseModel):
    video_id: str
    question: str
    answer: str
    sources: list[Source] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    provider: str
    model: str
    embedding_model: str
    credentials_configured: bool
    embeddings_loaded: bool
    cached_videos: list[str] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    detail: str
