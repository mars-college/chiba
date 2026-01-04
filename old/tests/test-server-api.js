/**
 * Test: Server API Endpoints
 * Tests all HTTP endpoints of the kiosk server
 *
 * Usage:
 *   1. Start the server: node server.js
 *   2. Run tests: node tests/test-server-api.js [--api-key YOUR_KEY]
 */

const http = require('http');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

// Parse --api-key argument
const args = process.argv.slice(2);
let API_KEY = process.env.API_KEY || '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--api-key' && args[i + 1]) {
    API_KEY = args[i + 1];
  }
}

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (API_KEY) {
      options.headers['Authorization'] = `Bearer ${API_KEY}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== Server API Tests ===');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`API Key: ${API_KEY ? '***' + API_KEY.slice(-4) : '(none)'}\n`);

  let passed = 0;
  let failed = 0;

  // Test 1: GET /status (no auth required)
  console.log('Test 1: GET /status');
  try {
    const { status, data } = await request('GET', '/status');
    if (status === 200 && 'mode' in data) {
      console.log(`  ✓ Status returned mode: ${data.mode}`);
      passed++;
    } else {
      console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
      failed++;
    }
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message}`);
    failed++;
  }

  // Test 2: GET /files (no auth required)
  console.log('\nTest 2: GET /files');
  try {
    const { status, data } = await request('GET', '/files');
    if (status === 200 && Array.isArray(data.files)) {
      console.log(`  ✓ Files returned: ${data.files.length} files`);
      passed++;
    } else {
      console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
      failed++;
    }
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message}`);
    failed++;
  }

  // Test 3: GET / (endpoint list)
  console.log('\nTest 3: GET / (endpoint list)');
  try {
    const { status, data } = await request('GET', '/');
    if (status === 200 && data.service === 'kiosk-server') {
      const expectedEndpoints = ['/youtube', '/youtube_and_play', '/cache_and_play', '/sync', '/sync_and_play', '/playlist', '/next', '/previous', '/pause', '/resume', '/restart', '/volume'];
      const hasAll = expectedEndpoints.every(ep => data.endpoints.includes(ep));
      if (hasAll) {
        console.log(`  ✓ All expected endpoints listed`);
        passed++;
      } else {
        console.log(`  ✗ Missing endpoints. Got: ${data.endpoints.join(', ')}`);
        failed++;
      }
    } else {
      console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
      failed++;
    }
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message}`);
    failed++;
  }

  // Test 4: POST /off (requires auth)
  console.log('\nTest 4: POST /off');
  if (!API_KEY) {
    console.log('  ⊘ Skipped (no API key)');
  } else {
    try {
      const { status, data } = await request('POST', '/off');
      if (status === 200 && data.mode === 'off') {
        console.log(`  ✓ Display turned off`);
        passed++;
      } else {
        console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  // Test 5: POST /file with existing file
  console.log('\nTest 5: POST /file');
  if (!API_KEY) {
    console.log('  ⊘ Skipped (no API key)');
  } else {
    try {
      // First get list of files
      const { data: filesData } = await request('GET', '/files');
      if (filesData.files && filesData.files.length > 0) {
        const testFile = filesData.files[0];
        const { status, data } = await request('POST', '/file', { file: testFile });
        if (status === 200 && data.mode === 'video') {
          console.log(`  ✓ Playing file: ${testFile}`);
          passed++;
        } else {
          console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
          failed++;
        }
      } else {
        console.log('  ⊘ Skipped (no files available)');
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  // Test 6: POST /file with non-existent file (should fail)
  console.log('\nTest 6: POST /file (non-existent file)');
  if (!API_KEY) {
    console.log('  ⊘ Skipped (no API key)');
  } else {
    try {
      const { status, data } = await request('POST', '/file', { file: 'nonexistent-file-12345.mp4' });
      if (status === 400 && data.error) {
        console.log(`  ✓ Correctly rejected: ${data.error}`);
        passed++;
      } else {
        console.log(`  ✗ Should have failed but got: ${JSON.stringify(data)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  // Test 7: POST without auth (should fail with 401)
  console.log('\nTest 7: POST without auth');
  try {
    const url = new URL('/off', BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };

    const result = await new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.end();
    });

    if (result.status === 401) {
      console.log(`  ✓ Correctly rejected with 401`);
      passed++;
    } else if (result.status === 200) {
      console.log(`  ⊘ No auth configured on server (API_KEY not set)`);
    } else {
      console.log(`  ✗ Unexpected status: ${result.status}`);
      failed++;
    }
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message}`);
    failed++;
  }

  // Test 8: POST /sync validation (missing collectionId)
  console.log('\nTest 8: POST /sync validation');
  if (!API_KEY) {
    console.log('  ⊘ Skipped (no API key)');
  } else {
    try {
      const { status, data } = await request('POST', '/sync', {});
      if (status === 400 && data.error && data.error.includes('collectionId')) {
        console.log(`  ✓ Correctly rejected missing collectionId`);
        passed++;
      } else {
        console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  // Test 9: POST /sync with invalid db parameter
  console.log('\nTest 9: POST /sync with invalid db');
  if (!API_KEY) {
    console.log('  ⊘ Skipped (no API key)');
  } else {
    try {
      const { status, data } = await request('POST', '/sync', { collectionId: 'test', db: 'INVALID' });
      if (status === 400 && data.error && data.error.includes('db')) {
        console.log(`  ✓ Correctly rejected invalid db parameter`);
        passed++;
      } else {
        console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  // Test 10: POST /youtube validation (missing url)
  console.log('\nTest 10: POST /youtube validation');
  if (!API_KEY) {
    console.log('  ⊘ Skipped (no API key)');
  } else {
    try {
      const { status, data } = await request('POST', '/youtube', {});
      if (status === 400 && data.error && data.error.includes('url')) {
        console.log(`  ✓ Correctly rejected missing url`);
        passed++;
      } else {
        console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  // Test 11: POST /playlist validation (missing items)
  console.log('\nTest 11: POST /playlist validation');
  if (!API_KEY) {
    console.log('  ⊘ Skipped (no API key)');
  } else {
    try {
      const { status, data } = await request('POST', '/playlist', {});
      if (status === 400 && data.error && data.error.includes('items')) {
        console.log(`  ✓ Correctly rejected missing items`);
        passed++;
      } else {
        console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  // Test 12: POST /playlist with empty items array
  console.log('\nTest 12: POST /playlist with empty items');
  if (!API_KEY) {
    console.log('  ⊘ Skipped (no API key)');
  } else {
    try {
      const { status, data } = await request('POST', '/playlist', { items: [] });
      if (status === 400 && data.error) {
        console.log(`  ✓ Correctly rejected empty items: ${data.error}`);
        passed++;
      } else {
        console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  // Test 13: GET /volume (no auth required)
  console.log('\nTest 13: GET /volume');
  try {
    const { status, data } = await request('GET', '/volume');
    if (status === 200 && typeof data.level === 'number') {
      console.log(`  ✓ Volume returned: ${data.level}`);
      passed++;
    } else {
      console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
      failed++;
    }
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message}`);
    failed++;
  }

  // Test 14: POST /volume validation (missing level)
  console.log('\nTest 14: POST /volume validation');
  if (!API_KEY) {
    console.log('  ⊘ Skipped (no API key)');
  } else {
    try {
      const { status, data } = await request('POST', '/volume', {});
      if (status === 400 && data.error && data.error.includes('level')) {
        console.log(`  ✓ Correctly rejected missing level`);
        passed++;
      } else {
        console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  // Test 15: POST /volume validation (out of range)
  console.log('\nTest 15: POST /volume out of range');
  if (!API_KEY) {
    console.log('  ⊘ Skipped (no API key)');
  } else {
    try {
      const { status, data } = await request('POST', '/volume', { level: 15 });
      if (status === 400 && data.error) {
        console.log(`  ✓ Correctly rejected out of range: ${data.error}`);
        passed++;
      } else {
        console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  // Test 16: POST /pause
  console.log('\nTest 16: POST /pause');
  if (!API_KEY) {
    console.log('  ⊘ Skipped (no API key)');
  } else {
    try {
      const { status, data } = await request('POST', '/pause');
      if (status === 200 && data.paused === true) {
        console.log(`  ✓ Paused successfully`);
        passed++;
      } else {
        console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  // Test 17: POST /resume
  console.log('\nTest 17: POST /resume');
  if (!API_KEY) {
    console.log('  ⊘ Skipped (no API key)');
  } else {
    try {
      const { status, data } = await request('POST', '/resume');
      if (status === 200 && data.paused === false) {
        console.log(`  ✓ Resumed successfully`);
        passed++;
      } else {
        console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  // Test 18: POST /restart (should fail if not in playlist mode)
  console.log('\nTest 18: POST /restart (not in playlist mode)');
  if (!API_KEY) {
    console.log('  ⊘ Skipped (no API key)');
  } else {
    try {
      // First make sure we're in off mode
      await request('POST', '/off');
      const { status, data } = await request('POST', '/restart');
      if (status === 400 && data.error) {
        console.log(`  ✓ Correctly rejected: ${data.error}`);
        passed++;
      } else {
        console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  // Test 19: POST /next (works in any mode)
  console.log('\nTest 19: POST /next');
  if (!API_KEY) {
    console.log('  ⊘ Skipped (no API key)');
  } else {
    try {
      const { status, data } = await request('POST', '/next');
      if (status === 200) {
        console.log(`  ✓ Next command accepted`);
        passed++;
      } else {
        console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  // Test 20: POST /previous (works in any mode)
  console.log('\nTest 20: POST /previous');
  if (!API_KEY) {
    console.log('  ⊘ Skipped (no API key)');
  } else {
    try {
      const { status, data } = await request('POST', '/previous');
      if (status === 200) {
        console.log(`  ✓ Previous command accepted`);
        passed++;
      } else {
        console.log(`  ✗ Unexpected response: ${JSON.stringify(data)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  // Summary
  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`\nNote: Some tests require API_KEY and running server`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner failed:', err);
  console.error('Make sure the server is running: node server.js');
  process.exit(1);
});
