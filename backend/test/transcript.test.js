import assert from 'node:assert/strict'
import test from 'node:test'

import { chunkSegments, extractVideoId, formatTimestamp, watchUrl } from '../src/transcript.js'

test('extractVideoId accepts common YouTube URL forms', () => {
  const id = 'dQw4w9WgXcQ'
  assert.equal(extractVideoId(id), id)
  assert.equal(extractVideoId(`https://youtu.be/${id}?si=test`), id)
  assert.equal(extractVideoId(`https://www.youtube.com/watch?v=${id}`), id)
  assert.equal(extractVideoId(`https://youtube.com/shorts/${id}`), id)
  assert.equal(extractVideoId(`https://www.youtube-nocookie.com/embed/${id}`), id)
})

test('timestamp helpers preserve long video timestamps', () => {
  assert.equal(formatTimestamp(65.9), '01:05')
  assert.equal(formatTimestamp(3661), '01:01:01')
  assert.equal(watchUrl('dQw4w9WgXcQ', 65.9), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=65s')
})

test('chunkSegments retains timestamps and overlap', () => {
  const segments = Array.from({ length: 5 }, (_, index) => ({
    text: `${index}`.repeat(90),
    start: index * 10,
    duration: 10,
  }))
  const chunks = chunkSegments(segments, 220, 100)
  assert.equal(chunks.length, 4)
  assert.equal(chunks[0].metadata.timestamp, '00:00')
  assert.equal(chunks[1].metadata.timestamp, '00:10')
  assert.match(chunks[1].text, /^1+/)
})
