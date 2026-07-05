/** Matches citations the model writes inline, e.g. [04:12] or [1:02:33]. */
export const TIMESTAMP_PATTERN = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g

/** "04:12" -> 252, "1:02:33" -> 3753. Returns null when unparseable. */
export function toSeconds(label) {
  const parts = String(label).trim().split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

/** 252 -> "04:12", 3753 -> "01:02:33". */
export function toLabel(seconds) {
  const total = Math.max(Math.floor(seconds || 0), 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value) => String(value).padStart(2, '0')
  return hours ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`
}

/**
 * Split answer text into plain-text and timestamp parts so the timestamps can
 * be rendered as buttons that seek the player.
 */
export function splitIntoParts(text) {
  const parts = []
  let cursor = 0
  const pattern = new RegExp(TIMESTAMP_PATTERN.source, 'g')
  let match = pattern.exec(text)

  while (match) {
    const seconds = toSeconds(match[1])
    if (seconds === null) {
      match = pattern.exec(text)
      continue
    }
    if (match.index > cursor) {
      parts.push({ type: 'text', value: text.slice(cursor, match.index) })
    }
    parts.push({ type: 'timestamp', label: match[1], seconds })
    cursor = match.index + match[0].length
    match = pattern.exec(text)
  }

  if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) })
  return parts
}
