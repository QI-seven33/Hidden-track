import { loadConfig, type Config } from '../src/server/config';
import type { FastifyInstance } from 'fastify';
export const ORIGIN = 'http://localhost:3190';
export function testConfig(extra: Partial<Config> = {}): Config {
  return {
    ...loadConfig({ SESSION_SECRET: '11'.repeat(32) }),
    localOnly: false,
    origins: [ORIGIN],
    database: ':memory:',
    adminToken: 'test-admin-token-abcdefghijklmnopqrstuvwxyz',
    ...extra,
  };
}
export async function guest(app: FastifyInstance, name: string) {
  const response = await app.inject({ url: '/api/session' });
  const cookie = String(response.headers['set-cookie']).split(';')[0]!;
  await app.inject({
    method: 'POST',
    url: '/api/session',
    headers: { cookie, origin: ORIGIN },
    payload: { name },
  });
  return { cookie, origin: ORIGIN };
}
