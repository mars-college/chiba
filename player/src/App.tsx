import { useEffect, useRef, useState, useCallback } from 'react'

type Mode = 'video' | 'url' | 'off'

interface State {
  mode: Mode
  file: string | null
  url: string | null
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

  // Handle video playback
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (state.mode === 'video' && state.file) {
      const newSrc = `/media/${state.file}`
      // Only reload if source changed
      if (!video.src.endsWith(newSrc)) {
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
    } else if (state.mode !== 'video') {
      video.pause()
      video.removeAttribute('src')
      video.load() // Free memory
      setShowHint(false)
    }
  }, [state.mode, state.file])

  return (
    <div style={styles.container}>
      <video
        ref={videoRef}
        style={{
          ...styles.video,
          ...(state.mode !== 'video' ? styles.hidden : {}),
        }}
        autoPlay
        muted={muted}
        loop
        playsInline
        preload="auto"
      />

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
          🔇 Click anywhere for audio
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
