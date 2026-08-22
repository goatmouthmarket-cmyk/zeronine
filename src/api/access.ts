import type { FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.ts';

export const OWNER_COOKIE = 'zeronine_owner';

export function publicDashboardEnabled(): boolean {
  return config.dashboardAdminToken.length > 0;
}

export function isOwner(req: FastifyRequest): boolean {
  if (!publicDashboardEnabled()) return true;
  const signed = req.cookies?.[OWNER_COOKIE];
  if (!signed) return false;
  const value = req.unsignCookie(signed);
  if (!value.valid) return false;
  const expected = Buffer.from(config.dashboardAdminToken);
  const actual = Buffer.from(value.value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function requireOwner(req: FastifyRequest, reply: FastifyReply): boolean {
  if (isOwner(req)) return true;
  reply.code(403).send({ error: 'dashboard owner access required' });
  return false;
}

export function grantOwner(reply: FastifyReply): void {
  reply.setCookie(OWNER_COOKIE, config.dashboardAdminToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: config.nodeEnv === 'production',
    signed: true,
    maxAge: 60 * 60 * 12,
  });
}
