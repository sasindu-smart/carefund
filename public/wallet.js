// NEAR wallet connection (NEAR Wallet Selector from esm.sh), same approach as the Allowance dashboard.
// The person signs every action in their own wallet. No private key ever touches this app.
const V = "8.10.0";
// One near-api-js copy for every wallet package, otherwise signing can fail with
// "Class e is missing in schema: publicKey". Try another with ?napi=5.1.1
let NAPI = "4.0.3";
try { NAPI = new URLSearchParams(location.search).get("napi") || NAPI; } catch {}
const DEPS = `?deps=near-api-js@${NAPI}`;
const CORE = `https://esm.sh/@near-wallet-selector/core@${V}${DEPS}`;
const mod = (name) => `https://esm.sh/@near-wallet-selector/${name}@${V}${DEPS}`;
const WALLETS = [
  { id: "meteor-wallet", label: "Meteor Wallet", note: "Popup. Tested on testnet.", pkg: mod("meteor-wallet"), fn: "setupMeteorWallet" },
  { id: "sender", label: "Sender", note: "Browser extension.", pkg: mod("sender"), fn: "setupSender" },
  { id: "nightly", label: "Nightly", note: "Browser extension.", pkg: mod("nightly"), fn: "setupNightly" },
  { id: "here-wallet", label: "HERE Wallet", note: "Mobile app or web.", pkg: mod("here-wallet"), fn: "setupHereWallet" },
  { id: "my-near-wallet", label: "MyNearWallet", note: "Redirects.", pkg: mod("my-near-wallet"), fn: "setupMyNearWallet" },
];
const METHODS = ["create_case", "cancel_case", "verify_case", "reject_case", "release_milestone", "withdraw_stake", "donate", "refund", "claim_repayment", "repay", "mark_default", "flag_case", "unfreeze", "add_verifier", "remove_verifier", "apply_provider", "approve_provider", "reject_provider", "confirm_fraud", "set_ai_rules", "attach_ai_check"];

let cfg = null, selector = null, loading = null;
const listeners = new Set();
const emit = () => listeners.forEach((f) => f(state()));
const active = () => { try { return selector?.store.getState().accounts.find((a) => a.active)?.accountId || null; } catch { return null; } };
const state = () => ({ ready: !!selector, account: active() });

async function load() {
  if (selector) return selector;
  if (loading) return loading;
  loading = (async () => {
    const { setupWalletSelector } = await import(CORE);
    const modules = [];
    const loaded = await Promise.allSettled(WALLETS.map((w) => Promise.race([import(w.pkg).then((m) => m[w.fn]()), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000))])));
    loaded.forEach((r, i) => { if (r.status === "fulfilled") { modules.push(r.value); WALLETS[i].ok = true; } else { WALLETS[i].ok = false; } });
    if (!modules.length) throw new Error("No wallet libraries could be loaded. Check your internet connection.");
    selector = await setupWalletSelector({ network: cfg.network, modules });
    selector.store.observable.subscribe(emit);
    return selector;
  })();
  try { return await loading; } finally { loading = null; }
}

window.Wallet = {
  options: () => WALLETS.filter((w) => w.ok !== false).map((w) => ({ id: w.id, label: w.label, note: w.note })),
  state,
  onChange: (f) => { listeners.add(f); return () => listeners.delete(f); },
  async init(config) { cfg = config; try { await load(); } catch (e) { console.warn(e); } emit(); return state(); },
  async connect(id) {
    await load();
    const wallet = await selector.wallet(id);
    await wallet.signIn({ contractId: cfg.contractId, methodNames: METHODS, accounts: [] });
    emit();
  },
  async disconnect() { if (!selector) return; try { await (await selector.wallet()).signOut(); } catch (e) { console.warn(e); } emit(); },
  async sign(methodName, args, deposit = "0") {
    await load();
    const wallet = await selector.wallet();
    const out = await wallet.signAndSendTransaction({
      receiverId: cfg.contractId,
      actions: [{ type: "FunctionCall", params: { methodName, args, gas: "100000000000000", deposit: String(deposit) } }],
    });
    return out?.transaction?.hash || out?.transaction_outcome?.id || null;
  },
};
