#!/usr/bin/env node

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_TASK_CHARACTERS = 20_000;
const routePath = '/v1/route';
const socketPath = process.env.JEV_BRIDGE_SOCKET ?? path.join(os.homedir(), '.codex', 'jev-router', 'bridge.sock');
const thisDirectory = path.dirname(fileURLToPath(import.meta.url));
const routerPath = process.env.JEV_BRIDGE_ROUTER ?? path.join(thisDirectory, 'codex-route');
const settingsPath = process.env.JEV_BRIDGE_SETTINGS ?? path.join(thisDirectory, 'settings.json');

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
    return {};
  }
}

const settings = readSettings();
const allowedJevStatuses = new Set(['not_requested', 'credential_missing', 'request_failed', 'malformed_choice', 'choice_below_confidence', 'choice_routed']);
const isModelChoice = (value) => typeof value === 'string' && /^gpt-[0-9]+(?:\.[0-9]+)?(?:-(?:astra|sol|luna|terra))?$/.test(value);
const allowedEfforts = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

function validateRouteResult(result) {
  const lane = result?.recommendation?.lane;
  const choice = result?.jev?.choice;
  const choiceEffort = result?.jev?.effort;
  const status = result?.jev?.status;
  const verified = result?.jev?.verified;
  const acceptedChoiceStatuses = new Set(['choice_below_confidence', 'choice_routed']);
  if (result?.status !== 'routed' || !['luna', 'terra', 'sol', 'astra'].includes(lane)
    || typeof verified !== 'boolean' || !allowedJevStatuses.has(status)
    || verified !== acceptedChoiceStatuses.has(status) || typeof result?.route?.source !== 'string'
    || typeof result?.recommendation?.model !== 'string' || typeof result?.recommendation?.effort !== 'string'
    || (result.route.override !== null && typeof result.route.override !== 'string')
    || (result.jev.verified && !isModelChoice(choice))
    || (result.jev.verified && !allowedEfforts.has(choiceEffort))
    || (result.jev.verified && (typeof result.jev.model !== 'string' || typeof result.jev.confidence !== 'number' || result.jev.confidence < 0 || result.jev.confidence > 1))
    || (!result.jev.verified && (choice !== null || choiceEffort !== null))) throw new Error('Jev bridge returned an invalid response.');
  if (result.jev.confidence_details !== undefined) {
    const details = parseConfidenceDetails(JSON.stringify(result.jev.confidence_details));
    if (!verified || result.jev.confidence !== details.model) {
      throw new Error('Jev bridge returned inconsistent confidence details.');
    }
  }
  return result;
}

async function readTask() {
  let task = '';
  for await (const chunk of process.stdin) {
    task += chunk.toString('utf8');
    if (task.length > MAX_TASK_CHARACTERS) {
      throw new Error(`Task text must be no more than ${MAX_TASK_CHARACTERS} characters.`);
    }
  }
  if (!task.trim()) throw new Error('Pipe the task text to jev-route on standard input.');
  return task;
}

function requestThroughLocalSocket(task) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      socketPath,
      path: routePath,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }, (response) => {
      let body = '';
      let responseBytes = 0;
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        responseBytes += Buffer.byteLength(chunk, 'utf8');
        if (responseBytes > 65_536) {
          request.destroy(new Error('Jev bridge response exceeded 64 KiB.'));
          return;
        }
        body += chunk;
      });
      response.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(result.error ?? 'Jev bridge request failed.'));
            return;
          }
          resolve(validateRouteResult(result));
        } catch {
          reject(new Error('Jev bridge returned an invalid response.'));
        }
      });
    });

    request.setTimeout(10_000, () => request.destroy(new Error('Jev bridge request timed out.')));
    request.on('error', (error) => {
      error.bridgeUnavailable = error.code === 'ENOENT' || error.code === 'ECONNREFUSED';
      reject(error);
    });
    request.end(JSON.stringify({ task }));
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

function parseRouterOutput(output) {
  const fields = Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^([a-z_]+)=(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value]),
  );
  const { lane, model, effort } = fields;
  if (!['luna', 'terra', 'sol', 'astra'].includes(lane) || !model || !effort) {
    throw new Error('The local router returned an incomplete route.');
  }
  const hybrid = fields.hybrid ?? '';
  const verified = hybrid.startsWith('jev-advisory;');
  const jevStatus = fields.jev_status ?? 'not_requested';
  if (!allowedJevStatuses.has(jevStatus) || (verified && !['choice_below_confidence', 'choice_routed'].includes(jevStatus)) || (!verified && ['choice_below_confidence', 'choice_routed'].includes(jevStatus))) throw new Error('The local router returned an invalid Jev status.');
  const choice = verified ? hybrid.match(/(?:^|;)choice=([^;]+)/)?.[1] ?? null : null;
  const choiceEffort = verified ? hybrid.match(/(?:^|;)effort=([^;]+)/)?.[1] ?? null : null;
  const returnedModel = hybrid.match(/(?:^|;)model=([^;]+)/)?.[1] ?? null;
  const confidenceText = hybrid.match(/(?:^|;)confidence=([0-9]+(?:\.[0-9]+)?)/)?.[1];
  return {
    status: 'routed',
    jev: {
      verified,
      status: jevStatus,
      choice,
      effort: choiceEffort,
      model: verified ? returnedModel : null,
      confidence: verified && confidenceText !== undefined ? Number(confidenceText) : null,
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

function routeDirectly(task) {
  return new Promise((resolve, reject) => {
    const child = spawn(routerPath, ['--route-only', '--hybrid'], {
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
      reject(new Error('The local Jev route timed out.'));
    }, 8_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(new Error('The local Jev router could not start.'));
    });
    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error('The local Jev router could not complete the request.'));
        return;
      }
      try {
        resolve(validateRouteResult(parseRouterOutput(output)));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(task);
  });
}

try {
  const task = await readTask();
  const result = await requestThroughLocalSocket(task).catch((error) => {
    if (!error.bridgeUnavailable) throw error;
    return routeDirectly(task);
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`jev-route: ${error.message}\n`);
  process.exitCode = 1;
}
