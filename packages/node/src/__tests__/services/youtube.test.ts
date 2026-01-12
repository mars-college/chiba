/**
 * YouTube download service tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { isYouTubeUrl, getVideoMetadata, downloadYouTube } from '../../services/youtube.js';
import { initDatabase, closeDatabase } from '../../db/index.js';

describe('youtube service', () => {
  describe('isYouTubeUrl', () => {
    it('should recognize youtube.com URLs', () => {
      expect(isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
      expect(isYouTubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
      expect(isYouTubeUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    });

    it('should recognize youtu.be URLs', () => {
      expect(isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
      expect(isYouTubeUrl('http://youtu.be/dQw4w9WgXcQ')).toBe(true);
    });

    it('should recognize youtube.com shorts URLs', () => {
      expect(isYouTubeUrl('https://www.youtube.com/shorts/ABC123')).toBe(true);
    });

    it('should recognize youtube.com embed URLs', () => {
      expect(isYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(true);
    });

    it('should reject non-YouTube URLs', () => {
      expect(isYouTubeUrl('https://vimeo.com/123456')).toBe(false);
      expect(isYouTubeUrl('https://example.com/video.mp4')).toBe(false);
      expect(isYouTubeUrl('not a url')).toBe(false);
      expect(isYouTubeUrl('')).toBe(false);
      expect(isYouTubeUrl('https://notyoutube.com/watch?v=test')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(isYouTubeUrl('youtube.com/watch?v=test')).toBe(false); // missing protocol
      expect(isYouTubeUrl('ftp://youtube.com/watch?v=test')).toBe(false); // wrong protocol
    });
  });

  describe('yt-dlp integration', () => {
    let ytdlpAvailable = false;
    let ytdlpVersion = '';

    beforeAll(() => {
      // Check if yt-dlp is installed
      try {
        ytdlpVersion = execSync('yt-dlp --version', { encoding: 'utf8' }).trim();
        ytdlpAvailable = true;
        console.log(`yt-dlp available: ${ytdlpVersion}`);
      } catch {
        console.log('yt-dlp not installed - skipping integration tests');
      }
    });

    it('should detect yt-dlp installation', () => {
      if (!ytdlpAvailable) {
        console.log('SKIP: yt-dlp not installed');
        return;
      }
      expect(ytdlpVersion).toBeTruthy();
      expect(ytdlpVersion).toMatch(/^\d+\.\d+/);
    });

    it('should spawn yt-dlp and receive output', async () => {
      if (!ytdlpAvailable) {
        console.log('SKIP: yt-dlp not installed');
        return;
      }

      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
        const ytdlp = spawn('yt-dlp', ['--version']);
        let stdout = '';
        let stderr = '';

        ytdlp.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        ytdlp.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ytdlp.on('close', (code) => {
          resolve({ code, stdout, stderr });
        });

        ytdlp.on('error', (err) => {
          resolve({ code: -1, stdout: '', stderr: err.message });
        });
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/^\d+\.\d+/);
    });

    it('should fetch video metadata', async () => {
      if (!ytdlpAvailable) {
        console.log('SKIP: yt-dlp not installed');
        return;
      }

      // Use a short, reliable video for testing
      const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // "Me at the zoo" - first YouTube video
      const metadata = await getVideoMetadata(testUrl);

      expect(metadata.title).toBeTruthy();
      console.log('Fetched metadata:', metadata);
    }, 30000); // 30 second timeout

    it('should download a short video', async () => {
      if (!ytdlpAvailable) {
        console.log('SKIP: yt-dlp not installed');
        return;
      }

      // Create a temp directory for the test
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chiba-youtube-test-'));
      const tempDbPath = path.join(tempDir, 'test.db');

      // Mock MEDIA_DIR and initialize database
      const originalMediaDir = process.env.MEDIA_DIR;
      process.env.MEDIA_DIR = tempDir;

      try {
        // Initialize database in temp dir
        initDatabase(tempDbPath);

        // Use a very short video for testing
        const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

        const progressUpdates: Array<{ progress: number; status: string; message?: string }> = [];

        const result = await downloadYouTube(testUrl, {
          onProgress: (p) => {
            progressUpdates.push({ progress: p.progress, status: p.status, message: p.message });
            console.log(`Progress: ${p.progress}% - ${p.status} - ${p.message}`);
          },
        });

        expect(result.content.filename).toBeTruthy();
        expect(result.content.hash).toBeTruthy();
        expect(result.content.type).toBe('video');

        // Verify file exists
        const filePath = path.join(tempDir, result.content.filename);
        expect(fs.existsSync(filePath)).toBe(true);

        console.log('Downloaded:', result.content.filename, 'Size:', result.content.sizeBytes);
      } finally {
        // Cleanup
        closeDatabase();
        process.env.MEDIA_DIR = originalMediaDir;
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }, 120000); // 2 minute timeout for download
  });
});
