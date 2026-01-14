import { useState, useEffect, useRef, useCallback } from 'react';
import type { PlaybackState } from '@chiba/shared';
import { apiUpload, UploadProgress } from '../hooks/useApi';

const ALLOWED_FILE_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

interface PlaybackPanelProps {
  playbackState?: PlaybackState;
  disabled: boolean;
  loading?: boolean;
  onPlay: (source: { type: string; url?: string; filename?: string; name?: string }) => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onLoopChange: (enabled: boolean) => void;
  onShuffleChange: (enabled: boolean) => void;
  onVolumeChange: (volume: number) => void;
  onImageDurationChange: (duration: number) => void;
  onShowIntrosChange: (enabled: boolean) => void;
  onIntroDurationChange: (duration: number) => void;
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
  onImageDurationChange,
  onShowIntrosChange,
  onIntroDurationChange,
}: PlaybackPanelProps) {
  const [urlInput, setUrlInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [localVolume, setLocalVolume] = useState(playbackState?.volume ?? 100);
  const [localImageDuration, setLocalImageDuration] = useState(playbackState?.imageDuration ?? 10000);
  const [localIntroDuration, setLocalIntroDuration] = useState(playbackState?.introDuration ?? 5000);
  const [isInteracting, setIsInteracting] = useState(false);
  const [isDurationInteracting, setIsDurationInteracting] = useState(false);
  const [isIntroDurationInteracting, setIsIntroDurationInteracting] = useState(false);
  const lastSentVolume = useRef(playbackState?.volume ?? 100);
  const lastSentImageDuration = useRef(playbackState?.imageDuration ?? 10000);
  const lastSentIntroDuration = useRef(playbackState?.introDuration ?? 5000);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const durationDebounceTimer = useRef<NodeJS.Timeout | null>(null);
  const introDurationDebounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Upload state
  const [playMode, setPlayMode] = useState<'url' | 'upload'>('url');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isPlaying = playbackState && playbackState.mode !== 'off';
  const isPaused = playbackState?.paused;
  const isPlaylist = playbackState?.playlist && playbackState.playlist.items.length > 1;
  const loop = playbackState?.loop ?? true;
  const shuffle = playbackState?.shuffle ?? false;
  const showIntros = playbackState?.showIntros ?? true;

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

  // Sync image duration with server value when not interacting
  useEffect(() => {
    if (!isDurationInteracting && playbackState?.imageDuration !== undefined) {
      if (Math.abs(playbackState.imageDuration - lastSentImageDuration.current) > 100) {
        setLocalImageDuration(playbackState.imageDuration);
        lastSentImageDuration.current = playbackState.imageDuration;
      }
    }
  }, [playbackState?.imageDuration, isDurationInteracting]);

  // Sync intro duration with server value when not interacting
  useEffect(() => {
    if (!isIntroDurationInteracting && playbackState?.introDuration !== undefined) {
      if (Math.abs(playbackState.introDuration - lastSentIntroDuration.current) > 100) {
        setLocalIntroDuration(playbackState.introDuration);
        lastSentIntroDuration.current = playbackState.introDuration;
      }
    }
  }, [playbackState?.introDuration, isIntroDurationInteracting]);

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      if (durationDebounceTimer.current) {
        clearTimeout(durationDebounceTimer.current);
      }
      if (introDurationDebounceTimer.current) {
        clearTimeout(introDurationDebounceTimer.current);
      }
    };
  }, []);

  const handlePlayUrl = () => {
    if (!urlInput.trim()) return;
    onPlay({ type: 'url', url: urlInput.trim(), name: nameInput.trim() || undefined });
    setUrlInput('');
    setNameInput('');
  };

  // File upload handlers
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const handleUpload = useCallback(async (file: File) => {
    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      setUploadError(`Unsupported file type: ${file.type}`);
      return;
    }

    setUploading(true);
    setUploadProgress(null);
    setUploadError(null);

    try {
      // Upload to controller first
      const result = await apiUpload(
        file,
        nameInput.trim() || file.name,
        (progress) => setUploadProgress(progress)
      );

      // Then play on node using the upload URL
      onPlay({ type: 'url', url: result.data.url, name: result.data.originalName });
      setNameInput('');
      setUploadProgress(null);
    } catch (err) {
      setUploadError(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }, [nameInput, onPlay]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleUpload(file);
    }
  }, [handleUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleUpload(file);
      e.target.value = '';
    }
  }, [handleUpload]);

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

  // Debounced image duration change - sends at most every 100ms
  const sendImageDurationChange = useCallback((duration: number) => {
    if (durationDebounceTimer.current) {
      clearTimeout(durationDebounceTimer.current);
    }
    durationDebounceTimer.current = setTimeout(() => {
      lastSentImageDuration.current = duration;
      onImageDurationChange(duration);
    }, 100);
  }, [onImageDurationChange]);

  const handleImageDurationChange = (newDuration: number) => {
    setLocalImageDuration(newDuration);
    sendImageDurationChange(newDuration);
  };

  const handleDurationInteractionStart = () => {
    setIsDurationInteracting(true);
  };

  const handleDurationInteractionEnd = () => {
    setTimeout(() => setIsDurationInteracting(false), 500);
  };

  // Debounced intro duration change - sends at most every 100ms
  const sendIntroDurationChange = useCallback((duration: number) => {
    if (introDurationDebounceTimer.current) {
      clearTimeout(introDurationDebounceTimer.current);
    }
    introDurationDebounceTimer.current = setTimeout(() => {
      lastSentIntroDuration.current = duration;
      onIntroDurationChange(duration);
    }, 100);
  }, [onIntroDurationChange]);

  const handleIntroDurationChange = (newDuration: number) => {
    setLocalIntroDuration(newDuration);
    sendIntroDurationChange(newDuration);
  };

  const handleIntroDurationInteractionStart = () => {
    setIsIntroDurationInteracting(true);
  };

  const handleIntroDurationInteractionEnd = () => {
    setTimeout(() => setIsIntroDurationInteracting(false), 500);
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
          <button
            onClick={() => onShowIntrosChange(!showIntros)}
            disabled={disabled}
            title="Show intro screens"
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              border: showIntros ? '1px solid var(--accent)' : '1px solid var(--border)',
              background: showIntros ? 'rgba(59, 130, 246, 0.2)' : 'var(--bg-tertiary)',
              color: showIntros ? 'var(--accent)' : 'var(--text-secondary)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: disabled ? 0.5 : 1,
              transition: 'all 0.2s',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </button>
        </div>
      </div>

      {/* Image Duration Slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '4px',
            display: 'flex',
          }}
          title="Image display duration"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <input
          type="range"
          className="volume-slider"
          min="5"
          max="120"
          value={Math.round(localImageDuration / 1000)}
          onChange={(e) => handleImageDurationChange(parseInt(e.target.value) * 1000)}
          onMouseDown={handleDurationInteractionStart}
          onMouseUp={handleDurationInteractionEnd}
          onTouchStart={handleDurationInteractionStart}
          onTouchEnd={handleDurationInteractionEnd}
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
          {Math.round(localImageDuration / 1000)}s
        </span>
      </div>

      {/* Intro Duration Slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', opacity: showIntros ? 1 : 0.5 }}>
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '4px',
            display: 'flex',
          }}
          title="Intro screen duration (2-20 sec)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </div>
        <input
          type="range"
          className="volume-slider"
          min="2"
          max="20"
          value={Math.round(localIntroDuration / 1000)}
          onChange={(e) => handleIntroDurationChange(parseInt(e.target.value) * 1000)}
          onMouseDown={handleIntroDurationInteractionStart}
          onMouseUp={handleIntroDurationInteractionEnd}
          onTouchStart={handleIntroDurationInteractionStart}
          onTouchEnd={handleIntroDurationInteractionEnd}
          disabled={disabled || !showIntros}
          style={{ flex: 1 }}
        />
        <span style={{
          minWidth: '40px',
          textAlign: 'right',
          fontSize: '0.875rem',
          color: 'var(--text-secondary)',
          fontFamily: "'SF Mono', Monaco, 'Courier New', monospace",
        }}>
          {Math.round(localIntroDuration / 1000)}s
        </span>
      </div>

      {/* Play from URL / Upload */}
      <div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px',
        }}>
          <div style={{
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Play Content
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setPlayMode('url')}
              style={{
                padding: '4px 8px',
                fontSize: '0.75rem',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                background: playMode === 'url' ? 'var(--primary)' : 'var(--bg-tertiary)',
                color: playMode === 'url' ? 'white' : 'var(--text-secondary)',
              }}
            >
              URL
            </button>
            <button
              onClick={() => setPlayMode('upload')}
              style={{
                padding: '4px 8px',
                fontSize: '0.75rem',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                background: playMode === 'upload' ? 'var(--primary)' : 'var(--bg-tertiary)',
                color: playMode === 'upload' ? 'white' : 'var(--text-secondary)',
              }}
            >
              Upload
            </button>
          </div>
        </div>

        {playMode === 'url' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              type="text"
              className="form-input"
              placeholder="YouTube, Eden, Google Drive, or direct media URL"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePlayUrl()}
              disabled={disabled}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Name (optional)"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
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
        ) : (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_FILE_TYPES.join(',')}
              onChange={handleFileSelect}
              style={{ display: 'none' }}
              disabled={disabled || uploading}
            />

            <div style={{ marginBottom: '8px' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Name (optional)"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                disabled={disabled || uploading}
              />
            </div>

            <div
              onClick={() => !uploading && !disabled && fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              style={{
                border: `2px dashed ${dragActive ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: '8px',
                padding: '20px 16px',
                textAlign: 'center',
                cursor: uploading || disabled ? 'default' : 'pointer',
                backgroundColor: dragActive ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                transition: 'all 0.2s',
                opacity: disabled ? 0.5 : 1,
              }}
            >
              {uploading ? (
                <div>
                  <div style={{
                    width: '100%',
                    height: '6px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                    marginBottom: '8px',
                  }}>
                    <div style={{
                      width: `${uploadProgress?.percent || 0}%`,
                      height: '100%',
                      backgroundColor: 'var(--primary)',
                      transition: 'width 0.2s',
                    }} />
                  </div>
                  <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.875rem' }}>
                    Uploading... {uploadProgress?.percent || 0}%
                    {uploadProgress && uploadProgress.total > 0 && (
                      <span style={{ marginLeft: '6px', color: 'var(--text-muted)' }}>
                        ({formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.total)})
                      </span>
                    )}
                  </p>
                </div>
              ) : (
                <div>
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                    style={{ color: 'var(--text-muted)', marginBottom: '8px' }}
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.875rem' }}>
                    Drop file or click to browse
                  </p>
                </div>
              )}
            </div>

            {uploadError && (
              <div style={{
                marginTop: '8px',
                padding: '6px 10px',
                borderRadius: '4px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                color: 'var(--error, #ef4444)',
                fontSize: '0.8125rem',
              }}>
                {uploadError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
