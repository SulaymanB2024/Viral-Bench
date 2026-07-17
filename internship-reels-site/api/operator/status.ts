import type { VercelRequest, VercelResponse } from '@vercel/node';

import { handleApiError, requireMethod, sendJson } from '../../lib/http.js';
import { requireOperatorSession } from '../../lib/operator-auth.js';
import { createAgentStateStore, type AgentStateStore } from '../../lib/state.js';

interface StatusRouteOptions {
  store?: AgentStateStore | null;
  env?: NodeJS.ProcessEnv;
}

export function createStatusHandler(options: StatusRouteOptions = {}) {
  return async (request: VercelRequest, response: VercelResponse): Promise<void> => {
    try {
      const env = options.env ?? process.env;
      requireMethod(request, 'GET');
      if (env.AGENT_ENABLED?.toLowerCase() !== 'true') {
        sendJson(response, 200, { authenticated: false, enabled: false });
        return;
      }
      const store = options.store === undefined ? createAgentStateStore(env) : options.store;
      const session = await requireOperatorSession(request, store, env);
      sendJson(response, 200, {
        authenticated: true,
        enabled: true,
        expires_at: new Date(session.exp * 1_000).toISOString(),
      });
    } catch (error) {
      handleApiError(response, error);
    }
  };
}

export default createStatusHandler();
