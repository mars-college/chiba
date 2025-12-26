import { useEffect, useRef, useState, useCallback } from 'react'

type Mode = 'video' | 'playlist' | 'url' | 'off'

interface State {
  mode: Mode
  file: string | null
  url: string | null
}

// Image display duration in playlist mode (ms)
const IMAGE_DISPLAY_DURATION = 10000

// File type detection
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v']

function getFileType(filename: string | null): 'image' | 'video' | 'unknown' {
  if (!filename) return 'unknown'
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'))
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  return 'unknown'
}

// Styles optimized for GPU acceleration
const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    background: '#000',
    position: 'fixed',
    top: 0,
    left: 0,
    overflow: 'hidden',
    // Force GPU layer
    transform: 'translateZ(0)',
    willChange: 'contents',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    position: 'absolute',
    top: 0,
    left: 0,
    // GPU acceleration
    transform: 'translateZ(0)',
    backfaceVisibility: 'hidden',
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  image: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    position: 'absolute',
    top: 0,
    left: 0,
    transform: 'translateZ(0)',
  },
  hidden: {
    display: 'none',
  },
}

function getWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}`
}

export default function App() {
  const [state, setState] = useState<State>({ mode: 'off', file: null, url: null })
  const [muted, setMuted] = useState(false) // Start unmuted, will auto-mute if blocked
  const [showHint, setShowHint] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number>(0)

  // Handle click to unmute (only needed if browser blocked autoplay with audio)
  useEffect(() => {
    const handleClick = () => {
      if (videoRef.current && muted) {
        videoRef.current.muted = false
        videoRef.current.play().then(() => {
          setMuted(false)
          setShowHint(false)
        }).catch(() => {})
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [muted])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(getWebSocketUrl())
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'ready' }))
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'state') {
          setState({
            mode: data.mode,
            file: data.file,
            url: data.url,
          })
        }
      } catch {}
    }

    ws.onclose = () => {
      wsRef.current = null
      reconnectTimeoutRef.current = window.setTimeout(connect, 1000)
    }

    ws.onerror = () => ws.close()
  }, [])

  // Connect on mount
  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimeoutRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  // Request next item in playlist
  const requestNext = useCallback(() => {
    if (state.mode === 'playlist' && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'next' }))
    }
  }, [state.mode])

  // Determine current file type
  const fileType = getFileType(state.file)
  const isPlaylistOrVideo = state.mode === 'video' || state.mode === 'playlist'
  const showVideo = isPlaylistOrVideo && fileType === 'video'
  const showImage = isPlaylistOrVideo && fileType === 'image'

  // Handle image display timer (for playlist mode)
  useEffect(() => {
    if (state.mode === 'playlist' && fileType === 'image') {
      const timer = setTimeout(() => {
        requestNext()
      }, IMAGE_DISPLAY_DURATION)
      return () => clearTimeout(timer)
    }
  }, [state.mode, state.file, fileType, requestNext])

  // Handle video playback
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (showVideo && state.file) {
      const newSrc = `/media/${state.file}`
      // Only reload if source changed
      if (!video.src.endsWith(newSrc)) {
        // Set loop based on mode (loop for single video, no loop for playlist)
        video.loop = state.mode === 'video'
        video.src = newSrc
        video.muted = false // Try unmuted first
        video.load()
        video.play().then(() => {
          // Autoplay with audio worked (Pi kiosk mode)
          setMuted(false)
          setShowHint(false)
        }).catch(() => {
          // Browser blocked autoplay with audio, fall back to muted
          video.muted = true
          setMuted(true)
          setShowHint(true)
          video.play().catch(() => {})
        })
      }
    } else if (!showVideo) {
      video.pause()
      video.removeAttribute('src')
      video.load() // Free memory
      setShowHint(false)
    }
  }, [state.mode, state.file, showVideo])

  return (
    <div style={styles.container}>
      {/* Video player */}
      <video
        ref={videoRef}
        style={{
          ...styles.video,
          ...(!showVideo ? styles.hidden : {}),
        }}
        autoPlay
        muted={muted}
        loop={state.mode === 'video'}
        playsInline
        preload="auto"
        onEnded={requestNext}
      />

      {/* Image display */}
      {showImage && state.file && (
        <img
          src={`/media/${state.file}`}
          style={styles.image}
          alt=""
        />
      )}

      {showHint && (
        <div style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          background: 'rgba(0,0,0,0.7)',
          color: 'white',
          padding: '10px 20px',
          borderRadius: 8,
          fontSize: 14,
          cursor: 'pointer',
        }}>
          Click anywhere for audio
        </div>
      )}

      {state.mode === 'url' && state.url && (
        <iframe
          src={state.url}
          style={styles.iframe}
          allow="autoplay; fullscreen"
        />
      )}
    </div>
  )
}
