# CareFund

**Help that reaches the right hand.**

CareFund is community grants and loans on NEAR where the money is protected even when a story cannot be proven. A person asks for help. A registered verifier (a hospital, doctor or NGO) checks the documents and names the **payee**: the hospital, pharmacy or supplier. Donors fund the case, the money waits in a smart contract, and it is released in milestones against a bill. If the goal is missed, everyone is refunded automatically.

Built for NEAR HACKATHON. Tracks: **Real-World Money**, **Social Money**, **Open Innovation**.

Two ways to give: help an **individual** through a verified grant or loan, or donate to a **hospital** that registered and was approved (hospital campaigns).

**Companion project:** [Allowance](https://github.com/sasindu-smart/allowance) is my other, independent hackathon project (an AI agent that spends only inside rules enforced by a NEAR contract). The two projects share no code.

**Try it (nothing to install):** **https://carefund-ijf9.onrender.com** (app: [/app](https://carefund-ijf9.onrender.com/app)). The free host can take about a minute to wake on the first visit. Or run it locally in one minute, below.

## The problem

Crowdfunding for medical bills, rehabilitation and small businesses works on trust, and fraud makes people stop giving. A smart contract cannot know whether a story is true. What it can do is limit what a false story is able to do.

## How CareFund limits fraud

| Safeguard | What the contract enforces |
|---|---|
| Registered verifiers | Only a verifier approved by the owner can open a case for donations |
| Money goes to the provider | A grant can never be paid to the requester's own wallet |
| Document fingerprint | The verifier must submit the same SHA-256 hash the requester stored. Files never go on-chain |
| Milestones with proof | Funds are released in 1 to 4 parts, each needs a bill hash from the verifier |
| Automatic refunds | Goal missed, case cancelled or frozen: donors take back what has not been released |
| Reports from donors | Only people who gave to a case can report it, weighted by how much they gave. At least 2 donors holding 25% of the money freeze it. Throwaway accounts have no say. While frozen nothing is released; if the owner does not decide in 14 days donors can refund |
| Verifier stake | Verifying a grant or hospital campaign locks 5% of the goal (20% for loans) from the verifier. It comes back when the case completes. If the owner confirms fraud, the stake is paid to the donors on top of their refund and the verifier is removed |
| Public audit trail | The contract writes every donation, release, refund, report and decision into a list (last 200 events) anyone can read. The app shows it on the Audit trail page |
| No self-funding | The requester and verifier cannot fund their own case |
| Loan guarantee | The verifier locks 20% of a loan. After a missed repayment anyone can declare a default: the guarantee pays lenders first |
| Loan record | A default blocks that account from new loans. Each repaid loan raises the borrower's limit |
| Approved hospitals | A hospital, clinic, rehabilitation centre or NGO applies with a licence fingerprint and the owner approves it. Its own campaigns must be verified by a **different** verifier and are paid to the hospital itself |

## Grants and loans

- **Grant**: a gift, no repayment. Paid to the provider the verifier names (hospital, pharmacy, **rehabilitation centre**).
- **Hospital campaign**: opened by an approved provider (equipment, a ward, free treatment). Paid to the provider's own wallet in milestones, verified by someone else.
- **Loan**: no interest, repaid in parts to the contract. Lenders claim their share as repayments arrive. First loan limit is 20 NEAR, plus 20 for each repaid loan.

## Run it

Needs Node 20 or newer. No dependencies to install.

    git clone https://github.com/sasindu-smart/carefund
    cd carefund
    npm start            # landing page at http://localhost:3000 , the app at http://localhost:3000/app

The default is **demo mode**: fictional cases and fictional NEAR, everything runs in your browser. It uses the exact same rules file as the contract (`contract/src/fund-core.js`). The bar at the top lets you play every role: donor, requester, verifier, owner. You can move the clock forward 7 or 30 days to see a missed goal or a loan default. "Try to break the rules" shows the contract refusing forbidden moves.

Run the tests (rules + server):

    npm test

## Testnet mode (real contract)

1. Build and deploy `contract/` (steps in [contract/README.md](contract/README.md)).
2. Start the site with the contract: `CONTRACT_ID=yourname-carefund.testnet npm start`
3. Connect a NEAR wallet (Meteor, Sender, Nightly, HERE, MyNearWallet). You sign every action yourself.

## Honest limits

- **Prototype on testnet.** No real money. The verifiers in the demo are fictional (marked "example").
- Whether a hospital really holds a licence is decided by the platform **owner**. The contract only records the application and the decision. Real use needs a proper licence check.
- Freezing can be abused: someone could donate 25% of a case, report it, and get refunded. It costs them nothing but time, and the owner can dismiss it (those donors then cannot report that case again). The 14-day timeout stops a case being frozen forever.
- A verifier can still be fooled or dishonest, and no contract can force a borrower to repay. The guarantee and the default record reduce the damage, they do not remove the risk. Lending carries real risk.
- Real use would need legal review (fundraising and lending rules differ by country), identity checks and real verifier agreements.
- Privacy: do not put names, phone numbers or medical details in the public story. Only the hash of the documents is stored.

## Project layout

    contract/src/fund-core.js   all rules, no SDK imports (27 tests)
    contract/src/index.js       thin near-sdk-js wrapper
    public/                     landing.html (home), app.html + app.js (the app), demo.js = in-browser backend, chain.js + wallet.js = testnet)
    server.js                   zero-dependency static server

MIT licensed.
