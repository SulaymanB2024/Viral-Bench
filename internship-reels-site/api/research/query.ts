import type { VercelRequest, VercelResponse } from '@vercel/node';

import { hashIpAddress, requestIp } from '../../lib/auth.js';
import {
  bodyRecord,
  handleApiError,
  requireAllowedOrigin,
  requireJson,
  requireMethod,
  sendJson,
} from '../../lib/http.js';
import {
  AgentService,
  createDefaultAgentService,
  parseResearchQuery,
} from '../../lib/service.js';

interface ResearchRouteOptions {
  service?: AgentService;
  env?: NodeJS.ProcessEnv;
}

export function createResearchQueryHandler(options: ResearchRouteOptions = {}) {
  return async (request: VercelRequest, response: VercelResponse): Promise<void> => {
    try {
      const env = options.env ?? process.env;
      requireMethod(request, 'POST');
      requireAllowedOrigin(request, env);
      requireJson(request);
      const input = parseResearchQuery(bodyRecord(request));
      const secret = env.AGENT_IP_HASH_SECRET?.trim();
      const ipHash = secret && secret.length >= 32
        ? hashIpAddress(requestIp(request.headers), secret)
        : null;
      const result = await (options.service ?? createDefaultAgentService(env)).research(input, ipHash);
      sendJson(response, 200, result);
    } catch (error) {
      handleApiError(response, error);
    }
  };
}

export default createResearchQueryHandler();
