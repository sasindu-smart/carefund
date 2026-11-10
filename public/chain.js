// Testnet backend: reads the deployed contract over RPC, writes through the user's own NEAR wallet.
// No private key ever touches this page or the server.
export function createChain(cfg) {
  const view = async (method, args = {}) => {
    const r = await fetch(cfg.rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "cf", method: "query", params: {
        request_type: "call_function", finality: "optimistic", account_id: cfg.contractId,
        method_name: method, args_base64: btoa(JSON.stringify(args)),
      } }),
    });
    const j = await r.json();
    if (j.error || j.result?.error) throw new Error(j.result?.error || j.error?.data || j.error?.message || "RPC error");
    return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
  };
  let owner = null, verifiers = {};
  return {
    mode: "chain",
    ready: async () => {
      await window.Wallet.init(cfg);
      try { const c = await view("get_config"); owner = c.owner; verifiers = await view("get_verifiers"); } catch (e) { console.warn(e); }
    },
    account: () => window.Wallet.state().account,
    owner: () => owner,
    now: () => BigInt(Date.now()) * 1_000_000n,
    verifiers: async (force) => (force || !Object.keys(verifiers).length ? (verifiers = await view("get_verifiers")) : verifiers),
    providers: () => view("get_providers"),
    aiRules: () => view("get_ai_rules"),
    audit: (f = {}) => view("get_audit", { limit: 100, ...f }),
    vstats: (a) => view("get_verifier_stats", { account: a }),
    categories: () => ["cancer", "surgery", "dialysis", "accident", "child-care", "medicine", "rehabilitation", "mental-health", "equipment", "free-treatment", "disaster", "education", "small-business", "farming", "other"],
    list: (filter = {}) => view("list_cases", { limit: 100, ...filter }),
    get: (id) => view("get_case", { id }),
    acct: async (id, a) => ((a || window.Wallet.state().account) ? view("get_account_view", { id, account: a || window.Wallet.state().account }) : null),
    rep: (a) => view("get_reputation", { account: a || window.Wallet.state().account || "" }),
    call: async (method, args = {}, deposit = 0n) => {
      if (!window.Wallet.state().account) throw new Error("Connect your wallet first");
      const hash = await window.Wallet.sign(method, args, String(deposit));
      return { result: null, hash };
    },
  };
}
