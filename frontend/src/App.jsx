import { useCallback, useRef, useState } from 'react'
import ChatBox from './components/ChatBox'
import UrlInput from './components/UrlInput'
import VideoPlayer from './components/VideoPlayer'
import { askQuestion, processVideo } from './api'

let messageId = 0
const nextId = () => `m${++messageId}`

export default function App() {
  const [video, setVideo] = useState(null)
  const [status, setStatus] = useState('idle')
  const [loadError, setLoadError] = useState('')
  const [messages, setMessages] = useState([])
  const [isAnswering, setIsAnswering] = useState(false)
  const playerRef = useRef(null)

  const seekTo = useCallback((seconds) => {
    playerRef.current?.seekTo(seconds)
  }, [])

  async function handleProcess(url) {
    setStatus('loading')
    setLoadError('')
    try {
      const result = await processVideo(url)
      setVideo(result)
      setMessages([])
      setStatus('ready')
    } catch (error) {
      setVideo(null)
      setStatus('error')
      setLoadError(error.message)
    }
  }

  async function handleSend(question) {
    if (!video) return
    const history = messages
      .filter((message) => !message.error)
      .map((message) => ({ role: message.role, content: message.content }))

    setMessages((current) => [...current, { id: nextId(), role: 'user', content: question }])
    setIsAnswering(true)
    try {
      const result = await askQuestion({ videoId: video.video_id, question, history })
      setMessages((current) => [
        ...current,
        {
          id: nextId(),
          role: 'assistant',
          content: result.answer || 'The model returned an empty answer.',
          sources: result.sources,
        },
      ])
    } catch (error) {
      setMessages((current) => [
        ...current,
        { id: nextId(), role: 'assistant', content: error.message, error: true },
      ])
    } finally {
      setIsAnswering(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-50 sm:text-2xl">
              YouTube Q&amp;A
            </h1>
            <p className="text-sm text-slate-400">
              Ask questions about any video and jump straight to the moment it is answered.
            </p>
          </div>
          <span className="rounded-full border border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-400">
            RAG · local embeddings · free LLM APIs
          </span>
        </header>

        <UrlInput onSubmit={handleProcess} status={status} video={video} error={loadError} />

        <main className="grid min-h-0 flex-1 gap-5 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <VideoPlayer ref={playerRef} video={video} />
          </div>
          <div className="min-h-[28rem] lg:col-span-2 lg:h-[calc(100vh-16rem)]">
            <ChatBox
              messages={messages}
              onSend={handleSend}
              onSeek={seekTo}
              isBusy={isAnswering}
              disabled={!video}
            />
          </div>
        </main>

        <footer className="pt-1 text-center text-xs text-slate-600">
          Transcripts come from YouTube captions. Answers are grounded in the transcript only.
        </footer>
      </div>
    </div>
  )
}
