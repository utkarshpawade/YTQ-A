import { fetchTranscript as fetchYouTubeTranscript } from 'youtube-transcript'
import { ProxyAgent, fetch as undiciFetch } from 'undici'

import { settings } from './config.js'
import { TranscriptError } from './errors.js'

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const PATH_PREFIXES = new Set(['embed', 'shorts', 'live', 'v'])
const OEMBED_URL = 'https://www.youtube.com/oembed'
const proxyAgent = settings.proxyUrl ? new ProxyAgent(settings.proxyUrl) : null
const transcriptFetch = proxyAgent
  ? (url, init = {}) => undiciFetch(url, { ...init, dispatcher: proxyAgent })
  : globalThis.fetch

const clean = (value) => String(value || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()

export function formatTimestamp(seconds) {
  const total = Math.max(Math.trunc(Number(seconds) || 0), 0)
  const hours = Math.trunc(total / 3600)
  const minutes = Math.trunc((total % 3600) / 60)
  const secs = total % 60
  const pair = (value) => String(value).padStart(2, '0')
  return hours ? `${pair(hours)}:${pair(minutes)}:${pair(secs)}` : `${pair(minutes)}:${pair(secs)}`
}

export function extractVideoId(input) {
  const candidate = String(input || '').trim()
  if (!candidate) throw new TranscriptError('Please provide a YouTube URL.')
  if (VIDEO_ID_PATTERN.test(candidate)) return candidate

  let parsed
  try {
    parsed = new URL(candidate.includes('//') ? candidate : `https://${candidate}`)
  } catch {
    throw new TranscriptError('That does not look like a YouTube video link. Paste a URL such as https://www.youtube.com/watch?v=VIDEO_ID')
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const segments = parsed.pathname.split('/').filter(Boolean)
  let videoId = ''
  if (host === 'youtu.be' || host === 'y2u.be') {
    videoId = segments[0] || ''
  } else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    videoId = PATH_PREFIXES.has(segments[0]) && segments[1]
      ? segments[1]
      : parsed.searchParams.get('v') || ''
  }

  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new TranscriptError('That does not look like a YouTube video link. Paste a URL such as https://www.youtube.com/watch?v=VIDEO_ID')
  }
  return videoId
}

export function watchUrl(videoId, start) {
  const url = `https://www.youtube.com/watch?v=${videoId}`
  return start === undefined ? url : `${url}&t=${Math.trunc(start)}s`
}

export async function fetchTranscript(videoId, languages = ['en']) {
  let raw
  let lastError
  for (const language of languages) {
    try {
      raw = await fetchYouTubeTranscript(videoId, { lang: language, fetch: transcriptFetch })
      if (raw?.length) break
    } catch (error) {
      lastError = error
    }
  }

  if (!raw?.length) {
    try {
      raw = await fetchYouTubeTranscript(videoId, { fetch: transcriptFetch })
    } catch (error) {
      lastError = error
    }
  }

  if (!raw?.length) {
    const reason = lastError?.message ? `: ${lastError.message}` : ''
    throw new TranscriptError(`Could not retrieve a transcript for this video${reason}`)
  }

  const segments = raw.map((item) => ({
    text: clean(item.text),
    start: Number(item.offset ?? item.start ?? 0) / (item.offset !== undefined ? 1000 : 1),
    duration: Number(item.duration ?? 0) / (item.offset !== undefined ? 1000 : 1),
  })).filter((item) => item.text)

  if (!segments.length) throw new TranscriptError('The transcript for this video is empty.')
  return { segments, language: raw[0]?.lang || languages[0] || 'unknown' }
}

export function chunkSegments(segments, chunkSize = 1000, chunkOverlap = 150) {
  if (!segments.length) return []
  const size = Math.max(chunkSize, 200)
  const overlap = Math.min(Math.max(chunkOverlap, 0), Math.trunc(size / 2))
  const chunks = []
  let buffer = []
  let length = 0

  const flush = () => {
    if (!buffer.length) return []
    const start = buffer[0].start
    const end = buffer.at(-1).start + buffer.at(-1).duration
    chunks.push({
      text: buffer.map((segment) => segment.text).join(' '),
      metadata: {
        index: chunks.length,
        start: Number(start.toFixed(2)),
        end: Number(end.toFixed(2)),
        duration: Number((end - start).toFixed(2)),
        timestamp: formatTimestamp(start),
        end_timestamp: formatTimestamp(end),
      },
    })

    const carried = []
    let carriedLength = 0
    for (let index = buffer.length - 1; index >= 0; index -= 1) {
      const segment = buffer[index]
      if (carriedLength + segment.text.length > overlap) break
      carried.unshift(segment)
      carriedLength += segment.text.length + 1
    }
    return carried
  }

  for (const segment of segments) {
    const addition = segment.text.length + 1
    if (buffer.length && length + addition > size) {
      buffer = flush()
      length = buffer.reduce((total, item) => total + item.text.length + 1, 0)
    }
    buffer.push(segment)
    length += addition
  }
  flush()
  return chunks
}

export async function fetchVideoDetails(videoId) {
  const url = new URL(OEMBED_URL)
  url.searchParams.set('url', watchUrl(videoId))
  url.searchParams.set('format', 'json')
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'youtube-rag/2.0' }, signal: AbortSignal.timeout(6000) })
    if (!response.ok) return {}
    const payload = await response.json()
    return { title: payload.title || '', author: payload.author_name || '', thumbnail: payload.thumbnail_url || '' }
  } catch {
    return {}
  }
}
