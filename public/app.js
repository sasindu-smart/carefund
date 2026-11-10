import * as F from "/core/fund-core.js";
import { createDemo, ACCOUNTS, VERIFIERS } from "/demo.js";
import { createChain } from "/chain.js";

const { NEAR } = F;
const CFG = window.CAREFUND || { mode: "demo" };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const B = (x) => BigInt(x);

/* ---------- formatting ---------- */
const fmt = (y) => {
  const v = B(y), whole = v / NEAR, frac = ((v % NEAR) * 1000n) / NEAR;
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === 0n ? w : w + "." + frac.toString().padStart(3, "0").replace(/0+$/, "");
};
const toYocto = (txt) => {
  const m = String(txt).trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!m) throw new Error("Enter an amount like 5 or 2.5");
  return B(m[1]) * NEAR + (B((m[2] || "").padEnd(6, "0")) * NEAR) / 1000000n;
};
const dateOf = (ns) => new Date(Number(B(ns) / 1_000_000n)).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const daysLeft = (c) => { if (!c.deadline) return null; return Math.ceil(Number((B(c.deadline) - be.now()) / F.DAY_NS * 1000n) / 1000); };
const short = (h) => (h && h.length > 18 ? h.slice(0, 13) + "…" + h.slice(-4) : h || "");
const pct = (a, b) => (B(b) === 0n ? 0 : Math.min(100, Number((B(a) * 10000n) / B(b)) / 100));
const cap = (s) => s.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

const STATUS = {
  pending: ["Waiting for verifier", "hold"], open: ["Open", "ok"], funded: ["Fully funded", "ok"], completed: ["Completed", "ok"],
  repaying: ["Being repaid", "hold"], repaid: ["Repaid", "ok"], defaulted: ["Defaulted", "block"], failed: ["Goal missed", ""],
  cancelled: ["Cancelled", ""], rejected: ["Rejected", ""], frozen: ["Frozen after reports", "block"], fraud: ["Fraud confirmed, refunded", "block"],
};

/* ---------- backend ---------- */
const be = CFG.mode === "chain" ? createChain(CFG) : createDemo();
const demo = be.mode === "demo";
let VERS = {};
let view = "cases", kindF = "", catF = "";

function toast(msg, kind = "quiet") {
  const t = $("toast"); t.textContent = msg; t.className = "toast show " + kind;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = "toast " + kind), kind === "block" ? 6500 : 3800);
}
const errMsg = (e) => (e && e.message ? e.message.replace(/^.*?Error:\s*/, "") : String(e));

async function hashBlob(blob) {
  const buf = await blob.arrayBuffer();
  const d = await crypto.subtle.digest("SHA-256", buf);
  return "sha256-" + [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const hashText = (t) => hashBlob(new Blob([t]));

/* ---------- shell ---------- */
const VIEWS = ["cases", "hosp", "ask", "desk", "me", "audit", "how"];
const NAV = [["cases", "Cases"], ["hosp", "Hospitals"], ["ask", "Ask for help"], ["desk", "Verifier desk"], ["me", "My activity"], ["audit", "Audit trail"], ["how", "How it works"]];
function paintNav() {
  const html = NAV.map(([k, l]) => `<button data-v="${k}" ${view === k ? 'aria-current="page"' : ""}>${l}</button>`).join("");
  $("nav").innerHTML = html; $("mnav").innerHTML = html;
  document.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => go(b.dataset.v)));
}
function go(v) {
  view = v; closeSheet();
  VIEWS.forEach((k) => ($("v-" + k).hidden = k !== v));
  paintNav(); render(); window.scrollTo({ top: 0 });
  try { history.replaceState(null, "", "#" + v); } catch {}
}
$("home").onclick = () => { location.href = "/"; };
$("home").onkeydown = (e) => { if (e.key === "Enter") location.href = "/"; };

function paintTop() {
  $("modePill").textContent = demo ? "Demo mode" : "NEAR " + CFG.network;
  $("demoBar").hidden = !demo;
  if (demo) {
    $("walletBtn").hidden = false;
    const a = be.account();
    $("actor").innerHTML = ACCOUNTS.map((x) => `<option value="${esc(x.id)}" ${x.id === a ? "selected" : ""}>${esc(x.id)} · ${esc(x.role)}</option>`).join("");
    $("bal").textContent = fmt(be.balance()) + " NEAR";
    $("clock").textContent = new Date(Number(be.now() / 1_000_000n)).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } else {
    const w = window.Wallet.state();
    $("walletBtn").hidden = false;
    $("walletBtn").textContent = w.account ? w.account.length > 22 ? w.account.slice(0, 20) + "…" : w.account : "Connect wallet";
  }
}

/* ---------- cases list ---------- */
const kindTabs = [["", "All"], ["grant", "Grants"], ["loan", "Loans"], ["campaign", "Hospital campaigns"]];
const kindLabel = (k) => (k === "campaign" ? "hospital" : k);
function chips(list, cur, attr) {
  return list.map(([k, l]) => `<button class="chip" ${attr}="${esc(k)}" aria-pressed="${cur === k}">${esc(l)}</button>`).join("");
}
function card(c) {
  const [stl, stc] = STATUS[c.effective_status] || [c.effective_status, ""];
  const dl = daysLeft(c);
  const live = ["open"].includes(c.effective_status);
  const pay = c.payee ? (c.kind === "loan" ? `Lenders are repaid by <code>${esc(c.requester)}</code>` : `Paid directly to <code>${esc(c.payee)}</code>`) : "Payee is set once the verifier approves";
  return `<button class="card case" data-case="${c.id}" aria-label="${esc(c.title)}">
    <div class="tags"><span class="tag ${c.kind}">${kindLabel(c.kind)}</span><span class="tag st ${stc}">${esc(stl)}</span></div>
    <h3>${esc(c.title)}</h3>
    <div class="by">${esc(cap(c.category))} · by ${esc(c.requester)}</div>
    ${c.payee || c.status !== "pending" ? `<div class="ver">✔ Verified by ${esc((VERS[c.verifier] && VERS[c.verifier].name) || c.verifier)}</div>` : `<div class="by">Verifier: ${esc((VERS[c.verifier] && VERS[c.verifier].name) || c.verifier)}</div>`}
    <div class="track"><div class="fill ${c.kind === "loan" ? "loan" : ""}" style="width:${pct(c.raised, c.goal)}%"></div></div>
    <div class="row"><span><b>${fmt(c.raised)}</b> / ${fmt(c.goal)} NEAR</span><span>${live && dl != null ? (dl > 0 ? dl + " days left" : "ends today") : c.kind === "loan" ? c.parts + " repayments" : c.donors_count + " donors"}</span></div>
    <div class="pay">${pay}</div>
  </button>`;
}
function stat(k, v, s) { return `<div class="card stat"><div class="k">${k}</div><div class="v">${v}<small>NEAR</small></div><div class="s">${s}</div></div>`; }
function statN(k, v, s) { return `<div class="card stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`; }

async function renderCases() {
  const all = await be.list({});
  const live = all.filter((c) => ["open", "funded", "repaying"].includes(c.effective_status));
  const sum = (f) => all.reduce((t, c) => t + B(f(c)), 0n);
  $("stats").innerHTML =
    statN("Live cases", live.length, "checked by a verifier") +
    stat("Raised", fmt(sum((c) => c.raised)), "waiting in escrow or released") +
    stat("Released to providers", fmt(sum((c) => c.released)), "each part against a bill") +
    stat("Paid back to lenders", fmt(sum((c) => B(c.repaid || 0) + B(c.slashed || 0))), "repayments and guarantees");
  $("kindF").innerHTML = chips(kindTabs, kindF, "data-kind");
  $("catF").innerHTML = chips([["", "All categories"], ...be.categories().map((k) => [k, cap(k)])], catF, "data-cat");
  document.querySelectorAll("[data-kind]").forEach((b) => (b.onclick = () => { kindF = b.dataset.kind; renderCases(); }));
  document.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => { catF = b.dataset.cat; renderCases(); }));
  const shown = all.filter((c) => c.effective_status !== "pending" && c.effective_status !== "rejected" && (!kindF || c.kind === kindF) && (!catF || c.category === catF));
  $("casesSub").textContent = shown.length + " shown · every case on this page has been checked by a verifier";
  $("grid").innerHTML = shown.length ? shown.map(card).join("") : `<div class="card empty" style="grid-column:1/-1"><b>No cases here yet</b>Try another filter, or ask for help.</div>`;
  document.querySelectorAll("[data-case]").forEach((b) => (b.onclick = () => openCase(b.dataset.case)));
  $("labBox").hidden = !demo;
  if (demo) renderLab(all);
}

/* ---------- rule lab (demo) ---------- */
function renderLab(all) {
  const pend = all.find((c) => c.status === "pending" && c.kind === "grant");
  const open = all.find((c) => c.status === "open" && c.kind === "grant");
  const tests = [];
  if (pend) tests.push(["A verifier tries to pay the grant to the patient's own wallet", () => be.probe("verify_case", pend.verifier, { id: pend.id, payee: pend.requester, doc_hash: pend.doc_hash })]);
  if (pend) tests.push(["A verifier approves a grant without putting any money at stake", () => be.probe("verify_case", pend.verifier, { id: pend.id, payee: "pharmacy.testnet", doc_hash: pend.doc_hash })]);
  if (open) tests.push(["A throwaway account that gave nothing reports a case", () => be.probe("flag_case", "troll-123.testnet", { id: open.id, reason: "fake" })]);
  if (pend) tests.push(["A stranger tries to verify a case", () => be.probe("verify_case", "alice.testnet", { id: pend.id, payee: "pharmacy.testnet", doc_hash: pend.doc_hash })]);
  if (open) tests.push(["A patient funds their own case", () => be.probe("donate", open.requester, { id: open.id }, n1())]);
  if (open) tests.push(["The verifier releases money before the goal is reached", () => be.probe("release_milestone", open.verifier, { id: open.id, evidence: "sha256-fake0001" })]);
  if (open) tests.push(["Someone gives more than the case needs", () => be.probe("donate", "alice.testnet", { id: open.id }, B(open.goal) * 2n)]);
  $("lab").innerHTML = tests.map((t, i) => `<div><button class="b-ghost b-sm" data-lab="${i}">${esc(t[0])}</button><div id="lab${i}"></div></div>`).join("");
  document.querySelectorAll("[data-lab]").forEach((b) => (b.onclick = () => {
    const r = tests[b.dataset.lab][1]();
    $("lab" + b.dataset.lab).innerHTML = r.ok ? `<div class="res"><b>Allowed?</b> This should have been refused.</div>` : `<div class="res"><b>Refused by the contract:</b> ${esc(r.error)}</div>`;
  }));
}
const n1 = () => NEAR;

/* ---------- case sheet ---------- */
let openId = null;
const closeSheet = () => { $("sheet").hidden = true; openId = null; };
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeSheet(); $("wmodal").hidden = true; } });

function milestoneSteps(c) {
  const each = B(c.goal) / B(c.milestones);
  const out = [];
  for (let k = 1; k <= c.milestones; k++) {
    const amt = k === c.milestones ? B(c.goal) - each * B(c.milestones - 1) : each;
    const done = k <= c.released_n;
    const next = !done && k === c.released_n + 1 && c.effective_status === "funded";
    out.push(`<div class="step"><span class="dot ${done ? "done" : next ? "now" : ""}">${done ? "✓" : k}</span><div><b>Milestone ${k}: ${fmt(amt)} NEAR to the payee</b><small>${done ? "Released against bill " + esc(short(c.evidence[k - 1])) : next ? "Next: waiting for the verifier to confirm a bill" : "Released after the previous step"}</small></div></div>`);
  }
  return out.join("");
}

async function openCase(id) {
  openId = id;
  const c = await be.get(id);
  if (!c) return;
  const me = be.account();
  const av = me ? await be.acct(id, me) : null;
  const [stl, stc] = STATUS[c.effective_status] || [c.effective_status, ""];
  const dl = daysLeft(c);
  const vname = (VERS[c.verifier] && VERS[c.verifier].name) || c.verifier;
  const isReq = me === c.requester, isVer = me === c.verifier, isOwner = me && me === be.owner();
  const st = c.effective_status;
  const stakeFree = B(c.stake_free || 0), stakeLocked = B(c.stake_locked || 0);
  let vst = { completed: 0, frauds: 0 }; try { vst = (await be.vstats(c.verifier)) || vst; } catch {}

  let loanBox = "";
  if (c.kind === "loan" && ["repaying", "repaid", "defaulted"].includes(st)) {
    const rec = B(c.repaid) + B(c.slashed || 0);
    loanBox = `<div class="card panel" style="margin-top:12px"><h3>Repayment</h3>
      <div class="track"><div class="fill loan" style="width:${pct(rec, c.goal)}%"></div></div>
      <div class="row"><span><b>${fmt(c.repaid)}</b> repaid${B(c.slashed || 0) > 0n ? ` + <b>${fmt(c.slashed)}</b> from the guarantee` : ""}</span><span>of ${fmt(c.goal)} NEAR</span></div>
      <p class="sub" style="margin:8px 0 0">${c.parts} payments, one every ${c.period_days} days, starting ${c.started_at ? dateOf(c.started_at) : "after the last milestone"}. Due so far: <b>${fmt(c.expected_repayment)}</b> NEAR.</p></div>`;
  }
  const stakeTotal = stakeLocked + stakeFree + B(c.slashed || 0) + B(c.slash_pool || 0);
  const stakeWhat = c.kind === "loan" ? "guarantee" : "stake";
  const guarantee = stakeTotal > 0n
    ? `<div class="note ${st === "fraud" ? "" : "ok"}" style="margin-top:12px"><b>Verifier ${stakeWhat}:</b> ${esc(vname)} locked ${fmt(stakeTotal)} NEAR (${c.kind === "loan" ? "20" : "5"}% of the goal). ${st === "fraud" ? "Fraud was confirmed: it was paid to the donors on top of their refund." : stakeLocked > 0n ? (c.kind === "loan" ? "It pays lenders first if the loan is not repaid." : "It comes back when the case completes. If fraud is confirmed it is paid to the donors.") : B(c.slashed || 0) > 0n ? "It was used to cover lenders after the default." : "It is free to withdraw."}</div>` : "";
  const frozenBox = st === "frozen" ? `<div class="note" style="margin-top:12px"><b>Frozen.</b> Donors holding ${pct(c.flagged_amount, c.raised)}% of the money reported this case. Releases are paused while the owner reviews it. If there is no decision, refunds open after ${F.CFG.FREEZE_TIMEOUT_DAYS} days.</div>` : "";

  let acts = "";
  const A = [];
  // donor / lender actions
  if (st === "open" && me && !isReq && !isVer) {
    const left = B(c.goal) - B(c.raised);
    A.push(`<div class="arow"><div class="inline"><label class="f">${c.kind === "loan" ? "Lend" : "Donate"} (NEAR)<input id="donAmt" inputmode="decimal" value="${esc(fmt(left < NEAR * 10n ? left : NEAR * 10n))}"></label><button class="${c.kind === "loan" ? "b-hold" : "b-ok"}" data-do="donate">${c.kind === "loan" ? "Lend" : "Donate"}</button></div><small class="sub">${fmt(left)} NEAR still needed. Money waits inside the contract until the goal is reached.</small></div>`);
  }
  if (av && B(av.refundable) > 0n) A.push(`<div class="arow"><div class="inline"><div><b>${fmt(av.refundable)} NEAR</b> can go back to you.<div class="sub">Goal missed, cancelled or frozen: you can take back what has not been released.</div></div><button class="b-ghost" data-do="refund">Take refund</button></div></div>`);
  if (av && B(av.claimable_repayment) > 0n) A.push(`<div class="arow"><div class="inline"><div><b>${fmt(av.claimable_repayment)} NEAR</b> of your loan has been repaid.</div><button class="b-ok" data-do="claim">Claim it</button></div></div>`);
  if (me && !isReq && !isVer && ["open", "funded"].includes(st) && av && B(av.contributed) > 0n && !av.flagged) {
    A.push(`<div class="arow"><div class="inline"><label class="f">Report this case<input id="flagWhy" maxlength="140" placeholder="What looks wrong? (optional)"></label><button class="b-danger" data-do="flag">⚑ Report</button></div><small class="sub">Only donors can report. At least ${F.CFG.FLAG_MIN_REPORTERS} donors who together gave ${Number(F.CFG.FLAG_PM) / 10}% of the money freeze the case. So far: ${c.flag_count || 0} reporter(s), ${pct(c.flagged_amount || 0, c.raised)}% of the money.</small></div>`);
  }
  // requester
  if (isReq && ["pending", "open"].includes(c.status)) A.push(`<div class="arow"><div class="inline"><div>Changed your mind? ${c.status === "open" ? "Donors will be able to take their money back." : ""}</div><button class="b-danger" data-do="cancel">Cancel my request</button></div></div>`);
  if (isReq && c.kind === "loan" && ["repaying", "defaulted"].includes(c.status)) {
    const owing = B(c.goal) - B(c.repaid) - B(c.slashed || 0);
    if (owing > 0n) A.push(`<div class="arow"><div class="inline"><label class="f">Repay (NEAR)<input id="repayAmt" inputmode="decimal" value="${esc(fmt(owing / BigInt(Math.max(1, c.parts))))}"></label><button class="b-hold" data-do="repay">Repay</button></div><small class="sub">${fmt(owing)} NEAR still owed.</small></div>`);
  }
  if (c.ai_check && c.status !== "pending") {
    const ck = c.ai_check, ov = ck.overruled;
    A.push(`<div class="arow ai"><b>AI advice and the human decision</b><div class="aiRes">${aiChip(ck.verdict)} <small>rules v${ck.rules_version} · the verifier ${c.status === "rejected" ? "rejected" : "approved"} this case${ov ? ", <b>against the AI's advice</b>" : ck.verdict === "review" ? " after looking closer" : ", in line with the AI"}.</small></div></div>`);
  }
  // verifier
  if (isVer && c.status === "pending") {
    A.push(`<div class="arow ai" id="aiBox"><b>AI pre-check <span class="tagt">advice only</span></b>
      <div class="sub">An AI reads the request against the platform's rules and says green, look closer, or red. <b>You decide.</b> The AI never moves money and can be overruled.</div>
      ${c.ai_check ? `<div class="aiRes">${aiChip(c.ai_check.verdict)} <small>Recorded on-chain with rules version ${c.ai_check.rules_version}.</small></div>` : `<div id="aiOut"></div><div class="inline"><button class="b-ghost" data-do="aicheck">Run AI pre-check</button></div>`}</div>`);
    const need = (B(c.goal) * (c.kind === "loan" ? F.CFG.GUARANTEE_PM : F.CFG.STAKE_PM)) / 1000n;
    A.push(`<div class="arow"><b>Check this request</b>
      <label class="f">Payee wallet (who is paid)<input id="vPayee" ${c.kind === "campaign" ? "readonly" : ""} placeholder="${c.kind === "grant" ? "hospital or pharmacy wallet, not the patient" : "the borrower or a supplier"}" value="${c.kind !== "grant" ? esc(c.requester) : ""}"></label>
      <label class="f">Fingerprint of the documents you checked<input id="vHash" value="${demo ? esc(c.doc_hash) : ""}" placeholder="sha256-…"><small>Must match what the requester submitted. ${demo ? "Demo: pre-filled." : "Pick the same files below."}</small></label>
      <label class="f">…or choose the file<input id="vFile" type="file"></label>
      <div class="note"><b>${c.kind === "loan" ? "Guarantee" : "Stake"}:</b> you lock ${fmt(need)} NEAR (${c.kind === "loan" ? "20" : "5"}%). ${c.kind === "loan" ? "It is paid to lenders if the borrower defaults." : "It comes back when the case completes. If the case is frozen and the owner confirms fraud, it is paid to the donors."}</div>
      <div class="inline"><button class="b-ok" data-do="verify" data-need="${need}">Verify and lock ${fmt(need)} NEAR</button><button class="b-danger" data-do="reject">Reject</button></div></div>`);
  }
  if (isVer && st === "funded") {
    A.push(`<div class="arow"><b>Release milestone ${c.released_n + 1} of ${c.milestones}</b><label class="f">Fingerprint of the bill or proof<input id="evHash" placeholder="sha256-…" value="${demo ? "sha256-" + Math.random().toString(16).slice(2).padEnd(16, "0") : ""}"></label><label class="f">…or choose the file<input id="evFile" type="file"></label><button class="b-ok" data-do="release">Release to ${esc(c.payee)}</button></div>`);
  }
  if (isVer && (stakeFree > 0n || (stakeLocked > 0n && ["failed", "cancelled"].includes(st)))) A.push(`<div class="arow"><div class="inline"><div>Your ${stakeWhat} is free to take back.</div><button class="b-ghost" data-do="stake">Withdraw ${stakeWhat}</button></div></div>`);
  // anyone
  if (c.kind === "loan" && st === "repaying" && B(c.repaid) < B(c.expected_repayment)) A.push(`<div class="arow"><div class="inline"><div><b>Repayment is overdue.</b><div class="sub">Anyone can ask the contract to declare a default. It checks the maths itself.</div></div><button class="b-danger" data-do="default">Declare default</button></div></div>`);
  if (isOwner && st === "frozen") A.push(`<div class="arow"><b>Owner decision</b><div class="inline"><button class="b-ok" data-do="unfreeze">Dismiss reports, continue</button><button class="b-danger" data-do="fraud">Confirm fraud</button></div><small class="sub">Confirming fraud refunds the donors, pays them the verifier's stake on top, and removes the verifier.</small></div>`);
  acts = `<div class="actions"><h3>${me ? "What you can do" : "Connect a wallet to take part"}</h3>${A.join("") || `<p class="sub">${me ? "Nothing to do here with this account. Switch the account at the top to play another role." : "Connect your wallet first."}</p>`}</div>`;

  $("sheetBody").innerHTML = `<button class="close b-ghost" id="xs" aria-label="Close">✕</button>
    <div class="tags"><span class="tag ${c.kind}">${kindLabel(c.kind)}</span><span class="tag st ${stc}">${esc(stl)}</span><span class="tag st">${esc(cap(c.category))}</span></div>
    <h2>${esc(c.title)}</h2>
    <p class="sub" style="margin:8px 0 0">${esc(c.story) || "No story added."}</p>
    <div class="track" style="margin-top:16px"><div class="fill ${c.kind === "loan" ? "loan" : ""}" style="width:${pct(c.raised, c.goal)}%"></div></div>
    <div class="row"><span><b>${fmt(c.raised)}</b> / ${fmt(c.goal)} NEAR · ${c.donors_count} ${c.kind === "loan" ? "lenders" : "donors"}</span><span>${st === "open" && dl != null ? (dl > 0 ? dl + " days left · ends " + dateOf(c.deadline) : "ends today") : ""}</span></div>
    <div class="who"><div>Requester<b>${esc(c.requester)}</b></div><div>Verifier<b>${esc(vname)}</b><span style="display:block;font-size:12px;margin-top:3px">${vst.completed} completed · ${vst.frauds} fraud${vst.frauds === 1 ? "" : "s"}</span></div><div class="hi">Money goes to<b>${esc(c.payee || "set by the verifier")}</b></div></div>
    <div class="card panel"><h3>How the money moves</h3><div class="steps">
      <div class="step"><span class="dot ${["pending"].includes(c.status) ? "now" : "done"}">${c.status === "pending" ? "1" : "✓"}</span><div><b>Verifier checks the documents</b><small>Fingerprint on-chain: <span class="mono">${esc(short(c.doc_hash))}</span>. The documents themselves stay private.</small></div></div>
      <div class="step"><span class="dot ${["funded", "completed", "repaying", "repaid", "defaulted"].includes(c.status) ? "done" : c.status === "open" ? "now" : ""}">${["funded", "completed", "repaying", "repaid", "defaulted"].includes(c.status) ? "✓" : "2"}</span><div><b>${c.kind === "loan" ? "Lenders fund it" : "Donors fund it"}</b><small>Money waits inside the contract. If the goal is missed, everyone is refunded.</small></div></div>
      ${milestoneSteps(c)}
      ${c.kind === "loan" ? `<div class="step"><span class="dot ${st === "repaid" ? "done" : st === "repaying" ? "now" : ""}">${st === "repaid" ? "✓" : "↩"}</span><div><b>Borrower repays in ${c.parts} parts</b><small>Lenders claim their share as repayments arrive.</small></div></div>` : ""}
    </div></div>
    ${loanBox}${frozenBox}${guarantee}${acts}`;
  $("sheet").hidden = false;
  $("xs").onclick = closeSheet;
  $("sheetBody").querySelectorAll("[data-do]").forEach((b) => (b.onclick = () => doAction(b, c)));
  const vf = $("vFile"); if (vf) vf.onchange = async () => { if (vf.files[0]) $("vHash").value = await hashBlob(vf.files[0]); };
  const ef = $("evFile"); if (ef) ef.onchange = async () => { if (ef.files[0]) $("evHash").value = await hashBlob(ef.files[0]); };
}

const AI_LABEL = { green: ["Looks fine", "ok"], review: ["Look closer", "hold"], red: ["Problem found", "block"] };
const aiChip = (v) => `<span class="tag st ${(AI_LABEL[v] || [])[1] || ""}">AI: ${esc((AI_LABEL[v] || [v])[0])}</span>`;
async function runAiCheck(btn, c) {
  const out = $("aiOut"); btn.disabled = true; out.innerHTML = `<p class="sub">Asking the AI…</p>`;
  try {
    const rules = await be.aiRules();
    const r = await fetch("/api/precheck", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      rules: rules.rules, rules_version: rules.version,
      case: { kind: c.kind, category: c.category, title: c.title, story: c.story, goal_near: fmt(c.goal), days: c.days, parts: c.parts, requester: c.requester, payee: $("vPayee") ? $("vPayee").value : "" },
    }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || "AI check failed");
    lastAi = j;
    out.innerHTML = `<div class="aiRes">${aiChip(j.verdict)} <small>${j.source === "near-ai" ? "NEAR AI · " + esc(j.model) : "Written checks (no AI key on this server)"} · rules v${j.rules_version}</small>
      ${j.reasons.length ? `<ul class="aiList ok">${j.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${j.concerns.length ? `<ul class="aiList bad">${j.concerns.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${j.note ? `<small class="sub">${esc(j.note)}</small>` : ""}
      <div class="inline"><button class="b-ghost b-sm" id="aiRecord">Record this on-chain</button><small class="sub">Optional. It shows donors the AI's advice and whether you agreed.</small></div></div>`;
    $("aiRecord").onclick = async (e) => {
      e.target.disabled = true;
      try { const o = await be.call("attach_ai_check", { id: c.id, verdict: j.verdict, report_hash: j.report_hash, rules_version: j.rules_version }); toast(o.hash ? "Sent. It can take a few seconds to confirm." : "AI advice recorded.", "allow"); if (o.hash) await new Promise((x) => setTimeout(x, 4000)); await render(); if (openId) await openCase(openId); }
      catch (err) { e.target.disabled = false; toast(errMsg(err), "block"); }
    };
  } catch (e) { out.innerHTML = `<p class="sub">${esc(errMsg(e))}</p>`; }
  btn.disabled = false;
}
let lastAi = null;

async function doAction(btn, c) {
  const k = btn.dataset.do;
  if (k === "aicheck") return runAiCheck(btn, c);
  const v = (id) => ($(id) ? $(id).value.trim() : "");
  try {
    let method, args = { id: c.id }, dep = 0n, ok = "Done";
    if (k === "donate") { method = "donate"; dep = toYocto(v("donAmt")); ok = "Thank you. Your " + (c.kind === "loan" ? "loan" : "donation") + " is in escrow."; }
    else if (k === "refund") { method = "refund"; ok = "Refund sent back to you."; }
    else if (k === "claim") { method = "claim_repayment"; ok = "Repayment sent to you."; }
    else if (k === "flag") { method = "flag_case"; args.reason = v("flagWhy"); ok = "Report recorded."; }
    else if (k === "cancel") { method = "cancel_case"; ok = "Request cancelled."; }
    else if (k === "repay") { method = "repay"; dep = toYocto(v("repayAmt")); ok = "Repayment received."; }
    else if (k === "verify") { method = "verify_case"; args.payee = v("vPayee"); args.doc_hash = v("vHash"); dep = B(btn.dataset.need || 0); ok = "Verified. The case is now open for funding."; }
    else if (k === "reject") { method = "reject_case"; ok = "Case rejected."; }
    else if (k === "release") { method = "release_milestone"; args.evidence = v("evHash"); ok = "Milestone released to the payee."; }
    else if (k === "stake") { method = "withdraw_stake"; ok = "Guarantee returned."; }
    else if (k === "default") { method = "mark_default"; ok = "Default recorded. The guarantee now covers lenders."; }
    else if (k === "unfreeze") { method = "unfreeze"; ok = "Reports dismissed. The case continues."; }
    else if (k === "fraud") { method = "confirm_fraud"; ok = "Fraud confirmed. Donors can now take their refund plus the stake."; }
    btn.disabled = true;
    const out = await be.call(method, args, dep);
    toast(out.hash ? "Sent. It can take a few seconds to confirm." : ok, "allow");
    if (out.hash) await new Promise((r) => setTimeout(r, 4000));
    await render(); paintTop();
    if (openId) await openCase(openId);
  } catch (e) {
    btn.disabled = false;
    toast(errMsg(e), "block");
  }
}

/* ---------- hospitals ---------- */
let hospFilter = "";
const PTYPE = { hospital: "Hospital", clinic: "Clinic", rehabilitation: "Rehabilitation centre", ngo: "NGO", pharmacy: "Pharmacy" };
async function myProvider() {
  const me = be.account(); if (!me) return null;
  const list = await be.providers();
  return list.find((p) => p.account === me) || null;
}
async function renderHosp() {
  const me = be.account();
  const provs = await be.providers();
  const approved = provs.filter((p) => p.status === "approved");
  const mine = provs.find((p) => p.account === me);
  const all = await be.list({ kind: "campaign" });
  const live = all.filter((c) => !["pending", "rejected"].includes(c.effective_status));
  $("hospCta").innerHTML = mine && mine.status === "approved"
    ? `<button class="b-gold" id="hStart">Start a campaign for ${esc(mine.name.replace(" (example)", ""))}</button>`
    : mine && mine.status === "pending" ? `<span class="pill hold"><i></i> Your application is waiting for the owner</span>`
    : `<button class="b-gold" id="hReg">Register your hospital or clinic</button>`;
  if ($("hStart")) $("hStart").onclick = () => { askKind = "campaign"; go("ask"); };
  if ($("hReg")) $("hReg").onclick = () => openRegister();
  $("provSub").textContent = approved.length + " approved · each one applied with a licence fingerprint and was checked by the platform owner";
  $("provGrid").innerHTML = approved.length ? approved.map((p) => `<button class="card prov" data-prov="${esc(p.account)}" aria-pressed="${hospFilter === p.account}">
      <div class="tags"><span class="tag campaign">${esc(PTYPE[p.type] || p.type)}</span><span class="ver">✔ Verified provider</span></div>
      <h3>${esc(p.name)}</h3><div class="by">${esc(p.country)} · <span class="mono">${esc(p.account)}</span></div>
      <div class="lic">licence ${esc(short(p.license_hash))}</div>
      <div class="row" style="margin-top:8px"><span><b>${p.campaigns}</b> campaign${p.campaigns === 1 ? "" : "s"}</span><span><b>${fmt(p.raised)}</b> NEAR raised</span></div></button>`).join("")
    : `<div class="card empty" style="grid-column:1/-1"><b>No providers yet</b>Be the first hospital to register.</div>`;
  document.querySelectorAll("[data-prov]").forEach((b) => (b.onclick = () => { hospFilter = hospFilter === b.dataset.prov ? "" : b.dataset.prov; renderHosp(); }));
  const shown = live.filter((c) => !hospFilter || c.requester === hospFilter);
  $("campTitle").textContent = hospFilter ? "Campaigns by " + ((VERS[hospFilter] && VERS[hospFilter].name) || hospFilter) : "Hospital campaigns";
  $("campSub").textContent = hospFilter ? "Tap the provider again to see all campaigns." : shown.length + " live · paid to the hospital itself, verified by a different verifier";
  $("campGrid").innerHTML = shown.length ? shown.map(card).join("") : `<div class="card empty" style="grid-column:1/-1"><b>No campaigns yet</b>Approved providers can start one here.</div>`;
  document.querySelectorAll("#campGrid [data-case]").forEach((b) => (b.onclick = () => openCase(b.dataset.case)));
}

let regHash = "";
function openRegister() {
  $("sheetBody").innerHTML = `<button class="close b-ghost" id="xs" aria-label="Close">✕</button>
    <h2>Register your hospital or clinic</h2>
    <p class="sub" style="margin:8px 0 0">You apply with your own wallet. The platform owner reviews your licence and approves you. Until then you cannot receive donations.</p>
    <form class="form" id="regForm" autocomplete="off">
      <label class="f">Name of the hospital, clinic or centre<input id="rName" maxlength="80"></label>
      <div class="g2"><label class="f">Type<select id="rType">${Object.entries(PTYPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label class="f">Country<input id="rCountry" maxlength="40"></label></div>
      <label class="f">Your wallet<input value="${esc(be.account() || "Connect a wallet first")}" readonly></label>
      <label class="f">Licence or registration document <small>The file stays in your browser. Only its SHA-256 fingerprint is saved.</small><input id="rFile" type="file"></label>
      <div class="inline"><label class="f" style="flex:1">Fingerprint<input id="rHash" readonly placeholder="Choose a file" value="${esc(regHash)}"></label>${demo ? `<button type="button" class="b-ghost b-sm" id="rSample">Use a sample document</button>` : ""}</div>
      <button class="b-gold" id="rSend">Send application</button>
    </form>`;
  $("sheet").hidden = false; openId = null;
  $("xs").onclick = closeSheet;
  $("rFile").onchange = async () => { if ($("rFile").files[0]) { regHash = await hashBlob($("rFile").files[0]); $("rHash").value = regHash; } };
  if (demo) $("rSample").onclick = async () => { regHash = await hashText("licence-" + Math.random()); $("rHash").value = regHash; };
  $("regForm").onsubmit = async (e) => {
    e.preventDefault(); const b = $("rSend"); b.disabled = true;
    try {
      const out = await be.call("apply_provider", { name: $("rName").value, type: $("rType").value, country: $("rCountry").value, license_hash: $("rHash").value });
      toast(out.hash ? "Sent. It can take a few seconds to confirm." : "Application sent. The owner will review it.", "allow");
      regHash = ""; closeSheet(); await render();
    } catch (err) { toast(errMsg(err), "block"); b.disabled = false; }
  };
}

/* ---------- ask for help ---------- */
let askKind = "grant", askHash = "";
async function renderAsk() {
  const me = be.account();
  const mine = await myProvider();
  const isProv = !!mine && mine.status === "approved";
  if (askKind === "campaign" && !isProv) askKind = "grant";
  const vopts = Object.entries(VERS).filter(([id]) => id !== me || askKind !== "campaign").map(([id, v]) => `<option value="${esc(id)}">${esc(v.name)} · ${esc(id)}</option>`).join("");
  $("askForm").innerHTML = `
    <div><div class="seg ${isProv ? "seg3" : ""}">
      <button type="button" class="grant" data-k="grant" aria-pressed="${askKind === "grant"}"><b>Grant</b><small>A gift. No repayment.</small></button>
      <button type="button" class="loan" data-k="loan" aria-pressed="${askKind === "loan"}"><b>Loan</b><small>Repaid in parts. Needs a guarantee from the verifier.</small></button>
      ${isProv ? `<button type="button" class="campaign" data-k="campaign" aria-pressed="${askKind === "campaign"}"><b>Hospital campaign</b><small>Paid to ${esc(mine.name.replace(" (example)", ""))}.</small></button>` : ""}</div></div>
    ${askKind === "campaign" ? `<div class="note ok"><b>Hospital campaign.</b> The money is paid to your own wallet, so a <b>different</b> verifier must approve it before anyone can donate.</div>` : ""}
    <div class="g2"><label class="f">Category<select id="aCat">${be.categories().map((k) => `<option value="${k}" ${askKind === "campaign" && k === "equipment" ? "selected" : ""}>${esc(cap(k))}</option>`).join("")}</select></label>
      <label class="f">Goal (NEAR)<input id="aGoal" inputmode="decimal" value="${askKind === "loan" ? "10" : askKind === "campaign" ? "100" : "50"}"></label></div>
    <div class="note ok" id="aSens" hidden><b>Privacy first.</b> For rehabilitation and mental health, do not use a name or photo in the story. The money is paid only to the treatment centre the verifier names, never to a personal wallet.</div>
    <label class="f">Title<input id="aTitle" maxlength="80" placeholder="Short and clear"></label>
    <label class="f">Story <small>Public. Do not write names, phone numbers or medical details. Documents stay private.</small><textarea id="aStory" maxlength="500"></textarea></label>
    <label class="f">Verifier (hospital, doctor or NGO)<select id="aVer">${vopts}</select></label>
    <div class="g2"><label class="f">Fundraising time (days)<input id="aDays" inputmode="numeric" value="30"></label>
      <label class="f">Milestones<input id="aMs" inputmode="numeric" value="2"></label></div>
    ${askKind === "loan" ? `<div class="g2"><label class="f">Number of repayments<input id="aParts" inputmode="numeric" value="3"></label><label class="f">Days between repayments<input id="aPer" inputmode="numeric" value="30"></label></div>` : ""}
    <label class="f">Your documents <small>The file never leaves your browser. Only its fingerprint (SHA-256) is saved.</small><input id="aFile" type="file"></label>
    <div class="inline"><label class="f" style="flex:1">Fingerprint<input id="aHash" readonly placeholder="Choose a file" value="${esc(askHash)}"></label>${demo ? `<button type="button" class="b-ghost b-sm" id="aSample">Use a sample document</button>` : ""}</div>
    <button class="b-gold" id="aSend">Send for verification</button>`;
  $("askForm").querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { askKind = b.dataset.k; renderAsk(); }));
  const sens = () => ($("aSens").hidden = !["rehabilitation", "mental-health"].includes($("aCat").value));
  $("aCat").onchange = sens; sens();
  $("aFile").onchange = async () => { if ($("aFile").files[0]) { askHash = await hashBlob($("aFile").files[0]); $("aHash").value = askHash; } };
  if (demo) $("aSample").onclick = async () => { askHash = await hashText("sample-" + Math.random()); $("aHash").value = askHash; };
  $("askForm").onsubmit = async (e) => {
    e.preventDefault();
    const b = $("aSend"); b.disabled = true;
    try {
      const a = { kind: askKind, category: $("aCat").value, title: $("aTitle").value, story: $("aStory").value, doc_hash: $("aHash").value, goal: String(toYocto($("aGoal").value)), verifier: $("aVer").value, days: Number($("aDays").value), milestones: Number($("aMs").value) };
      if (askKind === "loan") { a.parts = Number($("aParts").value); a.period_days = Number($("aPer").value); }
      const out = await be.call("create_case", a);
      toast(out.hash ? "Sent. It can take a few seconds to confirm." : "Request sent. Waiting for " + ((VERS[a.verifier] && VERS[a.verifier].name) || a.verifier) + ".", "allow");
      askHash = "";
      if (!out.hash) { go("me"); }
    } catch (err) { toast(errMsg(err), "block"); b.disabled = false; }
  };
}

/* ---------- verifier desk ---------- */
async function renderDesk() {
  const me = be.account();
  const all = await be.list({});
  const mine = all.filter((c) => c.verifier === me && ["pending", "open", "funded", "frozen"].includes(c.effective_status));
  const isV = !!VERS[me];
  $("deskSub").textContent = isV ? `Signed in as ${VERS[me].name}. Cases waiting for you are first.` : me ? "This account is not a registered verifier. " + (demo ? "Switch to a verifier account at the top (for example stmarys-nairobi.testnet)." : "") : "Connect a wallet to see your queue.";
  mine.sort((a, b) => (a.status === "pending" ? -1 : 1) - (b.status === "pending" ? -1 : 1));
  $("deskGrid").innerHTML = mine.length ? mine.map(card).join("") : `<div class="card empty" style="grid-column:1/-1"><b>${isV ? "Nothing waiting" : "No cases"}</b>${isV ? "New requests for you will appear here." : "Only registered verifiers have a queue."}</div>`;
  document.querySelectorAll("#deskGrid [data-case]").forEach((b) => (b.onclick = () => openCase(b.dataset.case)));
  const owner = me && me === be.owner();
  $("adminBox").hidden = !owner;
  if (owner) {
    const frozen = all.filter((c) => c.status === "frozen");
    const provs = await be.providers();
    const pend = provs.filter((p) => p.status === "pending");
    const ai = await be.aiRules();
    $("adminBody").innerHTML = `<h3 style="font-size:15px;margin:6px 0">Hospital applications</h3>
      ${pend.length ? pend.map((p) => `<div class="appl"><div><b>${esc(p.name)}</b><small>${esc(PTYPE[p.type] || p.type)} · ${esc(p.country)} · <span class="mono">${esc(p.account)}</span><br>licence ${esc(short(p.license_hash))}</small></div><div class="inline"><button class="b-ok b-sm" data-ap="approve_provider" data-acc="${esc(p.account)}">Approve</button><button class="b-danger b-sm" data-ap="reject_provider" data-acc="${esc(p.account)}">Reject</button></div></div>`).join("") : `<p class="sub" style="margin:4px 0 10px">No applications waiting.</p>`}
      <h3 style="font-size:15px;margin:14px 0 6px">Approved verifiers and providers</h3>
      <div class="kv">${Object.entries(VERS).map(([id, v]) => `<div><span>${esc(v.name)}${v.provider ? " · provider" : ""}</span><b class="mono">${esc(id)}</b></div>`).join("")}</div>
      <h3 style="font-size:15px;margin:14px 0 6px">AI rules <span class="tagt">version ${ai.version}</span></h3>
      <p class="sub" style="margin:0 0 6px">These are the instructions the AI pre-check reads before every review. Each save becomes a new numbered version in the public audit trail. The AI only advises; verifiers decide.</p>
      <textarea id="aiRulesTxt" rows="9" maxlength="2500" style="width:100%;font:13px/1.45 var(--mono,monospace);padding:10px;border:1px solid var(--line);border-radius:10px">${esc(ai.rules)}</textarea>
      <div class="inline" style="margin-top:6px"><button class="b-ok b-sm" id="aiRulesSave">Save as version ${ai.version + 1}</button><small class="sub">${ai.history.length} version${ai.history.length === 1 ? "" : "s"} kept.</small></div>
      <p class="sub" style="margin:12px 0 0">${frozen.length ? "Frozen cases: " + frozen.map((c) => `<a href="#" data-fz="${c.id}">#${c.id} ${esc(c.title)}</a>`).join(", ") : "No frozen cases."}</p>`;
    $("aiRulesSave").onclick = async (e) => {
      e.target.disabled = true;
      try { const o = await be.call("set_ai_rules", { rules: $("aiRulesTxt").value }); toast(o.hash ? "Sent. It can take a few seconds to confirm." : "New AI rules saved as a new version.", "allow"); if (o.hash) await new Promise((x) => setTimeout(x, 4000)); await render(); }
      catch (err) { e.target.disabled = false; toast(errMsg(err), "block"); }
    };
    document.querySelectorAll("[data-fz]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openCase(a.dataset.fz); }));
    document.querySelectorAll("[data-ap]").forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { await be.call(b.dataset.ap, { account: b.dataset.acc }); toast(b.dataset.ap === "approve_provider" ? "Provider approved. They can now verify cases and open campaigns." : "Application rejected.", "allow"); await render(); paintTop(); }
      catch (e) { b.disabled = false; toast(errMsg(e), "block"); }
    }));
  }
}

/* ---------- my activity ---------- */
async function renderMe() {
  const me = be.account();
  if (!me) { $("meSub").textContent = "Connect a wallet to see your cases."; $("meStats").innerHTML = ""; $("meGrid").innerHTML = `<div class="card empty" style="grid-column:1/-1"><b>Not connected</b>Connect your wallet first.</div>`; return; }
  const all = await be.list({});
  const rep = await be.rep(me);
  const entries = await Promise.all(all.map(async (c) => ({ c, av: await be.acct(c.id, me) })));
  const mine = entries.filter(({ c, av }) => c.requester === me || c.verifier === me || (av && B(av.contributed) > 0n));
  const given = entries.reduce((t, { av }) => t + B(av ? av.contributed : 0), 0n);
  const back = entries.reduce((t, { av }) => t + B(av ? av.refundable : 0) + B(av ? av.claimable_repayment : 0), 0n);
  $("meSub").textContent = me;
  $("meStats").innerHTML = statN("Cases involving you", mine.length, "asked, verified or funded") + stat("You put in", fmt(given), "donations and loans") + stat("Waiting for you", fmt(back), "refunds and repayments") +
    statN("Loan record", rep.defaults > 0 ? "Blocked" : rep.repaid + " repaid", rep.defaults > 0 ? "an unpaid loan is on record" : "limit " + fmt(rep.loan_limit) + " NEAR");
  $("meGrid").innerHTML = mine.length ? mine.map(({ c }) => card(c)).join("") : `<div class="card empty" style="grid-column:1/-1"><b>Nothing yet</b>Fund a case or ask for help to see it here.</div>`;
  document.querySelectorAll("#meGrid [data-case]").forEach((b) => (b.onclick = () => openCase(b.dataset.case)));
}

/* ---------- audit trail ---------- */
let auditCase = "";
const AUDIT_ICON = { donated: ["+", "ok"], milestone_released: ["→", "ok"], refunded: ["↺", "hold"], case_flagged: ["⚑", "block"], fraud_confirmed: ["!", "block"], loan_defaulted: ["!", "block"], case_unfrozen: ["✓", "ok"] };
function auditText(e) {
  const d = e.d || {}, id = d.id != null ? `case #${d.id}` : "";
  const who = (a) => `<b>${esc(a)}</b>`;
  switch (e.e) {
    case "case_created": return `${who(d.requester)} asked for ${fmt(d.goal)} NEAR (${kindLabel(d.kind)}) · ${id}`;
    case "case_verified": return `${who(d.verifier)} verified ${id}. Payee: ${who(d.payee)}`;
    case "case_rejected": return `The verifier rejected ${id}`;
    case "case_cancelled": return `The requester cancelled ${id}`;
    case "donated": return `${who(d.donor)} gave ${fmt(d.amount)} NEAR to ${id}`;
    case "milestone_released": return `${fmt(d.amount)} NEAR released to ${who(d.to)} · ${id}, milestone ${d.milestone}`;
    case "refunded": return `${who(d.donor)} took back ${fmt(d.amount)} NEAR · ${id}`;
    case "case_flagged": return `${who(d.by)} reported ${id} (${d.reporters} donor${d.reporters === 1 ? "" : "s"}, ${fmt(d.flagged)} NEAR)`;
    case "case_unfrozen": return `Owner dismissed the reports on ${id}. It continues`;
    case "fraud_confirmed": return `Owner confirmed fraud on ${id}. ${fmt(d.slashed)} NEAR of ${who(d.verifier)}'s stake goes to the donors`;
    case "repaid": return `Borrower repaid ${fmt(d.amount)} NEAR · ${id}`;
    case "loan_repaid": return `${id} is fully repaid`;
    case "loan_defaulted": return `${id} defaulted. ${fmt(d.covered)} NEAR of the guarantee covers lenders`;
    case "repayment_claimed": return `${who(d.lender)} claimed ${fmt(d.amount)} NEAR of repayment · ${id}`;
    case "guarantee_returned": return `Verifier took back ${fmt(d.amount)} NEAR of stake · ${id}`;
    case "verifier_added": return `Owner added verifier ${who(d.account)}`;
    case "verifier_removed": return `Owner removed verifier ${who(d.account)}`;
    case "provider_applied": return `${who(d.account)} applied to register as a provider (${esc(d.name)})`;
    case "provider_approved": return `Owner approved provider ${who(d.account)}`;
    case "ai_check": return `The verifier recorded AI advice <b>${esc(d.verdict)}</b> for ${id} (rules v${d.rules_version})`;
    case "ai_overruled": return `The verifier decided <b>${esc(d.decision)}</b> on ${id}, against the AI's advice (${esc(d.ai)})`;
    case "ai_rules_updated": return `Owner changed the AI rules. Now version <b>${d.version}</b> (${d.chars} characters)`;
    case "provider_rejected": return `Owner rejected provider ${who(d.account)}`;
    default: return esc(e.e);
  }
}
async function renderAudit() {
  const all = await be.list({});
  const sum = (f) => all.reduce((t, c) => t + B(f(c)), 0n);
  $("auStats").innerHTML =
    stat("Donated", fmt(sum((c) => c.raised)), "all cases") +
    stat("Released to providers", fmt(sum((c) => c.released)), "against bills") +
    stat("Verifier stakes locked", fmt(sum((c) => c.stake_locked || 0)), "at risk if fraud is found") +
    stat("Stakes paid to donors", fmt(sum((c) => c.slash_pool || 0)), "after confirmed fraud");
  $("auCase").innerHTML = `<option value="">All cases</option>` + all.map((c) => `<option value="${c.id}" ${String(c.id) === auditCase ? "selected" : ""}>#${c.id} · ${esc(c.title)}</option>`).join("");
  $("auCase").onchange = () => { auditCase = $("auCase").value; renderAudit(); };
  const list = await be.audit(auditCase ? { id: Number(auditCase) } : {});
  $("auSub").textContent = list.length + " events shown, newest first · written by the contract itself, nobody edits this list";
  $("auList").innerHTML = list.length ? list.map((e) => {
    const [ic, kind] = AUDIT_ICON[e.e] || ["•", ""];
    const dt = new Date(Number(B(e.t) / 1_000_000n));
    return `<div class="ev"><span class="ic ${kind}">${ic}</span><div><div class="t">${auditText(e)}</div><div class="s">by <span class="mono">${esc(e.by)}</span></div></div><div class="tm">${dt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}<br>${dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</div></div>`;
  }).join("") : `<div class="empty"><b>No events yet</b>Actions will be listed here as they happen.</div>`;
  const ex = CFG.mode === "chain" ? `https://${CFG.network === "mainnet" ? "" : "testnet."}nearblocks.io/address/${CFG.contractId}` : "";
  $("auLink").innerHTML = ex ? `<a class="b-ghost b-sm" style="display:inline-block;padding:8px 14px;border:1px solid var(--line);border-radius:10px;text-decoration:none;background:#fff" href="${esc(ex)}" target="_blank" rel="noopener">Open the contract on NearBlocks ↗</a>` : `<span class="sub">In testnet mode this list is read from the deployed contract, and every action also has its own transaction on the NEAR explorer.</span>`;
}

function renderHow() {
  $("rules").innerHTML = [
    ["Loan guarantee from the verifier", "20% of the loan"], ["First loan limit", fmt(F.CFG.LOAN_BASE_LIMIT) + " NEAR"], ["Limit grows by", fmt(F.CFG.LOAN_STEP) + " NEAR per repaid loan"],
    ["Freezing a case", F.CFG.FLAG_MIN_REPORTERS + "+ donors holding " + Number(F.CFG.FLAG_PM) / 10 + "% of the money"], ["Verifier stake", "5% (grants, campaigns) · 20% (loans)"], ["Frozen, no decision", "refunds open after " + F.CFG.FREEZE_TIMEOUT_DAYS + " days"], ["Hospital campaigns", "need a different verifier"], ["Grace before a default can be called", F.CFG.GRACE_DAYS + " days"], ["Fundraising time", "1 to 90 days"], ["Milestones per case", "1 to 4"], ["Interest", "none"],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
}

async function render() {
  VERS = await be.verifiers();
  if (view === "cases") await renderCases();
  else if (view === "hosp") await renderHosp();
  else if (view === "ask") await renderAsk();
  else if (view === "desk") await renderDesk();
  else if (view === "me") await renderMe();
  else if (view === "audit") await renderAudit();
  else renderHow();
}

/* ---------- demo controls + wallet ---------- */
const DEMO_WALLETS = [["Meteor Wallet", "Popup wallet. Used for the testnet proof."], ["Sender", "Browser extension."], ["Nightly", "Browser extension."], ["HERE Wallet", "Mobile app or web."], ["MyNearWallet", "Web wallet."]];
if (demo) {
  $("walletBtn").onclick = () => {
    $("wtitle").textContent = "Connect a wallet";
    $("wintro").innerHTML = "This public demo is <b>simulated</b>: no money moves, so there is nothing to connect. Use the <b>Acting as</b> bar to play every role. In <b>testnet mode</b> you sign each action in your own NEAR wallet and the smart contract enforces the rules.";
    $("wlist").innerHTML = DEMO_WALLETS.map(([l, n]) => `<div class="wopt" style="opacity:.62;cursor:default"><span>${esc(l)}<small>${esc(n)}</small></span><span class="tagt">Testnet mode</span></div>`).join("") +
      `<a class="wopt" href="https://github.com/sasindu-smart/carefund#testnet-mode-real-contract" target="_blank" rel="noopener"><span>How to run it with a real wallet<small>Steps in the README</small></span><span>›</span></a>`;
    $("wmodal").hidden = false;
  };
  $("wclose").onclick = () => ($("wmodal").hidden = true);
  $("actor").onchange = async () => { be.setAccount($("actor").value); paintTop(); await render(); if (openId) await openCase(openId); };
  document.querySelectorAll("[data-adv]").forEach((b) => (b.onclick = async () => { be.advance(Number(b.dataset.adv)); paintTop(); toast("Moved the demo clock forward " + b.dataset.adv + " days.", "quiet"); await render(); if (openId) await openCase(openId); }));
  $("reset").onclick = async () => { be.reset(); paintTop(); closeSheet(); await render(); toast("Demo reset.", "quiet"); };
} else {
  $("walletBtn").onclick = async () => {
    if (window.Wallet.state().account) { await window.Wallet.disconnect(); return; }
    $("wtitle").textContent = "Connect a wallet";
    $("wintro").textContent = "You approve every action in your own wallet. Your keys never touch this app.";
    const opts = window.Wallet.options();
    $("wlist").innerHTML = opts.map((o) => `<button class="wopt" data-id="${esc(o.id)}"><span>${esc(o.label)}<small>${esc(o.note)}</small></span><span>›</span></button>`).join("") || `<p class="sub">The wallet library is still loading, or could not be loaded.</p>`;
    $("wmodal").hidden = false;
    $("wlist").querySelectorAll("[data-id]").forEach((b) => (b.onclick = async () => { $("wmodal").hidden = true; try { await window.Wallet.connect(b.dataset.id); } catch (e) { toast(errMsg(e), "block"); } }));
  };
  $("wclose").onclick = () => ($("wmodal").hidden = true);
}

(async function boot() {
  if (!demo) { await import("/wallet.js"); window.Wallet.onChange(() => { paintTop(); render(); }); }
  // Testnet mode: draw the page first, wallet libraries (loaded from a CDN) must never block it.
  const ready = be.ready().catch((e) => toast(errMsg(e), "block"));
  const h = (location.hash || "").slice(1);
  view = NAV.some(([k]) => k === h) ? h : "cases";
  VIEWS.forEach((k) => ($("v-" + k).hidden = k !== view));
  paintNav(); paintTop();
  if (demo) { await ready; paintTop(); await render(); return; }
  render();
  ready.then(() => { paintTop(); render(); });
})();
