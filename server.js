// CareFund web server. Zero dependencies: it serves the static page, the contract's rules
// module (so the browser demo runs the exact same rules as the on-chain contract) and a
// small /config.js.
//
//   no CONTRACT_ID  -> demo mode: everything runs in the browser, no wallet, no money
//   NEARAI_API_KEY  -> /api/precheck asks NEAR AI Cloud; without it written checks are used
//   CONTRACT_ID set -> testnet mode: reads the contract over RPC, writes through a NEAR wallet

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { precheck } from "./ai.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const network = process.env.NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
const contractId = (process.env.CONTRACT_ID || "").trim();
const cfg = {
  mode: contractId ? "chain" : "demo",
  contractId,
  network,
  rpc: process.env.NEAR_RPC || (network === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com"),
};

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain; charset=utf-8" };
const FILES = {
  "/core/fund-core.js": path.join(root, "contract/src/fund-core.js"),
};

// Small per-address limit so a public demo cannot burn the API key.
const hits = new Map();
const limited = (ip) => { const now = Date.now(); const a = (hits.get(ip) || []).filter((t) => now - t < 3600e3); a.push(now); hits.set(ip, a); return a.length > 30; };

function api(req, res) {
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
  if (req.method !== "POST") return send(405, { error: "POST only" });
  if (limited(req.socket.remoteAddress || "x")) return send(429, { error: "Too many checks, try again later" });
  let body = "";
  req.on("data", (d) => { body += d; if (body.length > 20000) req.destroy(); });
  req.on("end", async () => {
    try { send(200, await precheck(JSON.parse(body || "{}"))); }
    catch (e) { send(400, { error: "Bad request" }); }
  });
}

export function handler(req, res) {
  if (new URL(req.url, "http://x").pathname === "/api/precheck") return api(req, res);
  const url = new URL(req.url, "http://x");
  let p = decodeURIComponent(url.pathname);
  if (p === "/config.js") {
    res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
    return res.end("window.CAREFUND = " + JSON.stringify(cfg) + ";");
  }
  if (p === "/healthz") { res.writeHead(200); return res.end("ok"); }
  if (p === "/") p = "/landing.html";
  if (p === "/app") p = "/app.html";
  let file = FILES[p];
  if (!file) {
    file = path.join(root, "public", p);
    if (!file.startsWith(path.join(root, "public") + path.sep)) { res.writeHead(403); return res.end("Forbidden"); }
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(buf);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  http.createServer(handler).listen(PORT, () => {
    console.log(`CareFund running on http://localhost:${PORT}  (${cfg.mode} mode)`);
  });
}
