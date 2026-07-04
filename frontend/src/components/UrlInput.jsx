import { useState } from 'react'

const SAMPLE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

/** URL submission bar plus the indexing status indicator. */
export default function UrlInput({ onSubmit, status, video, error }) {
  const [url, setUrl] = useState('')
  const isLoading = status === 'loading'

  function handleSubmit(event) {
    event.preventDefault()
    const trimmed = url.trim()
    if (!trimmed || isLoading) return
    onSubmit(trimmed)
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg shadow-black/20">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="video-url" className="sr-only">
          YouTube URL
        </label>
        <input
          id="video-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={SAMPLE_URL}
          disabled={isLoading}
          className="w-full flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={isLoading || !url.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {isLoading && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          )}
          {isLoading ? 'Indexing' : 'Load video'}
        </button>
      </form>

      <div className="mt-3 min-h-5 text-sm">
        {error && <p className="text-rose-400">{error}</p>}
        {!error && isLoading && (
          <p className="text-slate-400">
            Fetching the transcript and building the vector index. First run also downloads the
            embedding model, so give it a moment.
          </p>
        )}
        {!error && !isLoading && video && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-400">
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Indexed
            </span>
            <span className="text-slate-600">|</span>
            <span>{video.chunk_count} chunks</span>
            <span className="text-slate-600">|</span>
            <span>{video.segment_count} caption lines</span>
            <span className="text-slate-600">|</span>
            <span>{video.duration_label}</span>
          </p>
        )}
        {!error && !isLoading && !video && (
          <p className="text-slate-500">
            Works with any public video that has captions - watch pages, share links, shorts or
            embeds.
          </p>
        )}
      </div>
    </section>
  )
}
