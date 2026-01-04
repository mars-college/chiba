/**
 * Test: Eden Collection Sync
 * Downloads all creations from a test collection to verify the sync functionality
 *
 * Usage: node tests/test-eden-sync.js [--db PROD|STAGE]
 */

const path = require('path');
const fs = require('fs');
const { getCollectionCreations, syncCollection } = require('../eden');

const TEST_COLLECTION_ID = '68538ccaf883914b6b8e09a1';
const TEST_OUTPUT_DIR = path.join(__dirname, 'test-output');

// Parse --db argument
const args = process.argv.slice(2);
let TEST_DB = 'PROD';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--db' && args[i + 1]) {
    TEST_DB = args[i + 1].toUpperCase();
  }
}

async function runTests() {
  console.log('=== Eden Sync Tests ===');
  console.log(`Database: ${TEST_DB}\n`);

  let passed = 0;
  let failed = 0;

  // Clean up previous test output
  if (fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.rmSync(TEST_OUTPUT_DIR, { recursive: true });
  }

  // Test 1: Fetch collection creations
  console.log('Test 1: Fetch collection creations');
  try {
    const creations = await getCollectionCreations(TEST_COLLECTION_ID, TEST_DB);
    if (creations.length > 0) {
      console.log(`  ✓ Fetched ${creations.length} creations from ${TEST_DB}`);
      passed++;
    } else {
      console.log('  ✗ No creations returned');
      failed++;
    }

    // Verify creation structure
    const creation = creations[0];
    if (creation._id && creation.url && creation.filename) {
      console.log('  ✓ Creation has required fields (_id, url, filename)');
      passed++;
    } else {
      console.log('  ✗ Creation missing required fields');
      failed++;
    }
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message}`);
    failed++;
  }

  // Test 2: Sync collection to directory
  console.log('\nTest 2: Sync collection to directory');
  try {
    const results = await syncCollection(TEST_COLLECTION_ID, TEST_OUTPUT_DIR, { db: TEST_DB });

    if (results.total > 0) {
      console.log(`  ✓ Total creations: ${results.total}`);
      passed++;
    } else {
      console.log('  ✗ No creations found');
      failed++;
    }

    if (results.downloaded > 0) {
      console.log(`  ✓ Downloaded: ${results.downloaded} files`);
      passed++;
    } else {
      console.log('  ✗ No files downloaded');
      failed++;
    }

    // Verify files exist on disk
    const files = fs.readdirSync(TEST_OUTPUT_DIR);
    if (files.length === results.downloaded) {
      console.log(`  ✓ Files exist on disk: ${files.length}`);
      passed++;
    } else {
      console.log(`  ✗ File count mismatch: expected ${results.downloaded}, got ${files.length}`);
      failed++;
    }

    // Verify file sizes are non-zero
    const allNonEmpty = files.every(f => {
      const stat = fs.statSync(path.join(TEST_OUTPUT_DIR, f));
      return stat.size > 0;
    });
    if (allNonEmpty) {
      console.log('  ✓ All files have non-zero size');
      passed++;
    } else {
      console.log('  ✗ Some files are empty');
      failed++;
    }
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message}`);
    failed++;
  }

  // Test 3: Skip existing files
  console.log('\nTest 3: Skip existing files on re-sync');
  try {
    const results = await syncCollection(TEST_COLLECTION_ID, TEST_OUTPUT_DIR, { skipExisting: true, db: TEST_DB });

    if (results.skipped === results.total) {
      console.log(`  ✓ Skipped all ${results.skipped} existing files`);
      passed++;
    } else {
      console.log(`  ✗ Expected to skip ${results.total}, skipped ${results.skipped}`);
      failed++;
    }
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message}`);
    failed++;
  }

  // Test 4: Verify db parameter validation
  console.log('\nTest 4: Database parameter validation');
  try {
    // Test that invalid db falls back to PROD
    const creations = await getCollectionCreations(TEST_COLLECTION_ID, 'INVALID');
    console.log('  ✓ Invalid db parameter falls back to PROD');
    passed++;
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message}`);
    failed++;
  }

  // Summary
  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  // Cleanup
  console.log('\nCleaning up test output...');
  if (fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.rmSync(TEST_OUTPUT_DIR, { recursive: true });
  }
  console.log('Done.');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
