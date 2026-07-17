import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  clearOperatorCookie,
  cookieValue,
  OPERATOR_COOKIE,
  verifySessionToken,
} from '../../lib/auth.js';
import {
  handleApiError,
  HttpError,
  requireAllowedOrigin,
  requireJson,
  requireMethod,
  sendJson,
} from '../../lib/http.js';
import { createAgentStateStore, type AgentStateStore } from '../../lib/state.js';

interface LogoutRouteOptions {
  store?: AgentStateStore | null;
  env?: NodeJS.ProcessEnv;
}

export function createLogoutHandler(options: LogoutRouteOptions = {}) {
  return async (request: VercelRequest, response: VercelResponse): Promise<void> => {
    try {
      const env = options.env ?? process.env;
      requireMethod(request, 'POST');
      requireAllowedOrigin(request, env);
      requireJson(request);
      const store = options.store === undefined ? createAgentStateStore(env) : options.store;
      const secret = env.AGENT_SESSION_SECRET?.trim();
      if (!store || !secret || secret.length < 32) {
        throw new HttpError(503, 'operator_unavailable', 'Operator authentication is unavailable.');
      }
      const token = cookieValue(request.headers.cookie, OPERATOR_COOKIE);
      const session = token ? verifySessionToken(token, secret) : null;
      if (session) {
        const remainingSeconds = Math.max(1, session.exp - Math.floor(Date.now() / 1_000));
        await store.revokeSession(session.jti, remainingSeconds);
      }
      response.setHeader('Set-Cookie', clearOperatorCookie());
      sendJson(response, 200, { authenticated: false });
    } catch (error) {
      handleApiError(response, error);
    }
  };
}

export default createLogoutHandler();
