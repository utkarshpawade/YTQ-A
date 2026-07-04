const RAW_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
export const API_BASE_URL = RAW_BASE.replace(/\/+$/, '')

/** Turn a FastAPI error body into a single readable message. */
function readDetail(payload, fallback) {
  const detail = payload?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length) {
    return detail.map((item) => item.msg || String(item)).join(', ')
  }
  return fallback
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error(
      `Cannot reach the backend at ${API_BASE_URL}. Start the API locally, or check VITE_API_BASE_URL.`,
    )
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readDetail(payload, `Request failed with status ${response.status}.`))
  }
  return payload
}

export function processVideo(url, signal) {
  return request('/api/process-video', { method: 'POST', body: { url }, signal })
}

export function askQuestion({ videoId, question, history = [] }, signal) {
  return request('/api/chat', {
    method: 'POST',
    body: { video_id: videoId, question, history },
    signal,
  })
}

export function checkHealth(signal) {
  return request('/api/health', { signal })
}
