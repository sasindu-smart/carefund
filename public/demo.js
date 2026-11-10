// Demo backend: runs the SAME rules module as the contract (/core/fund-core.js) inside the browser,
// with fictional accounts, fictional money and a clock you can move forward.
import * as F from "/core/fund-core.js";
const { NEAR, DAY_NS } = F;

const KEY = "carefund-demo-v1";
const n = (x) => BigInt(Math.round(x * 1000)) * (NEAR / 1000n);
const hash = (i) => "sha256-" + (BigInt(0x9e3779b97f4a7c15n) * BigInt(i + 7)).toString(16).padStart(16, "0").repeat(4).slice(0, 64);

export const OWNER = "owner.testnet";
export const VERIFIERS = {
  "stmarys-nairobi.testnet": "St. Mary's Hospital, Nairobi (example)",
  "clinic-dhaka.testnet": "Dhaka Community Clinic (example)",
  "coop-andes.testnet": "Andes Farmers' Co-op (example)",
  "ngo-manila.testnet": "Manila Relief NGO (example)",
};
export const ACCOUNTS = [
  { id: "alice.testnet", role: "Donor" }, { id: "carol.testnet", role: "Donor" }, { id: "dave.testnet", role: "Donor" },
  { id: "bob.testnet", role: "Asks for help" }, { id: "ana.testnet", role: "Asks for help" }, { id: "juan.testnet", role: "Borrower" },
  ...Object.entries(VERIFIERS).map(([id, name]) => ({ id, role: "Verifier · " + name.replace(" (example)", "") })),
  { id: "cancer-institute-colombo.testnet", role: "Provider · cancer hospital" },
  { id: "city-general-manila.testnet", role: "Hospital applying to register" },
  { id: OWNER, role: "Platform owner" },
];
const PEOPLE = ["alice", "carol", "dave", "erin", "frank", "bob", "ana", "juan", "mei", "lina"].map((x) => x + ".testnet");

export const METHODS = {
  apply_provider: F.applyProvider, approve_provider: F.approveProvider, reject_provider: F.rejectProvider,
  confirm_fraud: F.confirmFraud, add_verifier: F.addVerifier, remove_verifier: F.removeVerifier, unfreeze: F.unfreeze,
  create_case: F.createCase, cancel_case: F.cancelCase, verify_case: F.verifyCase, reject_case: F.rejectCase,
  release_milestone: F.releaseMilestone, withdraw_stake: F.withdrawStake, donate: F.donate, refund: F.refund,
  claim_repayment: F.claimRepayment, repay: F.repay, mark_default: F.markDefault, flag_case: F.flagCase,
  set_ai_rules: F.setAiRules, attach_ai_check: F.attachAiCheck,
};

function seed() {
  const s = F.newState(OWNER);
  const bal = {};
  [...PEOPLE, ...Object.keys(VERIFIERS), "cancer-institute-colombo.testnet", "city-general-manila.testnet", OWNER].forEach((a) => (bal[a] = String(n(1000))));
  const base = BigInt(Date.now()) * 1_000_000n - 50n * DAY_NS; // the story starts 50 days ago
  const at = (d) => base + BigInt(Math.round(d * 1000)) * (DAY_NS / 1000n);
  const run = (fn, caller, day, args, deposit = 0n) => {
    const out = F.exec(fn, s, { caller, now: at(day), deposit }, args);
    if (deposit) bal[caller] = String(BigInt(bal[caller]) - deposit);
    if (out.transfer) bal[out.transfer.to] = String(BigInt(bal[out.transfer.to] || 0) + out.transfer.amount);
    return out.result;
  };
  for (const [a, name] of Object.entries(VERIFIERS)) run(F.addVerifier, OWNER, 0, { account: a, name });
  const H = (i) => hash(i);

  // 1. Grant, 64% funded, paid straight to a hospital pharmacy.
  run(F.createCase, "ana.testnet", 38, { kind: "grant", category: "cancer", title: "Chemotherapy, cycle 3 of 6", story: "A teacher needs the third of six chemotherapy cycles at the Cancer Institute in Colombo. The hospital has confirmed the diagnosis and written the cost of the cycle.", doc_hash: H(1), goal: String(n(500)), verifier: "stmarys-nairobi.testnet", days: 30, milestones: 2 });
  run(F.verifyCase, "stmarys-nairobi.testnet", 39, { id: 1, payee: "pharmacy-stmarys.testnet", doc_hash: H(1) }, n(25));
  [["carol.testnet", 120], ["dave.testnet", 100], ["erin.testnet", 60], ["frank.testnet", 40]].forEach(([a, x], i) => run(F.donate, a, 40 + i, { id: 1 }, n(x)));

  // 2. Loan, 40% funded, the co-op locked a guarantee.
  run(F.createCase, "juan.testnet", 44, { kind: "loan", category: "farming", title: "Second water pump for the paddy field", story: "A rice farmer wants to buy a second water pump for his paddy field and repay from the next harvest, in three equal parts.", doc_hash: H(2), goal: String(n(20)), verifier: "coop-andes.testnet", days: 30, parts: 3, period_days: 30, milestones: 1 });
  run(F.verifyCase, "coop-andes.testnet", 45, { id: 2, payee: "juan.testnet", doc_hash: H(2) }, n(4));
  run(F.donate, "carol.testnet", 46, { id: 2 }, n(5)); run(F.donate, "frank.testnet", 47, { id: 2 }, n(3));

  // 3. Grant, 88% funded, three days left.
  run(F.createCase, "mei.testnet", 38, { kind: "grant", category: "dialysis", title: "Six months of dialysis sessions", story: "Regular dialysis sessions at Dhaka Community Clinic for a patient waiting for a kidney transplant. The clinic has quoted the cost of the six months.", doc_hash: H(3), goal: String(n(120)), verifier: "clinic-dhaka.testnet", days: 14, milestones: 3 });
  run(F.verifyCase, "clinic-dhaka.testnet", 39, { id: 3, payee: "dialysis-unit-dhaka.testnet", doc_hash: H(3) }, n(6));
  run(F.donate, "alice.testnet", 41, { id: 3 }, n(60)); run(F.donate, "dave.testnet", 42, { id: 3 }, n(46));

  // 4. Grant waiting for a verifier.
  run(F.createCase, "bob.testnet", 49, { kind: "grant", category: "surgery", title: "Emergency appendix surgery", story: "Emergency appendix surgery was done last night at St Mary's Hospital in Nairobi. The family cannot cover the hospital bill of 80 NEAR, the invoice is attached.", doc_hash: H(4), goal: String(n(80)), verifier: "stmarys-nairobi.testnet", days: 21, milestones: 2 });

  // 5. A loan that is being repaid on time.
  run(F.createCase, "lina.testnet", 5, { kind: "loan", category: "small-business", title: "Sewing machines for a tailoring shop", story: "A small tailoring shop in Manila wants to buy two more sewing machines and repay in three parts from the shop income.", doc_hash: H(5), goal: String(n(12)), verifier: "ngo-manila.testnet", days: 30, parts: 3, period_days: 30, milestones: 1 });
  run(F.verifyCase, "ngo-manila.testnet", 6, { id: 4 + 1, payee: "lina.testnet", doc_hash: H(5) }, n(2.4));
  run(F.donate, "frank.testnet", 8, { id: 5 }, n(7)); run(F.donate, "erin.testnet", 9, { id: 5 }, n(5));
  run(F.releaseMilestone, "ngo-manila.testnet", 10, { id: 5, evidence: H(55) });
  run(F.repay, "lina.testnet", 32, { id: 5 }, n(4));

  // 7. Providers: two registered hospitals, one more waiting for the owner.
  const lic = (i) => "sha256-licence" + String(i).padStart(2, "0") + "00000000";
  run(F.applyProvider, "stmarys-nairobi.testnet", 1, { name: "St. Mary's Hospital, Nairobi (example)", type: "hospital", country: "Kenya", license_hash: lic(1) });
  run(F.applyProvider, "clinic-dhaka.testnet", 1, { name: "Dhaka Community Clinic (example)", type: "clinic", country: "Bangladesh", license_hash: lic(2) });
  run(F.applyProvider, "cancer-institute-colombo.testnet", 2, { name: "Colombo Cancer Institute (example)", type: "hospital", country: "Sri Lanka", license_hash: lic(3) });
  run(F.applyProvider, "city-general-manila.testnet", 48, { name: "City General Hospital, Manila (example)", type: "hospital", country: "Philippines", license_hash: lic(4) });
  ["stmarys-nairobi.testnet", "clinic-dhaka.testnet", "cancer-institute-colombo.testnet"].forEach((a, i) => run(F.approveProvider, OWNER, 3 + i, { account: a }));
  // 8. A hospital campaign: the Colombo cancer hospital asks for chemotherapy chairs; Dhaka clinic verified it.
  run(F.createCase, "cancer-institute-colombo.testnet", 42, { kind: "campaign", category: "equipment", title: "Six chemotherapy chairs for the cancer ward", story: "The ward treats 40 patients a day and has four chairs. New chairs shorten waiting lists.", doc_hash: H(8), goal: String(n(300)), verifier: "clinic-dhaka.testnet", days: 30, milestones: 2 });
  run(F.verifyCase, "clinic-dhaka.testnet", 43, { id: 6, payee: "cancer-institute-colombo.testnet", doc_hash: H(8) }, n(15));
  [["alice.testnet", 70], ["dave.testnet", 55], ["erin.testnet", 40]].forEach(([a, x], i) => run(F.donate, a, 44 + i, { id: 6 }, n(x)));

  // 6. Rehabilitation: paid straight to the treatment centre, no name or photo.
  run(F.createCase, "mei.testnet", 46, { kind: "grant", category: "rehabilitation", title: "12-week residential rehabilitation programme", story: "A young adult wants a 12-week residential treatment programme for addiction at a licensed rehabilitation centre. Anonymous on purpose: no name, no photo.", doc_hash: H(6), goal: String(n(90)), verifier: "clinic-dhaka.testnet", days: 30, milestones: 3 });
  run(F.verifyCase, "clinic-dhaka.testnet", 47, { id: 7, payee: "recovery-centre-dhaka.testnet", doc_hash: H(6) }, n(4.5));
  run(F.donate, "alice.testnet", 48, { id: 7 }, n(30)); run(F.donate, "carol.testnet", 49, { id: 7 }, n(15));

  return { s, bal, offset: "0", acting: "alice.testnet" };
}

export function createDemo() {
  let st = null;
  try { st = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (!st || !st.s) st = seed();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  const now = () => BigInt(Date.now()) * 1_000_000n + BigInt(st.offset);

  return {
    mode: "demo",
    ready: async () => {},
    account: () => st.acting,
    setAccount: (a) => { st.acting = a; save(); },
    balance: (a = st.acting) => BigInt(st.bal[a] || 0),
    now,
    owner: () => st.s.owner,
    advance: (days) => { st.offset = String(BigInt(st.offset) + BigInt(days) * DAY_NS); save(); },
    reset: () => { try { localStorage.removeItem(KEY); } catch {} st = seed(); save(); },
    verifiers: async () => st.s.verifiers,
    providers: async () => F.providerList(st.s, now()),
    aiRules: async () => F.aiRulesView(st.s),
    audit: async (f = {}) => F.auditList(st.s, { limit: 100, ...f }),
    vstats: async (a) => F.verifierStats(st.s, a),
    categories: () => F.CATEGORIES,
    list: async (filter = {}) => F.listView(st.s, now(), { limit: 100, ...filter }),
    get: async (id) => { const c = st.s.cases[String(id)]; return c ? F.caseView(c, now()) : null; },
    acct: async (id, a = st.acting) => { const c = st.s.cases[String(id)]; return c ? F.accountView(c, a, now()) : null; },
    rep: async (a = st.acting) => { const r = st.s.rep[a] || { repaid: 0, defaults: 0 }; return { ...r, loan_limit: String(F.loanLimit(st.s, a)) }; },
    // The contract throws on a broken rule and keeps the old state; we do the same by working on a copy.
    call: async (method, args = {}, deposit = 0n) => {
      const fn = METHODS[method];
      if (!fn) throw new Error("Unknown method " + method);
      const dep = BigInt(deposit);
      if (dep > BigInt(st.bal[st.acting] || 0)) throw new Error("Not enough demo NEAR in this account");
      const copy = structuredClone(st.s);
      const out = F.exec(fn, copy, { caller: st.acting, now: now(), deposit: dep }, args);
      st.s = copy;
      st.bal[st.acting] = String(BigInt(st.bal[st.acting] || 0) - dep);
      if (out.transfer) st.bal[out.transfer.to] = String(BigInt(st.bal[out.transfer.to] || 0) + out.transfer.amount);
      save();
      return out;
    },
    // Try a forbidden move on a throw-away copy and return the contract's refusal.
    probe: (method, caller, args, deposit = 0n) => {
      try { METHODS[method](structuredClone(st.s), { caller, now: now(), deposit: BigInt(deposit) }, args); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    },
    snapshot: () => st.s,
  };
}
