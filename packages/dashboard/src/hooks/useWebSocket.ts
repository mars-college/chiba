import { useEffect, useRef, useState, useCallback } from 'react';
import type { NodeStatus, NodeDownloadProgressMessage } from '@chiba/shared';

interface DashboardMessage {
  type: 'nodes' | 'node_update' | 'node_disconnected' | 'task_progress' | 'error';
  nodes?: NodeStatus[];
  status?: NodeStatus;  // For node_update
  nodeId?: string;
  task?: NodeDownloadProgressMessage;  // For task_progress
  error?: string;
}

/** Task progress info with expiration for cleanup */
export interface TaskProgress {
  taskId: string;
  nodeId: string;
  taskType: string;
  status: string;
  progress: number;
  message?: string;
  error?: { code: string; message: string };
  result?: {
    filename?: string;
    hash?: string;
    sizeBytes?: number;
    alreadyCached?: boolean;
  };
  receivedAt: number;
}

interface UseWebSocketResult {
  nodes: NodeStatus[];
  connected: boolean;
  error: string | null;
  tasks: Map<string, TaskProgress>;
  sendCommand: (nodeId: string, command: string, data?: unknown) => void;
}

export function useWebSocket(): UseWebSocketResult {
  const [nodes, setNodes] = useState<NodeStatus[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Map<string, TaskProgress>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const taskCleanupRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

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
              // Single node update - controller sends { nodeId, status }
              if (message.nodeId && message.status) {
                setNodes(prev => {
                  const index = prev.findIndex(n => n.node.id === message.nodeId);
                  if (index >= 0) {
                    const updated = [...prev];
                    updated[index] = message.status!;
                    return updated;
                  }
                  return [...prev, message.status!];
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

            case 'task_progress':
              // Task progress update
              if (message.task) {
                const task = message.task;
                setTasks(prev => {
                  const updated = new Map(prev);
                  updated.set(task.taskId, {
                    taskId: task.taskId,
                    nodeId: task.nodeId,
                    taskType: task.taskType,
                    status: task.status,
                    progress: task.progress,
                    message: task.message,
                    error: task.error,
                    result: task.result,
                    receivedAt: Date.now(),
                  });
                  return updated;
                });
                console.log('[WS] Task progress:', task.taskId, task.status, task.progress);
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

    // Clean up completed/errored tasks after 10 seconds
    taskCleanupRef.current = setInterval(() => {
      const now = Date.now();
      setTasks(prev => {
        const updated = new Map(prev);
        for (const [taskId, task] of updated.entries()) {
          if (
            (task.status === 'completed' || task.status === 'error') &&
            now - task.receivedAt > 10000
          ) {
            updated.delete(taskId);
          }
        }
        return updated.size !== prev.size ? updated : prev;
      });
    }, 5000);

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (taskCleanupRef.current) {
        clearInterval(taskCleanupRef.current);
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

  return { nodes, connected, error, tasks, sendCommand };
}
