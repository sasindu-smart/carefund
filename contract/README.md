# CareFund smart contract

JavaScript contract (`near-sdk-js` 2.0.0). All rules live in `src/fund-core.js` (no SDK imports, covered by `npm test`, 27 tests). `src/index.js` is a thin wrapper that reads the caller, time and attached NEAR, calls the core, saves the state and sends the transfer.

The web demo runs this same `fund-core.js` in the browser, so what you click in the demo is what the contract enforces.

| Who | Methods |
|---|---|
| Owner | `add_verifier({account, name})`, `remove_verifier({account})`, `approve_provider({account})`, `reject_provider({account})`, `unfreeze({id})` (dismiss reports), `confirm_fraud({id})` (frozen case: refund donors plus the verifier's stake) |
| Hospital / clinic / NGO | `apply_provider({name, type, country, license_hash})`. Once approved it becomes a verifier and can open `kind: "campaign"` cases, which a different verifier must approve |
| Anyone | `create_case({kind, category, title, story, doc_hash, goal, verifier, days, milestones, parts?, period_days?})`, `donate({id})` (attach NEAR), `refund({id})`, `claim_repayment({id})`, `flag_case({id, reason})` (donors of that case only), `mark_default({id})` |
| Requester / borrower | `cancel_case({id})`, `repay({id})` (attach NEAR) |
| Verifier | `verify_case({id, payee, doc_hash})` (attach a 5% stake, or a 20% guarantee for a loan), `reject_case({id})`, `release_milestone({id, evidence})`, `withdraw_stake({id})` |
| Views | `get_case`, `get_account_view`, `list_cases`, `get_verifiers`, `get_providers`, `get_audit`, `get_verifier_stats`, `get_reputation`, `get_config` |

Amounts are yoctoNEAR strings. `donate`, `verify_case` and `repay` are payable.

## Build (Linux or WSL, Node 20)
    npm install
    npm run build        # writes build/carefund.wasm

## Deploy to testnet (near-cli-rs, interactive)
    near create-account YOURNAME-carefund.testnet --useFaucet
    near contract deploy YOURNAME-carefund.testnet
    # use-file -> build/carefund.wasm, with-init-call, function: init, json-args:
    # {"owner":"OWNER.testnet"}

Then, as the owner, register at least one verifier (this is a normal contract call):

    near contract call-function as-transaction YOURNAME-carefund.testnet add_verifier json-args '{"account":"VERIFIER.testnet","name":"Example Hospital"}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as OWNER.testnet network-config testnet

Run the website against it: `CONTRACT_ID=YOURNAME-carefund.testnet npm start` (from the repo root).

## Known limits
- The transfer is sent after the state is saved. If the payee account does not exist, that transfer fails and the funds stay in the contract. Verifiers must check the payee wallet.
- No interest on loans. No contract can force repayment; the guarantee and the default record only limit the damage.
- Reports (`flag_case`) are one per account. Someone with many accounts could try to freeze a case; the owner can unfreeze it.
