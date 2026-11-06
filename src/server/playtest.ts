import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
export interface PlaytestConfig {
  origin: string;
  passwordHash: string;
  gateSecret: string;
  expiresAt: number;
}
export const GATE_COOKIE = "__Host-music_test";
export function hashTestPassword(
  password: string,
  salt = randomBytes(16).toString("hex"),
): string {
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}
const equal = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return (
    left.length === right.length &&
    left.length > 0 &&
    timingSafeEqual(left, right)
  );
};
export function issueGateCookie(config: PlaytestConfig) {
  const body = `${config.expiresAt}.${randomBytes(18).toString("base64url")}`;
  return `${body}.${createHmac("sha256", config.gateSecret).update(`${config.origin}|${body}`).digest("base64url")}`;
}
export function validGateCookie(
  config: PlaytestConfig,
  token: string | undefined,
): boolean {
  if (!token || token.length > 200 || Date.now() >= config.expiresAt)
    return false;
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== String(config.expiresAt) ||
    !/^[A-Za-z0-9_-]{24}$/.test(parts[1]!)
  )
    return false;
  const signature = createHmac("sha256", config.gateSecret)
    .update(`${config.origin}|${parts[0]}.${parts[1]}`)
    .digest("base64url");
  return equal(parts[2]!, signature);
}
function entryPage(nonce: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>底牌音乐 · 队友测试</title><style>body{margin:0;background:#eef1ed;color:#22342e;font:16px/1.6 system-ui,"Microsoft YaHei",sans-serif;display:grid;place-items:center;min-height:100dvh}main{background:#fff;max-width:360px;margin:24px;padding:32px;border:1px solid #d0dbd0;border-radius:12px}h1{font-size:25px}label,input,button{display:block;box-sizing:border-box;width:100%}input,button{font:inherit;border-radius:6px;padding:12px;margin-top:8px;border:1px solid #b5c8b7}button{margin-top:20px;background:#285d47;color:white;cursor:pointer}small{color:#526554}input:focus,button:focus{outline:3px solid #cca55b}#message{min-height:24px;color:#9b3434}</style></head><body><main><h1>乐友测试入口</h1><p>输入本次测试口令，进入双人对战。</p><form id="entry" method="post" action="/test-login"><label>测试口令<input id="password" name="password" type="password" autocomplete="current-password" required maxlength="128"></label><button id="submit">进入测试</button></form><p id="message" role="status"></p><small>无需登录 QQ 音乐即可对战。请只向队友分享本次入口与口令。</small></main><script nonce="${nonce}">document.getElementById('entry').addEventListener('submit',async e=>{e.preventDefault();const input=document.getElementById('password'),button=document.getElementById('submit'),message=document.getElementById('message');button.disabled=true;message.textContent='正在验证…';try{const response=await fetch('/test-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:input.value}),credentials:'same-origin'});input.value='';const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'暂时无法进入测试');location.reload()}catch(error){message.textContent=error.message;button.disabled=false}});</script></body></html>`;
}
/** Registered on the root instance, before app sessions and all HTTP/WS routes. */
export function registerPlaytestGate(
  app: FastifyInstance,
  config: PlaytestConfig,
) {
  const host = new URL(config.origin).host;
  const revoked = new Set<string>();
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
  };
  const originAllowed = (r: FastifyRequest) =>
    r.headers.origin === config.origin;
  app.addHook("onRequest", async (request, reply) => {
    reply
      .header("Cache-Control", "private, no-store")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY")
      .header("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (Date.now() >= config.expiresAt)
      return reply
        .code(410)
        .send({
          error: {
            code: "PLAYTEST_EXPIRED",
            message: "本次测试已结束，请向房主获取新的入口",
          },
        });
    // Ignore Forwarded/X-Forwarded-Host: this instance accepts one exact public host only.
    if (request.headers.host !== host)
      return reply
        .code(421)
        .send({
          error: {
            code: "HOST_DENIED",
            message: "请使用本次测试的 HTTPS 地址",
          },
        });
    let path: string;
    try {
      path = decodeURIComponent(request.url.split("?")[0]!).replace(
        /\/{2,}/g,
        "/",
      );
    } catch {
      return reply
        .code(400)
        .send({ error: { code: "INVALID_PATH", message: "路径无效" } });
    }
    if (
      /^\/(?:lab(?:\/|$)|api\/(?:admin(?:\/|$)|music\/inspect(?:\/|$))|(?:\.env|data|artifacts|src|deploy)(?:[/.]|$))/.test(
        path,
      ) ||
      path.endsWith(".map")
    )
      return reply
        .code(404)
        .send({ error: { code: "NOT_FOUND", message: "路径不存在" } });
    if (path === "/test-login" && request.method === "POST") return;
    const token = request.cookies[GATE_COOKIE];
    if (validGateCookie(config, token) && !revoked.has(token!)) return;
    if (
      request.method === "GET" &&
      !path.startsWith("/api/") &&
      !request.headers.upgrade
    ) {
      const nonce = randomBytes(18).toString("base64url");
      return reply
        .code(401)
        .header(
          "Content-Security-Policy",
          `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
        )
        .type("text/html; charset=utf-8")
        .send(entryPage(nonce));
    }
    return reply
      .code(401)
      .send({
        error: {
          code: "PLAYTEST_LOGIN_REQUIRED",
          message: "请先输入本次测试口令",
        },
      });
  });
  app.post(
    "/test-login",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      bodyLimit: 1024,
    },
    async (request, reply) => {
      if (!originAllowed(request))
        return reply
          .code(403)
          .send({
            error: { code: "ORIGIN_DENIED", message: "请求来源不合法" },
          });
      const password = (request.body as { password?: unknown } | null)
        ?.password;
      if (
        typeof password !== "string" ||
        password.length < 1 ||
        password.length > 128
      )
        return reply
          .code(400)
          .send({
            error: { code: "INVALID_INPUT", message: "请输入测试口令" },
          });
      const [salt, expected] = config.passwordHash.split(":");
      const actual = scryptSync(password, salt!, 32).toString("hex");
      if (!equal(actual, expected!))
        return reply
          .code(401)
          .send({
            error: { code: "WRONG_TEST_PASSWORD", message: "测试口令不正确" },
          });
      reply.setCookie(GATE_COOKIE, issueGateCookie(config), {
        ...cookieOptions,
        maxAge: Math.max(1, Math.floor((config.expiresAt - Date.now()) / 1000)),
      });
      return { ok: true };
    },
  );
  app.get("/test-login", (_request, reply) => reply.redirect("/"));
  app.post("/test-logout", async (request, reply) => {
    if (!originAllowed(request))
      return reply
        .code(403)
        .send({ error: { code: "ORIGIN_DENIED", message: "请求来源不合法" } });
    const token = request.cookies[GATE_COOKIE];
    if (token) revoked.add(token);
    reply.clearCookie(GATE_COOKIE, cookieOptions);
    return { ok: true };
  });
  // Existing websocket connections must also end at the fixed deadline.
  const timer = setTimeout(
    () => {
      void app.close();
    },
    Math.max(1, config.expiresAt - Date.now()),
  );
  timer.unref();
  app.addHook("onClose", async () => {
    clearTimeout(timer);
  });
}
