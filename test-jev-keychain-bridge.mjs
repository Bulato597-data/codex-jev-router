import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const bridgePath = fileURLToPath(new URL('./jev-keychain-bridge.mjs', import.meta.url));
const helperPath = fileURLToPath(new URL('./jev-route.mjs', import.meta.url));

async function startBridge(routerPath, additionalEnvironment = {}) {
  const server = spawn(process.execPath, [bridgePath], {
    env: {
      ...process.env,
      JEV_BRIDGE_PORT: '0',
      JEV_BRIDGE_SOCKET: path.join(path.dirname(routerPath), 'bridge.sock'),
      JEV_BRIDGE_ROUTER: routerPath,
      ...additionalEnvironment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let startup = '';
  server.stdout.setEncoding('utf8');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bridge did not start in time.')), 3_000);
    server.stdout.on('data', (chunk) => {
      startup += chunk;
      if (!startup.includes('Jev bridge local socket ready.')) return;
      clearTimeout(timer);
      resolve();
    });
    server.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return { server };
}

async function stopBridge(server) {
  if (server.exitCode !== null) return;
  const exited = once(server, 'exit').catch(() => {});
  server.kill('SIGTERM');
  await exited;
}

async function runHelper(socketPath, task, additionalEnvironment = {}) {
  const helper = spawn(process.execPath, [helperPath], {
    env: { ...process.env, JEV_BRIDGE_SOCKET: socketPath, ...additionalEnvironment },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let errorOutput = '';
  helper.stdout.setEncoding('utf8');
  helper.stderr.setEncoding('utf8');
  helper.stdout.on('data', (chunk) => { output += chunk; });
  helper.stderr.on('data', (chunk) => { errorOutput += chunk; });
  helper.stdin.end(task);
  const [code] = await once(helper, 'close');
  assert.equal(code, 0, errorOutput);
  return JSON.parse(output);
}

async function runHelperAgainstSocketResult(socketPath, task, result) {
  const server = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });

  const helper = spawn(process.execPath, [helperPath], {
    env: { ...process.env, JEV_BRIDGE_SOCKET: socketPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  helper.stdout.setEncoding('utf8');
  helper.stdout.on('data', (chunk) => { output += chunk; });
  helper.stdin.end(task);
  const [code] = await once(helper, 'close');
  await new Promise((resolve) => server.close(resolve));
  return { code, output };
}

test('bridge returns a typed Jev route over its owner-only Unix socket', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'jev-bridge-test-'));
  const routerPath = path.join(tempDirectory, 'mock-router');
  await writeFile(routerPath, `#!/bin/sh
cat >/dev/null
printf '%s\\n' 'lane=sol' 'model=gpt-6-sol' 'effort=high' 'reason=accepted Jev route' 'route_source=jev-noul-composed' 'jev_status=nouls_composed' 'hybrid=jev-noul-composition;composed_model=gpt-6-sol;composed_effort=high;model=jev-test' 'jev_diagnostics={\"basis\":\"independent_noul_questions_composed_locally\",\"threshold_policy\":{\"yes_at_or_above\":0.7,\"no_at_or_below\":0.3,\"uncertain\":\"select the configured uncertainty route; deterministic safety floors may raise it\"},\"nouls\":{\"frontier_architecture\":0,\"frontier_debugging\":0,\"deep_security_audit\":0,\"extensive_conflicting_data\":0,\"complex_agentic_coding\":0,\"computer_use_workflow\":0,\"complete_feature\":0,\"unknown_cause\":0,\"cross_system_verification\":0,\"data_integrity_verification\":0,\"integration_verification\":0,\"security_verification\":0}}'
`);
  await chmod(routerPath, 0o700);

  const { server } = await startBridge(routerPath);

  try {
    assert.deepEqual(await runHelper(path.join(tempDirectory, 'bridge.sock'), 'private task text that should not be echoed'), {
      status: 'routed',
      jev: { verified: true, status: 'nouls_composed', model: 'jev-test', nouls: { frontier_architecture: 0, frontier_debugging: 0, deep_security_audit: 0, extensive_conflicting_data: 0, complex_agentic_coding: 0, computer_use_workflow: 0, complete_feature: 0, unknown_cause: 0, cross_system_verification: 0, data_integrity_verification: 0, integration_verification: 0, security_verification: 0 }, details: { basis: 'independent_noul_questions_composed_locally', threshold_policy: { yes_at_or_above: 0.7, no_at_or_below: 0.3, uncertain: 'select the configured uncertainty route; deterministic safety floors may raise it' }, nouls: { frontier_architecture: 0, frontier_debugging: 0, deep_security_audit: 0, extensive_conflicting_data: 0, complex_agentic_coding: 0, computer_use_workflow: 0, complete_feature: 0, unknown_cause: 0, cross_system_verification: 0, data_integrity_verification: 0, integration_verification: 0, security_verification: 0 } } },
      recommendation: { lane: 'sol', model: 'gpt-6-sol', effort: 'high' },
      route: { source: 'jev-noul-composed', override: null },
      reason: 'accepted Jev route',
    });
  } finally {
    await stopBridge(server);
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('Noul probabilities survive the socket and direct helper paths', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'jev-noul-test-'));
  const routerPath = path.join(tempDirectory, 'mock-router');
  const details = {
    basis: 'independent_noul_questions_composed_locally',
    threshold_policy: { yes_at_or_above: 0.7, no_at_or_below: 0.3, uncertain: 'select the configured uncertainty route; deterministic safety floors may raise it' },
    nouls: { frontier_architecture: 0.92, frontier_debugging: 0, deep_security_audit: 0, extensive_conflicting_data: 0, complex_agentic_coding: 0, computer_use_workflow: 0, complete_feature: 0, unknown_cause: 0, cross_system_verification: 0, data_integrity_verification: 0, integration_verification: 0, security_verification: 0 },
  };
  await writeFile(routerPath, `#!/bin/sh
cat >/dev/null
printf '%s\\n' 'lane=sol' 'model=gpt-6-sol' 'effort=high' 'reason=local safety floor' 'route_source=jev-noul-composed' 'route_override=sensitive-risk-floor' 'jev_status=nouls_composed' 'hybrid=jev-noul-composition;composed_model=gpt-6-sol;composed_effort=high;model=jev-test' 'jev_diagnostics=${JSON.stringify(details)}'
`);
  await chmod(routerPath, 0o700);
  const { server } = await startBridge(routerPath);
  try {
    const socket = await runHelper(path.join(tempDirectory, 'bridge.sock'), 'Synthetic task');
    const direct = await runHelper(path.join(tempDirectory, 'absent.sock'), 'Synthetic task', { JEV_BRIDGE_ROUTER: routerPath });
    assert.deepEqual(socket, direct);
    assert.deepEqual(socket.jev.details, details);
    assert.deepEqual(socket.jev.nouls, details.nouls);
    assert.equal(socket.route.override, 'sensitive-risk-floor');
    const inconsistent = structuredClone(socket);
    inconsistent.jev.nouls.frontier_architecture = 0.1;
    const rejected = await runHelperAgainstSocketResult(path.join(tempDirectory, 'bad.sock'), 'Synthetic task', inconsistent);
    assert.notEqual(rejected.code, 0);
  } finally {
    await stopBridge(server);
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('bridge has no spoofable HTTP listener', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'jev-bridge-test-'));
  const routerPath = path.join(tempDirectory, 'mock-router');
  await writeFile(routerPath, '#!/bin/sh\nexit 99\n');
  await chmod(routerPath, 0o700);
  const { server } = await startBridge(routerPath);

  try {
    await assert.rejects(fetch('http://127.0.0.1:38457/v1/route'));
  } finally {
    await stopBridge(server);
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('global helper sends task text through the owner-only Unix socket', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'jev-bridge-test-'));
  const routerPath = path.join(tempDirectory, 'mock-router');
  const socketPath = path.join(tempDirectory, 'bridge.sock');
  await writeFile(routerPath, `#!/bin/sh
cat >/dev/null
printf '%s\\n' 'lane=luna' 'model=gpt-6-luna' 'effort=low' 'reason=accepted Jev route' 'route_source=jev-noul-composed' 'jev_status=nouls_composed' 'hybrid=jev-noul-composition;composed_model=gpt-6-luna;composed_effort=low;model=jev-test' 'jev_diagnostics={\"basis\":\"independent_noul_questions_composed_locally\",\"threshold_policy\":{\"yes_at_or_above\":0.7,\"no_at_or_below\":0.3,\"uncertain\":\"select the configured uncertainty route; deterministic safety floors may raise it\"},\"nouls\":{\"frontier_architecture\":0,\"frontier_debugging\":0,\"deep_security_audit\":0,\"extensive_conflicting_data\":0,\"complex_agentic_coding\":0,\"computer_use_workflow\":0,\"complete_feature\":0,\"unknown_cause\":0,\"cross_system_verification\":0,\"data_integrity_verification\":0,\"integration_verification\":0,\"security_verification\":0}}'
`);
  await chmod(routerPath, 0o700);
  const { server } = await startBridge(routerPath, {
    JEV_BRIDGE_SOCKET: socketPath,
  });

  try {
    assert.deepEqual(await runHelper(socketPath, 'route this private task'), {
      status: 'routed',
      jev: { verified: true, status: 'nouls_composed', model: 'jev-test', nouls: { frontier_architecture: 0, frontier_debugging: 0, deep_security_audit: 0, extensive_conflicting_data: 0, complex_agentic_coding: 0, computer_use_workflow: 0, complete_feature: 0, unknown_cause: 0, cross_system_verification: 0, data_integrity_verification: 0, integration_verification: 0, security_verification: 0 }, details: { basis: 'independent_noul_questions_composed_locally', threshold_policy: { yes_at_or_above: 0.7, no_at_or_below: 0.3, uncertain: 'select the configured uncertainty route; deterministic safety floors may raise it' }, nouls: { frontier_architecture: 0, frontier_debugging: 0, deep_security_audit: 0, extensive_conflicting_data: 0, complex_agentic_coding: 0, computer_use_workflow: 0, complete_feature: 0, unknown_cause: 0, cross_system_verification: 0, data_integrity_verification: 0, integration_verification: 0, security_verification: 0 } } },
      recommendation: { lane: 'luna', model: 'gpt-6-luna', effort: 'low' },
      route: { source: 'jev-noul-composed', override: null },
      reason: 'accepted Jev route',
    });
  } finally {
    await stopBridge(server);
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('global helper routes directly when no local bridge is running', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'jev-bridge-test-'));
  const routerPath = path.join(tempDirectory, 'mock-router');
  await writeFile(routerPath, `#!/bin/sh
cat >/dev/null
printf '%s\\n' 'lane=terra' 'model=gpt-5.6-terra' 'effort=medium' 'reason=local fallback' 'route_source=local-fallback' 'hybrid=local-fallback;reason=request_failed'
`);
  await chmod(routerPath, 0o700);
  try {
    assert.deepEqual(await runHelper(path.join(tempDirectory, 'missing.sock'), 'route without service', {
      JEV_BRIDGE_ROUTER: routerPath,
    }), {
      status: 'routed',
      jev: { verified: false, status: 'not_requested', model: null, nouls: null, details: null },
      recommendation: { lane: 'terra', model: 'gpt-5.6-terra', effort: 'medium' },
      route: { source: 'local-fallback', override: null },
      reason: 'local fallback',
    });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('global helper rejects invalid or inconsistent Jev status from a bridge', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'jev-bridge-test-'));
  const socketPath = path.join(tempDirectory, 'untrusted.sock');
  const validResult = {
    status: 'routed',
    jev: { verified: false, status: 'not_requested', model: null, nouls: null, details: null },
    recommendation: { lane: 'terra', model: 'gpt-5.6-terra', effort: 'medium' },
    route: { source: 'local-fallback', override: null },
    reason: 'local fallback',
  };

  try {
    const invalidResults = [
      { ...validResult, jev: { ...validResult.jev, status: 'untrusted status text' } },
      { ...validResult, jev: { ...validResult.jev, verified: true, model: 'jev-test', nouls: {} } },
    ];

    for (const result of invalidResults) {
      const outcome = await runHelperAgainstSocketResult(socketPath, 'validate an untrusted response', result);
      assert.notEqual(outcome.code, 0);
      assert.equal(outcome.output, '');
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
