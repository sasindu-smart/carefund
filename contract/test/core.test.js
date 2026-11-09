import test from "node:test";
import assert from "node:assert/strict";
import * as F from "../src/fund-core.js";
const { NEAR, DAY_NS } = F;

const OWNER = "owner.testnet", VER = "lankacare.testnet", PAYEE = "pharmacy.lankacare.testnet";
const ALICE = "alice.testnet", BOB = "bob.testnet", CAROL = "carol.testnet", DAVE = "dave.testnet", ERIN = "erin.testnet";
const DOC = "sha256-abc12345", BILL = "sha256-bill0001";
const STK = 500n * (10n ** 21n); // 0.5 NEAR = 5% of a 10 NEAR goal
const n = (x) => BigInt(Math.round(x * 1000)) * (NEAR / 1000n);
const c = (caller, now = 1n * DAY_NS, deposit = 0n) => ({ caller, now, deposit });

const mk = () => { const s = F.newState(OWNER); F.addVerifier(s, c(OWNER), { account: VER, name: "Lanka Care Hospital" }); return s; };
const grant = (s, extra = {}) => F.createCase(s, c(BOB), { kind: "grant", category: "cancer", title: "Chemo", story: "x", doc_hash: DOC, goal: String(n(10)), verifier: VER, days: 30, milestones: 2, ...extra }).result.id;
const openGrant = (s) => { const id = grant(s); F.verifyCase(s, c(VER, 1n * DAY_NS, STK), { id, payee: PAYEE, doc_hash: DOC }); return id; };
const loanArgs = (extra = {}) => ({ kind: "loan", category: "farming", title: "Pump", story: "", doc_hash: DOC, goal: String(n(10)), verifier: VER, days: 30, parts: 2, period_days: 30, milestones: 1, ...extra });
const openLoan = (s) => {
  const id = F.createCase(s, c(BOB), loanArgs()).result.id;
  F.verifyCase(s, c(VER, 1n * DAY_NS, n(2)), { id, payee: BOB, doc_hash: DOC });
  return id;
};
const fund = (s, id, who = [[CAROL, 6], [DAVE, 4]]) => who.forEach(([a, x]) => F.donate(s, c(a, 2n * DAY_NS, n(x)), { id }));

test("only the owner manages verifiers", () => {
  const s = F.newState(OWNER);
  assert.throws(() => F.addVerifier(s, c(ALICE), { account: VER }), /Only the owner/);
  F.addVerifier(s, c(OWNER), { account: VER });
  assert.ok(s.verifiers[VER]);
});

test("a case needs a registered verifier, a doc hash and sane numbers", () => {
  const s = mk();
  assert.throws(() => grant(s, { verifier: "nobody.testnet" }), /registered verifier/);
  assert.throws(() => grant(s, { doc_hash: "" }), /doc_hash/);
  assert.throws(() => grant(s, { goal: String(n(0.5)) }), /at least 1 NEAR/);
  assert.throws(() => grant(s, { category: "yacht" }), /category/);
  assert.throws(() => F.createCase(s, c(VER), { kind: "grant", category: "cancer", title: "t", doc_hash: DOC, goal: String(n(5)), verifier: VER }), /own case/);
  assert.equal(grant(s), 1);
});

test("grant: money can never be paid to the requester", () => {
  const s = mk(); const id = grant(s);
  assert.throws(() => F.verifyCase(s, c(VER), { id, payee: BOB, doc_hash: DOC }), /not to the requester/);
  assert.throws(() => F.verifyCase(s, c(ALICE), { id, payee: PAYEE, doc_hash: DOC }), /chosen, registered verifier/);
  assert.throws(() => F.verifyCase(s, c(VER), { id, payee: PAYEE, doc_hash: "sha256-other999" }), /does not match/);
  F.verifyCase(s, c(VER, 1n * DAY_NS, STK), { id, payee: PAYEE, doc_hash: DOC });
  assert.equal(s.cases[1].status, "open");
});

test("donations: open cases only, no self-funding, no overfunding", () => {
  const s = mk(); const id = grant(s);
  assert.throws(() => F.donate(s, c(CAROL, 2n * DAY_NS, n(1)), { id }), /not open/);
  F.verifyCase(s, c(VER, 1n * DAY_NS, STK), { id, payee: PAYEE, doc_hash: DOC });
  assert.throws(() => F.donate(s, c(BOB, 2n * DAY_NS, n(1)), { id }), /cannot fund their own/);
  assert.throws(() => F.donate(s, c(CAROL, 2n * DAY_NS, 0n), { id }), /Attach NEAR/);
  assert.throws(() => F.donate(s, c(CAROL, 2n * DAY_NS, n(11)), { id }), /still needed/);
  assert.throws(() => F.donate(s, c(CAROL, 40n * DAY_NS, n(1)), { id }), /deadline/);
  F.donate(s, c(CAROL, 2n * DAY_NS, n(6)), { id });
  assert.equal(s.cases[1].status, "open");
  F.donate(s, c(DAVE, 2n * DAY_NS, n(4)), { id });
  assert.equal(s.cases[1].status, "funded");
});

test("grant: milestones are released by the verifier, to the payee, against evidence", () => {
  const s = mk(); const id = openGrant(s); fund(s, id);
  assert.throws(() => F.releaseMilestone(s, c(ALICE), { id, evidence: BILL }), /Only the verifier/);
  assert.throws(() => F.releaseMilestone(s, c(VER), { id, evidence: "" }), /evidence/);
  const r1 = F.releaseMilestone(s, c(VER), { id, evidence: BILL });
  assert.deepEqual(r1.transfer, { to: PAYEE, amount: n(5) });
  assert.equal(s.cases[1].status, "funded");
  const r2 = F.releaseMilestone(s, c(VER), { id, evidence: "sha256-bill0002" });
  assert.deepEqual(r2.transfer, { to: PAYEE, amount: n(5) });
  assert.equal(s.cases[1].status, "completed");
  assert.throws(() => F.releaseMilestone(s, c(VER), { id, evidence: BILL }), /not fully funded/);
});

test("release is impossible before the goal is reached", () => {
  const s = mk(); const id = openGrant(s);
  F.donate(s, c(CAROL, 2n * DAY_NS, n(6)), { id });
  assert.throws(() => F.releaseMilestone(s, c(VER), { id, evidence: BILL }), /not fully funded/);
});

test("goal missed by the deadline: every donor gets their money back, once", () => {
  const s = mk(); const id = openGrant(s);
  F.donate(s, c(CAROL, 2n * DAY_NS, n(6)), { id });
  assert.throws(() => F.refund(s, c(CAROL, 5n * DAY_NS), { id }), /not available/);
  const late = 40n * DAY_NS;
  assert.equal(F.accountView(s.cases[1], CAROL, late).refundable, String(n(6)));
  const r = F.refund(s, c(CAROL, late), { id });
  assert.deepEqual(r.transfer, { to: CAROL, amount: n(6) });
  assert.throws(() => F.refund(s, c(CAROL, late), { id }), /Nothing to refund/);
  assert.throws(() => F.refund(s, c(DAVE, late), { id }), /Nothing to refund/);
});

test("cancelled case refunds donors", () => {
  const s = mk(); const id = openGrant(s);
  F.donate(s, c(CAROL, 2n * DAY_NS, n(3)), { id });
  assert.throws(() => F.cancelCase(s, c(ALICE), { id }), /Only the requester/);
  F.cancelCase(s, c(BOB), { id });
  assert.equal(F.refund(s, c(CAROL), { id }).transfer.amount, n(3));
});

test("only donors can report a case, and reports are weighted by how much they gave", () => {
  const s = mk(); const id = openGrant(s); fund(s, id); // Carol 6, Dave 4 of 10
  assert.throws(() => F.flagCase(s, c(ALICE), { id, reason: "x" }), /Only donors/);
  assert.throws(() => F.flagCase(s, c(BOB), { id, reason: "x" }), /own case/);
  F.flagCase(s, c(DAVE), { id, reason: "photo looks reused" });       // 4 of 10 = 40%, but only one reporter
  assert.equal(s.cases[1].status, "funded");
  assert.throws(() => F.flagCase(s, c(DAVE), { id, reason: "again" }), /already reported/);
  F.flagCase(s, c(CAROL), { id, reason: "same story elsewhere" });     // two reporters, 100%
  assert.equal(s.cases[1].status, "frozen");
});

test("two tiny donors cannot freeze a case: the reports must carry 25% of the money", () => {
  const s = mk(); const id = openGrant(s);
  F.donate(s, c(CAROL, 2n * DAY_NS, n(8)), { id });
  F.donate(s, c("tiny1.testnet", 2n * DAY_NS, n(0.5)), { id });
  F.donate(s, c("tiny2.testnet", 2n * DAY_NS, n(0.5)), { id });
  F.flagCase(s, c("tiny1.testnet"), { id }); F.flagCase(s, c("tiny2.testnet"), { id });
  assert.equal(s.cases[1].status, "open");                              // 1 of 9 = 11%
  assert.equal(s.cases[1].flag_count, 2);
});

test("while frozen nobody can drain the case; after 14 days without a decision donors can refund", () => {
  const s = mk(); const id = openGrant(s); fund(s, id);
  F.releaseMilestone(s, c(VER), { id, evidence: BILL });               // 5 of 10 out
  F.flagCase(s, c(CAROL, 3n * DAY_NS), { id }); F.flagCase(s, c(DAVE, 3n * DAY_NS), { id });
  assert.equal(s.cases[1].status, "frozen");
  assert.throws(() => F.releaseMilestone(s, c(VER), { id, evidence: "sha256-bill0002" }), /not fully funded/);
  assert.throws(() => F.refund(s, c(CAROL, 5n * DAY_NS), { id }), /frozen while the owner reviews/);
  assert.equal(F.refund(s, c(CAROL, 18n * DAY_NS), { id }).transfer.amount, n(3));   // 6 of 10, half released
  assert.equal(F.refund(s, c(DAVE, 18n * DAY_NS), { id }).transfer.amount, n(2));
});

test("owner dismisses the reports: the case goes on and those donors cannot report it again", () => {
  const s = mk(); const id = openGrant(s); fund(s, id);
  F.flagCase(s, c(CAROL), { id }); F.flagCase(s, c(DAVE), { id });
  assert.throws(() => F.unfreeze(s, c(ALICE), { id }), /Only the owner/);
  F.unfreeze(s, c(OWNER), { id });
  assert.equal(s.cases[1].status, "funded");
  assert.equal(s.cases[1].flag_count, 0);
  assert.throws(() => F.flagCase(s, c(CAROL), { id }), /reviewed and dismissed/);
});

test("verifying a grant needs a 5% stake from the verifier", () => {
  const s = mk(); const id = grant(s);
  assert.throws(() => F.verifyCase(s, c(VER), { id, payee: PAYEE, doc_hash: DOC }), /needs a stake/);
  assert.throws(() => F.verifyCase(s, c(VER, 1n * DAY_NS, STK - 1n), { id, payee: PAYEE, doc_hash: DOC }), /needs a stake/);
  F.verifyCase(s, c(VER, 1n * DAY_NS, STK), { id, payee: PAYEE, doc_hash: DOC });
  assert.equal(s.cases[id].stake_locked, String(STK));
});

test("the stake comes back when the case completes, and a cancelled case frees it too", () => {
  const s = mk(); const id = openGrant(s); fund(s, id);
  assert.throws(() => F.withdrawStake(s, c(VER), { id }), /No guarantee/);
  F.releaseMilestone(s, c(VER), { id, evidence: BILL });
  assert.throws(() => F.withdrawStake(s, c(VER), { id }), /No guarantee/);   // still locked until the last milestone
  F.releaseMilestone(s, c(VER), { id, evidence: "sha256-bill0002" });
  assert.equal(F.withdrawStake(s, c(VER), { id }).transfer.amount, STK);
  assert.equal(F.verifierStats(s, VER).completed, 1);
  const s2 = mk(); const id2 = openGrant(s2);
  F.cancelCase(s2, c(BOB), { id: id2 });
  assert.equal(F.withdrawStake(s2, c(VER), { id: id2 }).transfer.amount, STK);
});

test("confirmed fraud: donors get their refund plus the verifier's stake, and the verifier is removed", () => {
  const s = mk(); const id = openGrant(s); fund(s, id);                  // Carol 6, Dave 4
  F.releaseMilestone(s, c(VER), { id, evidence: BILL });                  // 5 of 10 out
  assert.throws(() => F.confirmFraud(s, c(OWNER), { id }), /frozen case/);
  F.flagCase(s, c(CAROL), { id }); F.flagCase(s, c(DAVE), { id });
  assert.throws(() => F.confirmFraud(s, c(ALICE), { id }), /Only the owner/);
  const r = F.confirmFraud(s, c(OWNER), { id });
  assert.equal(r.result.slashed, String(STK));
  assert.equal(s.cases[id].status, "fraud");
  assert.equal(s.verifiers[VER], undefined);
  assert.equal(F.verifierStats(s, VER).frauds, 1);
  // pool = 5 (unreleased) + 0.5 (stake) = 5.5, shared by who gave: Carol 6/10, Dave 4/10
  assert.equal(F.refund(s, c(CAROL), { id }).transfer.amount, n(3.3));
  assert.equal(F.refund(s, c(DAVE), { id }).transfer.amount, n(2.2));
  assert.throws(() => F.withdrawStake(s, c(VER), { id }), /No guarantee/);
});

test("every action is written to the audit trail, newest first, capped", () => {
  const s = mk(); const id = openGrant(s);
  const a = F.exec(F.donate, s, c(CAROL, 2n * DAY_NS, n(4)), { id });
  assert.equal(a.result.raised, String(n(4)));
  const trail = F.auditList(s, {});
  assert.equal(trail[0].e, "donated"); assert.equal(trail[0].by, CAROL);
  assert.equal(F.auditList(s, { id: 999 }).length, 0);
  for (let i = 0; i < 250; i++) F.exec(F.donate, s, c("d" + i + ".testnet", 2n * DAY_NS, n(0.001)), { id });
  assert.equal(s.audit.length, F.CFG.AUDIT_MAX);
  assert.equal(F.auditList(s, { limit: 5 }).length, 5);
  assert.equal(F.auditList(s, { id })[0].e, "donated");
});

test("loan: needs a guarantee of 20% from the verifier and respects the borrower limit", () => {
  const s = mk();
  assert.throws(() => F.createCase(s, c(BOB), loanArgs({ goal: String(n(25)) })), /Loan limit/);
  const id = F.createCase(s, c(BOB), loanArgs()).result.id;
  assert.throws(() => F.verifyCase(s, c(VER, 1n * DAY_NS, n(1)), { id, payee: BOB, doc_hash: DOC }), /guarantee/);
  F.verifyCase(s, c(VER, 1n * DAY_NS, n(2)), { id, payee: BOB, doc_hash: DOC });
  assert.equal(s.cases[id].stake_locked, String(n(2)));
  assert.throws(() => F.createCase(s, c(BOB), loanArgs()), /current loan/);
});

test("loan repaid in full: lenders are paid back pro rata, guarantee returns, reputation grows", () => {
  const s = mk(); const id = openLoan(s); fund(s, id);
  F.releaseMilestone(s, c(VER), { id, evidence: BILL });
  const started = 3n * DAY_NS;
  assert.equal(s.cases[id].status, "repaying");
  assert.throws(() => F.repay(s, c(ALICE, started, n(5)), { id }), /Only the borrower/);
  assert.throws(() => F.repay(s, c(BOB, started, n(11)), { id }), /still owed/);
  F.repay(s, c(BOB, started, n(5)), { id });
  assert.equal(F.claimableRepayment(s.cases[id], CAROL), n(3));   // 6/10 of 5
  assert.equal(F.claimRepayment(s, c(CAROL), { id }).transfer.amount, n(3));
  assert.throws(() => F.claimRepayment(s, c(CAROL), { id }), /Nothing to claim/);
  F.repay(s, c(BOB, started, n(5)), { id });
  assert.equal(s.cases[id].status, "repaid");
  assert.equal(s.rep[BOB].repaid, 1);
  assert.equal(F.claimRepayment(s, c(DAVE), { id }).transfer.amount, n(4));
  assert.equal(F.claimRepayment(s, c(CAROL), { id }).transfer.amount, n(3));
  assert.equal(F.withdrawStake(s, c(VER), { id }).transfer.amount, n(2));
  assert.equal(F.loanLimit(s, BOB), n(40));
});

test("loan default: anyone can call it once overdue, guarantee pays lenders, borrower is blocked", () => {
  const s = mk(); const id = openLoan(s); fund(s, id);
  F.releaseMilestone(s, c(VER), { id, evidence: BILL }); // started_at = 1 day
  const early = 1n * DAY_NS + 33n * DAY_NS;               // installment 1 due at day 31, grace to day 34
  assert.throws(() => F.markDefault(s, c(ERIN, early), { id }), /not overdue/);
  const late = 1n * DAY_NS + 35n * DAY_NS;
  const d = F.markDefault(s, c(ERIN, late), { id });
  assert.equal(d.result.status, "defaulted");
  assert.equal(s.cases[id].slashed, String(n(2)));
  assert.equal(F.claimRepayment(s, c(CAROL), { id }).transfer.amount, n(1.2)); // 6/10 of 2
  assert.equal(s.rep[BOB].defaults, 1);
  assert.throws(() => F.createCase(s, c(BOB), loanArgs()), /unpaid loan on record/);
  assert.throws(() => F.markDefault(s, c(ERIN, late), { id }), /not being repaid/);
});

test("a borrower who paid installment 1 on time is not in default", () => {
  const s = mk(); const id = openLoan(s); fund(s, id);
  F.releaseMilestone(s, c(VER), { id, evidence: BILL });
  F.repay(s, c(BOB, 20n * DAY_NS, n(5)), { id });
  assert.throws(() => F.markDefault(s, c(ERIN, 40n * DAY_NS), { id }), /not overdue/);
  assert.equal(F.markDefault(s, c(ERIN, 70n * DAY_NS), { id }).result.status, "defaulted"); // installment 2 missed
});

test("a failed loan frees the verifier's guarantee", () => {
  const s = mk(); const id = openLoan(s);
  assert.throws(() => F.withdrawStake(s, c(VER, 5n * DAY_NS), { id }), /No guarantee/);
  assert.equal(F.withdrawStake(s, c(VER, 60n * DAY_NS), { id }).transfer.amount, n(2));
});

test("views hide private maps and show effective status", () => {
  const s = mk(); const id = openGrant(s);
  const v = F.caseView(s.cases[id], 60n * DAY_NS);
  assert.equal(v.effective_status, "failed");
  assert.equal(v.donors, undefined);
  assert.equal(F.listView(s, 2n * DAY_NS, { kind: "grant" }).length, 1);
  assert.equal(F.listView(s, 2n * DAY_NS, { kind: "loan" }).length, 0);
});

// ---- providers and hospital campaigns ----
const HOSP = "cancer-hospital.testnet", HVER = "second-verifier.testnet", LIC = "sha256-licence01";
const withProvider = () => {
  const s = mk();
  F.addVerifier(s, c(OWNER), { account: HVER, name: "Second Verifier" });
  F.applyProvider(s, c(HOSP), { name: "City Cancer Hospital", type: "hospital", country: "Kenya", license_hash: LIC });
  return s;
};
const campaignArgs = (extra = {}) => ({ kind: "campaign", category: "equipment", title: "New chemo chairs", story: "", doc_hash: DOC, goal: String(n(10)), verifier: HVER, days: 30, milestones: 2, ...extra });

test("a hospital applies, stays pending, and only the owner can approve it", () => {
  const s = withProvider();
  assert.equal(s.providers[HOSP].status, "pending");
  assert.equal(s.verifiers[HOSP], undefined);
  assert.throws(() => F.applyProvider(s, c(HOSP), { name: "x", type: "hospital", country: "K", license_hash: LIC }), /already applied/);
  assert.throws(() => F.applyProvider(s, c(ALICE), { name: "x", type: "casino", country: "K", license_hash: LIC }), /type must be/);
  assert.throws(() => F.applyProvider(s, c(ALICE), { name: "x", type: "hospital", country: "K", license_hash: "" }), /license_hash/);
  assert.throws(() => F.approveProvider(s, c(ALICE), { account: HOSP }), /Only the owner/);
  F.approveProvider(s, c(OWNER), { account: HOSP });
  assert.equal(s.providers[HOSP].status, "approved");
  assert.equal(s.verifiers[HOSP].provider, true);
});

test("a rejected provider can re-apply; a rejection removes verifier rights", () => {
  const s = withProvider();
  F.approveProvider(s, c(OWNER), { account: HOSP });
  F.rejectProvider(s, c(OWNER), { account: HOSP });
  assert.equal(s.verifiers[HOSP], undefined);
  F.applyProvider(s, c(HOSP), { name: "City Cancer Hospital", type: "hospital", country: "Kenya", license_hash: LIC });
  assert.equal(s.providers[HOSP].status, "pending");
});

test("only an approved provider can open a hospital campaign", () => {
  const s = withProvider();
  assert.throws(() => F.createCase(s, c(HOSP), campaignArgs()), /approved providers/);
  assert.throws(() => F.createCase(s, c(ALICE), campaignArgs()), /approved providers/);
  F.approveProvider(s, c(OWNER), { account: HOSP });
  assert.equal(F.createCase(s, c(HOSP), campaignArgs()).result.id, 1);
  assert.throws(() => F.createCase(s, c(HOSP), campaignArgs({ verifier: HOSP })), /own case/);
});

test("campaign needs a different verifier and is paid to the hospital itself", () => {
  const s = withProvider(); F.approveProvider(s, c(OWNER), { account: HOSP });
  const id = F.createCase(s, c(HOSP), campaignArgs()).result.id;
  assert.throws(() => F.verifyCase(s, c(HOSP), { id, payee: HOSP, doc_hash: DOC }), /chosen, registered verifier/);
  assert.throws(() => F.verifyCase(s, c(HVER), { id, payee: ALICE, doc_hash: DOC }), /paid to the hospital that opened/);
  F.verifyCase(s, c(HVER, 1n * DAY_NS, STK), { id, payee: HOSP, doc_hash: DOC });
  F.donate(s, c(CAROL, 2n * DAY_NS, n(10)), { id });
  assert.throws(() => F.donate(s, c(HOSP, 2n * DAY_NS, n(1)), { id }), /Only 0|not open|cannot fund/);
  const r1 = F.releaseMilestone(s, c(HVER), { id, evidence: BILL });
  assert.deepEqual(r1.transfer, { to: HOSP, amount: n(5) });
  F.releaseMilestone(s, c(HVER), { id, evidence: "sha256-bill0002" });
  assert.equal(s.cases[id].status, "completed");
});

test("campaign refunds and reports work like a grant", () => {
  const s = withProvider(); F.approveProvider(s, c(OWNER), { account: HOSP });
  const id = F.createCase(s, c(HOSP), campaignArgs()).result.id;
  F.verifyCase(s, c(HVER, 1n * DAY_NS, STK), { id, payee: HOSP, doc_hash: DOC });
  F.donate(s, c(CAROL, 2n * DAY_NS, n(4)), { id });
  assert.equal(F.refund(s, c(CAROL, 40n * DAY_NS), { id }).transfer.amount, n(4));
  assert.equal(F.providerList(s, 0n).find((p) => p.account === HOSP).campaigns, 1);
});
