/**
 * Upload endpoint tests.
 * Tests the file upload functionality with streaming and MD5 hashing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Load .env to get API key for authenticated requests
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

// Test video file path - a real large video for testing
const TEST_VIDEO_PATH = '/Users/gene/Downloads/5cbf9cbadcd201e4d6476e7252a69206ba052997b3eaf834145c7b8d72f94731.mp4';

const TEST_PORT = 18099;
const TEST_UPLOADS_DIR = path.resolve(__dirname, '../../test-uploads');
const TEST_DB_PATH = path.resolve(__dirname, '../../test-upload.db');

// API key for authenticated requests
const API_KEY = process.env.API_KEY || '';

describe('Upload API', () => {
  let server: http.Server;

  beforeAll(async () => {
    // Set test environment
    process.env.PORT = String(TEST_PORT);
    process.env.UPLOADS_DIR = TEST_UPLOADS_DIR;
    process.env.DB_PATH = TEST_DB_PATH;

    // Clean up test directories
    if (fs.existsSync(TEST_UPLOADS_DIR)) {
      fs.rmSync(TEST_UPLOADS_DIR, { recursive: true });
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    // Import and start server
    const { startServer } = await import('../server.js');
    server = startServer(TEST_PORT);

    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    // Close server
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // Clean up test uploads directory
    if (fs.existsSync(TEST_UPLOADS_DIR)) {
      fs.rmSync(TEST_UPLOADS_DIR, { recursive: true });
    }
    // Clean up test db
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  beforeEach(() => {
    // Clean uploads directory between tests
    if (fs.existsSync(TEST_UPLOADS_DIR)) {
      const files = fs.readdirSync(TEST_UPLOADS_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(TEST_UPLOADS_DIR, file));
      }
    }
  });

  /**
   * Helper to make HTTP request with multipart form data
   */
  async function uploadFile(
    filePath: string,
    mimeType = 'video/mp4',
    customName?: string
  ): Promise<{ statusCode: number; body: string }> {
    const fileContent = fs.readFileSync(filePath);
    const boundary = '----TestBoundary' + Date.now();
    const filename = path.basename(filePath);

    const parts: Buffer[] = [];

    // Add name field if provided
    if (customName) {
      parts.push(Buffer.from(`--${boundary}\r\n`));
      parts.push(Buffer.from(`Content-Disposition: form-data; name="name"\r\n\r\n`));
      parts.push(Buffer.from(`${customName}\r\n`));
    }

    // Add file
    parts.push(Buffer.from(`--${boundary}\r\n`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`));
    parts.push(Buffer.from(`Content-Type: ${mimeType}\r\n\r\n`));
    parts.push(fileContent);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/upload',
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
            'X-API-Key': API_KEY,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ statusCode: res.statusCode!, body: data }));
        }
      );

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * Helper to compute MD5 hash of a file
   */
  function computeFileMD5(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  it('should upload the real test video file', async () => {
    // Skip if test video doesn't exist
    if (!fs.existsSync(TEST_VIDEO_PATH)) {
      console.log(`Skipping: test video not found at ${TEST_VIDEO_PATH}`);
      return;
    }

    const expectedHash = computeFileMD5(TEST_VIDEO_PATH);
    const fileSize = fs.statSync(TEST_VIDEO_PATH).size;

    console.log(`Uploading test video: ${TEST_VIDEO_PATH}`);
    console.log(`File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Expected MD5: ${expectedHash}`);

    const response = await uploadFile(TEST_VIDEO_PATH);

    expect(response.statusCode).toBe(200);

    const result = JSON.parse(response.body);
    expect(result.success).toBe(true);
    expect(result.data.hash).toBe(expectedHash);
    expect(result.data.filename).toBe(`${expectedHash}.mp4`);
    expect(result.data.contentType).toBe('video');
    expect(result.data.sizeBytes).toBe(fileSize);
    expect(result.data.url).toContain('/uploads/');
    expect(result.data.url).toContain(expectedHash);

    // Verify file exists in uploads directory
    const uploadedPath = path.join(TEST_UPLOADS_DIR, `${expectedHash}.mp4`);
    expect(fs.existsSync(uploadedPath)).toBe(true);

    // Verify uploaded file hash matches
    const uploadedHash = computeFileMD5(uploadedPath);
    expect(uploadedHash).toBe(expectedHash);

    console.log('Upload successful!');
    console.log(`Uploaded to: ${uploadedPath}`);
  }, 60000); // 60 second timeout for large file

  it('should serve uploaded file via GET /uploads/:filename', async () => {
    // Skip if test video doesn't exist
    if (!fs.existsSync(TEST_VIDEO_PATH)) {
      console.log(`Skipping: test video not found at ${TEST_VIDEO_PATH}`);
      return;
    }

    // First upload the file
    const uploadResponse = await uploadFile(TEST_VIDEO_PATH);
    expect(uploadResponse.statusCode).toBe(200);

    const uploadResult = JSON.parse(uploadResponse.body);
    const filename = uploadResult.data.filename;

    // Now fetch it
    const response = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; bodyLength: number }>((resolve, reject) => {
      http.get(`http://localhost:${TEST_PORT}/uploads/${filename}`, (res) => {
        let bodyLength = 0;
        res.on('data', (chunk) => (bodyLength += chunk.length));
        res.on('end', () => resolve({ statusCode: res.statusCode!, headers: res.headers, bodyLength }));
      }).on('error', reject);
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('video/mp4');
    expect(response.headers['accept-ranges']).toBe('bytes');

    const originalSize = fs.statSync(TEST_VIDEO_PATH).size;
    expect(response.bodyLength).toBe(originalSize);
  }, 60000);

  it('should support range requests for video seeking', async () => {
    // Skip if test video doesn't exist
    if (!fs.existsSync(TEST_VIDEO_PATH)) {
      console.log(`Skipping: test video not found at ${TEST_VIDEO_PATH}`);
      return;
    }

    // First upload the file
    const uploadResponse = await uploadFile(TEST_VIDEO_PATH);
    expect(uploadResponse.statusCode).toBe(200);

    const uploadResult = JSON.parse(uploadResponse.body);
    const filename = uploadResult.data.filename;

    // Request a range
    const response = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; bodyLength: number }>((resolve, reject) => {
      http.get(
        {
          hostname: 'localhost',
          port: TEST_PORT,
          path: `/uploads/${filename}`,
          headers: { Range: 'bytes=0-1023' },
        },
        (res) => {
          let bodyLength = 0;
          res.on('data', (chunk) => (bodyLength += chunk.length));
          res.on('end', () => resolve({ statusCode: res.statusCode!, headers: res.headers, bodyLength }));
        }
      ).on('error', reject);
    });

    expect(response.statusCode).toBe(206); // Partial Content
    expect(response.bodyLength).toBe(1024);
    expect(response.headers['content-range']).toMatch(/^bytes 0-1023\/\d+$/);
  }, 60000);

  it('should deduplicate identical uploads', async () => {
    // Skip if test video doesn't exist
    if (!fs.existsSync(TEST_VIDEO_PATH)) {
      console.log(`Skipping: test video not found at ${TEST_VIDEO_PATH}`);
      return;
    }

    // Upload same file twice
    const response1 = await uploadFile(TEST_VIDEO_PATH);
    expect(response1.statusCode).toBe(200);
    const result1 = JSON.parse(response1.body);

    const response2 = await uploadFile(TEST_VIDEO_PATH);
    expect(response2.statusCode).toBe(200);
    const result2 = JSON.parse(response2.body);

    // Should have same hash and filename
    expect(result1.data.hash).toBe(result2.data.hash);
    expect(result1.data.filename).toBe(result2.data.filename);

    // Should only have one file in uploads dir
    const files = fs.readdirSync(TEST_UPLOADS_DIR);
    expect(files.length).toBe(1);
  }, 120000);

  it('should reject unsupported file types', async () => {
    // Create a temp text file
    const tempPath = path.join(TEST_UPLOADS_DIR, 'test.txt');
    fs.mkdirSync(TEST_UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(tempPath, 'Hello World');

    const response = await uploadFile(tempPath, 'text/plain');

    expect(response.statusCode).toBe(400);
    const result = JSON.parse(response.body);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported file type');

    fs.unlinkSync(tempPath);
  });

  it('should return 404 for non-existent upload file', async () => {
    const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      http.get(`http://localhost:${TEST_PORT}/uploads/nonexistent.mp4`, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode!, body: data }));
      }).on('error', reject);
    });

    expect(response.statusCode).toBe(404);
  });

  it('should use custom name when provided', async () => {
    // Skip if test video doesn't exist
    if (!fs.existsSync(TEST_VIDEO_PATH)) {
      console.log(`Skipping: test video not found at ${TEST_VIDEO_PATH}`);
      return;
    }

    const customName = 'My Custom Video Name.mp4';
    const response = await uploadFile(TEST_VIDEO_PATH, 'video/mp4', customName);

    expect(response.statusCode).toBe(200);
    const result = JSON.parse(response.body);
    expect(result.data.originalName).toBe(customName);
  }, 60000);
});
