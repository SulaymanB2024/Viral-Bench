import assert from 'node:assert/strict';
import test from 'node:test';

import { createLoginHandler } from '../api/operator/login.js';
import { createLogoutHandler } from '../api/operator/logout.js';
import { createResearchQueryHandler } from '../api/research/query.js';
import { hashOperatorPassword } from '../lib/auth.js';
import {
  AgentService,
  type ResearchAccess,
  type ResearchQueryInput,
} from '../lib/service.js';
import { MemoryAgentStateStore } from '../lib/state.js';
import { corpus, mockRequest, mockResponse } from './helpers.js';

const password = 'a sufficiently long operator password';
const env = {
  NODE_ENV: 'production',
  AGENT_ENABLED: 'true',
  OPERATOR_PASSWORD_HASH: hashOperatorPassword(password, Buffer.alloc(16, 4)),
  AGENT_SESSION_SECRET: 'session-secret-'.repeat(4),
  AGENT_IP_HASH_SECRET: 'ip-hash-secret-'.repeat(4),
};
const requestHeaders = {
  origin: 'https://viralbench.example',
  host: 'viralbench.example',
  'content-type': 'application/json',
  'x-forwarded-for': '203.0.113.7',
};

test('research route grants quota and cache bypass only to an active operator session', async () => {
  const store = new MemoryAgentStateStore();
  const fallback = new AgentService({ corpus: corpus(), enabled: false });
  const accesses: ResearchAccess[] = [];
  const service = {
    async research(
      input: ResearchQueryInput,
      ipHash: string | null,
      access: ResearchAccess = {},
    ) {
      accesses.push(access);
      return await fallback.research(input, ipHash);
    },
  };
  const handler = createResearchQueryHandler({ service, store, env });
  const question = { question: 'What resume hooks appear in reviewed records?' };

  const publicOutput = mockResponse();
  await handler(mockRequest({ body: question, headers: requestHeaders }), publicOutput.response);
  assert.deepEqual(accesses.at(-1), {});
  assert.equal(publicOutput.state.headers.has('x-viralbench-research-access'), false);

  const login = createLoginHandler({ store, env });
  const loginOutput = mockResponse();
  await login(mockRequest({ body: { password }, headers: requestHeaders }), loginOutput.response);
  const cookie = String(loginOutput.state.headers.get('set-cookie')).split(';')[0]!;
  const authenticatedHeaders = { ...requestHeaders, cookie };

  const operatorOutput = mockResponse();
  await handler(mockRequest({ body: question, headers: authenticatedHeaders }), operatorOutput.response);
  assert.deepEqual(accesses.at(-1), { bypassAppQuota: true, bypassCache: true });
  assert.equal(operatorOutput.state.headers.get('cache-control'), 'no-store');
  assert.equal(operatorOutput.state.headers.get('vary'), 'Cookie');
  assert.equal(operatorOutput.state.headers.get('x-viralbench-research-access'), 'operator');

  const logout = createLogoutHandler({ store, env });
  await logout(mockRequest({ body: {}, headers: authenticatedHeaders }), mockResponse().response);
  const revokedOutput = mockResponse();
  await handler(mockRequest({ body: question, headers: authenticatedHeaders }), revokedOutput.response);
  assert.deepEqual(accesses.at(-1), {});
  assert.equal(revokedOutput.state.headers.has('x-viralbench-research-access'), false);
});
