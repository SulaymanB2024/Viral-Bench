import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  createOperatorSession,
  hashIpAddress,
  operatorCookie,
  requestIp,
  verifyOperatorPassword,
} from '../../lib/auth.js';
import {
  bodyRecord,
  handleApiError,
  HttpError,
  requireAllowedOrigin,
  requireJson,
  requireMethod,
  sendJson,
} from '../../lib/http.js';
import { createAgentStateStore, type AgentStateStore } from '../../lib/state.js';

const FIFTEEN_MINUTES = 15 * 60 * 1_000;

interface LoginRouteOptions {
  store?: AgentStateStore | null;
  env?: NodeJS.ProcessEnv;
}

export function createLoginHandler(options: LoginRouteOptions = {}) {
  return async (request: VercelRequest, response: VercelResponse): Promise<void> => {
    try {
      const env = options.env ?? process.env;
      requireMethod(request, 'POST');
      requireAllowedOrigin(request, env);
      requireJson(request);
      if (env.AGENT_ENABLED?.toLowerCase() !== 'true') {
        throw new HttpError(503, 'operator_staged', 'Operator access is disabled during staged rollout.');
      }
      const passwordHash = env.OPERATOR_PASSWORD_HASH?.trim();
      const sessionSecret = env.AGENT_SESSION_SECRET?.trim();
      const ipSecret = env.AGENT_IP_HASH_SECRET?.trim();
      const store = options.store === undefined ? createAgentStateStore(env) : options.store;
      if (
        !passwordHash
        || !sessionSecret
        || sessionSecret.length < 32
        || !ipSecret
        || ipSecret.length < 32
        || !store
      ) {
        throw new HttpError(503, 'operator_unavailable', 'Operator authentication is unavailable.');
      }
      const body = bodyRecord(request);
      const password = typeof body.password === 'string' ? body.password : '';
      if (!verifyOperatorPassword(password, passwordHash)) {
        const ipHash = hashIpAddress(requestIp(request.headers), ipSecret);
        const limit = await store.rateLimit(`operator:login:${ipHash}`, 5, FIFTEEN_MINUTES);
        if (!limit.allowed) {
          throw new HttpError(429, 'login_throttled', 'Too many failed login attempts. Try again later.');
        }
        throw new HttpError(401, 'invalid_credentials', 'The password is not valid.');
      }
      const { token, session } = createOperatorSession(sessionSecret);
      response.setHeader('Set-Cookie', operatorCookie(token));
      sendJson(response, 200, {
        authenticated: true,
        expires_at: new Date(session.exp * 1_000).toISOString(),
      });
    } catch (error) {
      handleApiError(response, error);
    }
  };
}

export default createLoginHandler();
