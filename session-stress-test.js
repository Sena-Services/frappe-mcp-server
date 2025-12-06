#!/usr/bin/env node
/**
 * Session-focused stress test for MCP Server
 *
 * This tests the specific failure mode: multiple sessions with parallel calls
 */

import axios from 'axios';

const MCP_URL = process.env.MCP_URL || 'http://127.0.0.1:4000/mcp';
const SITE_NAME = process.env.SITE_NAME || 'sentrav0.1.localhost';

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
  'X-Frappe-Site-Name': SITE_NAME
};

/**
 * Initialize a session - track timing
 */
async function initializeSession(label) {
  const start = Date.now();

  try {
    const response = await axios.post(MCP_URL, {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: `stress-${label}`, version: '1.0.0' }
      },
      id: 1
    }, {
      headers: DEFAULT_HEADERS,
      timeout: 10000
    });

    const sessionId = response.headers['mcp-session-id'];
    console.log(`  [${label}] Session created: ${sessionId?.slice(0, 8)}... (${Date.now() - start}ms)`);
    return { sessionId, success: true };
  } catch (error) {
    console.log(`  [${label}] FAILED: ${error.message} (${Date.now() - start}ms)`);
    return { sessionId: null, success: false, error: error.message };
  }
}

/**
 * Call a tool
 */
async function callTool(sessionId, toolName, args, label) {
  const start = Date.now();

  try {
    const response = await axios.post(MCP_URL, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: args },
      id: Math.random().toString(36).slice(2)
    }, {
      headers: {
        ...DEFAULT_HEADERS,
        'mcp-session-id': sessionId
      },
      timeout: 10000
    });

    return { success: true, duration: Date.now() - start };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - start,
      error: error.message,
      code: error.response?.status
    };
  }
}

/**
 * Test: Sequential session creation, then parallel calls
 */
async function testSequentialThenParallel() {
  console.log('\n📋 TEST: Create sessions SEQUENTIALLY, then calls in PARALLEL\n');

  const sessionCount = 3;
  const callsPerSession = 10;

  // Step 1: Create sessions one at a time
  console.log('Step 1: Creating sessions sequentially...');
  const sessions = [];
  for (let i = 0; i < sessionCount; i++) {
    const result = await initializeSession(`S${i}`);
    if (result.success) {
      sessions.push(result.sessionId);
    }
  }
  console.log(`  Created ${sessions.length}/${sessionCount} sessions\n`);

  // Step 2: Make all calls in parallel
  console.log(`Step 2: Making ${sessions.length * callsPerSession} calls in parallel...`);
  const start = Date.now();

  const promises = sessions.flatMap((sessionId, sIdx) =>
    Array.from({ length: callsPerSession }, (_, cIdx) =>
      callTool(sessionId, 'ping', {}, `s${sIdx}c${cIdx}`)
    )
  );

  const results = await Promise.all(promises);
  const elapsed = Date.now() - start;

  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`  ✅ ${success} succeeded, ❌ ${failed} failed (${elapsed}ms total)`);

  if (failed > 0) {
    const errors = {};
    results.filter(r => !r.success).forEach(r => {
      errors[r.error] = (errors[r.error] || 0) + 1;
    });
    console.log('  Errors:', errors);
  }

  return { success, failed, elapsed };
}

/**
 * Test: Parallel session creation, then parallel calls
 */
async function testAllParallel() {
  console.log('\n📋 TEST: Create sessions AND calls ALL in PARALLEL\n');

  const sessionCount = 3;
  const callsPerSession = 10;

  // Create sessions in parallel
  console.log('Step 1: Creating sessions in parallel...');
  const sessionResults = await Promise.all(
    Array.from({ length: sessionCount }, (_, i) => initializeSession(`P${i}`))
  );

  const sessions = sessionResults.filter(r => r.success).map(r => r.sessionId);
  console.log(`  Created ${sessions.length}/${sessionCount} sessions\n`);

  if (sessions.length === 0) {
    console.log('  ❌ No sessions created, aborting');
    return { success: 0, failed: sessionCount * callsPerSession };
  }

  // Make calls in parallel
  console.log(`Step 2: Making ${sessions.length * callsPerSession} calls in parallel...`);
  const start = Date.now();

  const promises = sessions.flatMap((sessionId, sIdx) =>
    Array.from({ length: callsPerSession }, (_, cIdx) =>
      callTool(sessionId, 'ping', {}, `s${sIdx}c${cIdx}`)
    )
  );

  const results = await Promise.all(promises);
  const elapsed = Date.now() - start;

  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`  ✅ ${success} succeeded, ❌ ${failed} failed (${elapsed}ms total)`);

  if (failed > 0) {
    const errors = {};
    results.filter(r => !r.success).forEach(r => {
      errors[r.error] = (errors[r.error] || 0) + 1;
    });
    console.log('  Errors:', errors);
  }

  return { success, failed, elapsed };
}

/**
 * Test: Interleaved session creation and calls
 */
async function testInterleaved() {
  console.log('\n📋 TEST: INTERLEAVED - create session then immediately call\n');

  const sessionCount = 3;
  const callsPerSession = 10;

  async function sessionWithCalls(idx) {
    const result = await initializeSession(`I${idx}`);
    if (!result.success) {
      return { success: 0, failed: callsPerSession };
    }

    // Immediately make calls on this session
    const callResults = await Promise.all(
      Array.from({ length: callsPerSession }, (_, cIdx) =>
        callTool(result.sessionId, 'ping', {}, `s${idx}c${cIdx}`)
      )
    );

    return {
      success: callResults.filter(r => r.success).length,
      failed: callResults.filter(r => !r.success).length
    };
  }

  const start = Date.now();

  // All sessions+calls in parallel
  const results = await Promise.all(
    Array.from({ length: sessionCount }, (_, i) => sessionWithCalls(i))
  );

  const elapsed = Date.now() - start;
  const totalSuccess = results.reduce((sum, r) => sum + r.success, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

  console.log(`  ✅ ${totalSuccess} succeeded, ❌ ${totalFailed} failed (${elapsed}ms total)`);

  return { success: totalSuccess, failed: totalFailed, elapsed };
}

/**
 * Test: Single session high concurrency
 */
async function testSingleSessionHighLoad() {
  console.log('\n📋 TEST: SINGLE session with HIGH concurrency (100 parallel calls)\n');

  const result = await initializeSession('HI');
  if (!result.success) {
    console.log('  ❌ Failed to create session');
    return { success: 0, failed: 100 };
  }

  console.log('Making 100 parallel calls...');
  const start = Date.now();

  const results = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      callTool(result.sessionId, 'ping', {}, `c${i}`)
    )
  );

  const elapsed = Date.now() - start;
  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`  ✅ ${success} succeeded, ❌ ${failed} failed (${elapsed}ms total)`);
  console.log(`  Throughput: ${Math.round(100 / (elapsed / 1000))} req/s`);

  if (failed > 0) {
    const errors = {};
    results.filter(r => !r.success).forEach(r => {
      errors[r.error] = (errors[r.error] || 0) + 1;
    });
    console.log('  Errors:', errors);
  }

  return { success, failed, elapsed };
}

/**
 * Test: Observe server logs during multi-session
 */
async function testWithDelay() {
  console.log('\n📋 TEST: Sessions with DELAYS (observe server logs)\n');

  // Create sessions with small delays
  console.log('Creating 3 sessions with 500ms delays...');
  const sessions = [];

  for (let i = 0; i < 3; i++) {
    const result = await initializeSession(`D${i}`);
    if (result.success) sessions.push(result.sessionId);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`Created ${sessions.length} sessions\n`);

  // Now make parallel calls with session ID logging
  console.log('Making 5 parallel calls per session...');
  const start = Date.now();

  const promises = sessions.flatMap((sessionId, sIdx) =>
    Array.from({ length: 5 }, async (_, cIdx) => {
      const result = await callTool(sessionId, 'ping', {}, `s${sIdx}c${cIdx}`);
      if (!result.success) {
        console.log(`    ❌ Session ${sIdx}, Call ${cIdx}: ${result.error}`);
      }
      return result;
    })
  );

  const results = await Promise.all(promises);
  const elapsed = Date.now() - start;

  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`\n  ✅ ${success} succeeded, ❌ ${failed} failed (${elapsed}ms total)`);

  return { success, failed, elapsed };
}

/**
 * Main
 */
async function main() {
  console.log('═'.repeat(60));
  console.log('  MCP SERVER - SESSION STRESS TEST');
  console.log('═'.repeat(60));
  console.log(`URL: ${MCP_URL}`);
  console.log(`Site: ${SITE_NAME}`);

  const results = {};

  // Run tests
  results.sequentialThenParallel = await testSequentialThenParallel();
  await new Promise(r => setTimeout(r, 1000));

  results.allParallel = await testAllParallel();
  await new Promise(r => setTimeout(r, 1000));

  results.interleaved = await testInterleaved();
  await new Promise(r => setTimeout(r, 1000));

  results.singleSessionHighLoad = await testSingleSessionHighLoad();
  await new Promise(r => setTimeout(r, 1000));

  results.withDelay = await testWithDelay();

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  SUMMARY');
  console.log('═'.repeat(60));

  Object.entries(results).forEach(([test, r]) => {
    const status = r.failed === 0 ? '✅' : '❌';
    console.log(`${status} ${test}: ${r.success}/${r.success + r.failed} passed (${r.elapsed}ms)`);
  });
}

main().catch(console.error);
