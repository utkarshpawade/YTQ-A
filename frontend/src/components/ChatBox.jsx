import { useEffect, useRef, useState } from 'react'
import { splitIntoParts } from '../timestamps'

const SUGGESTIONS = [
  'Summarise this video in five bullets',
  'What are the main takeaways?',
  'Which tools or people are mentioned?',
]

/** Renders answer text with [MM:SS] citations turned into seek buttons. */
function AnswerText({ text, onSeek }) {
  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-100">
      {splitIntoParts(text).map((part, index) =>
        part.type === 'timestamp' ? (
          <button
            key={index}
            type="button"
            onClick={() => onSeek(part.seconds)}
            title={`Jump to ${part.label}`}
            className="mx-0.5 inline-flex items-center rounded bg-indigo-500/15 px-1.5 py-0.5 align-baseline font-mono text-xs font-semibold text-indigo-300 transition hover:bg-indigo-500/30 hover:text-indigo-200"
          >
            {part.label}
          </button>
        ) : (
          <span key={index}>{part.value}</span>
        ),
      )}
    </p>
  )
}

function SourceList({ sources, onSeek }) {
  const [open, setOpen] = useState(false)
  if (!sources?.length) return null

  return (
    <div className="mt-3 border-t border-slate-800 pt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-xs font-medium text-slate-400 transition hover:text-slate-200"
      >
        {open ? 'Hide' : 'Show'} {sources.length} transcript source
        {sources.length > 1 ? 's' : ''}
      </button>

      {open && (
        <ul className="mt-2 space-y-2">
          {sources.map((source, index) => (
            <li key={`${source.start}-${index}`} className="rounded-lg bg-slate-950/60 p-2.5">
              <button
                type="button"
                onClick={() => onSeek(source.start)}
                className="font-mono text-xs font-semibold text-indigo-300 transition hover:text-indigo-200"
              >
                [{source.timestamp}
                {source.end_timestamp ? ` - ${source.end_timestamp}` : ''}]
              </button>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">{source.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Message({ message, onSeek }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2.5 text-sm text-white">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[92%] rounded-2xl rounded-bl-sm px-4 py-3 ${
          message.error
            ? 'border border-rose-900/60 bg-rose-950/40 text-rose-200'
            : 'border border-slate-800 bg-slate-900'
        }`}
      >
        {message.error ? (
          <p className="text-sm leading-relaxed">{message.content}</p>
        ) : (
          <>
            <AnswerText text={message.content} onSeek={onSeek} />
            <SourceList sources={message.sources} onSeek={onSeek} />
          </>
        )}
      </div>
    </div>
  )
}

/** Chat panel: history, composer, and timestamp seek wiring. */
export default function ChatBox({ messages, onSend, onSeek, isBusy, disabled }) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, isBusy])

  function submit(question) {
    const trimmed = question.trim()
    if (!trimmed || disabled || isBusy) return
    setDraft('')
    onSend(trimmed)
  }

  function handleSubmit(event) {
    event.preventDefault()
    submit(draft)
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit(draft)
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg shadow-black/20">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-200">Ask the video</h2>
        <span className="text-xs text-slate-500">Answers cite clickable timestamps</span>
      </header>

      <div ref={scrollRef} className="scrollbar-slim flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="space-y-3 text-sm text-slate-500">
            <p>
              {disabled
                ? 'Load a video first, then ask anything about what was said in it.'
                : 'Ask anything about this video. Try one of these:'}
            </p>
            {!disabled && (
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => submit(suggestion)}
                    className="rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-500 hover:text-indigo-300"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((message) => (
          <Message key={message.id} message={message} onSeek={onSeek} />
        ))}

        {isBusy && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
            Searching the transcript
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-slate-800 p-3">
        <div className="flex items-end gap-2">
          <textarea
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled || isBusy}
            placeholder={disabled ? 'Load a video to start' : 'Ask about this video...'}
            className="scrollbar-slim max-h-32 min-h-11 w-full flex-1 resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={disabled || isBusy || !draft.trim()}
            className="h-11 shrink-0 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  )
}
