import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import { app } from '../src/app.js'

let server
let baseUrl

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`
      resolve()
    })
  })
})

after(() => new Promise((resolve) => server.close(resolve)))

test('health endpoint exposes the compatible response shape', async () => {
  const response = await fetch(`${baseUrl}/api/health`)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.ok(['ok', 'degraded'].includes(body.status))
  assert.equal(typeof body.provider, 'string')
  assert.ok(Array.isArray(body.cached_videos))
})

test('request validation returns a readable detail payload', async () => {
  const response = await fetch(`${baseUrl}/api/process-video`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: '' }),
  })
  assert.equal(response.status, 422)
  const body = await response.json()
  assert.ok(Array.isArray(body.detail))
})
