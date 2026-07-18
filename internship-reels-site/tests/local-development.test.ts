import assert from 'node:assert/strict';
import test from 'node:test';

import { createResearchQueryHandler } from '../api/research/query.js';
import type { AgentService } from '../lib/service.js';
import {
  createAgentStateStore,
  MemoryAgentStateStore,
} from '../lib/state.js';
import { mockRequest, mockResponse } from './helpers.js';

const localEnv = {
  NODE_ENV: 'development',
  AGENT_ENABLED: 'true',
  AGENT_LOCAL_STATE: 'true',
};

test('explicit local agent state reuses memory and stays disabled in production', () => {
  const first = createAgentStateStore(localEnv);
  const second = createAgentStateStore(localEnv);
  assert.ok(first instanceof MemoryAgentStateStore);
  assert.equal(second, first);
  assert.equal(createAgentStateStore({
    ...localEnv,
    NODE_ENV: 'production',
  }), null);
  assert.equal(createAgentStateStore({
    ...localEnv,
    VERCEL_ENV: 'production',
  }), null);
});

test('local research requests receive a privacy-preserving IP hash without a secret', async () => {
  let observedIpHash: string | null = null;
  const service = {
    async research(_input: unknown, ipHash: string | null) {
      observedIpHash = ipHash;
      return { mode: 'test' };
    },
  } as unknown as AgentService;
  const handler = createResearchQueryHandler({ service, env: localEnv });
  const output = mockResponse();

  await handler(mockRequest({
    body: { question: 'Which reviewed resume hooks are relevant?' },
    headers: {
      origin: 'http://127.0.0.1:4321',
      host: '127.0.0.1:4321',
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.7',
    },
  }), output.response);

  assert.equal(output.state.statusCode, 200);
  assert.match(observedIpHash ?? '', /^[a-f0-9]{32}$/);
  assert.doesNotMatch(JSON.stringify(output.state.body), /203\.0\.113\.7/);
});
