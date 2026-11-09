// CareFund rules. Pure JavaScript, no SDK imports, so every rule is covered by `npm test`.
//
// Amounts are yocto-NEAR kept as decimal strings in the state (BigInt inside the functions).
// Every function mutates the state it is given and returns { result, logs, transfer }.
// `transfer` is either null or { to, amount } - the wrapper turns it into a NEAR transfer.
//
// Life of a case
//   pending  -> a person asks for help (grant = gift, loan = repaid in parts)
//   open     -> a registered verifier checked it, fixed the payee wallet (and, for a loan, locked a guarantee)
//   funded   -> the goal is reached; money waits in the contract
//   funded   -> the verifier releases it to the payee in milestones, against a bill (evidence hash)
//   completed (grant) | repaying -> repaid | defaulted (loan)
//   failed / cancelled / frozen  -> donors can take their money back

export const NEAR = 10n ** 24n;
export const DAY_NS = 86_400n * 1_000_000_000n;

export const KINDS = ["grant", "loan", "campaign"]; // campaign = a fundraiser opened by an approved hospital or provider
export const PROVIDER_TYPES = ["hospital", "clinic", "rehabilitation", "ngo", "pharmacy"];
export const CATEGORIES = [
  "cancer", "surgery", "dialysis", "accident", "child-care", "medicine",
  "rehabilitation", "mental-health", "equipment", "free-treatment", "disaster", "education", "small-business", "farming", "other",
];

export const CFG = {
  MIN_GOAL: NEAR,                 // 1 NEAR
  LOAN_BASE_LIMIT: 20n * NEAR,    // first loan
  LOAN_STEP: 20n * NEAR,          // + per repaid loan
  LOAN_MAX: 200n * NEAR,
  GUARANTEE_PM: 200n,             // verifier locks 20% of a loan
  STAKE_PM: 50n,                  // verifier locks 5% of a grant or hospital campaign
  FLAG_MIN_REPORTERS: 2,          // at least this many donors must report...
  FLAG_PM: 250n,                  // ...and together hold this share (25%) of the money raised
  FREEZE_TIMEOUT_DAYS: 14,        // a frozen case the owner never decides on opens refunds after this
  AUDIT_MAX: 200,
  GRACE_DAYS: 3n,
  MIN_DAYS: 1, MAX_DAYS: 90,
  MAX_TITLE: 80, MAX_STORY: 500, MAX_REASON: 140,
  MAX_MILESTONES: 4, MAX_PARTS: 12, MAX_PERIOD_DAYS: 60,
};

const fail = (msg) => { throw new Error(msg); };
const B = (x) => BigInt(x);
const ev = (event, data) => "EVENT_JSON:" + JSON.stringify({ standard: "carefund", version: "1.0.0", event, data });
const out = (result, logs, transfer = null) => ({ result, logs, transfer });
const str = (x) => String(x);

// Runs one rule function and writes its events into the on-chain audit trail (the last AUDIT_MAX events).
export function exec(fn, s, ctx, args) {
  const o = fn(s, ctx, args || {});
  s.audit ||= [];
  for (const line of o.logs) {
    const j = JSON.parse(line.slice("EVENT_JSON:".length));
    s.audit.push({ t: str(ctx.now), by: ctx.caller, e: j.event, d: j.data });
  }
  if (s.audit.length > CFG.AUDIT_MAX) s.audit.splice(0, s.audit.length - CFG.AUDIT_MAX);
  return o;
}

export function newState(owner) {
  if (!owner) fail("owner is required");
  return { owner, verifiers: {}, providers: {}, nextId: 1, cases: {}, rep: {}, vrep: {}, audit: [] };
}

const getCase = (s, id) => s.cases[String(id)] || fail("Case not found");
const repOf = (s, a) => (s.rep[a] ||= { repaid: 0, defaults: 0 });
const mustDeposit = (ctx) => { const d = B(ctx.deposit ?? 0); if (d <= 0n) fail("Attach NEAR to this call"); return d; };
const noDeposit = (ctx) => { if (B(ctx.deposit ?? 0) !== 0n) fail("Do not attach NEAR to this call"); };

export function loanLimit(s, account) {
  const r = s.rep[account] || { repaid: 0, defaults: 0 };
  if (r.defaults > 0) return 0n;
  const lim = CFG.LOAN_BASE_LIMIT + CFG.LOAN_STEP * B(r.repaid);
  return lim > CFG.LOAN_MAX ? CFG.LOAN_MAX : lim;
}

// ---- admin -------------------------------------------------------------------------------

export function addVerifier(s, ctx, { account, name }) {
  if (ctx.caller !== s.owner) fail("Only the owner can add verifiers");
  noDeposit(ctx);
  if (!account) fail("account is required");
  s.verifiers[account] = { name: String(name || account).slice(0, 60) };
  return out(true, [ev("verifier_added", { account })]);
}

export function removeVerifier(s, ctx, { account }) {
  if (ctx.caller !== s.owner) fail("Only the owner can remove verifiers");
  noDeposit(ctx);
  delete s.verifiers[account];
  return out(true, [ev("verifier_removed", { account })]);
}

// ---- providers (hospitals, clinics, rehabilitation centres, NGOs) --------------------------
// A provider applies with the fingerprint of its licence. The owner reviews and approves.
// An approved provider becomes a verifier (patients can pick it) and may open its own campaigns,
// which must be verified by a DIFFERENT verifier.

export function applyProvider(s, ctx, a) {
  noDeposit(ctx);
  const name = String(a.name || "").trim();
  if (!name || name.length > 80) fail("Name is required (max 80 characters)");
  if (!PROVIDER_TYPES.includes(a.type)) fail("type must be one of " + PROVIDER_TYPES.join(", "));
  const country = String(a.country || "").trim();
  if (!country || country.length > 40) fail("Country is required");
  if (!a.license_hash || String(a.license_hash).length < 8) fail("license_hash (fingerprint of your licence) is required");
  const cur = s.providers[ctx.caller];
  if (cur && cur.status !== "rejected") fail("This account has already applied");
  s.providers[ctx.caller] = { name, type: a.type, country, license_hash: String(a.license_hash), status: "pending", applied_at: str(ctx.now) };
  return out({ status: "pending" }, [ev("provider_applied", { account: ctx.caller, name })]);
}

export function approveProvider(s, ctx, { account }) {
  noDeposit(ctx);
  if (ctx.caller !== s.owner) fail("Only the owner can approve providers");
  const p = s.providers[account] || fail("No application from this account");
  if (p.status === "approved") fail("Already approved");
  p.status = "approved";
  p.approved_at = str(ctx.now);
  s.verifiers[account] = { name: p.name, provider: true };
  return out({ status: "approved" }, [ev("provider_approved", { account })]);
}

export function rejectProvider(s, ctx, { account }) {
  noDeposit(ctx);
  if (ctx.caller !== s.owner) fail("Only the owner can reject providers");
  const p = s.providers[account] || fail("No application from this account");
  p.status = "rejected";
  if (s.verifiers[account] && s.verifiers[account].provider) delete s.verifiers[account];
  return out({ status: "rejected" }, [ev("provider_rejected", { account })]);
}

// ---- asking for help ---------------------------------------------------------------------

export function createCase(s, ctx, a) {
  noDeposit(ctx);
  const kind = a.kind;
  if (!KINDS.includes(kind)) fail("kind must be grant, loan or campaign");
  if (kind === "campaign") {
    const pr = s.providers[ctx.caller];
    if (!pr || pr.status !== "approved") fail("Only approved providers can open a hospital campaign");
  }
  if (!CATEGORIES.includes(a.category)) fail("Unknown category");
  const title = String(a.title || "").trim();
  const story = String(a.story || "").trim();
  if (!title || title.length > CFG.MAX_TITLE) fail("Title is required (max " + CFG.MAX_TITLE + " characters)");
  if (story.length > CFG.MAX_STORY) fail("Story is too long (max " + CFG.MAX_STORY + " characters)");
  if (!a.doc_hash || String(a.doc_hash).length < 8) fail("doc_hash (fingerprint of your documents) is required");
  const goal = B(a.goal);
  if (goal < CFG.MIN_GOAL) fail("Goal must be at least 1 NEAR");
  const verifier = a.verifier;
  if (!s.verifiers[verifier]) fail("Choose a registered verifier");
  if (verifier === ctx.caller) fail("You cannot verify your own case");
  const days = Number(a.days ?? 30);
  if (!Number.isInteger(days) || days < CFG.MIN_DAYS || days > CFG.MAX_DAYS) fail("days must be 1-" + CFG.MAX_DAYS);
  const milestones = Number(a.milestones ?? 2);
  if (!Number.isInteger(milestones) || milestones < 1 || milestones > CFG.MAX_MILESTONES) fail("milestones must be 1-" + CFG.MAX_MILESTONES);

  const c = {
    id: s.nextId, kind, category: a.category, title, story, requester: ctx.caller, verifier,
    doc_hash: String(a.doc_hash), goal: str(goal), days, milestones, status: "pending",
    created_at: str(ctx.now), deadline: null, payee: null, raised: "0", released: "0", released_n: 0,
    donors: {}, flags: {}, flag_count: 0, flagged_amount: "0", barred: {}, prev_status: null, frozen_at: null, evidence: [], funded_at: null,
    stake_locked: "0", stake_free: "0", slash_pool: "0",
  };
  if (kind === "loan") {
    const parts = Number(a.parts ?? 3), period = Number(a.period_days ?? 30);
    if (!Number.isInteger(parts) || parts < 1 || parts > CFG.MAX_PARTS) fail("parts must be 1-" + CFG.MAX_PARTS);
    if (!Number.isInteger(period) || period < 1 || period > CFG.MAX_PERIOD_DAYS) fail("period_days must be 1-" + CFG.MAX_PERIOD_DAYS);
    const lim = loanLimit(s, ctx.caller);
    if (lim === 0n) fail("This account has an unpaid loan on record and cannot borrow");
    if (goal > lim) fail("Loan limit for this account is " + (lim / NEAR) + " NEAR");
    for (const o of Object.values(s.cases)) {
      if (o.kind === "loan" && o.requester === ctx.caller && ["pending", "open", "funded", "repaying"].includes(o.status)) {
        fail("Finish your current loan request first");
      }
    }
    Object.assign(c, { parts, period_days: period, repaid: "0", slashed: "0", started_at: null, claimed_repay: {} });
  }
  s.cases[String(c.id)] = c;
  s.nextId += 1;
  return out({ id: c.id }, [ev("case_created", { id: c.id, kind, goal: c.goal, requester: ctx.caller, verifier })]);
}

export function cancelCase(s, ctx, { id }) {
  noDeposit(ctx);
  const c = getCase(s, id);
  if (ctx.caller !== c.requester) fail("Only the requester can cancel");
  if (!["pending", "open"].includes(c.status)) fail("Case can no longer be cancelled");
  c.status = "cancelled";
  return out({ status: c.status }, [ev("case_cancelled", { id: c.id })]);
}

// ---- verifier ----------------------------------------------------------------------------

export function verifyCase(s, ctx, { id, payee, doc_hash }) {
  const c = getCase(s, id);
  if (ctx.caller !== c.verifier || !s.verifiers[ctx.caller]) fail("Only the chosen, registered verifier can verify");
  if (c.status !== "pending") fail("Case is not pending");
  if (doc_hash !== c.doc_hash) fail("doc_hash does not match the documents the requester submitted");
  if (!payee) fail("payee is required");
  if (c.kind === "grant" || c.kind === "campaign") {
    if (c.kind === "grant" && payee === c.requester) fail("A grant must be paid to a hospital, pharmacy or provider - not to the requester");
    if (c.kind === "campaign" && payee !== c.requester) fail("A hospital campaign is paid to the hospital that opened it");
    const need = (B(c.goal) * CFG.STAKE_PM) / 1000n;
    const dep = B(ctx.deposit ?? 0);
    if (dep < need) fail("Verifying needs a stake of at least " + str(need) + " yocto-NEAR (5%). It comes back when the case completes and is lost if fraud is confirmed");
    c.stake_locked = str(dep);
  } else {
    const need = (B(c.goal) * CFG.GUARANTEE_PM) / 1000n;
    const dep = B(ctx.deposit ?? 0);
    if (dep < need) fail("A loan needs a guarantee of at least " + str(need) + " yocto-NEAR");
    c.stake_locked = str(dep);
  }
  c.payee = payee;
  c.status = "open";
  c.deadline = str(ctx.now + B(c.days) * DAY_NS);
  return out({ status: c.status }, [ev("case_verified", { id: c.id, verifier: ctx.caller, payee })]);
}

export function rejectCase(s, ctx, { id }) {
  noDeposit(ctx);
  const c = getCase(s, id);
  if (ctx.caller !== c.verifier) fail("Only the chosen verifier can reject");
  if (c.status !== "pending") fail("Case is not pending");
  c.status = "rejected";
  return out({ status: c.status }, [ev("case_rejected", { id: c.id })]);
}

export function releaseMilestone(s, ctx, { id, evidence }) {
  noDeposit(ctx);
  const c = getCase(s, id);
  if (ctx.caller !== c.verifier) fail("Only the verifier can release a milestone");
  if (c.status !== "funded") fail("Case is not fully funded (or is frozen)");
  if (!evidence || String(evidence).length < 8) fail("evidence (fingerprint of the bill or proof) is required");
  const k = c.released_n + 1;
  const goal = B(c.goal);
  const amount = k === c.milestones ? goal - B(c.released) : goal / B(c.milestones);
  c.released = str(B(c.released) + amount);
  c.released_n = k;
  c.evidence.push(String(evidence));
  if (k === c.milestones) {
    if (c.kind !== "loan") {
      c.status = "completed";
      c.stake_free = str(B(c.stake_free) + B(c.stake_locked)); c.stake_locked = "0";
      (s.vrep[c.verifier] ||= { completed: 0, frauds: 0 }).completed += 1;
    }
    else { c.status = "repaying"; c.started_at = str(ctx.now); }
  }
  return out({ milestone: k, amount: str(amount), status: c.status },
    [ev("milestone_released", { id: c.id, milestone: k, amount: str(amount), to: c.payee })],
    { to: c.payee, amount });
}

// ---- donors ------------------------------------------------------------------------------

export function donate(s, ctx, { id }) {
  const c = getCase(s, id);
  const amt = mustDeposit(ctx);
  if (c.status !== "open") fail("Case is not open for donations");
  if (ctx.now > B(c.deadline)) fail("The deadline has passed");
  if (ctx.caller === c.requester || ctx.caller === c.verifier) fail("The requester and verifier cannot fund their own case");
  const left = B(c.goal) - B(c.raised);
  if (amt > left) fail("Only " + str(left) + " yocto-NEAR is still needed");
  const d = (c.donors[ctx.caller] ||= { amount: "0", refunded: false, claimed: "0" });
  d.amount = str(B(d.amount) + amt);
  c.raised = str(B(c.raised) + amt);
  if (B(c.raised) === B(c.goal)) { c.status = "funded"; c.funded_at = str(ctx.now); }
  return out({ raised: c.raised, status: c.status }, [ev("donated", { id: c.id, donor: ctx.caller, amount: str(amt) })]);
}

function refundAmount(c, account, now) {
  const d = c.donors[account];
  if (!d || d.refunded) return 0n;
  const dead = c.status === "open" && c.deadline && now > B(c.deadline);
  const frozenTimedOut = c.status === "frozen" && now >= B(c.frozen_at) + B(CFG.FREEZE_TIMEOUT_DAYS) * DAY_NS;
  if (!(dead || frozenTimedOut || ["failed", "cancelled", "fraud"].includes(c.status))) return 0n;
  const raised = B(c.raised);
  if (raised === 0n) return 0n;
  // what has not been released, plus a share of the verifier's stake if fraud was confirmed
  return (B(d.amount) * (raised - B(c.released) + B(c.slash_pool || 0))) / raised;
}

export function refund(s, ctx, { id }) {
  noDeposit(ctx);
  const c = getCase(s, id);
  if (c.status === "open" && ctx.now > B(c.deadline)) c.status = "failed";
  const d = c.donors[ctx.caller];
  if (!d || d.refunded) fail("Nothing to refund");
  const amount = refundAmount(c, ctx.caller, ctx.now);
  if (amount <= 0n) fail(c.status === "frozen" ? "This case is frozen while the owner reviews it. Refunds open after " + CFG.FREEZE_TIMEOUT_DAYS + " days if there is no decision" : "Refunds are not available for this case");
  d.refunded = true;
  return out({ amount: str(amount) }, [ev("refunded", { id: c.id, donor: ctx.caller, amount: str(amount) })], { to: ctx.caller, amount });
}

// ---- reports -----------------------------------------------------------------------------

// Only people who put money into the case can report it, and their reports are weighted by how much
// they gave. Free accounts have no say. A case freezes when enough donors, holding enough of the money, report it.
export function flagCase(s, ctx, { id, reason }) {
  noDeposit(ctx);
  const c = getCase(s, id);
  if (!["open", "funded"].includes(c.status)) fail("Only live cases can be reported");
  if (ctx.caller === c.requester || ctx.caller === c.verifier) fail("Not allowed to report your own case");
  const d = c.donors[ctx.caller];
  if (!d || d.refunded || B(d.amount) <= 0n) fail("Only donors of this case can report it");
  if (c.flags[ctx.caller]) fail("You already reported this case");
  if (c.barred[ctx.caller]) fail("Your earlier report of this case was reviewed and dismissed");
  c.flags[ctx.caller] = { reason: String(reason || "").slice(0, CFG.MAX_REASON), amount: d.amount };
  c.flag_count += 1;
  c.flagged_amount = str(B(c.flagged_amount) + B(d.amount));
  if (c.flag_count >= CFG.FLAG_MIN_REPORTERS && B(c.flagged_amount) * 1000n >= B(c.raised) * CFG.FLAG_PM) {
    c.prev_status = c.status; c.status = "frozen"; c.frozen_at = str(ctx.now);
  }
  return out({ reporters: c.flag_count, flagged: c.flagged_amount, status: c.status },
    [ev("case_flagged", { id: c.id, by: ctx.caller, reporters: c.flag_count, flagged: c.flagged_amount })]);
}

// Owner dismisses the reports: the case continues and those donors cannot report it again.
export function unfreeze(s, ctx, { id }) {
  noDeposit(ctx);
  if (ctx.caller !== s.owner) fail("Only the owner can unfreeze");
  const c = getCase(s, id);
  if (c.status !== "frozen") fail("Case is not frozen");
  c.status = c.prev_status;
  if (c.deadline) c.deadline = str(B(c.deadline) + (ctx.now - B(c.frozen_at)));
  Object.assign(c.barred, Object.fromEntries(Object.keys(c.flags).map((k) => [k, true])));
  c.flags = {}; c.flag_count = 0; c.flagged_amount = "0"; c.prev_status = null; c.frozen_at = null;
  return out({ status: c.status }, [ev("case_unfrozen", { id: c.id })]);
}

// Owner confirms the reports were right: the verifier's stake is paid to the donors on top of
// their refund, and the verifier loses its verifier rights.
export function confirmFraud(s, ctx, { id }) {
  noDeposit(ctx);
  if (ctx.caller !== s.owner) fail("Only the owner can confirm fraud");
  const c = getCase(s, id);
  if (c.status !== "frozen") fail("Only a frozen case can be confirmed as fraud");
  const slashed = B(c.stake_locked);
  c.slash_pool = str(slashed);
  c.stake_locked = "0";
  c.status = "fraud";
  (s.vrep[c.verifier] ||= { completed: 0, frauds: 0 }).frauds += 1;
  delete s.verifiers[c.verifier];
  if (s.providers[c.verifier]) s.providers[c.verifier].status = "rejected";
  return out({ status: c.status, slashed: str(slashed) }, [ev("fraud_confirmed", { id: c.id, verifier: c.verifier, slashed: str(slashed) })]);
}

// ---- loans -------------------------------------------------------------------------------

const recovered = (c) => B(c.repaid) + B(c.slashed);

export function repay(s, ctx, { id }) {
  const c = getCase(s, id);
  if (c.kind !== "loan") fail("Only loans are repaid");
  const amt = mustDeposit(ctx);
  if (ctx.caller !== c.requester) fail("Only the borrower repays");
  if (!["repaying", "defaulted"].includes(c.status)) fail("Loan is not being repaid");
  const owing = B(c.goal) - recovered(c);
  if (amt > owing) fail("Only " + str(owing) + " yocto-NEAR is still owed");
  c.repaid = str(B(c.repaid) + amt);
  const logs = [ev("repaid", { id: c.id, amount: str(amt) })];
  if (recovered(c) === B(c.goal) && c.status === "repaying") {
    c.status = "repaid";
    repOf(s, c.requester).repaid += 1;
    c.stake_free = str(B(c.stake_free) + B(c.stake_locked)); c.stake_locked = "0";
    (s.vrep[c.verifier] ||= { completed: 0, frauds: 0 }).completed += 1;
    logs.push(ev("loan_repaid", { id: c.id }));
  }
  return out({ repaid: c.repaid, status: c.status }, logs);
}

// Installment k (1..parts) is due started_at + k*period; the borrower must have paid goal*k/parts.
export function expectedRepayment(c, now) {
  if (c.started_at == null) return 0n;
  let exp = 0n;
  for (let k = 1; k <= c.parts; k++) {
    const due = B(c.started_at) + B(k) * B(c.period_days) * DAY_NS + CFG.GRACE_DAYS * DAY_NS;
    if (now > due) exp = k === c.parts ? B(c.goal) : (B(c.goal) * B(k)) / B(c.parts);
  }
  return exp;
}

// Anyone can call this; the contract checks the maths, nobody has to be trusted.
export function markDefault(s, ctx, { id }) {
  noDeposit(ctx);
  const c = getCase(s, id);
  if (c.kind !== "loan" || c.status !== "repaying") fail("Loan is not being repaid");
  if (B(c.repaid) >= expectedRepayment(c, ctx.now)) fail("The loan is not overdue");
  const stake = B(c.stake_locked);
  const owing = B(c.goal) - B(c.repaid);
  const cover = stake < owing ? stake : owing;
  c.slashed = str(cover);
  c.stake_free = str(B(c.stake_free) + stake - cover);
  c.stake_locked = "0";
  c.status = "defaulted";
  repOf(s, c.requester).defaults += 1;
  return out({ status: c.status, covered_by_guarantee: str(cover) },
    [ev("loan_defaulted", { id: c.id, borrower: c.requester, covered: str(cover) })]);
}

export function claimRepayment(s, ctx, { id }) {
  noDeposit(ctx);
  const c = getCase(s, id);
  if (c.kind !== "loan") fail("Only loans have repayments");
  const d = c.donors[ctx.caller];
  if (!d) fail("You did not lend to this loan");
  const amount = claimableRepayment(c, ctx.caller);
  if (amount <= 0n) fail("Nothing to claim yet");
  c.claimed_repay[ctx.caller] = str(B(c.claimed_repay[ctx.caller] || 0) + amount);
  return out({ amount: str(amount) }, [ev("repayment_claimed", { id: c.id, lender: ctx.caller, amount: str(amount) })], { to: ctx.caller, amount });
}

export function withdrawStake(s, ctx, { id }) {
  noDeposit(ctx);
  const c = getCase(s, id);
  if (ctx.caller !== c.verifier) fail("Only the verifier can withdraw the guarantee");
  releaseStakeOnEnd(c, ctx.now);
  const amount = B(c.stake_free || 0);
  if (amount <= 0n) fail("No guarantee is free to withdraw");
  c.stake_free = "0";
  return out({ amount: str(amount) }, [ev("guarantee_returned", { id: c.id, amount: str(amount) })], { to: ctx.caller, amount });
}

// A cancelled or failed loan frees the guarantee (checked lazily, when the verifier asks for it).
function releaseStakeOnEnd(c, now) {
  const ended = ["cancelled", "failed"].includes(c.status) || (c.status === "open" && c.deadline && now > B(c.deadline));
  if (ended && B(c.stake_locked) > 0n) {
    c.stake_free = str(B(c.stake_free) + B(c.stake_locked)); c.stake_locked = "0";
  }
}

// ---- read helpers (used by the view methods) ------------------------------------------------

export function claimableRepayment(c, account) {
  const d = c.donors[account];
  if (!d || c.kind !== "loan") return 0n;
  const entitled = (B(d.amount) * recovered(c)) / B(c.goal);
  return entitled - B(c.claimed_repay[account] || 0);
}

export function refundable(c, account, now) {
  return refundAmount(c, account, now);
}

export function caseView(c, now) {
  const v = { ...c };
  delete v.donors; delete v.flags; delete v.claimed_repay;
  v.donors_count = Object.keys(c.donors).length;
  v.effective_status = c.status === "open" && c.deadline && now > B(c.deadline) ? "failed" : c.status;
  if (c.kind === "loan") v.expected_repayment = str(expectedRepayment(c, now));
  return v;
}

export function accountView(c, account, now) {
  const d = c.donors[account];
  return {
    contributed: d ? d.amount : "0",
    refundable: str(refundable(c, account, now)),
    claimable_repayment: str(claimableRepayment(c, account)),
    flagged: !!c.flags[account],
  };
}

export function providerList(s, now) {
  return Object.entries(s.providers).map(([account, p]) => {
    const cs = Object.values(s.cases).filter((c) => c.kind === "campaign" && c.requester === account);
    return { account, ...p, campaigns: cs.length, raised: str(cs.reduce((t, c) => t + B(c.raised), 0n)) };
  });
}

export function auditList(s, { from = 0, limit = 50, id } = {}) {
  const all = (s.audit || []).filter((a) => id == null || (a.d && Number(a.d.id) === Number(id))).slice().reverse();
  return all.slice(from, from + Math.min(limit, 100));
}

export function verifierStats(s, account) {
  return s.vrep[account] || { completed: 0, frauds: 0 };
}

export function listView(s, now, { from = 0, limit = 50, kind, category, status } = {}) {
  const all = Object.values(s.cases).sort((a, b) => b.id - a.id)
    .map((c) => caseView(c, now))
    .filter((c) => (!kind || c.kind === kind) && (!category || c.category === category) && (!status || c.effective_status === status));
  return all.slice(from, from + Math.min(limit, 100));
}
