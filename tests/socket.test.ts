import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { makeApp } from "../src/server/app";
import { guest, ORIGIN, testConfig } from "./helpers";

test("live WebSocket handshake authenticates seats, pushes private views and rejects foreign origins", async () => {
  const { app } = await makeApp({ config: testConfig() });
  let socket: WebSocket | undefined;
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const a = await guest(app, "甲"),
      b = await guest(app, "乙");
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers: a,
        payload: { mode: "fixture" },
      })
    ).json();
    const id = created.room.id;
    await app.inject({
      method: "POST",
      url: `/api/rooms/${id}/join`,
      headers: b,
      payload: { invite: created.invite },
    });
    const wsUrl = address.replace("http:", "ws:") + `/api/rooms/${id}/socket`;
    socket = new WebSocket(wsUrl, {
      headers: { cookie: a.cookie, origin: ORIGIN },
    });
    const first = JSON.parse((await once(socket, "message"))[0].toString());
    assert.equal(first.type, "snapshot");
    assert.equal(first.room.me, "a");
    const update = once(socket, "message");
    await app.inject({
      method: "POST",
      url: `/api/rooms/${id}/song`,
      headers: b,
      payload: { songId: "coral", version: 1 },
    });
    const message = (await update)[0].toString();
    assert.ok(!message.includes("珊瑚海"));
    assert.ok(!message.includes("coral"));
    const rejected = new WebSocket(wsUrl, {
      headers: { cookie: b.cookie, origin: "https://foreign.test" },
    });
    const rejectedStatus = await new Promise<number>((resolve, reject) => {
      rejected.once("unexpected-response", (_req, response) => {
        response.resume();
        rejected.terminate();
        resolve(response.statusCode || 0);
      });
      rejected.once("error", () => {});
      setTimeout(() => {
        rejected.terminate();
        reject(new Error("handshake timeout"));
      }, 1500).unref();
    });
    assert.equal(rejectedStatus, 403);
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
      await once(socket, "close");
    }
    await app.close();
  }
});

test("room sockets bound duplicate tabs and server shutdown closes live connections", async () => {
  const { app } = await makeApp({ config: testConfig() });
  const sockets: WebSocket[] = [];
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const a = await guest(app, "甲");
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers: a,
        payload: { mode: "fixture" },
      })
    ).json();
    const url =
      address.replace("http:", "ws:") + `/api/rooms/${created.room.id}/socket`;
    for (let i = 0; i < 4; i++) {
      const socket = new WebSocket(url, {
        headers: { cookie: a.cookie, origin: ORIGIN },
      });
      sockets.push(socket);
      await once(socket, "message");
    }
    const rejected = new WebSocket(url, {
      headers: { cookie: a.cookie, origin: ORIGIN },
    });
    sockets.push(rejected);
    assert.equal((await once(rejected, "close"))[0], 1013);
    const closed = sockets.slice(0, 4).map((socket) => once(socket, "close"));
    await app.close();
    await Promise.all(closed);
  } finally {
    for (const socket of sockets) socket.terminate();
    await app.close();
  }
});
