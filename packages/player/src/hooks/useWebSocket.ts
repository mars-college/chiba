import { useState, useEffect, useCallback, useRef } from 'react';
import type { PlaybackState, NodeToPlayerMessage, PlayerToNodeMessage } from '@chiba/shared';
import { DEFAULT_PLAYBACK_STATE, WS_RECONNECT_DELAY } from '@chiba/shared';

const WS_RECONNECT_INTERVAL = WS_RECONNECT_DELAY;

export interface DownloadProgress {
  active: boolean;
  progress: number;
  message?: string;
  name?: string;
}

interface WebSocketState {
  connected: boolean;
  playbackState: PlaybackState;
  downloadProgress: DownloadProgress | null;
}

export function useWebSocket(url: string) {
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    playbackState: DEFAULT_PLAYBACK_STATE,
    downloadProgress: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WebSocket] Connected');
        setState(prev => ({ ...prev, connected: true }));

        // Send ready message
        const readyMessage: PlayerToNodeMessage = { type: 'ready' };
        ws.send(JSON.stringify(readyMessage));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as NodeToPlayerMessage;

          if (message.type === 'state' && message.playback) {
            console.log('[WebSocket] State update', message.playback.mode);
            setState(prev => ({
              ...prev,
              playbackState: message.playback,
            }));
          } else if (message.type === 'download_progress') {
            console.log('[WebSocket] Download progress', message.status, message.progress);
            setState(prev => ({
              ...prev,
              downloadProgress:
                message.status === 'completed' || message.status === 'error'
                  ? null
                  : {
                      active: true,
                      progress: message.progress,
                      message: message.message,
                      name: message.name,
                    },
            }));
          }
        } catch (err) {
          console.error('[WebSocket] Failed to parse message', err);
        }
      };

      ws.onclose = () => {
        console.log('[WebSocket] Disconnected');
        setState(prev => ({ ...prev, connected: false }));
        wsRef.current = null;

        // Schedule reconnect
        reconnectTimeoutRef.current = window.setTimeout(() => {
          console.log('[WebSocket] Reconnecting...');
          connect();
        }, WS_RECONNECT_INTERVAL);
      };

      ws.onerror = (err) => {
        console.error('[WebSocket] Error', err);
      };
    } catch (err) {
      console.error('[WebSocket] Failed to connect', err);

      // Schedule reconnect
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, WS_RECONNECT_INTERVAL);
    }
  }, [url]);

  const sendMessage = useCallback((message: PlayerToNodeMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const sendEnded = useCallback(() => {
    sendMessage({ type: 'ended' });
  }, [sendMessage]);

  const sendError = useCallback((error: string) => {
    sendMessage({ type: 'error', error });
  }, [sendMessage]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    ...state,
    sendEnded,
    sendError,
    sendMessage,
  };
}
