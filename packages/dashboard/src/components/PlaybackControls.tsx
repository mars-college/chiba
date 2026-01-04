import { useState } from 'react';
import type { PlaybackState } from '@chiba/shared';

interface PlaybackControlsProps {
  playbackState?: PlaybackState;
  disabled: boolean;
  onPlay: (source: { type: string; url?: string; filename?: string; loop?: boolean }) => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onLoopChange: (enabled: boolean) => void;
}

export function PlaybackControls({
  playbackState,
  disabled,
  onPlay,
  onStop,
  onPause,
  onResume,
  onLoopChange,
}: PlaybackControlsProps) {
  const [urlInput, setUrlInput] = useState('');
  const [sourceType, setSourceType] = useState<'url' | 'youtube'>('url');
  const [loopEnabled, setLoopEnabled] = useState(true);

  const isPlaying = playbackState && playbackState.mode !== 'off';
  const isPaused = playbackState?.paused;

  const handlePlayUrl = () => {
    if (!urlInput.trim()) return;

    // Auto-detect YouTube
    const isYoutube = urlInput.includes('youtube.com') || urlInput.includes('youtu.be');
    const type = isYoutube ? 'youtube' : sourceType;

    onPlay({ type, url: urlInput.trim(), loop: loopEnabled });
    setUrlInput('');
  };

  const handleLoopToggle = () => {
    const newValue = !loopEnabled;
    setLoopEnabled(newValue);
    // If currently playing, also update the server state
    if (isPlaying) {
      onLoopChange(newValue);
    }
  };

  const getCurrentContentInfo = () => {
    if (!playbackState || playbackState.mode === 'off') {
      return 'Not playing';
    }

    if (playbackState.currentContent) {
      // Prefer friendly name, then metadata title, then filename
      const content = playbackState.currentContent;
      return content.name || content.metadata?.title || content.filename || 'Unknown file';
    }

    if (playbackState.currentUrl) {
      const url = playbackState.currentUrl;
      if (url.length > 50) {
        return url.substring(0, 47) + '...';
      }
      return url;
    }

    return playbackState.mode;
  };

  return (
    <div>
      {/* Current Status */}
      <div style={{ marginBottom: '20px' }}>
        <div className="node-info-row">
          <span className="node-info-label">Status</span>
          <span className={`playback-mode ${isPlaying ? 'playing' : ''}`}>
            {playbackState?.mode || 'off'}
            {isPaused && ' (Paused)'}
          </span>
        </div>
        {isPlaying && (
          <div className="node-info-row" style={{ marginTop: '8px' }}>
            <span className="node-info-label">Now Playing</span>
            <span className="node-info-value" style={{ fontSize: '0.875rem' }}>
              {getCurrentContentInfo()}
            </span>
          </div>
        )}
      </div>

      {/* Transport Controls */}
      <div className="playback-controls" style={{ marginBottom: '20px' }}>
        {isPlaying && !isPaused && (
          <button
            className="control-btn"
            onClick={onPause}
            disabled={disabled}
            title="Pause"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          </button>
        )}
        {isPlaying && isPaused && (
          <button
            className="control-btn play"
            onClick={onResume}
            disabled={disabled}
            title="Resume"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        )}
        <button
          className="control-btn"
          onClick={onStop}
          disabled={disabled || !isPlaying}
          title="Stop"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" />
          </svg>
        </button>
      </div>

      {/* Play URL Input */}
      <div className="form-group">
        <label className="form-label">Play from URL</label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <select
            className="form-select"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as 'url' | 'youtube')}
            style={{ width: '120px' }}
            disabled={disabled}
          >
            <option value="url">URL</option>
            <option value="youtube">YouTube</option>
          </select>
          <input
            type="text"
            className="form-input"
            placeholder="Enter URL or YouTube link..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePlayUrl()}
            disabled={disabled}
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

      {/* Playback Options */}
      <div style={{ marginTop: '16px', display: 'flex', gap: '16px', fontSize: '0.875rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={isPlaying ? playbackState?.loop ?? loopEnabled : loopEnabled}
            onChange={handleLoopToggle}
            disabled={disabled}
          />
          Loop
        </label>
        {playbackState?.playlist && (
          <span style={{ color: 'var(--text-secondary)' }}>
            Playlist: {playbackState.playlistIndex + 1}/{playbackState.playlist.items.length}
          </span>
        )}
      </div>
    </div>
  );
}
