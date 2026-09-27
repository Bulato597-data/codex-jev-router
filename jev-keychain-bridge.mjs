#!/usr/bin/env node

import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chmodSync, mkdirSync, lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_BODY_BYTES = 24 * 1024;
const MAX_TASK_CHARACTERS = 20_000;
const ROUTE_TIMEOUT_MS = 8_000;
const ROUTE_PATH = '/v1/route';
const HEALTH_PATH = '/health';

const thisDirectory = path.dirname(fileURLToPath(import.meta.url));
const routerPath = process.env.JEV_BRIDGE_ROUTER ?? path.join(thisDirectory, 'codex-route');
const socketPath = process.env.JEV_BRIDGE_SOCKET ?? path.join(os.homedir(), '.codex', 'jev-router', 'bridge.sock');
const settingsPath = process.env.JEV_BRIDGE_SETTINGS ?? path.join(thisDirectory, 'settings.json');

process.umask(0o077);
mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });

function safeString(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256
    ? value.trim()
    : undefined;
}

function readSettings() {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    if (!settings || Array.isArray(settings) || typeof settings !== 'object') return {};
    return {
      keychainService: safeString(settings.keychainService),
      keychainAccount: safeString(settings.keychainAccount),
    };
  } catch {
    // No settings file is a supported development configuration.
    return {};
  }
}

const settings = readSettings();
const allowedJevStatuses = new Set(['not_requested', 'credential_missing', 'request_failed', 'malformed_choice', 'choice_below_confidence', 'choice_routed']);
const isModelChoice = (value) => typeof value === 'string' && /^gpt-[0-9]+(?:\.[0-9]+)?(?:-(?:astra|sol|luna|terra))?$/.test(value);
const allowedEfforts = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function isAuthorized(request, isUnixSocket) {
  // Accept only the owner-only Unix socket. Caller-controlled headers do not
  // establish authorization.
  return isUnixSocket;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;

    request.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }));
      }
    });

    request.on('error', () => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error('Request could not be read.'), { statusCode: 400 }));
    });
  });
}

function parseConfidenceDetails(text) {
  if (!text) return undefined;
  const value = JSON.parse(text);
  const isProbability = (number) => typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1;
  const isDistribution = (distribution) => distribution && typeof distribution === 'object'
    && !Array.isArray(distribution) && Object.keys(distribution).length > 0
    && Object.values(distribution).every(isProbability);
  if (value.basis !== 'model_choice_with_separate_effort_gate'
    || !isProbability(value.model) || !isProbability(value.effort)
    || !isDistribution(value.model_probabilities) || !isDistribution(value.effort_probabilities)) {
    throw new Error('The local router returned invalid confidence details.');
  }
  return value;
}

function parseRouteOutput(output) {
  const fields = Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^([a-z_]+)=(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value]),
  );

  const lane = fields.lane;
  const model = fields.model;
  const effort = fields.effort;
  if (!['luna', 'terra', 'sol', 'astra'].includes(lane) || !model || !effort) {
    throw new Error('The local router returned an incomplete route.');
  }

  const jevDetails = fields.hybrid ?? '';
  const verified = jevDetails.startsWith('jev-advisory;');
  const jevStatus = fields.jev_status ?? 'not_requested';
  if (!allowedJevStatuses.has(jevStatus) || (verified && !['choice_below_confidence', 'choice_routed'].includes(jevStatus)) || (!verified && ['choice_below_confidence', 'choice_routed'].includes(jevStatus))) throw new Error('The local router returned an invalid Jev status.');
  const choice = verified ? jevDetails.match(/(?:^|;)choice=([^;]+)/)?.[1] ?? null : null;
  const choiceEffort = verified ? jevDetails.match(/(?:^|;)effort=([^;]+)/)?.[1] ?? null : null;
  const returnedModel = jevDetails.match(/(?:^|;)model=([^;]+)/)?.[1] ?? null;
  const confidenceText = jevDetails.match(/(?:^|;)confidence=([0-9]+(?:\.[0-9]+)?)/)?.[1];
  const confidence = confidenceText === undefined ? null : Number(confidenceText);
  if (verified && (!isModelChoice(choice) || !allowedEfforts.has(choiceEffort))) throw new Error('The local router returned an invalid model choice.');

  return {
    status: 'routed',
    jev: {
      verified,
      status: jevStatus,
      choice,
      effort: choiceEffort,
      model: verified ? returnedModel : null,
      confidence: verified ? confidence : null,
      ...(verified && fields.jev_diagnostics ? { confidence_details: parseConfidenceDetails(fields.jev_diagnostics) } : {}),
    },
    recommendation: { lane, model, effort },
    route: {
      source: fields.route_source ?? (verified ? 'jev-choice' : 'local'),
      override: fields.route_override ?? null,
    },
    reason: fields.reason ?? 'Local router recommendation.',
  };
}

function getRecommendation(task) {
  return new Promise((resolve, reject) => {
    const child = spawn(routerPath, ['--route-only', '--hybrid'], {
      // The router may read its owner-controlled credential file or Keychain.
      env: {
        HOME: os.homedir(), PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: process.env.LANG ?? 'C', TMPDIR: process.env.TMPDIR ?? '/tmp',
        TYPESAFE_API_KEY: '',
        CODEX_ROUTE_KEYCHAIN_SERVICE:
          safeString(process.env.CODEX_ROUTE_KEYCHAIN_SERVICE)
          ?? settings.keychainService
          ?? 'codex-route-typesafe',
        CODEX_ROUTE_KEYCHAIN_ACCOUNT:
          safeString(process.env.CODEX_ROUTE_KEYCHAIN_ACCOUNT)
          ?? settings.keychainAccount
          ?? os.userInfo().username,
      },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let output = '';
    let finished = false;

    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill('SIGKILL');
      reject(new Error('The route service timed out.'));
    }, ROUTE_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 8_000 && !finished) {
        finished = true;
        clearTimeout(timeout);
        child.kill('SIGKILL');
        reject(new Error('The local router returned too much output.'));
      }
    });

    child.on('error', () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(new Error('The local route service could not start.'));
    });

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error('The local route service could not complete the request.'));
        return;
      }
      try {
        resolve(parseRouteOutput(output));
      } catch {
        reject(new Error('The local router returned an invalid route.'));
      }
    });

    // Keep task text off the process command line and out of service logs.
    child.stdin.end(task);
  });
}

function createRequestHandler(isUnixSocket) {
  let activeRecommendations = 0;
  return async (request, response) => {
    if (!isAuthorized(request, isUnixSocket)) {
      sendJson(response, 403, { error: 'This bridge is available only to its owner.' });
      return;
    }

    if (request.method === 'GET' && (request.url === HEALTH_PATH || request.url === `/jev${HEALTH_PATH}`)) {
      sendJson(response, 200, { status: 'ready' });
      return;
    }

    if (request.method !== 'POST' || (request.url !== ROUTE_PATH && request.url !== `/jev${ROUTE_PATH}`)) {
      sendJson(response, 404, { error: 'Route not found.' });
      return;
    }

    if (!request.headers['content-type']?.startsWith('application/json')) {
      sendJson(response, 415, { error: 'Use application/json.' });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const task = body?.task;
      if (typeof task !== 'string' || task.trim().length === 0 || task.length > MAX_TASK_CHARACTERS) {
        sendJson(response, 400, { error: `task must be a non-empty string up to ${MAX_TASK_CHARACTERS} characters.` });
        return;
      }

      if (activeRecommendations >= 2) {
        sendJson(response, 503, { error: 'Jev bridge is busy; try again shortly.' });
        return;
      }
      activeRecommendations += 1;
      try {
        sendJson(response, 200, await getRecommendation(task));
      } finally {
        activeRecommendations -= 1;
      }
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 503;
      sendJson(response, statusCode, { error: error.message });
    }
  };
}

const localServer = http.createServer(createRequestHandler(true));
let createdSocket = false;
let createdSocketIdentity = null;

async function staleSocketCanBeRemoved() {
  try {
    const stats = lstatSync(socketPath);
    if (!stats.isSocket() || stats.uid !== process.getuid()) throw new Error('Socket path is not an owner-owned socket.');
    const live = await new Promise((resolve) => {
      const probe = net.createConnection(socketPath);
      probe.once('connect', () => { probe.destroy(); resolve(true); });
      probe.once('error', (error) => {
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') resolve(false);
        else resolve(true);
      });
    });
    if (live) throw new Error('Another Jev bridge is already running.');
    const latest = lstatSync(socketPath);
    if (!latest.isSocket() || latest.ino !== stats.ino || latest.dev !== stats.dev) throw new Error('Socket path changed during startup.');
    unlinkSync(socketPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function cleanupSocket() {
  if (!createdSocket) return;
  try {
    const stats = lstatSync(socketPath);
    if (stats.isSocket() && stats.ino === createdSocketIdentity?.ino && stats.dev === createdSocketIdentity?.dev) unlinkSync(socketPath);
  } catch {}
}

function shutdown(exitCode) {
  localServer.close(() => { cleanupSocket(); process.exit(exitCode); });
}

try {
  await staleSocketCanBeRemoved();
  localServer.on('error', () => shutdown(1));
  localServer.listen(socketPath, () => {
    createdSocket = true;
    chmodSync(socketPath, 0o600);
    const stats = lstatSync(socketPath);
    createdSocketIdentity = { ino: stats.ino, dev: stats.dev };
    process.stdout.write('Jev bridge local socket ready.\n');
  });
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
} catch {
  process.exitCode = 1;
}
