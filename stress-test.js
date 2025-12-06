#!/usr/bin/env node
/**
 * MCP Server Stress Test
 *
 * Tests concurrent tool execution to identify bottlenecks.
 *
 * Usage:
 *   node stress-test.js
 *   node stress-test.js --parallel 50
 *   node stress-test.js --sequential
 */

import axios from 'axios';

// Configuration
const MCP_URL = process.env.MCP_URL || 'http://127.0.0.1:4000/mcp';
const SITE_NAME = process.env.SITE_NAME || 'sentrav0.1.localhost';
const PARALLEL_COUNT = parseInt(process.env.PARALLEL_COUNT || '10', 10);

// Track results
const results = {
  total: 0,
  success: 0,
  failed: 0,
  times: [],
  errors: []
};

/**
 * Initialize MCP session
 */
async function initializeSession() {
  console.log('\n📡 Initializing MCP session...');

  const response = await axios.post(MCP_URL, {
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'stress-test', version: '1.0.0' }
    },
    id: 1
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'X-Frappe-Site-Name': SITE_NAME
    }
  });

  const sessionId = response.headers['mcp-session-id'];
  console.log(`✅ Session initialized: ${sessionId}`);
  return sessionId;
}

/**
 * Call a tool via MCP
 */
async function callTool(sessionId, toolName, args, requestId) {
  const startTime = Date.now();

  try {
    const response = await axios.post(MCP_URL, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      },
      id: requestId
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'X-Frappe-Site-Name': SITE_NAME,
        'mcp-session-id': sessionId
      },
      timeout: 30000 // 30 second timeout
    });

    const duration = Date.now() - startTime;

    return {
      success: true,
      duration,
      requestId,
      toolName,
      result: response.data
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    return {
      success: false,
      duration,
      requestId,
      toolName,
      error: error.message,
      code: error.response?.status,
      data: error.response?.data
    };
  }
}

/**
 * Test sequential tool calls (baseline)
 */
async function testSequential(sessionId, count) {
  console.log(`\n🔄 Testing ${count} SEQUENTIAL tool calls...`);

  const startTime = Date.now();
  const results = [];

  for (let i = 0; i < count; i++) {
    const result = await callTool(sessionId, 'ping', {}, `seq-${i}`);
    results.push(result);
    process.stdout.write(result.success ? '.' : 'X');
  }

  const totalTime = Date.now() - startTime;
  console.log(`\n⏱️  Total: ${totalTime}ms, Avg: ${Math.round(totalTime / count)}ms per call`);

  return { results, totalTime, avgTime: totalTime / count };
}

/**
 * Test parallel tool calls
 */
async function testParallel(sessionId, count) {
  console.log(`\n⚡ Testing ${count} PARALLEL tool calls...`);

  const startTime = Date.now();

  // Fire all requests at once
  const promises = Array.from({ length: count }, (_, i) =>
    callTool(sessionId, 'ping', {}, `par-${i}`)
  );

  const results = await Promise.all(promises);
  const totalTime = Date.now() - startTime;

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const durations = results.map(r => r.duration);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const maxDuration = Math.max(...durations);
  const minDuration = Math.min(...durations);

  console.log(`✅ Success: ${successful}, ❌ Failed: ${failed}`);
  console.log(`⏱️  Total wall time: ${totalTime}ms`);
  console.log(`⏱️  Per-request: min=${minDuration}ms, avg=${Math.round(avgDuration)}ms, max=${maxDuration}ms`);

  if (failed > 0) {
    console.log('\n❌ Errors:');
    results.filter(r => !r.success).slice(0, 5).forEach(r => {
      console.log(`  - Request ${r.requestId}: ${r.error} (code: ${r.code})`);
    });
  }

  return { results, totalTime, avgDuration, successful, failed };
}

/**
 * Test parallel with different tool types
 */
async function testMixedParallel(sessionId, count) {
  console.log(`\n🎲 Testing ${count} PARALLEL MIXED tool calls (real DB operations)...`);

  const startTime = Date.now();

  // Mix of different tool types
  const tools = [
    { name: 'ping', args: {} },
    { name: 'find_doctypes', args: { search_term: 'Lead', limit: 5 } },
    { name: 'get_module_list', args: {} },
    { name: 'list_documents', args: { doctype: 'DocType', limit: 3 } },
  ];

  const promises = Array.from({ length: count }, (_, i) => {
    const tool = tools[i % tools.length];
    return callTool(sessionId, tool.name, tool.args, `mix-${i}`);
  });

  const results = await Promise.all(promises);
  const totalTime = Date.now() - startTime;

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  // Group by tool type
  const byTool = {};
  results.forEach(r => {
    if (!byTool[r.toolName]) byTool[r.toolName] = { success: 0, failed: 0, times: [] };
    if (r.success) byTool[r.toolName].success++;
    else byTool[r.toolName].failed++;
    byTool[r.toolName].times.push(r.duration);
  });

  console.log(`✅ Success: ${successful}, ❌ Failed: ${failed}`);
  console.log(`⏱️  Total wall time: ${totalTime}ms`);
  console.log('\n📊 By tool type:');
  Object.entries(byTool).forEach(([tool, stats]) => {
    const avg = Math.round(stats.times.reduce((a, b) => a + b, 0) / stats.times.length);
    console.log(`  ${tool}: ✅${stats.success} ❌${stats.failed} (avg: ${avg}ms)`);
  });

  if (failed > 0) {
    console.log('\n❌ Errors:');
    results.filter(r => !r.success).slice(0, 5).forEach(r => {
      console.log(`  - ${r.toolName} (${r.requestId}): ${r.error}`);
    });
  }

  return { results, totalTime, successful, failed, byTool };
}

/**
 * Test with increasing parallelism to find breaking point
 */
async function testScaling(sessionId) {
  console.log('\n📈 Testing scaling with increasing parallelism...\n');

  const levels = [1, 5, 10, 20, 30, 50];
  const scalingResults = [];

  for (const count of levels) {
    const result = await testParallel(sessionId, count);
    scalingResults.push({
      count,
      ...result
    });

    // Small delay between tests
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n📊 SCALING SUMMARY:');
  console.log('─'.repeat(60));
  console.log('Parallel │ Success │ Failed │ Wall Time │ Avg/Req │ Throughput');
  console.log('─'.repeat(60));

  scalingResults.forEach(r => {
    const throughput = Math.round(r.count / (r.totalTime / 1000) * 10) / 10;
    console.log(
      `${String(r.count).padStart(8)} │ ${String(r.successful).padStart(7)} │ ${String(r.failed).padStart(6)} │ ${String(r.totalTime + 'ms').padStart(9)} │ ${String(Math.round(r.avgDuration) + 'ms').padStart(7)} │ ${throughput} req/s`
    );
  });

  return scalingResults;
}

/**
 * Test multiple sessions in parallel (simulates multiple users)
 */
async function testMultipleSessions(sessionCount, callsPerSession) {
  console.log(`\n👥 Testing ${sessionCount} parallel sessions with ${callsPerSession} calls each...`);

  const startTime = Date.now();

  // Create sessions in parallel
  const sessions = await Promise.all(
    Array.from({ length: sessionCount }, () => initializeSession().catch(e => null))
  );

  const validSessions = sessions.filter(s => s !== null);
  console.log(`✅ Created ${validSessions.length}/${sessionCount} sessions`);

  // Make calls from all sessions in parallel
  const allPromises = validSessions.flatMap((sessionId, sessionIdx) =>
    Array.from({ length: callsPerSession }, (_, callIdx) =>
      callTool(sessionId, 'ping', {}, `s${sessionIdx}-c${callIdx}`)
    )
  );

  const results = await Promise.all(allPromises);
  const totalTime = Date.now() - startTime;

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`\n✅ Success: ${successful}, ❌ Failed: ${failed}`);
  console.log(`⏱️  Total wall time: ${totalTime}ms`);
  console.log(`📊 Throughput: ${Math.round(results.length / (totalTime / 1000))} req/s`);

  if (failed > 0) {
    console.log('\n❌ Errors:');
    const errorGroups = {};
    results.filter(r => !r.success).forEach(r => {
      const key = r.error || 'unknown';
      errorGroups[key] = (errorGroups[key] || 0) + 1;
    });
    Object.entries(errorGroups).forEach(([err, count]) => {
      console.log(`  - ${err}: ${count} occurrences`);
    });
  }

  return { results, totalTime, successful, failed };
}

/**
 * Main test runner
 */
async function main() {
  console.log('═'.repeat(60));
  console.log('  FRAPPE MCP SERVER STRESS TEST');
  console.log('═'.repeat(60));
  console.log(`MCP URL: ${MCP_URL}`);
  console.log(`Site: ${SITE_NAME}`);

  try {
    // Test 1: Basic connectivity
    console.log('\n' + '─'.repeat(60));
    console.log('TEST 1: Basic Connectivity');
    console.log('─'.repeat(60));

    const sessionId = await initializeSession();

    // Single ping test
    const pingResult = await callTool(sessionId, 'ping', {}, 'test-ping');
    if (pingResult.success) {
      console.log(`✅ Ping successful (${pingResult.duration}ms)`);
    } else {
      console.log(`❌ Ping failed: ${pingResult.error}`);
      return;
    }

    // Test 2: Sequential baseline
    console.log('\n' + '─'.repeat(60));
    console.log('TEST 2: Sequential Baseline (10 calls)');
    console.log('─'.repeat(60));
    await testSequential(sessionId, 10);

    // Test 3: Parallel ping
    console.log('\n' + '─'.repeat(60));
    console.log('TEST 3: Parallel Ping Calls');
    console.log('─'.repeat(60));
    await testParallel(sessionId, 10);

    // Test 4: Mixed parallel
    console.log('\n' + '─'.repeat(60));
    console.log('TEST 4: Mixed Parallel Calls (Real DB Operations)');
    console.log('─'.repeat(60));
    await testMixedParallel(sessionId, 20);

    // Test 5: Scaling test
    console.log('\n' + '─'.repeat(60));
    console.log('TEST 5: Scaling Test (Finding Breaking Point)');
    console.log('─'.repeat(60));
    await testScaling(sessionId);

    // Test 6: Multiple sessions
    console.log('\n' + '─'.repeat(60));
    console.log('TEST 6: Multiple Sessions (3 sessions x 10 calls)');
    console.log('─'.repeat(60));
    await testMultipleSessions(3, 10);

    console.log('\n' + '═'.repeat(60));
    console.log('  STRESS TEST COMPLETE');
    console.log('═'.repeat(60));

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

// Run
main();
