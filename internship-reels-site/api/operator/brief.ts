import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  bodyRecord,
  handleApiError,
  requireAllowedOrigin,
  requireJson,
  requireMethod,
  sendJson,
} from '../../lib/http.js';
import { requireOperatorSession } from '../../lib/operator-auth.js';
import {
  AgentService,
  createDefaultAgentService,
  parseOperatorBrief,
} from '../../lib/service.js';
import { createAgentStateStore, type AgentStateStore } from '../../lib/state.js';

interface BriefRouteOptions {
  service?: AgentService;
  store?: AgentStateStore | null;
  env?: NodeJS.ProcessEnv;
}

export function createBriefHandler(options: BriefRouteOptions = {}) {
  return async (request: VercelRequest, response: VercelResponse): Promise<void> => {
    try {
      const env = options.env ?? process.env;
      const store = options.store === undefined ? createAgentStateStore(env) : options.store;
      requireMethod(request, 'POST');
      requireAllowedOrigin(request, env);
      requireJson(request);
      await requireOperatorSession(request, store, env);
      const input = parseOperatorBrief(bodyRecord(request));
      const result = await (options.service ?? createDefaultAgentService(env)).marketingBrief(input);
      sendJson(response, 200, result);
    } catch (error) {
      handleApiError(response, error);
    }
  };
}

export default createBriefHandler();
