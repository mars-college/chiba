import { useState, useCallback, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import {
  VideoPlayer,
  ImageDisplay,
  DebugScreen,
  IntroScreen,
  OfflineScreen,
  UrlDisplay,
  ErrorScreen,
  InteractionOverlay,
  DownloadOverlay,
} from './components';

// Get WebSocket URL from query param, or default to current host
function getWebSocketUrl(): string {
  // Check for ?ws= query parameter (for dev mode)
  const params = new URLSearchParams(window.location.search);
  const wsParam = params.get('ws');
  if (wsParam) {
    return wsParam;
  }

  // Default: use current host (production mode)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
}

// Check if user has interacted with the page (required for autoplay in browsers)
// In kiosk mode with --autoplay-policy=no-user-gesture-required, this isn't needed
const INTERACTION_KEY = 'chiba_user_interacted';

function isKioskMode(): boolean {
  // Check for kiosk indicators:
  // 1. Running in fullscreen/standalone mode
  // 2. Served from localhost (Pi serving to itself)
  // 3. Has ?kiosk query param
  const params = new URLSearchParams(window.location.search);
  if (params.has('kiosk')) return true;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return true;
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  return false;
}

function hasUserInteracted(): boolean {
  // Skip interaction requirement in kiosk mode
  if (isKioskMode()) return true;
  return localStorage.getItem(INTERACTION_KEY) === 'true';
}

function markUserInteracted(): void {
  localStorage.setItem(INTERACTION_KEY, 'true');
}

export default function App() {
  const [error, setError] = useState<string | null>(null);
  const [needsInteraction, setNeedsInteraction] = useState(!hasUserInteracted());
  const wsUrl = getWebSocketUrl();
  const { connected, playbackState, downloadProgress, sendEnded, sendError } = useWebSocket(wsUrl);

  // Also mark as interacted on any click/touch anywhere
  useEffect(() => {
    if (!needsInteraction) return;

    const handleInteraction = () => {
      markUserInteracted();
      setNeedsInteraction(false);
    };

    // Listen for any user interaction
    window.addEventListener('click', handleInteraction, { once: true });
    window.addEventListener('touchstart', handleInteraction, { once: true });
    window.addEventListener('keydown', handleInteraction, { once: true });

    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, [needsInteraction]);

  const handleError = useCallback((errorMessage: string) => {
    setError(errorMessage);
    sendError(errorMessage);
  }, [sendError]);

  const handleEnded = useCallback(() => {
    sendEnded();
  }, [sendEnded]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Show error screen if there's an error
  if (error) {
    return (
      <div className="player-container" onClick={clearError}>
        <ErrorScreen message={error} />
      </div>
    );
  }

  // Handle first user interaction requirement
  const handleFirstInteraction = useCallback(() => {
    markUserInteracted();
    setNeedsInteraction(false);
  }, []);

  // Show interaction overlay if browser needs user gesture
  if (needsInteraction) {
    return (
      <div className="player-container">
        <InteractionOverlay onInteract={handleFirstInteraction} />
      </div>
    );
  }

  // Render download overlay when active (shown on top of everything)
  const downloadOverlay = downloadProgress?.active ? (
    <DownloadOverlay
      progress={downloadProgress.progress}
      message={downloadProgress.message}
      name={downloadProgress.name}
    />
  ) : null;

  // Render based on playback mode
  const { mode, currentContent, currentUrl, introMetadata, paused, volume } = playbackState;

  switch (mode) {
    case 'video':
      if (!currentContent) {
        return (
          <div className="player-container">
            {downloadOverlay}
            <ErrorScreen message="No content to play" />
          </div>
        );
      }
      return (
        <div className="player-container">
          {downloadOverlay}
          <VideoPlayer
            content={currentContent}
            paused={paused}
            volume={volume}
            onEnded={handleEnded}
            onError={handleError}
          />
        </div>
      );

    case 'image':
      if (!currentContent) {
        return (
          <div className="player-container">
            {downloadOverlay}
            <ErrorScreen message="No content to display" />
          </div>
        );
      }
      return (
        <div className="player-container">
          {downloadOverlay}
          <ImageDisplay
            content={currentContent}
            onError={handleError}
          />
        </div>
      );

    case 'intro':
      if (!introMetadata) {
        return (
          <div className="player-container">
            {downloadOverlay}
            <ErrorScreen message="No intro metadata" />
          </div>
        );
      }
      return (
        <div className="player-container">
          {downloadOverlay}
          <IntroScreen metadata={introMetadata} />
        </div>
      );

    case 'url':
      if (!currentUrl) {
        return (
          <div className="player-container">
            {downloadOverlay}
            <ErrorScreen message="No URL to display" />
          </div>
        );
      }
      return (
        <div className="player-container">
          {downloadOverlay}
          <UrlDisplay url={currentUrl} onError={handleError} />
        </div>
      );

    case 'off':
    default:
      // Show debug screen when not playing
      if (!connected) {
        return (
          <div className="player-container">
            {downloadOverlay}
            <OfflineScreen />
          </div>
        );
      }
      return (
        <div className="player-container">
          {downloadOverlay}
          <DebugScreen connected={connected} />
        </div>
      );
  }
}
