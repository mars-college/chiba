/**
 * Eden API integration service tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EDEN_API } from '@chiba/shared';

describe('eden service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('EDEN_API constants', () => {
    it('should have PROD API URL', () => {
      expect(EDEN_API.PROD).toBe('https://api.eden.art');
    });

    it('should have STAGE API URL', () => {
      expect(EDEN_API.STAGE).toBe('https://staging.api.eden.art');
    });
  });

  describe('syncCollection', () => {
    it('should throw error if EDEN_API_KEY not configured', async () => {
      delete process.env.EDEN_API_KEY;

      // Import after clearing env
      const { syncCollection } = await import('../../services/eden.js');

      await expect(syncCollection('test-collection-id')).rejects.toThrow(
        'EDEN_API_KEY not configured'
      );
    });
  });
});
