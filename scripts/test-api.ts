#!/usr/bin/env tsx
/**
 * Integration test script for Chiba API endpoints.
 *
 * Usage:
 *   tsx scripts/test-api.ts
 *
 * Or with custom config:
 *   CONTROLLER_URL=http://localhost:8080 NODE_ID=my-node tsx scripts/test-api.ts
 */

import http from 'http';
import https from 'https';

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  controllerUrl: process.env.CONTROLLER_URL || 'http://10.10.13.9:8080',
  nodeName: process.env.NODE_NAME || 'macbook',  // Friendly name to find
  nodeId: '',  // Will be resolved from nodeName
  apiKey: process.env.API_KEY || '3bcd5d271fd85aa1b982a0b3efa6abb0285d7d051a6d7f93',

  // Test data
  eden: {
    creationId: '656abdc809360ec0b9fc7c2d',  // PROD
    collectionIdProd: '68538ccaf883914b6b8e09a1',
    collectionIdStage: '6955b5ec1dd4ee955af9f612',
  },
  testVideoUrl: 'https://dtut5r9j4w7j4.cloudfront.net/1695eb3b9ccc8d1f7eb57ee54bfadfc4e7f564d526b1a0f4fa705ca11ced51af.mp4',
};

// =============================================================================
// HTTP Client
// =============================================================================

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  error?: string;
}

async function request<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, headers = {} } = options;
  const url = new URL(path, CONFIG.controllerUrl);
  const isHttps = url.protocol === 'https:';
  const httpModule = isHttps ? https : http;

  // Add auth header if API key is set
  if (CONFIG.apiKey) {
    headers['Authorization'] = `Bearer ${CONFIG.apiKey}`;
  }

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  return new Promise((resolve, reject) => {
    const req = httpModule.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({
              status: res.statusCode || 0,
              data: parsed as T,
              error: parsed.error,
            });
          } catch {
            resolve({
              status: res.statusCode || 0,
              data: data as T,
            });
          }
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(300000); // 5 min timeout for downloads

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// =============================================================================
// Test Utilities
// =============================================================================

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function log(message: string, ...args: unknown[]) {
  console.log(`  ${message}`, ...args);
}

function pass(name: string) {
  passCount++;
  console.log(`  ✓ ${name}`);
}

function fail(name: string, error?: string) {
  failCount++;
  console.log(`  ✗ ${name}`);
  if (error) console.log(`    Error: ${error}`);
}

function skip(name: string, reason?: string) {
  skipCount++;
  console.log(`  ⊘ ${name} (skipped${reason ? `: ${reason}` : ''})`);
}

function section(name: string) {
  console.log(`\n▶ ${name}`);
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Tests
// =============================================================================

async function testDiscovery() {
  section('Discovery Endpoints');

  // GET /api/info
  {
    const res = await request('/api/info');
    if (res.status === 200 && res.data && (res.data as { endpoints: string[] }).endpoints) {
      pass('GET /api/info - returns endpoint list');
    } else {
      fail('GET /api/info', res.error);
    }
  }

  // GET /health
  {
    const res = await request('/health');
    if (res.status === 200 && (res.data as { status: string }).status === 'ok') {
      pass('GET /health - returns ok');
    } else {
      fail('GET /health', res.error);
    }
  }

  // GET /api/nodes
  {
    const res = await request<{ success: boolean; data: { nodes: Array<{ node: { id: string; friendlyName: string } }> } }>('/api/nodes');
    if (res.status === 200 && res.data.success) {
      const nodes = res.data.data.nodes;
      pass(`GET /api/nodes - found ${nodes.length} node(s)`);

      // Check if our test node is connected and resolve its UUID
      const testNode = nodes.find(n =>
        n.node.friendlyName === CONFIG.nodeName ||
        n.node.friendlyName.toLowerCase().includes(CONFIG.nodeName.toLowerCase())
      );
      if (testNode) {
        pass(`Node "${CONFIG.nodeName}" is connected`);
        // Store the actual node UUID for later tests
        CONFIG.nodeId = testNode.node.id;
        log(`  Resolved node ID: ${CONFIG.nodeId}`);
      } else {
        fail(`Node "${CONFIG.nodeName}" not found in connected nodes`);
        log('Available nodes:', nodes.map(n => `${n.node.friendlyName} (${n.node.id})`).join(', '));
      }
    } else {
      fail('GET /api/nodes', res.error);
    }
  }
}

async function testEdenEndpoints() {
  section('Eden API Endpoints');

  // GET /api/eden/creation/:id
  {
    const res = await request<{ success: boolean; data: { creation: { _id: string; url: string; name?: string } } }>(
      `/api/eden/creation/${CONFIG.eden.creationId}?db=PROD`
    );
    if (res.status === 200 && res.data.success && res.data.data?.creation?._id) {
      pass(`GET /api/eden/creation/:id - fetched creation`);
      log(`  Name: ${res.data.data.creation.name || '(untitled)'}`);
      log(`  Media URL: ${res.data.data.creation.url?.substring(0, 60)}...`);
    } else {
      fail('GET /api/eden/creation/:id', res.error || 'Missing creation data');
    }
  }

  // GET /api/eden/collection/:id (PROD)
  {
    const res = await request<{
      success: boolean;
      data: {
        collection: { name: string };
        creations: Array<{ _id: string }>
      }
    }>(`/api/eden/collection/${CONFIG.eden.collectionIdProd}?db=PROD`);
    if (res.status === 200 && res.data.success && res.data.data.collection) {
      pass(`GET /api/eden/collection/:id (PROD) - fetched collection`);
      log(`  Name: ${res.data.data.collection.name}`);
      log(`  Creations: ${res.data.data.creations.length}`);
    } else {
      fail('GET /api/eden/collection/:id (PROD)', res.error);
    }
  }

  // GET /api/eden/collection/:id (STAGE)
  {
    const res = await request<{
      success: boolean;
      data: {
        collection: { name: string };
        creations: Array<{ _id: string }>
      }
    }>(`/api/eden/collection/${CONFIG.eden.collectionIdStage}?db=STAGE`);
    if (res.status === 200 && res.data.success && res.data.data.collection) {
      pass(`GET /api/eden/collection/:id (STAGE) - fetched collection`);
      log(`  Name: ${res.data.data.collection.name}`);
      log(`  Creations: ${res.data.data.creations.length}`);
    } else {
      fail('GET /api/eden/collection/:id (STAGE)', res.error);
    }
  }

  // GET /api/eden/parse - valid creation URL
  {
    const testUrl = `https://app.eden.art/creation/${CONFIG.eden.creationId}`;
    const res = await request<{ success: boolean; data: { valid: boolean; type: string; id: string } }>(
      `/api/eden/parse?url=${encodeURIComponent(testUrl)}`
    );
    if (res.status === 200 && res.data.data.valid && res.data.data.type === 'creation') {
      pass('GET /api/eden/parse - parsed creation URL');
    } else {
      fail('GET /api/eden/parse (creation URL)', res.error);
    }
  }

  // GET /api/eden/parse - valid collection URL
  {
    const testUrl = `https://eden.art/collection/${CONFIG.eden.collectionIdProd}`;
    const res = await request<{ success: boolean; data: { valid: boolean; type: string; id: string } }>(
      `/api/eden/parse?url=${encodeURIComponent(testUrl)}`
    );
    if (res.status === 200 && res.data.data.valid && res.data.data.type === 'collection') {
      pass('GET /api/eden/parse - parsed collection URL');
    } else {
      fail('GET /api/eden/parse (collection URL)', res.error);
    }
  }

  // GET /api/eden/parse - invalid URL
  {
    const testUrl = 'https://example.com/not-eden';
    const res = await request<{ success: boolean; data: { valid: boolean } }>(
      `/api/eden/parse?url=${encodeURIComponent(testUrl)}`
    );
    if (res.status === 200 && res.data.data.valid === false) {
      pass('GET /api/eden/parse - correctly rejected non-Eden URL');
    } else {
      fail('GET /api/eden/parse (invalid URL)', 'Should have returned valid: false');
    }
  }
}

let testPlaylistId: string | null = null;

async function testPlaylistCrud() {
  section('Playlist CRUD');

  // POST /api/playlists - create empty playlist
  {
    const res = await request<{ success: boolean; data: { id: string; name: string; items: unknown[] } }>(
      '/api/playlists',
      {
        method: 'POST',
        body: {
          name: 'Test Playlist (Empty)',
          loop: true,
        },
      }
    );
    if (res.status === 200 && res.data.success && res.data.data.id) {
      pass('POST /api/playlists - created empty playlist');
      testPlaylistId = res.data.data.id;
      log(`  ID: ${testPlaylistId}`);
    } else {
      fail('POST /api/playlists (empty)', res.error);
    }
  }

  // GET /api/playlists - list playlists
  {
    const res = await request<{ success: boolean; data: Array<{ id: string; name: string }> }>('/api/playlists');
    if (res.status === 200 && res.data.success && Array.isArray(res.data.data)) {
      pass(`GET /api/playlists - found ${res.data.data.length} playlist(s)`);
    } else {
      fail('GET /api/playlists', res.error);
    }
  }

  // GET /api/playlists/:id - get single playlist
  if (testPlaylistId) {
    const res = await request<{ success: boolean; data: { id: string; name: string } }>(
      `/api/playlists/${testPlaylistId}`
    );
    if (res.status === 200 && res.data.success && res.data.data.id === testPlaylistId) {
      pass('GET /api/playlists/:id - fetched playlist');
    } else {
      fail('GET /api/playlists/:id', res.error);
    }
  }

  // POST /api/playlists/:id/items - add items
  if (testPlaylistId) {
    const res = await request<{ success: boolean; data: { addedItems: unknown[]; totalItems: number } }>(
      `/api/playlists/${testPlaylistId}/items`,
      {
        method: 'POST',
        body: {
          items: [
            { creationId: CONFIG.eden.creationId, name: 'Test Creation' },
            { url: `https://eden.art/creation/${CONFIG.eden.creationId}` },
          ],
        },
      }
    );
    if (res.status === 200 && res.data.success && res.data.data.totalItems === 2) {
      pass('POST /api/playlists/:id/items - added 2 items');
    } else {
      fail('POST /api/playlists/:id/items', res.error);
    }
  }

  // PUT /api/playlists/:id - update playlist
  if (testPlaylistId) {
    const res = await request<{ success: boolean; data: { name: string; loop: boolean } }>(
      `/api/playlists/${testPlaylistId}`,
      {
        method: 'PUT',
        body: {
          name: 'Test Playlist (Updated)',
          loop: false,
        },
      }
    );
    if (res.status === 200 && res.data.success && res.data.data.name === 'Test Playlist (Updated)') {
      pass('PUT /api/playlists/:id - updated playlist');
    } else {
      fail('PUT /api/playlists/:id', res.error);
    }
  }

  // DELETE /api/playlists/:id/items/:index - remove item
  if (testPlaylistId) {
    const res = await request<{ success: boolean; remainingItems: number }>(
      `/api/playlists/${testPlaylistId}/items/0`,
      { method: 'DELETE' }
    );
    if (res.status === 200 && res.data.success) {
      pass('DELETE /api/playlists/:id/items/:index - removed item');
    } else {
      fail('DELETE /api/playlists/:id/items/:index', res.error);
    }
  }

  // Clean up - delete test playlist
  if (testPlaylistId) {
    const res = await request(`/api/playlists/${testPlaylistId}`, { method: 'DELETE' });
    if (res.status === 200) {
      pass('DELETE /api/playlists/:id - deleted playlist');
    } else {
      fail('DELETE /api/playlists/:id', res.error);
    }
    testPlaylistId = null;
  }
}

async function testPlaylistWithContent() {
  section('Playlist with Video Content');

  // Create playlist with video URL items
  {
    const res = await request<{ success: boolean; data: { id: string; items: unknown[] } }>(
      '/api/playlists',
      {
        method: 'POST',
        body: {
          name: 'Video Test Playlist',
          items: [
            { url: CONFIG.testVideoUrl, name: 'Test Video' },
          ],
          loop: true,
          showIntros: false,
        },
      }
    );
    if (res.status === 200 && res.data.success) {
      pass('Created playlist with video URL');
      testPlaylistId = res.data.data.id;
      log(`  Playlist ID: ${testPlaylistId}`);
      log(`  Items: ${res.data.data.items.length}`);
    } else {
      fail('Create playlist with video content', res.error);
    }
  }
}

async function testNodeCaching() {
  section('Node Caching');

  if (!CONFIG.nodeId) {
    skip('Cache tests', 'No node ID resolved');
    return;
  }

  // First check node status
  {
    const res = await request<{ success: boolean }>(`/api/nodes/${CONFIG.nodeId}`);
    if (res.status !== 200 || !res.data.success) {
      skip('Cache tests', `Node "${CONFIG.nodeName}" not available`);
      return;
    }
  }

  // Cache test video URL
  {
    log('Caching test video URL...');
    const res = await request<{ success: boolean; data: { data?: { content?: unknown; alreadyCached?: boolean } } }>(
      `/api/nodes/${CONFIG.nodeId}/cache`,
      {
        method: 'POST',
        body: {
          url: CONFIG.testVideoUrl,
        },
      }
    );
    if (res.status === 200 && res.data.success) {
      pass('POST /api/nodes/:id/cache - cached video URL');
      log(`  Already cached: ${res.data.data?.data?.alreadyCached || false}`);
    } else {
      fail('POST /api/nodes/:id/cache (URL)', res.error);
    }
  }
}

async function testNodePlayback() {
  section('Node Playback');

  if (!CONFIG.nodeId) {
    skip('Playback tests', 'No node ID resolved');
    return;
  }

  // Check node status first
  {
    const res = await request<{ success: boolean }>(`/api/nodes/${CONFIG.nodeId}`);
    if (res.status !== 200 || !res.data.success) {
      skip('Playback tests', `Node "${CONFIG.nodeName}" not available`);
      return;
    }
  }

  // Play test video URL
  {
    log('Starting playback of test video...');
    const res = await request<{ success: boolean; data: { data?: { state?: { mode: string } } } }>(
      `/api/nodes/${CONFIG.nodeId}/play`,
      {
        method: 'POST',
        body: {
          url: CONFIG.testVideoUrl,
          loop: true,
        },
      }
    );
    if (res.status === 200 && res.data.success) {
      pass('POST /api/nodes/:id/play - started playback');
      log(`  Mode: ${res.data.data?.data?.state?.mode || 'video'}`);
    } else {
      fail('POST /api/nodes/:id/play', res.error);
    }
  }

  await sleep(2000); // Let it play for 2 seconds

  // Pause
  {
    const res = await request<{ success: boolean }>(
      `/api/nodes/${CONFIG.nodeId}/pause`,
      { method: 'POST' }
    );
    if (res.status === 200 && res.data.success) {
      pass('POST /api/nodes/:id/pause - paused playback');
    } else {
      fail('POST /api/nodes/:id/pause', res.error);
    }
  }

  await sleep(1000);

  // Resume
  {
    const res = await request<{ success: boolean }>(
      `/api/nodes/${CONFIG.nodeId}/resume`,
      { method: 'POST' }
    );
    if (res.status === 200 && res.data.success) {
      pass('POST /api/nodes/:id/resume - resumed playback');
    } else {
      fail('POST /api/nodes/:id/resume', res.error);
    }
  }

  await sleep(500);

  // Volume 50%
  {
    const res = await request<{ success: boolean }>(
      `/api/nodes/${CONFIG.nodeId}/volume`,
      {
        method: 'POST',
        body: { level: 50 },
      }
    );
    if (res.status === 200 && res.data.success) {
      pass('POST /api/nodes/:id/volume - set volume to 50%');
    } else {
      fail('POST /api/nodes/:id/volume', res.error);
    }
  }

  // Volume back to 100%
  {
    await request(`/api/nodes/${CONFIG.nodeId}/volume`, {
      method: 'POST',
      body: { level: 100 },
    });
  }

  // Loop toggle
  {
    const res = await request<{ success: boolean }>(
      `/api/nodes/${CONFIG.nodeId}/loop`,
      {
        method: 'POST',
        body: { enabled: false },
      }
    );
    if (res.status === 200 && res.data.success) {
      pass('POST /api/nodes/:id/loop - toggled loop off');
    } else {
      fail('POST /api/nodes/:id/loop', res.error);
    }
  }

  // Stop
  {
    const res = await request<{ success: boolean }>(
      `/api/nodes/${CONFIG.nodeId}/stop`,
      { method: 'POST' }
    );
    if (res.status === 200 && res.data.success) {
      pass('POST /api/nodes/:id/stop - stopped playback');
    } else {
      fail('POST /api/nodes/:id/stop', res.error);
    }
  }
}

async function testPlaylistPlayback() {
  section('Playlist Playback & Navigation');

  if (!CONFIG.nodeId) {
    skip('Playlist playback tests', 'No node ID resolved');
    return;
  }

  if (!testPlaylistId) {
    skip('Playlist playback tests', 'No test playlist created');
    return;
  }

  // Play playlist on node
  {
    log('Starting playlist playback...');
    const res = await request<{ success: boolean }>(
      `/api/playlists/${testPlaylistId}/play`,
      {
        method: 'POST',
        body: {
          nodeId: CONFIG.nodeId,
          startIndex: 0,
        },
      }
    );
    if (res.status === 200 && res.data.success) {
      pass('POST /api/playlists/:id/play - started playlist');
    } else {
      fail('POST /api/playlists/:id/play', res.error);
    }
  }

  await sleep(2000);

  // Next (even if single item, should work)
  {
    const res = await request<{ success: boolean }>(
      `/api/nodes/${CONFIG.nodeId}/next`,
      { method: 'POST' }
    );
    if (res.status === 200 && res.data.success) {
      pass('POST /api/nodes/:id/next - next item');
    } else {
      fail('POST /api/nodes/:id/next', res.error);
    }
  }

  await sleep(500);

  // Previous
  {
    const res = await request<{ success: boolean }>(
      `/api/nodes/${CONFIG.nodeId}/previous`,
      { method: 'POST' }
    );
    if (res.status === 200 && res.data.success) {
      pass('POST /api/nodes/:id/previous - previous item');
    } else {
      fail('POST /api/nodes/:id/previous', res.error);
    }
  }

  // Stop
  {
    const res = await request<{ success: boolean }>(
      `/api/nodes/${CONFIG.nodeId}/stop`,
      { method: 'POST' }
    );
    if (res.status === 200 && res.data.success) {
      pass('Stopped playlist playback');
    } else {
      fail('Stop playlist', res.error);
    }
  }
}

async function testPlaylistCaching() {
  section('Playlist Cache to Node');

  if (!CONFIG.nodeId) {
    skip('Playlist cache test', 'No node ID resolved');
    return;
  }

  if (!testPlaylistId) {
    skip('Playlist cache test', 'No test playlist');
    return;
  }

  // Cache playlist to node
  {
    log('Caching playlist content to node...');
    const res = await request<{ success: boolean; data: { results: Record<string, { status: string }> } }>(
      `/api/playlists/${testPlaylistId}/cache`,
      {
        method: 'POST',
        body: {
          nodeIds: [CONFIG.nodeId],
        },
      }
    );
    if (res.status === 200 && res.data.success) {
      const status = res.data.data?.results?.[CONFIG.nodeId]?.status;
      pass(`POST /api/playlists/:id/cache - status: ${status}`);
    } else {
      fail('POST /api/playlists/:id/cache', res.error);
    }
  }
}

async function cleanup() {
  section('Cleanup');

  // Delete test playlist if exists
  if (testPlaylistId) {
    const res = await request(`/api/playlists/${testPlaylistId}`, { method: 'DELETE' });
    if (res.status === 200) {
      pass('Deleted test playlist');
    } else {
      log('Could not delete test playlist (may already be deleted)');
    }
  }

  // Stop playback on node
  if (CONFIG.nodeId) {
    await request(`/api/nodes/${CONFIG.nodeId}/stop`, { method: 'POST' });

    // Reset volume
    await request(`/api/nodes/${CONFIG.nodeId}/volume`, {
      method: 'POST',
      body: { level: 100 },
    });
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           Chiba API Integration Tests                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\nController: ${CONFIG.controllerUrl}`);
  console.log(`Target Node: ${CONFIG.nodeName}`);
  console.log(`Test Video: ${CONFIG.testVideoUrl.substring(0, 50)}...`);
  console.log(`Eden Creation: ${CONFIG.eden.creationId}`);
  console.log(`Eden Collection (PROD): ${CONFIG.eden.collectionIdProd}`);
  console.log(`Eden Collection (STAGE): ${CONFIG.eden.collectionIdStage}`);

  try {
    await testDiscovery();
    await testEdenEndpoints();
    await testPlaylistCrud();
    await testPlaylistWithContent();
    await testNodeCaching();
    await testNodePlayback();
    await testPlaylistPlayback();
    await testPlaylistCaching();
    await cleanup();
  } catch (err) {
    console.error('\n\n❌ Test runner error:', err);
    process.exit(1);
  }

  // Summary
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  Results: ${passCount} passed, ${failCount} failed, ${skipCount} skipped`);
  console.log('════════════════════════════════════════════════════════════\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

main();
