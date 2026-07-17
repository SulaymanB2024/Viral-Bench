import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createBriefHandler } from '../api/operator/brief.js';
import { createLoginHandler } from '../api/operator/login.js';
import { createLogoutHandler } from '../api/operator/logout.js';
import { createStatusHandler } from '../api/operator/status.js';
import { createResearchQueryHandler } from '../api/research/query.js';
import { hashOperatorPassword } from '../lib/auth.js';
import { AgentService } from '../lib/service.js';
import { MemoryAgentStateStore } from '../lib/state.js';
import { corpus, mockRequest, mockResponse } from './helpers.js';

const sessionSecret = 'session-secret-'.repeat(4);
const ipSecret = 'ip-hash-secret-'.repeat(4);
const password = 'a sufficiently long operator password';
const enabledEnv = {
  NODE_ENV: 'production',
  AGENT_ENABLED: 'true',
  OPERATOR_PASSWORD_HASH: hashOperatorPassword(password, Buffer.alloc(16, 4)),
  AGENT_SESSION_SECRET: sessionSecret,
  AGENT_IP_HASH_SECRET: ipSecret,
};
const requestHeaders = {
  origin: 'https://viralbench.example',
  host: 'viralbench.example',
  'content-type': 'application/json',
  'x-forwarded-for': '203.0.113.7',
};

test('research route enforces method, JSON, and same-origin CSRF policy', async () => {
  const service = new AgentService({ corpus: corpus(), enabled: false });
  const handler = createResearchQueryHandler({ service, env: enabledEnv });
  const ok = mockResponse();
  await handler(mockRequest({
    body: { question: 'What resume hooks appear in reviewed records?' },
    headers: requestHeaders,
  }), ok.response);
  assert.equal(ok.state.statusCode, 200);
  assert.equal((ok.state.body as { mode: string }).mode, 'retrieval_only');

  const rejected = mockResponse();
  await handler(mockRequest({
    body: { question: 'What resume hooks appear in reviewed records?' },
    headers: { ...requestHeaders, origin: 'https://attacker.example' },
  }), rejected.response);
  assert.equal(rejected.state.statusCode, 403);
});

test('login throttles concurrent failed attempts and issues a strict eight-hour cookie on success', async () => {
  const store = new MemoryAgentStateStore();
  const handler = createLoginHandler({ store, env: enabledEnv });
  const attempts = await Promise.all(Array.from({ length: 6 }, async () => {
    const output = mockResponse();
    await handler(mockRequest({ body: { password: 'wrong password' }, headers: requestHeaders }), output.response);
    return output.state.statusCode;
  }));
  assert.equal(attempts.filter((status) => status === 401).length, 5);
  assert.equal(attempts.filter((status) => status === 429).length, 1);

  const successful = mockResponse();
  await handler(mockRequest({
    body: { password },
    headers: { ...requestHeaders, 'x-forwarded-for': '203.0.113.8' },
  }), successful.response);
  assert.equal(successful.state.statusCode, 200);
  const cookie = String(successful.state.headers.get('set-cookie'));
  assert.match(cookie, /Max-Age=28800/);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
});

test('operator status, brief, logout, and revocation contracts stay fail-closed', async () => {
  const store = new MemoryAgentStateStore();
  const login = createLoginHandler({ store, env: enabledEnv });
  const loginOutput = mockResponse();
  await login(mockRequest({ body: { password }, headers: requestHeaders }), loginOutput.response);
  const cookie = String(loginOutput.state.headers.get('set-cookie')).split(';')[0]!;
  const authenticatedHeaders = { ...requestHeaders, cookie };

  const status = createStatusHandler({ store, env: enabledEnv });
  const statusOutput = mockResponse();
  await status(mockRequest({ method: 'GET', headers: authenticatedHeaders }), statusOutput.response);
  assert.equal(statusOutput.state.statusCode, 200);
  assert.equal((statusOutput.state.body as { authenticated: boolean }).authenticated, true);

  const brief = createBriefHandler({
    store,
    env: enabledEnv,
    service: new AgentService({ corpus: corpus(), enabled: false }),
  });
  const briefOutput = mockResponse();
  await brief(mockRequest({
    body: {
      objective: 'Increase useful awareness',
      audience: 'College students',
      platform: 'tiktok',
      topic: 'Resume evidence',
    },
    headers: authenticatedHeaders,
  }), briefOutput.response);
  assert.equal(briefOutput.state.statusCode, 200);
  assert.equal((briefOutput.state.body as { mode: string }).mode, 'retrieval_only');

  const logout = createLogoutHandler({ store, env: enabledEnv });
  const logoutOutput = mockResponse();
  await logout(mockRequest({ body: {}, headers: authenticatedHeaders }), logoutOutput.response);
  assert.equal(logoutOutput.state.statusCode, 200);
  assert.match(String(logoutOutput.state.headers.get('set-cookie')), /Max-Age=0/);

  const revokedOutput = mockResponse();
  await status(mockRequest({ method: 'GET', headers: authenticatedHeaders }), revokedOutput.response);
  assert.equal(revokedOutput.state.statusCode, 401);
});

test('disabled status and internal failures disclose no secrets', async () => {
  const disabled = createStatusHandler({ store: null, env: { AGENT_ENABLED: 'false' } });
  const disabledOutput = mockResponse();
  await disabled(mockRequest({ method: 'GET' }), disabledOutput.response);
  assert.deepEqual(disabledOutput.state.body, { authenticated: false, enabled: false });

  const brokenEnv = {
    ...enabledEnv,
    OPERATOR_PASSWORD_HASH: 'scrypt$v1$bad$bad',
  };
  const broken = createLoginHandler({ store: null, env: brokenEnv });
  const brokenOutput = mockResponse();
  await broken(mockRequest({ body: { password }, headers: requestHeaders }), brokenOutput.response);
  assert.equal(brokenOutput.state.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(brokenOutput.state.body), /session-secret|ip-hash-secret|scrypt/);
});

test('website runtime never imports the legacy autonomous publisher or writes queues', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const runtimeFiles = [
    ...walk(path.join(root, 'api')),
    ...walk(path.join(root, 'lib')),
  ].filter((file) => file.endsWith('.ts'));
  const source = runtimeFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(source, /marketing-agent/);
  assert.doesNotMatch(source, /creative_jobs\/incoming|traction_experiments\//);
  assert.doesNotMatch(source, /graph\.facebook|open\.tiktokapis|publishVideo|uploadVideo/i);
  assert.doesNotMatch(source, /writeFileSync|appendFileSync|createWriteStream/);
});

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}
