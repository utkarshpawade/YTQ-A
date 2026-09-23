import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatGroq } from '@langchain/groq'

import {
  GEMINI,
  GROQ,
  hasCredentials,
  modelName,
  requireEmbeddingCredentials,
  requireLlmCredentials,
  settings,
} from './config.js'
import { ConfigError, PipelineError, TranscriptError, VideoNotIndexedError } from './errors.js'
import { chunkSegments, extractVideoId, fetchTranscript, fetchVideoDetails, formatTimestamp, watchUrl } from './transcript.js'

const MAX_HISTORY_TURNS = 6
const SOURCE_PREVIEW_CHARS = 320
const SYSTEM_PROMPT = `You are a careful assistant that answers questions about one specific YouTube video.

You are given excerpts from that video's transcript. Each excerpt is labelled with the timestamp range it covers, like [04:12 - 05:01].

Rules:
1. Answer only from the excerpts. Never invent facts that are not in them.
2. If the excerpts do not contain the answer, say so plainly and suggest what the video does cover instead. Do not fall back on outside knowledge.
3. Cite your evidence inline with a single square-bracket timestamp taken from the start of the relevant excerpt label, for example [04:12]. Never write a range like [04:12 - 05:01]. Cite the moment the point is actually made.
4. Every claim of substance needs at least one citation.
5. Be direct and concise. Use short paragraphs or bullets, and match the language of the question.`

const HUMAN_PROMPT = `{history}Transcript excerpts:
{context}

Question: {question}

Answer with inline [MM:SS] citations.`

class VideoStore {
  constructor(maxItems) {
    this.maxItems = maxItems
    this.items = new Map()
  }

  get(videoId) {
    const item = this.items.get(videoId)
    if (item) {
      this.items.delete(videoId)
      this.items.set(videoId, item)
    }
    return item
  }

  put(item) {
    this.items.delete(item.video_id)
    this.items.set(item.video_id, item)
    while (this.items.size > this.maxItems) this.items.delete(this.items.keys().next().value)
  }

  videoIds() {
    return [...this.items.keys()]
  }
}

const store = new VideoStore(settings.maxCachedVideos)
let embeddings
const llms = new Map()

function getEmbeddings() {
  requireEmbeddingCredentials()
  embeddings ||= new GoogleGenerativeAIEmbeddings({
    apiKey: settings.googleApiKey,
    model: settings.embeddingModel,
  })
  return embeddings
}

function getLlm() {
  requireLlmCredentials()
  const key = `${settings.provider}:${modelName()}:${settings.temperature}`
  if (llms.has(key)) return llms.get(key)
  const common = { model: modelName(), temperature: settings.temperature, maxRetries: 2 }
  const llm = settings.provider === GROQ
    ? new ChatGroq({ ...common, apiKey: settings.groqApiKey })
    : settings.provider === GEMINI
      ? new ChatGoogleGenerativeAI({ ...common, apiKey: settings.googleApiKey })
      : null
  if (!llm) throw new ConfigError(`Unknown LLM provider '${settings.provider}'.`)
  llms.set(key, llm)
  return llm
}

const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0)
const magnitude = (vector) => Math.sqrt(dot(vector, vector))
const cosine = (a, b) => {
  const divisor = magnitude(a) * magnitude(b)
  return divisor ? dot(a, b) / divisor : 0
}

function mmrSearch(entries, queryVector, k, fetchK, lambda = 0.5) {
  const candidates = entries
    .map((entry) => ({ ...entry, relevance: cosine(queryVector, entry.vector) }))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, fetchK)
  const selected = []
  while (candidates.length && selected.length < k) {
    let bestIndex = 0
    let bestScore = -Infinity
    candidates.forEach((candidate, index) => {
      const redundancy = selected.length
        ? Math.max(...selected.map((item) => cosine(candidate.vector, item.vector)))
        : 0
      const score = lambda * candidate.relevance - (1 - lambda) * redundancy
      if (score > bestScore) {
        bestScore = score
        bestIndex = index
      }
    })
    selected.push(candidates.splice(bestIndex, 1)[0])
  }
  return selected
}

function publicIndex(index) {
  const { vectors, ...result } = index
  return result
}

export async function processVideo(url) {
  const videoId = extractVideoId(url)
  const cached = store.get(videoId)
  if (cached) return publicIndex(cached)

  const [{ segments, language }, details] = await Promise.all([
    fetchTranscript(videoId, settings.transcriptLanguages),
    fetchVideoDetails(videoId),
  ])
  const chunks = chunkSegments(segments, settings.chunkSize, settings.chunkOverlap)
  if (!chunks.length) throw new TranscriptError('The transcript could not be split into searchable chunks.')

  const vectors = await getEmbeddings().embedDocuments(chunks.map((chunk) => chunk.text))
  const duration = segments.at(-1).start + segments.at(-1).duration
  const index = {
    video_id: videoId,
    title: details.title || `YouTube video ${videoId}`,
    author: details.author || '',
    thumbnail: details.thumbnail || '',
    language,
    duration: Number(duration.toFixed(2)),
    duration_label: formatTimestamp(duration),
    chunk_count: chunks.length,
    segment_count: segments.length,
    status: 'ready',
    vectors: chunks.map((chunk, position) => ({ ...chunk, vector: vectors[position] })),
  }
  store.put(index)
  return publicIndex(index)
}

const formatContext = (documents) => documents.map(({ metadata, text }) =>
  `[${metadata.timestamp || '00:00'} - ${metadata.end_timestamp || '00:00'}]\n${text}`,
).join('\n\n')

function formatHistory(history = []) {
  const turns = history
    .filter((turn) => turn?.content && ['user', 'assistant'].includes(turn.role))
    .slice(-MAX_HISTORY_TURNS)
  if (!turns.length) return ''
  return `Earlier in this conversation:\n${turns.map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content.trim()}`).join('\n')}\n\n`
}

function asSource(document, videoId) {
  const { metadata } = document
  let preview = document.text.trim()
  if (preview.length > SOURCE_PREVIEW_CHARS) {
    preview = `${preview.slice(0, SOURCE_PREVIEW_CHARS).replace(/\s+\S*$/, '')}...`
  }
  return {
    timestamp: metadata.timestamp || formatTimestamp(metadata.start),
    end_timestamp: metadata.end_timestamp || '',
    start: Number(metadata.start || 0),
    end: Number(metadata.end ?? metadata.start ?? 0),
    text: preview,
    url: watchUrl(videoId, metadata.start || 0),
  }
}

export async function answerQuestion(videoId, question, history = []) {
  const cleanQuestion = String(question || '').trim()
  if (!cleanQuestion) throw new PipelineError('Ask a question about the video.')
  const index = store.get(videoId)
  if (!index) throw new VideoNotIndexedError('This video is not loaded yet. Submit the video URL again to re-index it.')

  const queryVector = await getEmbeddings().embedQuery(cleanQuestion)
  const documents = mmrSearch(index.vectors, queryVector, settings.retrieverK, settings.retrieverK * 4)
  if (!documents.length) return { answer: "I could not find anything about that in this video's transcript.", sources: [] }

  const chain = ChatPromptTemplate.fromMessages([
    ['system', SYSTEM_PROMPT],
    ['human', HUMAN_PROMPT],
  ]).pipe(getLlm()).pipe(new StringOutputParser())

  try {
    const answer = await chain.invoke({
      context: formatContext(documents),
      question: cleanQuestion,
      history: formatHistory(history),
    })
    return { answer: String(answer || '').trim(), sources: documents.map((document) => asSource(document, index.video_id)) }
  } catch (error) {
    if (error instanceof ConfigError) throw error
    throw new PipelineError(`The language model call failed: ${error.message || error}`)
  }
}

export function providerStatus() {
  return {
    provider: settings.provider,
    model: modelName(),
    embedding_model: settings.embeddingModel,
    credentials_configured: hasCredentials(),
    embeddings_loaded: Boolean(embeddings),
    cached_videos: store.videoIds(),
  }
}

export function warmEmbeddings() {
  try {
    getEmbeddings()
  } catch (error) {
    console.warn('Embedding warmup failed:', error.message)
  }
}
