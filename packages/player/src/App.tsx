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
const INTERACTION_KEY = 'chiba_user_interacted';

function hasUserInteracted(): boolean {
  return localStorage.getItem(INTERACTION_KEY) === 'true';
}

function markUserInteracted(): void {
  localStorage.setItem(INTERACTION_KEY, 'true');
}

export default function App() {
  const [error, setError] = useState<string | null>(null);
  const [needsInteraction, setNeedsInteraction] = useState(!hasUserInteracted());
  const wsUrl = getWebSocketUrl();
  const { connected, playbackState, sendEnded, sendError } = useWebSocket(wsUrl);

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

  // Render based on playback mode
  const { mode, currentContent, currentUrl, introMetadata, loop, paused, volume } = playbackState;

  switch (mode) {
    case 'video':
      if (!currentContent) {
        return (
          <div className="player-container">
            <ErrorScreen message="No content to play" />
          </div>
        );
      }
      return (
        <div className="player-container">
          <VideoPlayer
            content={currentContent}
            loop={loop}
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
            <ErrorScreen message="No content to display" />
          </div>
        );
      }
      return (
        <div className="player-container">
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
            <ErrorScreen message="No intro metadata" />
          </div>
        );
      }
      return (
        <div className="player-container">
          <IntroScreen metadata={introMetadata} />
        </div>
      );

    case 'url':
      if (!currentUrl) {
        return (
          <div className="player-container">
            <ErrorScreen message="No URL to display" />
          </div>
        );
      }
      return (
        <div className="player-container">
          <UrlDisplay url={currentUrl} onError={handleError} />
        </div>
      );

    case 'off':
    default:
      // Show debug screen when not playing
      if (!connected) {
        return (
          <div className="player-container">
            <OfflineScreen />
          </div>
        );
      }
      return (
        <div className="player-container">
          <DebugScreen connected={connected} />
        </div>
      );
  }
}
