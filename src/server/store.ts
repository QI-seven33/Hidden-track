import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface QQAuth {
  provider?: 'embedded-qq';
  credential?: Record<string, unknown>;
  openId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}
export class Store {
  readonly db: DatabaseSync;
  private key: Buffer;
  private statements = new Map<string, StatementSync>();
  private statement(sql: string) {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }
  hasRoom(id: string): boolean {
    return Boolean(
      this.statement('SELECT 1 FROM rooms WHERE id=? AND expires>?').get(
        id,
        Date.now(),
      ),
    );
  }
  constructor(path: string, secret: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.key = Buffer.from(secret, 'hex');
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, expires INTEGER NOT NULL, auth TEXT, nickname TEXT, avatar TEXT);
      CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS rooms_expiry ON rooms(expires);
      CREATE UNIQUE INDEX IF NOT EXISTS rooms_join_code ON rooms(json_extract(data, '$.joinCode')) WHERE json_extract(data, '$.joinCode') IS NOT NULL;
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
      CREATE TABLE IF NOT EXISTS web_auth_flows (session TEXT PRIMARY KEY, state TEXT NOT NULL, expires INTEGER NOT NULL, return_path TEXT NOT NULL, deferred_code TEXT, return_client TEXT);
      CREATE TABLE IF NOT EXISTS probes (id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER NOT NULL, data TEXT NOT NULL);`);
    const authColumns = this.statement(
      'PRAGMA table_info(web_auth_flows)',
    ).all() as { name: string }[];
    if (!authColumns.some((column) => column.name === 'deferred_code'))
      this.db.exec('ALTER TABLE web_auth_flows ADD COLUMN deferred_code TEXT');
    if (!authColumns.some((column) => column.name === 'return_client'))
      this.db.exec('ALTER TABLE web_auth_flows ADD COLUMN return_client TEXT');
    // 旧库补列：QQ 昵称与头像只在授权后写入，缺失时按空处理。
    const columns = this.statement('PRAGMA table_info(sessions)').all() as {
      name: string;
    }[];
    for (const column of ['nickname', 'avatar'])
      if (!columns.some((c) => c.name === column))
        this.db.exec(`ALTER TABLE sessions ADD COLUMN ${column} TEXT`);
  }
  getSession(id: string):
    | {
        id: string;
        name: string;
        expires: number;
        nickname?: string;
        avatar?: string;
      }
    | undefined {
    return this.statement(
      'SELECT id,name,expires,nickname,avatar FROM sessions WHERE id=? AND expires>?',
    ).get(id, Date.now()) as ReturnType<Store['getSession']>;
  }
  createSession(id: string, name: string) {
    this.statement('INSERT INTO sessions (id,name,expires) VALUES (?,?,?)').run(
      id,
      name,
      Date.now() + 7 * 86400000,
    );
  }
  setName(id: string, name: string) {
    this.statement('UPDATE sessions SET name=? WHERE id=?').run(name, id);
  }
  setProfile(id: string, nickname?: string, avatar?: string) {
    this.statement('UPDATE sessions SET nickname=?, avatar=? WHERE id=?').run(
      nickname || null,
      avatar || null,
      id,
    );
  }
  setAuth(id: string, auth: QQAuth | null) {
    let value: string | null = null;
    if (auth) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.key, iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(auth), 'utf8'),
        cipher.final(),
      ]);
      value = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
        'base64',
      );
    }
    this.statement('UPDATE sessions SET auth=? WHERE id=?').run(value, id);
  }
  getAuth(id: string): QQAuth | undefined {
    const row = this.statement('SELECT auth FROM sessions WHERE id=?').get(
      id,
    ) as { auth: string } | undefined;
    if (!row?.auth) return;
    try {
      const bytes = Buffer.from(row.auth, 'base64');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        bytes.subarray(0, 12),
      );
      decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString(),
      ) as QQAuth;
    } catch {
      return undefined;
    }
  }
  setWebAuthFlow(
    session: string,
    state: string,
    expires: number,
    returnPath: string,
    returnClient = '',
  ) {
    this.statement(
      'INSERT INTO web_auth_flows(session,state,expires,return_path,deferred_code,return_client) VALUES (?,?,?,?,NULL,?) ON CONFLICT(session) DO UPDATE SET state=excluded.state, expires=excluded.expires, return_path=excluded.return_path, deferred_code=NULL, return_client=excluded.return_client',
    ).run(session, state, expires, returnPath, returnClient);
  }
  getWebAuthFlow(session: string) {
    return this.statement(
      'SELECT state,expires,return_path AS returnPath, return_client AS returnClient FROM web_auth_flows WHERE session=? AND expires>?',
    ).get(session, Date.now()) as
      | {
          state: string;
          expires: number;
          returnPath: string;
          returnClient?: string;
        }
      | undefined;
  }
  webAuthReturnClient(state: string): string | undefined {
    return (
      this.statement(
        'SELECT return_client FROM web_auth_flows WHERE state=? AND expires>?',
      ).get(state, Date.now()) as { return_client?: string } | undefined
    )?.return_client;
  }
  deferWebAuthCode(state: string, code: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(code, 'utf8'),
      cipher.final(),
    ]);
    const sealed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      'base64',
    );
    return (
      Number(
        this.statement(
          'UPDATE web_auth_flows SET deferred_code=COALESCE(deferred_code,?) WHERE state=? AND expires>?',
        ).run(sealed, state, Date.now()).changes,
      ) > 0
    );
  }
  deferredWebAuthCode(session: string): string | undefined {
    const row = this.statement(
      'SELECT deferred_code FROM web_auth_flows WHERE session=? AND expires>?',
    ).get(session, Date.now()) as { deferred_code?: string } | undefined;
    if (!row?.deferred_code) return;
    try {
      const bytes = Buffer.from(row.deferred_code, 'base64'),
        decipher = createDecipheriv(
          'aes-256-gcm',
          this.key,
          bytes.subarray(0, 12),
        );
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString();
    } catch {
      return;
    }
  }
  hasWebAuthState(state: string) {
    return Boolean(
      this.statement(
        'SELECT 1 FROM web_auth_flows WHERE state=? AND expires>?',
      ).get(state, Date.now()),
    );
  }
  deleteWebAuthFlow(session: string) {
    this.statement('DELETE FROM web_auth_flows WHERE session=?').run(session);
  }
  saveRoom(id: string, data: unknown, expires: number) {
    this.statement(
      'INSERT INTO rooms VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires=excluded.expires',
    ).run(id, JSON.stringify(data), expires);
  }
  getRoom<T>(id: string): T | undefined {
    const row = this.statement(
      'SELECT data FROM rooms WHERE id=? AND expires>?',
    ).get(id, Date.now()) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }
  getRoomByCode<T>(code: string, includeExpired = false): T | undefined {
    const row = this.statement(
      "SELECT data FROM rooms WHERE json_extract(data, '$.joinCode')=? AND expires>?",
    ).get(code, includeExpired ? 0 : Date.now()) as
      { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }
  saveProbe(data: unknown) {
    this.statement('INSERT INTO probes(created,data) VALUES (?,?)').run(
      Date.now(),
      JSON.stringify(data),
    );
    this.db.exec(
      'DELETE FROM probes WHERE id NOT IN (SELECT id FROM probes ORDER BY id DESC LIMIT 100)',
    );
  }
  probes(): unknown[] {
    return (
      this.statement(
        'SELECT created,data FROM probes ORDER BY id DESC LIMIT 20',
      ).all() as { created: number; data: string }[]
    ).map((r) => ({ created: r.created, result: JSON.parse(r.data) }));
  }
  prune() {
    this.statement('DELETE FROM rooms WHERE expires<?').run(Date.now());
    this.statement('DELETE FROM sessions WHERE expires<?').run(Date.now());
    this.statement(
      'DELETE FROM web_auth_flows WHERE expires<? OR session NOT IN (SELECT id FROM sessions)',
    ).run(Date.now());
  }
  close() {
    this.db.close();
  }
}
