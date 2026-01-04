import { useEffect, useRef, useState, useCallback } from 'react';
import type { NodeStatus } from '@chiba/shared';

interface DashboardMessage {
  type: 'nodes' | 'node_update' | 'node_disconnected' | 'error';
  nodes?: NodeStatus[];
  node?: NodeStatus;
  nodeId?: string;
  error?: string;
}

interface UseWebSocketResult {
  nodes: NodeStatus[];
  connected: boolean;
  error: string | null;
  sendCommand: (nodeId: string, command: string, data?: unknown) => void;
}

export function useWebSocket(): UseWebSocketResult {
  const [nodes, setNodes] = useState<NodeStatus[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/dashboard`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected to dashboard WebSocket');
        setConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const message: DashboardMessage = JSON.parse(event.data);

          switch (message.type) {
            case 'nodes':
              // Full nodes list
              if (message.nodes) {
                setNodes(message.nodes);
              }
              break;

            case 'node_update':
              // Single node update
              if (message.node) {
                setNodes(prev => {
                  const index = prev.findIndex(n => n.node.id === message.node!.node.id);
                  if (index >= 0) {
                    const updated = [...prev];
                    updated[index] = message.node!;
                    return updated;
                  }
                  return [...prev, message.node!];
                });
              }
              break;

            case 'node_disconnected':
              // Node went offline
              if (message.nodeId) {
                setNodes(prev =>
                  prev.map(n =>
                    n.node.id === message.nodeId
                      ? { ...n, connected: false }
                      : n
                  )
                );
              }
              break;

            case 'error':
              console.error('[WS] Server error:', message.error);
              break;
          }
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected');
        setConnected(false);
        wsRef.current = null;

        // Reconnect after delay
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[WS] Attempting reconnect...');
          connect();
        }, 3000);
      };

      ws.onerror = (event) => {
        console.error('[WS] Error:', event);
        setError('WebSocket connection error');
      };
    } catch (err) {
      console.error('[WS] Failed to connect:', err);
      setError('Failed to connect to WebSocket');
    }
  }, []);

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

  const sendCommand = useCallback((nodeId: string, command: string, data?: unknown) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('[WS] Not connected');
      return;
    }

    wsRef.current.send(JSON.stringify({
      type: 'command',
      nodeId,
      command,
      data,
    }));
  }, []);

  return { nodes, connected, error, sendCommand };
}
