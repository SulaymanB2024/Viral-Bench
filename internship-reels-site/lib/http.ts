import type { VercelRequest, VercelResponse } from '@vercel/node';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function requireMethod(request: VercelRequest, method: 'GET' | 'POST'): void {
  if (request.method !== method) throw new HttpError(405, 'method_not_allowed', `${method} is required.`);
}

export function requireAllowedOrigin(
  request: VercelRequest,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const origin = header(request, 'origin');
  if (!origin && env.NODE_ENV !== 'production') return;
  if (!origin) throw new HttpError(403, 'origin_required', 'A same-origin request is required.');
  const configured = (env.AGENT_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const host = header(request, 'x-forwarded-host') || header(request, 'host');
  const inferred = host ? [`https://${host}`, `http://${host}`] : [];
  if (![...configured, ...inferred].includes(origin)) {
    throw new HttpError(403, 'origin_rejected', 'The request origin is not allowed.');
  }
}

export function requireJson(request: VercelRequest): void {
  const contentType = header(request, 'content-type');
  if (!contentType?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'json_required', 'Content-Type must be application/json.');
  }
}

export function bodyRecord(request: VercelRequest): Record<string, unknown> {
  const input = typeof request.body === 'string' ? safeParse(request.body) : request.body;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'invalid_body', 'The request body must be a JSON object.');
  }
  return input as Record<string, unknown>;
}

export function sendJson(response: VercelResponse, status: number, value: unknown): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.status(status).json(value);
}

export function handleApiError(response: VercelResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(response, error.status, { error: error.code, message: error.message });
    return;
  }
  sendJson(response, 500, {
    error: 'internal_error',
    message: 'The request could not be completed.',
  });
}

export function header(request: VercelRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new HttpError(400, 'invalid_json', 'The request body contains invalid JSON.');
  }
}
