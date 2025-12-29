/**
 * Eden API integration for syncing collections
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load API key from environment
require('dotenv').config({ quiet: true });
const EDEN_API_KEY = process.env.EDEN_API_KEY;

// API base URLs for different environments
const EDEN_API_BASES = {
  PROD: 'https://api.eden.art',
  STAGE: 'https://staging.api.eden.art'
};

function getApiBase(db) {
  const env = (db || 'PROD').toUpperCase();
  return EDEN_API_BASES[env] || EDEN_API_BASES.PROD;
}

/**
 * Fetch all creations from an Eden collection (handles pagination)
 * @param {string} collectionId - The collection ID
 * @param {string} db - Database environment: 'PROD' or 'STAGE' (default: 'PROD')
 * @returns {Promise<Array>} - Array of creation objects
 */
async function getCollectionCreations(collectionId, db = 'PROD') {
  const apiBase = getApiBase(db);
  const creations = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const url = `${apiBase}/v2/collections/${collectionId}/creations?page=${page}&limit=100`;

    const data = await new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'X-Api-Key': EDEN_API_KEY }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${body}`));
          }
        });
      });
      req.on('error', reject);
    });

    if (data.docs) {
      creations.push(...data.docs);
    }

    hasNextPage = data.hasNextPage;
    page++;
  }

  return creations;
}

/**
 * Download a file from URL to local path
 * @param {string} url - URL to download
 * @param {string} destPath - Local destination path
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Kiosk/1.0)',
        'Accept': '*/*'
      }
    };

    https.get(url, options, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        file.close();
        fs.unlinkSync(destPath);
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * Sync all creations from a collection to a local directory
 * @param {string} collectionId - The collection ID
 * @param {string} destDir - Destination directory
 * @param {object} options - Options
 * @param {boolean} options.skipExisting - Skip files that already exist
 * @param {string} options.db - Database environment: 'PROD' or 'STAGE' (default: 'PROD')
 * @returns {Promise<object>} - Sync results
 */
async function syncCollection(collectionId, destDir, options = {}) {
  const { skipExisting = true, db = 'PROD' } = options;

  // Ensure destination directory exists
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const apiBase = getApiBase(db);
  console.log(`Fetching creations from collection ${collectionId} (${db} - ${apiBase})...`);
  const creations = await getCollectionCreations(collectionId, db);
  console.log(`Found ${creations.length} creations`);

  const results = {
    total: creations.length,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    files: []
  };

  for (const creation of creations) {
    const filename = creation.filename || `${creation._id}.mp4`;
    const destPath = path.join(destDir, filename);

    // Skip if file exists
    if (skipExisting && fs.existsSync(destPath)) {
      console.log(`  Skipping (exists): ${filename}`);
      results.skipped++;
      results.files.push({ filename, status: 'skipped' });
      continue;
    }

    try {
      console.log(`  Downloading: ${filename}`);
      await downloadFile(creation.url, destPath);
      results.downloaded++;
      results.files.push({ filename, status: 'downloaded', url: creation.url });
    } catch (err) {
      console.error(`  Failed: ${filename} - ${err.message}`);
      results.failed++;
      results.files.push({ filename, status: 'failed', error: err.message });
    }
  }

  return results;
}

module.exports = {
  getCollectionCreations,
  downloadFile,
  syncCollection
};

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  let collectionId = null;
  let destDir = './downloads';
  let db = 'PROD';

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
      db = args[i + 1].toUpperCase();
      i++;
    } else if (!collectionId) {
      collectionId = args[i];
    } else {
      destDir = args[i];
    }
  }

  if (!collectionId) {
    console.log('Usage: node eden.js <collectionId> [destDir] [--db PROD|STAGE]');
    console.log('Example: node eden.js 68538ccaf883914b6b8e09a1 ./downloads --db STAGE');
    process.exit(1);
  }

  if (!EDEN_API_KEY) {
    console.error('Error: EDEN_API_KEY not set in environment or .env file');
    process.exit(1);
  }

  syncCollection(collectionId, destDir, { db })
    .then(results => {
      console.log('\n--- Sync Complete ---');
      console.log(`Total: ${results.total}`);
      console.log(`Downloaded: ${results.downloaded}`);
      console.log(`Skipped: ${results.skipped}`);
      console.log(`Failed: ${results.failed}`);
    })
    .catch(err => {
      console.error('Sync failed:', err.message);
      process.exit(1);
    });
}
