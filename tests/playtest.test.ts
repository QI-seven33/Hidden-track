import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { makeApp } from "../src/server/app";
import { loadConfig } from "../src/server/config";
import {
  hashTestPassword,
  GATE_COOKIE,
  issueGateCookie,
  validGateCookie,
  type PlaytestConfig,
} from "../src/server/playtest";
import { testConfig } from "./helpers";
const origin = "https://playtest.example.com",
  host = "playtest.example.com",
  password = "test-password-for-team-only";
const gate = (): PlaytestConfig => ({
  origin,
  passwordHash: hashTestPassword(password),
  gateSecret: "ab".repeat(32),
  expiresAt: Date.now() + 3600000,
});
const config = (playtest = gate()) =>
  testConfig({
    production: true,
    origins: [origin],
    playtest,
    trustProxy: true,
  });
const headers = (playtest: PlaytestConfig) => ({
  host,
  origin,
  cookie: `${GATE_COOKIE}=${issueGateCookie(playtest)}`,
});

test("playtest configuration fails closed for shared DB, wrong port/host, HTTP, origin mismatch or missing credentials", () => {
  const g = gate();
  const env = {
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "3191",
    DATABASE_PATH: "./artifacts/playtest/unit/app.sqlite",
    SESSION_SECRET: "11".repeat(32),
    APP_ORIGINS: origin,
    PLAYTEST_MODE: "true",
    PLAYTEST_ORIGIN: origin,
    PLAYTEST_PASSWORD_HASH: g.passwordHash,
    PLAYTEST_GATE_SECRET: g.gateSecret,
    PLAYTEST_EXPIRES_AT: String(g.expiresAt),
  };
  assert.equal(loadConfig(env).playtest?.origin, origin);
  assert.equal(loadConfig(env).adminToken, "");
  for (const extra of [
    { HOST: "0.0.0.0" },
    { PORT: "3190" },
    { DATABASE_PATH: "./data/app.sqlite" },
    { PLAYTEST_PASSWORD_HASH: "" },
    { PLAYTEST_GATE_SECRET: "" },
    { PLAYTEST_ORIGIN: "http://playtest.example.com" },
    { APP_ORIGINS: "*" },
    { PLAYTEST_EXPIRES_AT: String(Date.now() + 5 * 3600000) },
    { PLAYTEST_EXPIRES_AT: "0" },
  ])
    assert.throws(() => loadConfig({ ...env, ...extra }));
});
test("gate protects pages, health, metadata and API before creating any guest or game session", async () => {
  const { app, store } = await makeApp({ config: config() });
  try {
    const page = await app.inject({ url: "/r/secret-room", headers: { host } });
    assert.equal(page.statusCode, 401);
    assert.match(page.body, /输入本次测试口令/);
    assert.ok(page.headers["content-security-policy"]);
    assert.match(String(page.headers["cache-control"]), /no-store/);
    assert.ok(!page.body.includes(password));
    for (const url of ["/api/health", "/api/meta", "/api/session"]) {
      const r = await app.inject({ url, headers: { host } });
      assert.equal(r.statusCode, 401);
      assert.equal(r.headers["set-cookie"], undefined);
    }
    const rows = store.db
      .prepare("SELECT COUNT(*) AS count FROM sessions")
      .get() as { count: number };
    assert.equal(rows.count, 0);
  } finally {
    await app.close();
  }
});
test("valid login issues an HTTPS-only host cookie without echoing the password; invalid origin/password is denied", async () => {
  const g = gate(),
    { app } = await makeApp({ config: config(g) });
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/test-login",
          headers: { host, origin: "https://evil.test" },
          payload: { password },
        })
      ).statusCode,
      403,
    );
    const bad = await app.inject({
      method: "POST",
      url: "/test-login",
      headers: { host, origin },
      payload: { password: "wrong" },
    });
    assert.equal(bad.statusCode, 401);
    assert.equal(bad.headers["set-cookie"], undefined);
    const ok = await app.inject({
      method: "POST",
      url: "/test-login",
      headers: { host, origin },
      payload: { password },
    });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.json(), { ok: true });
    assert.ok(!ok.body.includes(password));
    const set = String(ok.headers["set-cookie"]);
    assert.ok(set.startsWith(GATE_COOKIE + "="));
    for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"])
      assert.ok(set.includes(flag));
    assert.ok(!set.includes("Domain="));
    const meta = await app.inject({
      url: "/api/meta",
      headers: { host, cookie: set.split(";")[0]! },
    });
    assert.equal(meta.statusCode, 200);
    assert.equal(meta.json().playtest, true);
    assert.deepEqual(meta.json().capabilities, []);
  } finally {
    await app.close();
  }
});
test("gate cookies reject tampering, expiration, wrong signing keys and different public origins", () => {
  const g = gate(),
    token = issueGateCookie(g);
  assert.equal(validGateCookie(g, token), true);
  for (const tokenValue of [
    undefined,
    "",
    token + "x",
    token.replace(/^\d/, "0"),
    "x".repeat(300),
  ])
    assert.equal(validGateCookie(g, tokenValue), false);
  assert.equal(
    validGateCookie({ ...g, gateSecret: "cd".repeat(32) }, token),
    false,
  );
  assert.equal(
    validGateCookie({ ...g, origin: "https://other.example.com" }, token),
    false,
  );
  assert.equal(
    validGateCookie({ ...g, expiresAt: Date.now() - 1 }, token),
    false,
  );
});
test("test mode hides admin/inspection/static private paths even for authenticated visitors", async () => {
  const g = gate(),
    { app } = await makeApp({ config: config(g) });
  try {
    for (const url of [
      "/lab",
      "/api/admin/status",
      "/api/admin/probe",
      "/%61pi/admin/status",
      "/api//admin/status",
      "/api/music/inspect",
      "/.env",
      "/data/app.sqlite",
      "/artifacts/playtest/current.json",
      "/src/server/config.ts",
      "/assets/client.js.map",
    ]) {
      const r = await app.inject({
        url,
        headers: {
          ...headers(g),
          authorization: "Bearer test-admin-token-abcdefghijklmnopqrstuvwxyz",
        },
      });
      assert.equal(r.statusCode, 404, url);
      assert.ok(!r.body.includes("test-admin-token"));
    }
  } finally {
    await app.close();
  }
});
test("public host and API Origin must match, regardless of forwarded Host tricks", async () => {
  const g = gate(),
    { app } = await makeApp({ config: config(g) });
  try {
    assert.equal(
      (
        await app.inject({
          url: "/api/session",
          headers: {
            ...headers(g),
            host: "other.test",
            "x-forwarded-host": host,
          },
        })
      ).statusCode,
      421,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/session",
          headers: { ...headers(g), origin: "https://evil.test" },
          payload: { name: "甲" },
        })
      ).statusCode,
      403,
    );
    const r = await app.inject({ url: "/api/session", headers: headers(g) });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().qqAuthorized, false);
    assert.match(String(r.headers["set-cookie"]), /Secure/);
  } finally {
    await app.close();
  }
});
test("failed test logins have a bounded attempt rate", async () => {
  const { app } = await makeApp({ config: config() });
  try {
    for (let i = 0; i < 5; i++)
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/test-login",
            headers: { host, origin },
            payload: { password: "bad" },
          })
        ).statusCode,
        401,
      );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/test-login",
          headers: { host, origin },
          payload: { password },
        })
      ).statusCode,
      429,
    );
  } finally {
    await app.close();
  }
});
test("logout revokes the presented gate token and expired test windows do not accept sessions", async () => {
  const g = gate(),
    { app } = await makeApp({ config: config(g) });
  try {
    const h = headers(g);
    assert.equal(
      (await app.inject({ method: "POST", url: "/test-logout", headers: h }))
        .statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: "/api/health", headers: h })).statusCode,
      401,
    );
    g.expiresAt = Date.now() - 1;
    assert.equal(
      (await app.inject({ url: "/api/health", headers: headers(g) }))
        .statusCode,
      410,
    );
  } finally {
    await app.close();
  }
});
test("real websocket handshake requires both gate authorization and room membership", async () => {
  const g = gate(),
    { app } = await makeApp({ config: config(g) });
  let ws: WebSocket | undefined;
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const base = `ws://127.0.0.1:${address.port}`;
    const rejected = async (cookie?: string) => {
      const socket = new WebSocket(base + "/api/rooms/missing/socket", {
        origin,
        headers: { host, ...(cookie ? { cookie } : {}) },
      });
      socket.on("error", () => {});
      const [, response] = await once(socket, "unexpected-response");
      response.resume();
      socket.terminate();
      return response.statusCode;
    };
    assert.equal(await rejected(), 401);
    assert.equal(await rejected(headers(g).cookie), 404);
    const h = headers(g),
      session = await app.inject({ url: "/api/session", headers: h });
    h.cookie += "; " + String(session.headers["set-cookie"]).split(";")[0];
    const room = (
      await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers: h,
        payload: { mode: "fixture", bot: false },
      })
    ).json().room;
    ws = new WebSocket(base + `/api/rooms/${room.id}/socket`, {
      origin,
      headers: h,
    });
    const message = once(ws, "message");
    await once(ws, "open");
    assert.equal(JSON.parse(String((await message)[0])).room.me, "a");
  } finally {
    ws?.terminate();
    await app.close();
  }
});
test("an anonymous guest cannot select a song lacking the required official preview", async () => {
  const commands: string[] = [];
  const g = gate();
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    commands.push(url.searchParams.get("opi_cmd") || "");
    assert.equal(url.searchParams.get("login_type"), null);
    return new Response(
      JSON.stringify({
        ret: 0,
        songlist: [
          {
            song_id: 10,
            song_mid: "paidmid",
            song_name: "测试数字专辑歌曲",
            singer_name: "测试歌手",
            playable: 0,
            unplayable_msg: "未购买",
            language: "国语",
            genre: "Pop 流行",
          },
        ],
      }),
    );
  };
  const { app } = await makeApp({
    config: { ...config(g), qqAppId: "test-app", qqAppKey: "test-key" },
    fetch: fetcher,
  });
  try {
    const h = headers(g),
      session = await app.inject({ url: "/api/session", headers: h });
    assert.equal(session.json().qqAuthorized, false);
    h.cookie += "; " + String(session.headers["set-cookie"]).split(";")[0];
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers: h,
        payload: { mode: "qq" },
      })
    ).json();
    const selected = await app.inject({
      method: "POST",
      url: `/api/rooms/${created.room.id}/song`,
      headers: h,
      payload: { songId: "qq:paidmid", version: 0 },
    });
    assert.equal(selected.statusCode, 403);
    assert.equal(selected.json().error.code, "PREVIEW_REQUIRED");
    assert.ok(
      commands.every((c) =>
        [
          "fcg_music_custom_get_song_info_batch.fcg",
          "fcg_music_custom_get_lyric.fcg",
        ].includes(c),
      ),
    );
  } finally {
    await app.close();
  }
});
