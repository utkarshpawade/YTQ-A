import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { toLabel } from '../timestamps'

const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api'
let apiPromise = null

/** Load the YouTube IFrame API once per page and resolve with window.YT. */
function loadIframeApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise

  apiPromise = new Promise((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.()
      resolve(window.YT)
    }
    const script = document.createElement('script')
    script.src = IFRAME_API_SRC
    script.async = true
    script.onerror = () => reject(new Error('Could not load the YouTube player API.'))
    document.head.appendChild(script)
  })
  return apiPromise
}

/**
 * Embedded player exposing `seekTo(seconds)` to its parent. The IFrame API is
 * used when it loads; otherwise the plain embed is remounted at the requested
 * start time so timestamps stay clickable either way.
 */
const VideoPlayer = forwardRef(function VideoPlayer({ video }, ref) {
  const containerRef = useRef(null)
  const playerRef = useRef(null)
  const [apiFailed, setApiFailed] = useState(false)
  const [fallbackStart, setFallbackStart] = useState(0)
  const [lastSeek, setLastSeek] = useState(null)
  const videoId = video?.video_id

  useEffect(() => {
    if (!videoId || apiFailed) return undefined
    let cancelled = false

    loadIframeApi()
      .then((YT) => {
        if (cancelled || !containerRef.current) return
        playerRef.current?.destroy?.()
        // The API swaps the target element for an iframe, so give it a fresh
        // child node instead of the container React owns.
        containerRef.current.replaceChildren()
        const host = document.createElement('div')
        containerRef.current.appendChild(host)
        playerRef.current = new YT.Player(host, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        })
      })
      .catch(() => {
        if (!cancelled) setApiFailed(true)
      })

    return () => {
      cancelled = true
      playerRef.current?.destroy?.()
      playerRef.current = null
      containerRef.current?.replaceChildren()
    }
  }, [videoId, apiFailed])

  useEffect(() => {
    setLastSeek(null)
    setFallbackStart(0)
  }, [videoId])

  const seekTo = useCallback((seconds) => {
    const target = Math.max(Math.floor(seconds || 0), 0)
    setLastSeek(target)
    const player = playerRef.current
    if (player?.seekTo) {
      player.seekTo(target, true)
      player.playVideo?.()
    } else {
      setFallbackStart(target)
    }
    containerRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }, [])

  useImperativeHandle(ref, () => ({ seekTo }), [seekTo])

  if (!videoId) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/40 text-center text-sm text-slate-500">
        <p className="max-w-xs px-6">
          Paste a YouTube link above to load a video and start asking questions about it.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="aspect-video w-full overflow-hidden rounded-xl border border-slate-800 bg-black shadow-lg shadow-black/40">
        {apiFailed ? (
          <iframe
            key={fallbackStart}
            className="h-full w-full"
            src={`https://www.youtube.com/embed/${videoId}?start=${fallbackStart}&autoplay=${
              fallbackStart ? 1 : 0
            }&rel=0`}
            title={video.title || 'YouTube video player'}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div
            ref={containerRef}
            className="h-full w-full [&>div]:h-full [&>div]:w-full [&_iframe]:h-full [&_iframe]:w-full"
          />
        )}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-slate-100">{video.title}</h2>
          <p className="truncate text-sm text-slate-400">
            {video.author || 'Unknown channel'}
            {video.duration_label ? ` · ${video.duration_label}` : ''}
            {video.language ? ` · ${video.language}` : ''}
          </p>
        </div>
        {lastSeek !== null && (
          <span className="shrink-0 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300">
            Jumped to {toLabel(lastSeek)}
          </span>
        )}
      </div>
    </div>
  )
})

export default VideoPlayer
