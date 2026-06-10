"""YouTube transcript fetching and timestamp aware chunking.

The transcript API returns a stream of short caption snippets. Naively joining
them loses the timing information that makes citations clickable, so chunks are
assembled snippet-by-snippet here and each one carries the start/end second of
the span it covers.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

from youtube_transcript_api import YouTubeTranscriptApi

try:  # exception names are stable, their import path is not
    from youtube_transcript_api import (
        CouldNotRetrieveTranscript,
        NoTranscriptFound,
        TranscriptsDisabled,
        VideoUnavailable,
    )
except ImportError:  # pragma: no cover - older releases
    from youtube_transcript_api._errors import (  # type: ignore[no-redef]
        CouldNotRetrieveTranscript,
        NoTranscriptFound,
        TranscriptsDisabled,
        VideoUnavailable,
    )

_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_PATH_PREFIXES = ("embed", "shorts", "live", "v")
_WHITESPACE_RE = re.compile(r"\s+")
_OEMBED_URL = "https://www.youtube.com/oembed"


class TranscriptError(RuntimeError):
    """Raised with a message that is safe to show to the end user."""


@dataclass(frozen=True)
class Segment:
    """A single caption snippet."""

    text: str
    start: float
    duration: float

    @property
    def end(self) -> float:
        return self.start + self.duration


@dataclass(frozen=True)
class TranscriptChunk:
    """A retrievable slice of the transcript plus the span it came from."""

    index: int
    text: str
    start: float
    end: float

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "start": round(self.start, 2),
            "end": round(self.end, 2),
            "duration": round(self.end - self.start, 2),
            "timestamp": format_timestamp(self.start),
            "end_timestamp": format_timestamp(self.end),
        }


def format_timestamp(seconds: float) -> str:
    """Seconds to MM:SS, or HH:MM:SS for videos longer than an hour."""
    total = max(int(seconds), 0)
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def extract_video_id(url: str) -> str:
    """Accept a bare id or any common YouTube URL shape and return the id."""
    candidate = (url or "").strip()
    if not candidate:
        raise TranscriptError("Please provide a YouTube URL.")
    if _VIDEO_ID_RE.match(candidate):
        return candidate

    parsed = urllib.parse.urlparse(candidate if "//" in candidate else f"https://{candidate}")
    host = parsed.netloc.lower().split(":")[0]
    host = host[4:] if host.startswith("www.") else host
    segments = [part for part in parsed.path.split("/") if part]

    video_id = ""
    if host in {"youtu.be", "y2u.be"}:
        video_id = segments[0] if segments else ""
    elif host.endswith("youtube.com") or host.endswith("youtube-nocookie.com"):
        if segments and segments[0] in _PATH_PREFIXES and len(segments) > 1:
            video_id = segments[1]
        else:
            video_id = urllib.parse.parse_qs(parsed.query).get("v", [""])[0]

    if not _VIDEO_ID_RE.match(video_id):
        raise TranscriptError(
            "That does not look like a YouTube video link. Paste a URL such as "
            "https://www.youtube.com/watch?v=VIDEO_ID"
        )
    return video_id


def watch_url(video_id: str, start: float | None = None) -> str:
    url = f"https://www.youtube.com/watch?v={video_id}"
    if start is not None:
        url += f"&t={int(start)}s"
    return url


def _proxy_config() -> Any | None:
    """Optional outbound proxy - YouTube blocks many datacenter IP ranges."""
    from config import get_settings

    proxy_url = get_settings().proxy_url
    if not proxy_url:
        return None
    try:
        from youtube_transcript_api.proxies import GenericProxyConfig
    except ImportError:  # pragma: no cover - proxy support landed in 1.x
        return None
    return GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)


def _transcript_list(video_id: str) -> Any:
    """Return a TranscriptList across both the 0.6.x and 1.x APIs."""
    if hasattr(YouTubeTranscriptApi, "list_transcripts"):  # legacy static API
        return YouTubeTranscriptApi.list_transcripts(video_id)
    proxy = _proxy_config()
    api = YouTubeTranscriptApi(proxy_config=proxy) if proxy else YouTubeTranscriptApi()
    return api.list(video_id)


def _translation_codes(transcript: Any) -> list[str]:
    codes: list[str] = []
    for language in getattr(transcript, "translation_languages", []) or []:
        code = (
            language.get("language_code")
            if isinstance(language, dict)
            else getattr(language, "language_code", None)
        )
        if code:
            codes.append(code)
    return codes


def _select_transcript(transcript_list: Any, languages: Sequence[str]) -> Any:
    """Prefer the requested languages, then fall back to anything translatable."""
    wanted = list(languages)
    try:
        return transcript_list.find_transcript(wanted)
    except Exception:  # noqa: BLE001 - the library raises several lookup errors
        pass

    available = list(transcript_list)
    if not available:
        raise TranscriptError("This video has no transcripts at all.")

    # Manually written captions are cleaner than auto-generated ones.
    available.sort(key=lambda item: bool(getattr(item, "is_generated", True)))
    chosen = available[0]
    if getattr(chosen, "is_translatable", False):
        translatable = _translation_codes(chosen)
        for language in wanted:
            if language in translatable:
                return chosen.translate(language)
    return chosen


def _raw_snippets(transcript: Any) -> list[dict[str, Any]]:
    fetched = transcript.fetch()
    if hasattr(fetched, "to_raw_data"):  # 1.x returns a FetchedTranscript object
        return fetched.to_raw_data()
    return list(fetched)


def _clean(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", (text or "").replace("\n", " ")).strip()


def fetch_transcript(video_id: str, languages: Sequence[str]) -> tuple[list[Segment], str]:
    """Download the best available transcript for a video id."""
    try:
        transcript = _select_transcript(_transcript_list(video_id), languages)
        raw = _raw_snippets(transcript)
        language = getattr(transcript, "language_code", "") or "unknown"
    except TranscriptError:
        raise
    except TranscriptsDisabled as exc:
        raise TranscriptError("This video has subtitles disabled, so it cannot be indexed.") from exc
    except NoTranscriptFound as exc:
        raise TranscriptError(
            "No transcript is available for this video in the configured languages."
        ) from exc
    except VideoUnavailable as exc:
        raise TranscriptError("This video is unavailable, private, or region locked.") from exc
    except CouldNotRetrieveTranscript as exc:
        raise TranscriptError(f"Could not retrieve the transcript: {exc}") from exc
    except Exception as exc:  # noqa: BLE001 - network failures must reach the user
        raise TranscriptError(f"Unexpected error while fetching the transcript: {exc}") from exc

    segments = [
        Segment(
            text=_clean(item["text"]),
            start=float(item["start"]),
            duration=float(item.get("duration") or 0.0),
        )
        for item in raw
        if _clean(item.get("text", ""))
    ]
    if not segments:
        raise TranscriptError("The transcript for this video is empty.")
    return segments, language


def chunk_segments(
    segments: Iterable[Segment],
    chunk_size: int = 1000,
    chunk_overlap: int = 150,
) -> list[TranscriptChunk]:
    """Group caption snippets into overlapping chunks that keep their timing."""
    items = list(segments)
    if not items:
        return []
    chunk_size = max(chunk_size, 200)
    chunk_overlap = min(max(chunk_overlap, 0), chunk_size // 2)

    chunks: list[TranscriptChunk] = []
    buffer: list[Segment] = []
    length = 0

    def flush() -> list[Segment]:
        """Emit the buffered segments and return the ones to carry over."""
        if not buffer:
            return []
        chunks.append(
            TranscriptChunk(
                index=len(chunks),
                text=" ".join(segment.text for segment in buffer),
                start=buffer[0].start,
                end=buffer[-1].end,
            )
        )
        carried: list[Segment] = []
        carried_length = 0
        for segment in reversed(buffer):
            if carried_length + len(segment.text) > chunk_overlap:
                break
            carried.insert(0, segment)
            carried_length += len(segment.text) + 1
        return carried

    for segment in items:
        addition = len(segment.text) + 1
        if buffer and length + addition > chunk_size:
            buffer = flush()
            length = sum(len(item.text) + 1 for item in buffer)
        buffer.append(segment)
        length += addition

    flush()
    return chunks


def fetch_video_details(video_id: str) -> dict[str, str]:
    """Best effort title/author lookup through the keyless oEmbed endpoint."""
    query = urllib.parse.urlencode({"url": watch_url(video_id), "format": "json"})
    request = urllib.request.Request(
        f"{_OEMBED_URL}?{query}", headers={"User-Agent": "youtube-rag/1.0"}
    )
    try:
        with urllib.request.urlopen(request, timeout=6) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, ValueError, TimeoutError, OSError):
        return {}
    return {
        "title": payload.get("title", ""),
        "author": payload.get("author_name", ""),
        "thumbnail": payload.get("thumbnail_url", ""),
    }
