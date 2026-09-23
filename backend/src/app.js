import cors from 'cors'
import express from 'express'
import swaggerUi from 'swagger-ui-express'
import { z } from 'zod'

import { settings, VERCEL_ORIGIN_PATTERN } from './config.js'
import { AppError } from './errors.js'
import { openApiDocument } from './openapi.js'
import { answerQuestion, processVideo, providerStatus } from './rag-pipeline.js'

const processVideoSchema = z.object({ url: z.string().trim().min(1) })
const chatSchema = z.object({
  video_id: z.string().trim().min(1),
  question: z.string().trim().min(1).max(1000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).default([]),
})

const allowedOrigin = (origin) => !origin
  || settings.allowedOrigins.includes('*')
  || settings.allowedOrigins.includes(origin)
  || VERCEL_ORIGIN_PATTERN.test(origin)

export const app = express()
app.disable('x-powered-by')
app.use(cors({
  origin(origin, callback) {
    callback(allowedOrigin(origin) ? null : new AppError(`Origin ${origin} is not allowed by CORS.`, 403), allowedOrigin(origin))
  },
  methods: ['GET', 'POST', 'OPTIONS'],
}))
app.use(express.json({ limit: '32kb' }))

app.get('/api/health', (_request, response) => {
  const status = providerStatus()
  response.json({ status: status.credentials_configured ? 'ok' : 'degraded', ...status })
})

app.post('/api/process-video', async (request, response) => {
  const payload = processVideoSchema.parse(request.body)
  response.json(await processVideo(payload.url))
})

app.post('/api/chat', async (request, response) => {
  const payload = chatSchema.parse(request.body)
  const result = await answerQuestion(payload.video_id, payload.question, payload.history)
  response.json({ video_id: payload.video_id, question: payload.question, ...result })
})

app.get('/openapi.json', (_request, response) => response.json(openApiDocument))
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))

app.get('/', (_request, response) => response.json({
  service: openApiDocument.info.title,
  version: openApiDocument.info.version,
  docs: '/docs',
  endpoints: ['/api/health', '/api/process-video', '/api/chat'],
}))

app.use((_request, response) => response.status(404).json({ detail: 'Not found.' }))

app.use((error, _request, response, _next) => {
  if (error instanceof z.ZodError) {
    return response.status(422).json({
      detail: error.issues.map((issue) => ({ msg: issue.message, loc: issue.path })),
    })
  }
  const status = error instanceof AppError
    ? error.statusCode
    : error instanceof SyntaxError && error.status === 400
      ? 400
      : 500
  if (status >= 500) console.error(error)
  return response.status(status).json({ detail: error.message || 'Internal server error.' })
})
