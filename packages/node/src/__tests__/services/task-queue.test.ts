/**
 * Tests for TaskQueue message types and structures.
 */

import { describe, it, expect } from 'vitest';
import type { NodeDownloadProgressMessage, TaskType, TaskStatus, TaskResult } from '@chiba/shared';

describe('Task Queue Types', () => {
  describe('NodeDownloadProgressMessage', () => {
    it('should have correct structure for queued status', () => {
      const msg: NodeDownloadProgressMessage = {
        type: 'download_progress',
        taskId: 'cache_abc123',
        nodeId: 'node-1',
        taskType: 'cache',
        status: 'queued',
        progress: 0,
        message: 'Task queued for processing',
      };

      expect(msg.type).toBe('download_progress');
      expect(msg.taskId).toBeDefined();
      expect(msg.nodeId).toBeDefined();
      expect(msg.taskType).toBe('cache');
      expect(msg.status).toBe('queued');
      expect(msg.progress).toBe(0);
    });

    it('should have correct structure for downloading status', () => {
      const msg: NodeDownloadProgressMessage = {
        type: 'download_progress',
        taskId: 'youtube_abc123',
        nodeId: 'node-1',
        taskType: 'youtube',
        status: 'downloading',
        progress: 50,
        totalBytes: 1024 * 1024,
        downloadedBytes: 512 * 1024,
        message: 'Downloading...',
      };

      expect(msg.status).toBe('downloading');
      expect(msg.progress).toBe(50);
      expect(msg.totalBytes).toBe(1024 * 1024);
      expect(msg.downloadedBytes).toBe(512 * 1024);
    });

    it('should support completed status with result', () => {
      const msg: NodeDownloadProgressMessage = {
        type: 'download_progress',
        taskId: 'cache_abc123',
        nodeId: 'node-1',
        taskType: 'cache',
        status: 'completed',
        progress: 100,
        message: 'Download complete',
        result: {
          filename: 'abc123.mp4',
          hash: 'abc123',
          sizeBytes: 1024,
          alreadyCached: false,
        },
      };

      expect(msg.status).toBe('completed');
      expect(msg.result?.filename).toBe('abc123.mp4');
      expect(msg.result?.hash).toBe('abc123');
      expect(msg.result?.sizeBytes).toBe(1024);
      expect(msg.result?.alreadyCached).toBe(false);
    });

    it('should support error status with error details', () => {
      const msg: NodeDownloadProgressMessage = {
        type: 'download_progress',
        taskId: 'eden_abc123',
        nodeId: 'node-1',
        taskType: 'eden',
        status: 'error',
        progress: 0,
        message: 'Download failed',
        error: {
          code: 'DOWNLOAD_FAILED',
          message: 'Connection timeout',
        },
      };

      expect(msg.status).toBe('error');
      expect(msg.error?.code).toBe('DOWNLOAD_FAILED');
      expect(msg.error?.message).toBe('Connection timeout');
    });

    it('should support all task types', () => {
      const taskTypes: TaskType[] = ['cache', 'youtube', 'eden'];

      for (const taskType of taskTypes) {
        const msg: NodeDownloadProgressMessage = {
          type: 'download_progress',
          taskId: `${taskType}_test`,
          nodeId: 'node-1',
          taskType,
          status: 'queued',
          progress: 0,
        };
        expect(msg.taskType).toBe(taskType);
      }
    });

    it('should support all status values', () => {
      const statuses: TaskStatus[] = ['queued', 'started', 'downloading', 'processing', 'completed', 'error'];

      for (const status of statuses) {
        const msg: NodeDownloadProgressMessage = {
          type: 'download_progress',
          taskId: 'test_task',
          nodeId: 'node-1',
          taskType: 'cache',
          status,
          progress: status === 'completed' ? 100 : 0,
        };
        expect(msg.status).toBe(status);
      }
    });
  });

  describe('TaskResult', () => {
    it('should support basic download result', () => {
      const result: TaskResult = {
        filename: 'abc123.mp4',
        hash: 'abc123',
        sizeBytes: 1024,
        alreadyCached: false,
      };

      expect(result.filename).toBe('abc123.mp4');
      expect(result.hash).toBe('abc123');
      expect(result.sizeBytes).toBe(1024);
      expect(result.alreadyCached).toBe(false);
    });

    it('should support Eden collection sync result', () => {
      const result: TaskResult = {
        itemsTotal: 10,
        itemsDownloaded: 8,
        itemsSkipped: 1,
        itemsFailed: 1,
      };

      expect(result.itemsTotal).toBe(10);
      expect(result.itemsDownloaded).toBe(8);
      expect(result.itemsSkipped).toBe(1);
      expect(result.itemsFailed).toBe(1);
    });

    it('should support already cached result', () => {
      const result: TaskResult = {
        filename: 'existing.mp4',
        hash: 'existing',
        sizeBytes: 2048,
        alreadyCached: true,
      };

      expect(result.alreadyCached).toBe(true);
    });
  });

  describe('Task ID format', () => {
    it('should follow the {type}_{uuid} pattern', () => {
      const patterns = [
        { taskId: 'cache_a1b2c3d4-e5f6-7890-abcd-ef1234567890', expectedType: 'cache' },
        { taskId: 'youtube_a1b2c3d4-e5f6-7890-abcd-ef1234567890', expectedType: 'youtube' },
        { taskId: 'eden_a1b2c3d4-e5f6-7890-abcd-ef1234567890', expectedType: 'eden' },
      ];

      for (const { taskId, expectedType } of patterns) {
        const parts = taskId.split('_');
        expect(parts[0]).toBe(expectedType);
        expect(parts[1]).toMatch(/^[a-f0-9-]+$/);
      }
    });
  });
});
