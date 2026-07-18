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
import { optionalOperatorSession } from '../../lib/operator-auth.js';
import {
  createDefaultAgentService,
  parseResearchQuery,
  type ResearchAccess,
  type ResearchQueryInput,
} from '../../lib/service.js';
import {
  createAgentStateStore,
  localAgentStateEnabled,
  type AgentStateStore,
} from '../../lib/state.js';
import type { ResearchAnswer } from '../../lib/types.js';

const LOCAL_IP_HASH_SECRET = 'viralbench-local-development-ip-hash-secret-v1';

interface ResearchService {
  research(
    input: ResearchQueryInput,
    ipHash: string | null,
    access?: ResearchAccess,
  ): Promise<ResearchAnswer>;
}

interface ResearchRouteOptions {
  service?: ResearchService;
  store?: AgentStateStore | null;
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
      const secret = (
        env.AGENT_IP_HASH_SECRET?.trim()
        || (localAgentStateEnabled(env) ? LOCAL_IP_HASH_SECRET : '')
      );
      const ipHash = secret && secret.length >= 32
        ? hashIpAddress(requestIp(request.headers), secret)
        : null;
      const store = options.store === undefined ? createAgentStateStore(env) : options.store;
      const operator = await optionalOperatorSession(request, store, env);
      const access: ResearchAccess = operator
        ? { bypassAppQuota: true, bypassCache: true }
        : {};
      if (operator) {
        response.setHeader('Vary', 'Cookie');
        response.setHeader('X-ViralBench-Research-Access', 'operator');
      }
      const result = await (options.service ?? createDefaultAgentService(env))
        .research(input, ipHash, access);
      sendJson(response, 200, result);
    } catch (error) {
      handleApiError(response, error);
    }
  };
}

export default createResearchQueryHandler();
