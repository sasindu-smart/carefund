import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { handler } from "../server.js";

const get = (port, path) => new Promise((resolve, reject) => {
  http.get({ port, path }, (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ status: res.statusCode, body: b, type: res.headers["content-type"] })); }).on("error", reject);
});

test("server serves the page, the shared rules module, config and refuses path escapes", async () => {
  const srv = http.createServer(handler).listen(0);
  const port = srv.address().port;
  try {
    const home = await get(port, "/");
    assert.equal(home.status, 200); assert.match(home.body, /Help that reaches the/); assert.match(home.body, /href="\/app"/);
    const app = await get(port, "/app");
    assert.equal(app.status, 200); assert.match(app.body, /id="main"/);
    const core = await get(port, "/core/fund-core.js");
    assert.equal(core.status, 200); assert.match(core.body, /export function createCase/);
    const cfg = await get(port, "/config.js");
    assert.match(cfg.body, /"mode":"demo"/);
    assert.equal((await get(port, "/healthz")).status, 200);
    assert.equal((await get(port, "/nope")).status, 404);
    assert.notEqual((await get(port, "/..%2f..%2fpackage.json")).status, 200);
  } finally { srv.close(); }
});
