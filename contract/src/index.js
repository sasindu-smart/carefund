// CareFund contract (near-sdk-js). A thin wrapper: every rule lives in fund-core.js,
// which has no SDK imports and is covered by `npm test`.
//
// The wrapper only reads who called, the time and the attached NEAR, calls the core,
// stores the state, writes the log lines and sends the one transfer (if any).
//
//   owner     -> add_verifier, remove_verifier, approve_provider, reject_provider, unfreeze, confirm_fraud
//   provider  -> apply_provider (a hospital, clinic, rehabilitation centre or NGO applies; once approved
//                it can open a "campaign" with create_case, verified by a different verifier)
//   anyone    -> create_case, cancel_case (requester), donate, refund, claim_repayment,
//                flag_case, mark_default, repay (borrower)
//   verifier  -> verify_case (+ guarantee for loans), reject_case, release_milestone, withdraw_stake
//   views     -> get_case, get_account_view, list_cases, get_verifiers, get_reputation, get_config

import { NearBindgen, near, call, view, initialize, NearPromise } from "near-sdk-js";
import * as F from "./fund-core.js";

@NearBindgen({})
class CareFund {
  constructor() {
    this.data = "";
  }

  load() {
    if (!this.data) throw new Error("Contract is not initialized");
    return JSON.parse(this.data);
  }

  save(s) {
    this.data = JSON.stringify(s);
  }

  ctx() {
    return {
      caller: near.predecessorAccountId(),
      now: near.blockTimestamp(),
      deposit: near.attachedDeposit(),
    };
  }

  run(fn, args) {
    const s = this.load();
    const out = F.exec(fn, s, this.ctx(), args || {});
    this.save(s);
    for (const line of out.logs) near.log(line);
    if (out.transfer) return NearPromise.new(out.transfer.to).transfer(out.transfer.amount);
    return out.result ?? null;
  }

  @initialize({})
  init({ owner }) {
    this.save(F.newState(owner));
  }

  // ---- admin
  @call({}) add_verifier(a) { return this.run(F.addVerifier, a); }
  @call({}) remove_verifier(a) { return this.run(F.removeVerifier, a); }
  @call({}) unfreeze(a) { return this.run(F.unfreeze, a); }
  @call({}) confirm_fraud(a) { return this.run(F.confirmFraud, a); }
  @call({}) approve_provider(a) { return this.run(F.approveProvider, a); }
  @call({}) reject_provider(a) { return this.run(F.rejectProvider, a); }

  // ---- hospitals and other providers apply here
  @call({}) apply_provider(a) { return this.run(F.applyProvider, a); }

  // ---- asking for help
  @call({}) create_case(a) { return this.run(F.createCase, a); }
  @call({}) cancel_case(a) { return this.run(F.cancelCase, a); }

  // ---- verifier (verify_case is payable: a loan needs the guarantee attached)
  @call({ payableFunction: true }) verify_case(a) { return this.run(F.verifyCase, a); }
  @call({}) reject_case(a) { return this.run(F.rejectCase, a); }
  @call({}) release_milestone(a) { return this.run(F.releaseMilestone, a); }
  @call({}) withdraw_stake(a) { return this.run(F.withdrawStake, a); }

  // ---- donors and lenders
  @call({ payableFunction: true }) donate(a) { return this.run(F.donate, a); }
  @call({}) refund(a) { return this.run(F.refund, a); }
  @call({}) claim_repayment(a) { return this.run(F.claimRepayment, a); }

  // ---- loans
  @call({ payableFunction: true }) repay(a) { return this.run(F.repay, a); }
  @call({}) mark_default(a) { return this.run(F.markDefault, a); }

  // ---- reports
  @call({}) flag_case(a) { return this.run(F.flagCase, a); }

  // ---- views
  @view({})
  get_case({ id }) {
    const c = this.load().cases[String(id)];
    return c ? F.caseView(c, near.blockTimestamp()) : null;
  }

  @view({})
  get_account_view({ id, account }) {
    const c = this.load().cases[String(id)];
    return c ? F.accountView(c, account, near.blockTimestamp()) : null;
  }

  @view({})
  list_cases(a) {
    return F.listView(this.load(), near.blockTimestamp(), a || {});
  }

  @view({})
  get_verifiers() {
    return this.load().verifiers;
  }

  @view({})
  get_audit(a) {
    return F.auditList(this.load(), a || {});
  }

  @view({})
  get_verifier_stats({ account }) {
    return F.verifierStats(this.load(), account);
  }

  @view({})
  get_providers() {
    return F.providerList(this.load(), near.blockTimestamp());
  }

  @view({})
  get_reputation({ account }) {
    const s = this.load();
    const r = s.rep[account] || { repaid: 0, defaults: 0 };
    return { ...r, loan_limit: String(F.loanLimit(s, account)) };
  }

  @view({})
  get_config() {
    const c = F.CFG;
    return {
      owner: this.load().owner,
      categories: F.CATEGORIES,
      guarantee_permille: String(c.GUARANTEE_PM),
      flag_min_reporters: c.FLAG_MIN_REPORTERS,
      flag_permille: String(c.FLAG_PM),
      stake_permille: String(c.STAKE_PM),
      freeze_timeout_days: c.FREEZE_TIMEOUT_DAYS,
      loan_base_limit: String(c.LOAN_BASE_LIMIT),
      loan_step: String(c.LOAN_STEP),
      grace_days: String(c.GRACE_DAYS),
    };
  }
}
