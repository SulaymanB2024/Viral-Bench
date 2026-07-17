import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

export const OPERATOR_COOKIE = 'vb_operator_session';
export const OPERATOR_SESSION_SECONDS = 8 * 60 * 60;

export interface OperatorSession {
  role: 'operator';
  jti: string;
  iat: number;
  exp: number;
}

export function hashOperatorPassword(password: string, salt = randomBytes(16)): string {
  if (password.length < 12) throw new Error('Operator password must contain at least 12 characters.');
  const digest = scryptSync(password, salt, 32, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$v1$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

export function verifyOperatorPassword(password: string, encoded: string): boolean {
  const [algorithm, version, saltValue, digestValue] = encoded.split('$');
  if (algorithm !== 'scrypt' || version !== 'v1' || !saltValue || !digestValue) return false;
  try {
    const salt = Buffer.from(saltValue, 'base64url');
    const expected = Buffer.from(digestValue, 'base64url');
    const actual = scryptSync(password, salt, expected.length, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createOperatorSession(secret: string, now = Date.now()): {
  session: OperatorSession;
  token: string;
} {
  const session: OperatorSession = {
    role: 'operator',
    jti: randomUUID(),
    iat: Math.floor(now / 1_000),
    exp: Math.floor(now / 1_000) + OPERATOR_SESSION_SECONDS,
  };
  return { session, token: signSession(session, secret) };
}

export function signSession(session: OperatorSession, secret: string): string {
  if (secret.length < 32) throw new Error('AGENT_SESSION_SECRET must contain at least 32 characters.');
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string, secret: string, now = Date.now()): OperatorSession | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature || secret.length < 32) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<OperatorSession>;
    if (
      parsed.role !== 'operator'
      || typeof parsed.jti !== 'string'
      || typeof parsed.iat !== 'number'
      || typeof parsed.exp !== 'number'
      || parsed.exp <= Math.floor(now / 1_000)
    ) return null;
    return parsed as OperatorSession;
  } catch {
    return null;
  }
}

export function operatorCookie(token: string): string {
  return [
    `${OPERATOR_COOKIE}=${token}`,
    `Max-Age=${OPERATOR_SESSION_SECONDS}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ].join('; ');
}

export function clearOperatorCookie(): string {
  return `${OPERATOR_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function cookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(';')) {
    const [key, ...value] = pair.trim().split('=');
    if (key === name) return value.join('=') || null;
  }
  return null;
}

export function hashIpAddress(ip: string, secret: string): string {
  if (secret.length < 32) throw new Error('AGENT_IP_HASH_SECRET must contain at least 32 characters.');
  return createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
}

export function requestIp(headers: Record<string, string | string[] | undefined>): string {
  const forwarded = headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(',')[0]?.trim() || 'unknown';
}
