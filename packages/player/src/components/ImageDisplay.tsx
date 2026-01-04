import { useState, useMemo } from 'react';
import type { Content } from '@chiba/shared';

interface ImageDisplayProps {
  content: Content;
  onError: (error: string) => void;
}

// Get base URL for node API (derive from ws query param or use current host)
function getNodeBaseUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const wsParam = params.get('ws');
  if (wsParam) {
    try {
      const wsUrl = new URL(wsParam);
      const protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
      return `${protocol}//${wsUrl.host}`;
    } catch {
      // Fall through to default
    }
  }
  return '';
}

export function ImageDisplay({ content, onError }: ImageDisplayProps) {
  const [loaded, setLoaded] = useState(false);

  const mediaUrl = useMemo(() => {
    const baseUrl = getNodeBaseUrl();
    return `${baseUrl}/media/${content.filename}`;
  }, [content.filename]);

  const handleError = () => {
    onError(`Failed to load image: ${content.filename}`);
  };

  const handleLoad = () => {
    setLoaded(true);
  };

  return (
    <div className="player-container">
      <img
        className="image-display"
        src={mediaUrl}
        alt={content.metadata?.title || content.filename}
        style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.3s' }}
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  );
}
