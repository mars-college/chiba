import { useState, useEffect, useRef, useCallback } from 'react';
import type { PlaybackState } from '@chiba/shared';

interface PlaybackPanelProps {
  playbackState?: PlaybackState;
  disabled: boolean;
  loading?: boolean;
  onPlay: (source: { type: string; url?: string; filename?: string }) => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onLoopChange: (enabled: boolean) => void;
  onShuffleChange: (enabled: boolean) => void;
  onVolumeChange: (volume: number) => void;
}

export function PlaybackPanel({
  playbackState,
  disabled,
  loading,
  onPlay,
  onStop,
  onPause,
  onResume,
  onNext,
  onPrevious,
  onLoopChange,
  onShuffleChange,
  onVolumeChange,
}: PlaybackPanelProps) {
  const [urlInput, setUrlInput] = useState('');
  const [localVolume, setLocalVolume] = useState(playbackState?.volume ?? 100);
  const [isInteracting, setIsInteracting] = useState(false);
  const lastSentVolume = useRef(playbackState?.volume ?? 100);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const isPlaying = playbackState && playbackState.mode !== 'off';
  const isPaused = playbackState?.paused;
  const isPlaylist = playbackState?.playlist && playbackState.playlist.items.length > 1;
  const loop = playbackState?.loop ?? true;
  const shuffle = playbackState?.shuffle ?? false;

  // Only sync with server value when not interacting AND server value differs significantly
  // This prevents snap-back while still allowing server-initiated changes
  useEffect(() => {
    if (!isInteracting && playbackState?.volume !== undefined) {
      // Only update if we're not the source of this change
      if (Math.abs(playbackState.volume - lastSentVolume.current) > 1) {
        setLocalVolume(playbackState.volume);
        lastSentVolume.current = playbackState.volume;
      }
    }
  }, [playbackState?.volume, isInteracting]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  const handlePlayUrl = () => {
    if (!urlInput.trim()) return;
    onPlay({ type: 'url', url: urlInput.trim() });
    setUrlInput('');
  };

  // Debounced volume change - sends at most every 100ms
  const sendVolumeChange = useCallback((volume: number) => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      lastSentVolume.current = volume;
      onVolumeChange(volume);
    }, 100);
  }, [onVolumeChange]);

  const handleVolumeChange = (newVolume: number) => {
    setLocalVolume(newVolume);
    sendVolumeChange(newVolume);
  };

  const handleVolumeInteractionStart = () => {
    setIsInteracting(true);
  };

  const handleVolumeInteractionEnd = () => {
    // Keep interacting flag for a bit longer to prevent snap-back from delayed server response
    setTimeout(() => setIsInteracting(false), 500);
  };

  const getCurrentContentInfo = () => {
    if (!playbackState || playbackState.mode === 'off') {
      return null;
    }

    if (playbackState.currentContent) {
      const content = playbackState.currentContent;
      return content.name || content.metadata?.title || content.filename || 'Unknown file';
    }

    if (playbackState.currentUrl) {
      try {
        const url = new URL(playbackState.currentUrl);
        return url.hostname + (url.pathname !== '/' ? url.pathname : '');
      } catch {
        return playbackState.currentUrl.substring(0, 40);
      }
    }

    return playbackState.mode;
  };

  const getVolumeIcon = () => {
    if (localVolume === 0) {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      );
    }
    if (localVolume < 50) {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      );
    }
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
      </svg>
    );
  };

  const contentInfo = getCurrentContentInfo();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Now Playing Section */}
      <div style={{
        background: isPlaying ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%)' : 'var(--bg-tertiary)',
        borderRadius: '12px',
        padding: '20px',
        border: isPlaying ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Status indicator */}
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '8px',
              background: isPlaying ? 'var(--accent)' : 'var(--bg-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {isPlaying ? (
                isPaused ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                )
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--text-muted)">
                  <rect x="6" y="6" width="12" height="12" />
                </svg>
              )}
            </div>
            <div>
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '4px',
              }}>
                {isPlaying ? (isPaused ? 'Paused' : 'Now Playing') : 'Idle'}
              </div>
              <div style={{
                fontSize: '1rem',
                fontWeight: 500,
                color: 'var(--text-primary)',
                maxWidth: '280px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {contentInfo || 'No media playing'}
              </div>
            </div>
          </div>
          {loading && (
            <div className="loading-spinner" style={{ width: '24px', height: '24px', borderWidth: '2px' }} />
          )}
        </div>

        {/* Playlist info */}
        {isPlaylist && (
          <div style={{
            fontSize: '0.8125rem',
            color: 'var(--text-secondary)',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            Track {(playbackState?.playlistIndex ?? 0) + 1} of {playbackState?.playlist?.items.length}
          </div>
        )}

        {/* Transport Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
          {/* Previous */}
          <button
            className="control-btn"
            onClick={onPrevious}
            disabled={disabled || !isPlaylist}
            title="Previous"
            style={{ opacity: isPlaylist ? 1 : 0.3 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="19 20 9 12 19 4 19 20" />
              <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>

          {/* Play/Pause */}
          {isPlaying && !isPaused ? (
            <button
              className="control-btn"
              onClick={onPause}
              disabled={disabled}
              title="Pause"
              style={{
                width: '56px',
                height: '56px',
                background: 'var(--accent)',
                borderColor: 'var(--accent)',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            </button>
          ) : (
            <button
              className="control-btn play"
              onClick={isPlaying ? onResume : undefined}
              disabled={disabled || (!isPlaying && !urlInput.trim())}
              title={isPlaying ? 'Resume' : 'Play'}
              style={{ width: '56px', height: '56px' }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </button>
          )}

          {/* Stop */}
          <button
            className="control-btn"
            onClick={onStop}
            disabled={disabled || !isPlaying}
            title="Stop"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" />
            </svg>
          </button>

          {/* Next */}
          <button
            className="control-btn"
            onClick={onNext}
            disabled={disabled || !isPlaylist}
            title="Next"
            style={{ opacity: isPlaylist ? 1 : 0.3 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 4 15 12 5 20 5 4" />
              <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Volume + Settings Row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: '20px',
        alignItems: 'center',
      }}>
        {/* Volume */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => {
              const newVol = localVolume === 0 ? 100 : 0;
              setLocalVolume(newVol);
              lastSentVolume.current = newVol;
              onVolumeChange(newVol);
            }}
            disabled={disabled}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              padding: '4px',
              display: 'flex',
              opacity: disabled ? 0.5 : 1,
            }}
            title={localVolume === 0 ? 'Unmute' : 'Mute'}
          >
            {getVolumeIcon()}
          </button>
          <input
            type="range"
            className="volume-slider"
            min="0"
            max="100"
            value={localVolume}
            onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
            onMouseDown={handleVolumeInteractionStart}
            onMouseUp={handleVolumeInteractionEnd}
            onTouchStart={handleVolumeInteractionStart}
            onTouchEnd={handleVolumeInteractionEnd}
            disabled={disabled}
            style={{ flex: 1 }}
          />
          <span style={{
            minWidth: '40px',
            textAlign: 'right',
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
            fontFamily: "'SF Mono', Monaco, 'Courier New', monospace",
          }}>
            {localVolume}%
          </span>
        </div>

        {/* Loop + Shuffle toggles */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => onLoopChange(!loop)}
            disabled={disabled}
            title="Loop"
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              border: loop ? '1px solid var(--accent)' : '1px solid var(--border)',
              background: loop ? 'rgba(59, 130, 246, 0.2)' : 'var(--bg-tertiary)',
              color: loop ? 'var(--accent)' : 'var(--text-secondary)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: disabled ? 0.5 : 1,
              transition: 'all 0.2s',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>
          <button
            onClick={() => onShuffleChange(!shuffle)}
            disabled={disabled}
            title="Shuffle"
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              border: shuffle ? '1px solid var(--accent)' : '1px solid var(--border)',
              background: shuffle ? 'rgba(59, 130, 246, 0.2)' : 'var(--bg-tertiary)',
              color: shuffle ? 'var(--accent)' : 'var(--text-secondary)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: disabled ? 0.5 : 1,
              transition: 'all 0.2s',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 3 21 3 21 8" />
              <line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" />
              <line x1="15" y1="15" x2="21" y2="21" />
              <line x1="4" y1="4" x2="9" y2="9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Play URL Input */}
      <div>
        <div style={{
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: '8px',
        }}>
          Play from URL
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            className="form-input"
            placeholder="YouTube, Eden, or direct media URL"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePlayUrl()}
            disabled={disabled}
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-primary"
            onClick={handlePlayUrl}
            disabled={disabled || !urlInput.trim()}
          >
            Play
          </button>
        </div>
      </div>
    </div>
  );
}
