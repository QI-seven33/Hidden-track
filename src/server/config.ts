import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { PlaytestConfig } from './playtest';
export interface Config {
  localOnly: boolean;
  production: boolean;
  playtest?: PlaytestConfig;
  clientRoot?: string;
  host: string;
  port: number;
  origins: string[];
  database: string;
  fixtures: boolean;
  practice: boolean;
  adminToken: string;
  sessionSecret: string;
  trustProxy: boolean;
  qqAppId: string;
  qqAppKey: string;
  qqPackage: string;
  qqH5Package: string;
  qqWebLogin?: boolean;
  qqTestIp: string;
  qqPublicMetadata: boolean;
  qqPublicLyrics: boolean;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const localOnly = env.LOCAL_PRACTICE_ONLY !== 'false';
  const production = env.NODE_ENV === 'production';
  let playtest: PlaytestConfig | undefined;
  if (env.PLAYTEST_MODE === 'true') {
    const origin = env.PLAYTEST_ORIGIN || '',
      expiresAt = Number(env.PLAYTEST_EXPIRES_AT);
    if (
      !production ||
      !/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(origin) ||
      !/[a-z]/i.test(new URL(origin).hostname)
    )
      throw new Error('联机测试必须使用正式Cookie和明确的HTTPS来源');
    if (
      !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(env.PLAYTEST_PASSWORD_HASH || '') ||
      !/^[a-f0-9]{64}$/.test(env.PLAYTEST_GATE_SECRET || '')
    )
      throw new Error('联机测试入口凭证缺失或无效');
    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() ||
      expiresAt > Date.now() + 4 * 3600000 + 60000
    )
      throw new Error('联机测试有效期必须在四小时以内');
    if (
      env.HOST !== '127.0.0.1' ||
      Number(env.PORT) !== 3191 ||
      !env.DATABASE_PATH ||
      resolve(env.DATABASE_PATH) === resolve('./data/app.sqlite')
    )
      throw new Error('联机测试必须使用独立端口和数据库');
    if (env.APP_ORIGINS !== origin)
      throw new Error('联机测试来源必须精确匹配入口');
    playtest = {
      origin,
      expiresAt,
      passwordHash: env.PLAYTEST_PASSWORD_HASH!,
      gateSecret: env.PLAYTEST_GATE_SECRET!,
    };
  }
  const sessionSecret =
    env.SESSION_SECRET || (production ? '' : randomBytes(32).toString('hex'));
  if (!/^[a-f0-9]{64}$/i.test(sessionSecret))
    throw new Error('SESSION_SECRET 必须是 32 字节十六进制值（64 个字符）');
  if (
    production &&
    !playtest &&
    (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32)
  )
    throw new Error('生产环境 ADMIN_TOKEN 至少 32 个字符');
  const origins = (
    env.APP_ORIGINS ||
    'http://127.0.0.1:5190,http://localhost:5190,http://127.0.0.1:3190,http://localhost:3190'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (production && origins.some((o) => !o.startsWith('https://')))
    throw new Error('生产环境 APP_ORIGINS 必须使用 HTTPS');
  if (
    !origins.length ||
    origins.some((origin) => {
      try {
        const url = new URL(origin);
        return (
          !['http:', 'https:'].includes(url.protocol) || url.origin !== origin
        );
      } catch {
        return true;
      }
    })
  )
    throw new Error('APP_ORIGINS 必须是完整、无路径的来源列表');
  const port = Number(env.PORT || 3190);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT 必须在 1–65535 之间');
  if (
    !localOnly &&
    Boolean(env.QQMUSIC_APP_ID) !== Boolean(env.QQMUSIC_APP_KEY)
  )
    throw new Error('QQ 音乐应用凭据必须成对配置');
  return {
    localOnly,
    production,
    playtest,
    clientRoot: env.CLIENT_ROOT,
    host: env.HOST || '127.0.0.1',
    port,
    origins,
    database: resolve(env.DATABASE_PATH || './data/app.sqlite'),
    fixtures:
      env.ENABLE_FIXTURES === 'true' ||
      (!production && env.ENABLE_FIXTURES !== 'false'),
    // 人机练习是产品功能，不是测试数据：独立开关，默认开启。
    practice: env.ENABLE_PRACTICE !== 'false',
    adminToken: playtest ? '' : env.ADMIN_TOKEN || '',
    sessionSecret,
    trustProxy: env.TRUST_PROXY === 'true',
    qqAppId: localOnly ? '' : env.QQMUSIC_APP_ID || '',
    qqAppKey: localOnly ? '' : env.QQMUSIC_APP_KEY || '',
    qqPackage: env.QQMUSIC_PACKAGE_NAME || '',
    // H5 授权页的 packageName 官方不校验，可以随便填；与扫码用的包名分开，
    // 免得为了 H5 填一个假包名反而影响已验证可用的扫码链路。
    qqH5Package: env.QQMUSIC_H5_PACKAGE_NAME || 'com.hiddentrack.app',
    qqWebLogin: env.QQMUSIC_H5_LOGIN === 'true',
    qqTestIp: env.QQMUSIC_TEST_CLIENT_IP || '',
    qqPublicMetadata: env.QQMUSIC_PUBLIC_METADATA === 'true',
    qqPublicLyrics: env.QQMUSIC_PUBLIC_LYRICS === 'true',
  };
}
