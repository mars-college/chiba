/**
 * Task queue service for async download operations.
 * Manages sequential task processing with progress reporting via WebSocket.
 */

import crypto from 'crypto';
import { createLogger } from '@chiba/shared';
import type {
  NodeDownloadProgressMessage,
  TaskType,
  TaskResult,
} from '@chiba/shared';
import { getDatabase } from '../db/index.js';
import { downloadAndCache } from './content-cache.js';
import { downloadYouTube, isYouTubeUrl } from './youtube.js';

const logger = createLogger('node', 'task-queue');

/**
 * Source configuration for a task.
 */
export interface TaskSource {
  url?: string;
  collectionId?: string;
  creationId?: string;
  db?: 'PROD' | 'STAGE';
}

/**
 * Task definition as stored in the queue.
 */
export interface QueuedTask {
  id: string;
  type: TaskType;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  source: TaskSource;
  metadata?: { name?: string };
  playAfter: boolean;
  priority: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  result?: TaskResult;
}

/**
 * Options for enqueuing a task.
 */
export interface EnqueueOptions {
  type: TaskType;
  source: TaskSource;
  metadata?: { name?: string };
  playAfter?: boolean;
  priority?: number;
}

/**
 * Callback for when a task completes and should trigger playback.
 */
export type PlayCallback = (result: TaskResult) => void;

/**
 * Progress callback type for sending updates via WebSocket.
 */
export type ProgressCallback = (msg: NodeDownloadProgressMessage) => void;

/**
 * Task queue for managing async download operations.
 */
export class TaskQueue {
  private processing = false;
  private progressCallback: ProgressCallback | null = null;
  private playCallback: PlayCallback | null = null;
  private nodeId = '';

  /**
   * Set the node ID for progress messages.
   */
  setNodeId(nodeId: string): void {
    this.nodeId = nodeId;
  }

  /**
   * Set the callback for progress updates.
   */
  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * Set the callback for when a task with playAfter completes.
   */
  setPlayCallback(callback: PlayCallback): void {
    this.playCallback = callback;
  }

  /**
   * Generate a unique task ID.
   */
  private generateTaskId(type: TaskType): string {
    return `${type}_${crypto.randomUUID()}`;
  }

  /**
   * Enqueue a task for processing.
   * Returns the task ID immediately.
   */
  enqueue(options: EnqueueOptions): string {
    const taskId = this.generateTaskId(options.type);
    const db = getDatabase();
    const now = Date.now();

    db.prepare(`
      INSERT INTO download_queue (task_id, source_type, source_data, metadata, priority, play_after, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      taskId,
      options.type,
      JSON.stringify(options.source),
      options.metadata ? JSON.stringify(options.metadata) : null,
      options.priority ?? 0,
      options.playAfter ? 1 : 0,
      now
    );

    logger.info('Task enqueued', { taskId, type: options.type, source: options.source });

    // Send queued status immediately
    this.sendProgress({
      taskId,
      taskType: options.type,
      status: 'queued',
      progress: 0,
      message: 'Task queued for processing',
    });

    // Start processing if not already running
    this.processQueue();

    return taskId;
  }

  /**
   * Get current queue status.
   */
  getQueueStatus(): { current: QueuedTask | null; pending: QueuedTask[] } {
    const db = getDatabase();

    const currentRow = db.prepare(`
      SELECT * FROM download_queue WHERE status = 'downloading' LIMIT 1
    `).get() as QueuedTaskRow | undefined;

    const pendingRows = db.prepare(`
      SELECT * FROM download_queue WHERE status = 'pending' ORDER BY priority DESC, created_at ASC
    `).all() as QueuedTaskRow[];

    return {
      current: currentRow ? this.rowToTask(currentRow) : null,
      pending: pendingRows.map(row => this.rowToTask(row)),
    };
  }

  /**
   * Get a task by ID.
   */
  getTask(taskId: string): QueuedTask | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM download_queue WHERE task_id = ?`).get(taskId) as QueuedTaskRow | undefined;
    return row ? this.rowToTask(row) : null;
  }

  /**
   * Process the queue sequentially.
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        const db = getDatabase();

        // Get next pending task (highest priority, oldest first)
        const row = db.prepare(`
          SELECT * FROM download_queue
          WHERE status = 'pending'
          ORDER BY priority DESC, created_at ASC
          LIMIT 1
        `).get() as QueuedTaskRow | undefined;

        if (!row) {
          // No more tasks
          break;
        }

        const task = this.rowToTask(row);
        await this.executeTask(task);
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Execute a single task.
   */
  private async executeTask(task: QueuedTask): Promise<void> {
    const db = getDatabase();
    const now = Date.now();

    // Mark as downloading
    db.prepare(`
      UPDATE download_queue SET status = 'downloading', started_at = ? WHERE task_id = ?
    `).run(now, task.id);

    logger.info('Task started', { taskId: task.id, type: task.type });

    this.sendProgress({
      taskId: task.id,
      taskType: task.type,
      status: 'started',
      progress: 0,
      message: 'Download started',
    });

    try {
      const result = await this.performDownload(task);

      // Mark as completed
      db.prepare(`
        UPDATE download_queue SET status = 'completed', completed_at = ? WHERE task_id = ?
      `).run(Date.now(), task.id);

      logger.info('Task completed', { taskId: task.id, result });

      this.sendProgress({
        taskId: task.id,
        taskType: task.type,
        status: 'completed',
        progress: 100,
        message: 'Download completed',
        result,
      });

      // Trigger playback if requested
      if (task.playAfter && this.playCallback) {
        this.playCallback(result);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = this.getErrorCode(error);

      // Mark as failed
      db.prepare(`
        UPDATE download_queue SET status = 'failed', completed_at = ?, error = ? WHERE task_id = ?
      `).run(Date.now(), errorMessage, task.id);

      logger.error('Task failed', error as Error, { taskId: task.id });

      this.sendProgress({
        taskId: task.id,
        taskType: task.type,
        status: 'error',
        progress: 0,
        message: 'Download failed',
        error: { code: errorCode, message: errorMessage },
      });
    }
  }

  /**
   * Perform the actual download based on task type.
   */
  private async performDownload(task: QueuedTask): Promise<TaskResult> {
    const { source, metadata } = task;

    switch (task.type) {
      case 'youtube': {
        if (!source.url) {
          throw new Error('YouTube URL is required');
        }
        const result = await downloadYouTube(source.url, {
          name: metadata?.name,
          onProgress: (progress) => {
            this.sendProgress({
              taskId: task.id,
              taskType: task.type,
              status: progress.status === 'complete' ? 'completed' :
                      progress.status === 'error' ? 'error' : 'downloading',
              progress: progress.progress,
              hash: progress.hash || undefined,
              message: progress.message,
            });
          },
        });
        return {
          filename: result.content.filename,
          hash: result.content.hash,
          sizeBytes: result.content.sizeBytes,
          alreadyCached: result.alreadyCached,
        };
      }

      case 'cache': {
        if (!source.url) {
          throw new Error('URL is required for cache');
        }

        // Check if it's a YouTube URL that was misclassified
        if (isYouTubeUrl(source.url)) {
          const result = await downloadYouTube(source.url, {
            name: metadata?.name,
            onProgress: (progress) => {
              this.sendProgress({
                taskId: task.id,
                taskType: 'youtube',
                status: progress.status === 'complete' ? 'completed' :
                        progress.status === 'error' ? 'error' : 'downloading',
                progress: progress.progress,
                hash: progress.hash || undefined,
                message: progress.message,
              });
            },
          });
          return {
            filename: result.content.filename,
            hash: result.content.hash,
            sizeBytes: result.content.sizeBytes,
            alreadyCached: result.alreadyCached,
          };
        }

        const result = await downloadAndCache(source.url, {
          name: metadata?.name,
          onProgress: (progress) => {
            this.sendProgress({
              taskId: task.id,
              taskType: task.type,
              status: 'downloading',
              progress: progress.progress,
              downloadedBytes: progress.downloadedBytes,
              totalBytes: progress.totalBytes,
              hash: progress.hash || undefined,
            });
          },
        });
        return {
          filename: result.content.filename,
          hash: result.content.hash,
          sizeBytes: result.content.sizeBytes,
          alreadyCached: result.alreadyCached,
        };
      }

      case 'eden': {
        // Eden sync will be handled later - for now throw error
        // This requires importing the eden service which has complex dependencies
        throw new Error('Eden sync not yet implemented in task queue');
      }

      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  /**
   * Send progress update via callback.
   */
  private sendProgress(partial: Omit<NodeDownloadProgressMessage, 'type' | 'nodeId'>): void {
    if (!this.progressCallback) return;

    const msg: NodeDownloadProgressMessage = {
      type: 'download_progress',
      nodeId: this.nodeId,
      ...partial,
    };

    this.progressCallback(msg);
  }

  /**
   * Get error code from error.
   */
  private getErrorCode(error: unknown): string {
    if (error instanceof Error) {
      if (error.message.includes('timeout')) return 'TIMEOUT';
      if (error.message.includes('HTTP')) return 'HTTP_ERROR';
      if (error.message.includes('content type')) return 'INVALID_CONTENT';
      if (error.message.includes('yt-dlp')) return 'YOUTUBE_ERROR';
      if (error.message.includes('Eden')) return 'EDEN_ERROR';
    }
    return 'DOWNLOAD_FAILED';
  }

  /**
   * Convert database row to QueuedTask.
   */
  private rowToTask(row: QueuedTaskRow): QueuedTask {
    return {
      id: row.task_id,
      type: row.source_type as TaskType,
      status: row.status as QueuedTask['status'],
      source: JSON.parse(row.source_data),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      playAfter: row.play_after === 1,
      priority: row.priority,
      createdAt: row.created_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      error: row.error ?? undefined,
    };
  }
}

/**
 * Database row type for download_queue.
 */
interface QueuedTaskRow {
  id: number;
  task_id: string;
  source_type: string;
  source_data: string;
  metadata: string | null;
  priority: number;
  play_after: number;
  status: string;
  error: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

/**
 * Singleton instance of the task queue.
 */
let taskQueueInstance: TaskQueue | null = null;

/**
 * Get or create the task queue singleton.
 */
export function getTaskQueue(): TaskQueue {
  if (!taskQueueInstance) {
    taskQueueInstance = new TaskQueue();
  }
  return taskQueueInstance;
}
