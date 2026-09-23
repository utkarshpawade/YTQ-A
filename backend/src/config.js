import 'dotenv/config'

import { ConfigError } from './errors.js'

export const GROQ = 'groq'
export const GEMINI = 'gemini'
export const VERCEL_ORIGIN_PATTERN = /^https:\/\/.*\.vercel\.app$/i

const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
]

const text = (name, fallback = '') => process.env[name]?.trim() || fallback

function integer(name, fallback) {
  const value = Number.parseInt(text(name), 10)
  return Number.isFinite(value) ? value : fallback
}

function decimal(name, fallback) {
  const value = Number.parseFloat(text(name))
  return Number.isFinite(value) ? value : fallback
}

const csv = (name) => text(name).split(',').map((part) => part.trim()).filter(Boolean)

function resolveProvider(groqApiKey, googleApiKey) {
  const requested = text('LLM_PROVIDER').toLowerCase()
  const aliases = { groq: GROQ, gemini: GEMINI, google: GEMINI, 'google-genai': GEMINI, googlegenai: GEMINI }
  if (requested) {
    if (!aliases[requested]) {
      throw new ConfigError(`LLM_PROVIDER='${requested}' is not supported. Use 'groq' or 'gemini'.`)
    }
    return aliases[requested]
  }
  return groqApiKey ? GROQ : googleApiKey ? GEMINI : GROQ
}

const groqApiKey = text('GROQ_API_KEY')
const googleApiKey = text('GOOGLE_API_KEY')
const configuredOrigins = csv('ALLOWED_ORIGINS')
const allowedOrigins = configuredOrigins.includes('*')
  ? ['*']
  : [...new Set([...DEFAULT_ORIGINS, ...configuredOrigins])]

export const settings = Object.freeze({
  provider: resolveProvider(groqApiKey, googleApiKey),
  groqApiKey,
  groqModel: text('GROQ_MODEL', 'openai/gpt-oss-20b'),
  googleApiKey,
  geminiModel: text('GEMINI_MODEL', 'gemini-2.5-flash'),
  embeddingModel: text('EMBEDDING_MODEL', 'gemini-embedding-001').replace(/^models\//, ''),
  chunkSize: integer('CHUNK_SIZE', 1000),
  chunkOverlap: integer('CHUNK_OVERLAP', 150),
  retrieverK: integer('RETRIEVER_K', 4),
  temperature: decimal('LLM_TEMPERATURE', 0.2),
  maxCachedVideos: Math.max(integer('MAX_CACHED_VIDEOS', 8), 1),
  transcriptLanguages: csv('TRANSCRIPT_LANGUAGES').length
    ? csv('TRANSCRIPT_LANGUAGES')
    : ['en', 'en-US', 'en-GB'],
  allowedOrigins,
  proxyUrl: text('TRANSCRIPT_PROXY_URL'),
  port: integer('PORT', 8000),
})

export const modelName = () => settings.provider === GROQ ? settings.groqModel : settings.geminiModel
export const hasLlmCredentials = () => Boolean(settings.provider === GROQ ? settings.groqApiKey : settings.googleApiKey)
export const hasEmbeddingCredentials = () => Boolean(settings.googleApiKey)
export const hasCredentials = () => hasLlmCredentials() && hasEmbeddingCredentials()

export function requireLlmCredentials() {
  if (hasLlmCredentials()) return
  const variable = settings.provider === GROQ ? 'GROQ_API_KEY' : 'GOOGLE_API_KEY'
  throw new ConfigError(`${variable} is missing, and it is required for the ${settings.provider} chat model. Add it to backend/.env for local runs, or as a secret on your deployment host.`)
}

export function requireEmbeddingCredentials() {
  if (hasEmbeddingCredentials()) return
  throw new ConfigError('GOOGLE_API_KEY is missing, and it is required for transcript embeddings. Add it to backend/.env for local runs, or as a secret on your deployment host.')
}
