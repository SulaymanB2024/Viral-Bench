import type { VercelRequest } from '@vercel/node';

import {
  cookieValue,
  OPERATOR_COOKIE,
  verifySessionToken,
  type OperatorSession,
} from './auth.js';
import { HttpError } from './http.js';
import type { AgentStateStore } from './state.js';

export async function requireOperatorSession(
  request: VercelRequest,
  store: AgentStateStore | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OperatorSession> {
  const secret = env.AGENT_SESSION_SECRET?.trim();
  if (!store || !secret || secret.length < 32) {
    throw new HttpError(503, 'operator_unavailable', 'Operator authentication is unavailable.');
  }
  const session = await optionalOperatorSession(request, store, env);
  if (!session) {
    throw new HttpError(401, 'authentication_required', 'Operator authentication is required.');
  }
  return session;
}

export async function optionalOperatorSession(
  request: VercelRequest,
  store: AgentStateStore | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OperatorSession | null> {
  const secret = env.AGENT_SESSION_SECRET?.trim();
  if (!store || !secret || secret.length < 32) return null;
  const token = cookieValue(request.headers.cookie, OPERATOR_COOKIE);
  const session = token ? verifySessionToken(token, secret) : null;
  if (!session || await store.isSessionRevoked(session.jti)) return null;
  return session;
}
