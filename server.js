// CareFund web server. Zero dependencies: it serves the static page, the contract's rules
// module (so the browser demo runs the exact same rules as the on-chain contract) and a
// small /config.js.
//
//   no CONTRACT_ID  -> demo mode: everything runs in the browser, no wallet, no money
//   CONTRACT_ID set -> testnet mode: reads the contract over RPC, writes through a NEAR wallet

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const network = process.env.NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
const contractId = (process.env.CONTRACT_ID || "").trim();
const cfg = {
  mode: contractId ? "chain" : "demo",
  contractId,
  network,
  rpc: process.env.NEAR_RPC || (network === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org"),
};

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain; charset=utf-8" };
const FILES = {
  "/core/fund-core.js": path.join(root, "contract/src/fund-core.js"),
};

export function handler(req, res) {
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
