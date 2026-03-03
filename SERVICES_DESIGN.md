# LeftClaw Services — Full Design Doc
## Project: `services.clawdbotatg.eth.link`
### Written: 2026-03-02 by LeftClaw

---

## Overview

A marketplace where humans and AI agents can hire LeftClaw to do Ethereum work. Jobs are posted to a smart contract with CLAWD payment (or USDC → auto-swapped to CLAWD). The bot watches for new jobs, picks them up, executes them, and submits results back to the contract.

This is Layer 1 of a larger vision:
- **L1:** Web UI + smart contract + bot polling
- **L2:** ERC-8004 agent identity → discoverable as an AI agent on Ethereum  
- **L3:** X402 HTTP payment integration (instant bot-to-bot payments)
- **L4:** Virtuals marketplace listing

---

## Service Catalog

### 🗣️ Consultation
Human or agent wants strategic advice on what/whether to build.
- **CONSULT_S**: 15 messages — 20 USDC equivalent in CLAWD
- **CONSULT_L**: 30 messages — 30 USDC equivalent in CLAWD

Delivery: Vercel AI chatbot (Claude claude-opus-4-6 + ethskills.com trained) gated by job ID. Customer gets a private chat link after job confirmed onchain.

### 🔨 Build
LeftClaw builds the thing end-to-end following ethskills.com phases.
- **BUILD_S**: 500 USDC — Simple contract + frontend (1 core feature)
- **BUILD_M**: 1000 USDC — Full app (3-5 features, tested, QA'd)
- **BUILD_L**: 1500 USDC — Complex app (multi-contract, integrations, full audit)
- **BUILD_XL**: 2500+ USDC — Custom quote via consultation first

Delivery: GitHub repo + IPFS CID + deployed contract address + ENS subdomain

### 🔍 QA Audit
Full QA pass following ethskills.com/qa + ethskills.com/frontend-ux.
- **QA_AUDIT**: 200 USDC — Full report, all issues found, severity rated

Delivery: Markdown report (IPFS CID) with every issue + fix suggestions

### 🛡️ Solidity Audit
Deep EVM security audit following ethskills.com/audit (500+ checklist items).
- **AUDIT_S**: 300 USDC — Single contract, full audit report
- **AUDIT_L**: 600 USDC — Multi-contract system, parallel specialist agents

Delivery: Audit report with findings rated Critical/High/Medium/Low/Info

### 🔑 Special Services (future/advanced)
- **MULTISIG_SIGNER**: Add LeftClaw as a Safe multisig signer — 50 USDC/mo
- **HOT_WALLET_OPS**: Let LeftClaw run a hot wallet for automated txs — custom
- **CUSTOM**: Post any job with custom CLAWD amount, LeftClaw decides to accept

---

## Smart Contract Design: `LeftClawServices.sol`

### Core Data Structures

```solidity
enum ServiceType {
    CONSULT_S,       // 0
    CONSULT_L,       // 1
    BUILD_S,         // 2
    BUILD_M,         // 3
    BUILD_L,         // 4
    BUILD_XL,        // 5
    QA_AUDIT,        // 6
    AUDIT_S,         // 7
    AUDIT_L,         // 8
    MULTISIG_SIGNER, // 9
    CUSTOM           // 10
}

enum JobStatus {
    OPEN,        // 0 — posted, waiting for bot to pick up
    IN_PROGRESS, // 1 — bot acknowledged and is working
    COMPLETED,   // 2 — bot submitted result, payment released
    CANCELLED,   // 3 — cancelled by client (before IN_PROGRESS), refund issued
    DISPUTED     // 4 — client disputed result
}

struct Job {
    uint256 id;
    address client;
    ServiceType serviceType;
    uint256 paymentClawd;      // Amount in CLAWD (18 decimals)
    uint256 paymentUsdcValue;  // USD value at time of posting (for display)
    string descriptionCID;     // IPFS CID of job description
    JobStatus status;
    uint256 createdAt;
    uint256 startedAt;
    uint256 completedAt;
    string resultCID;          // IPFS CID of result (set by bot)
    address executor;          // Bot address that picked up the job
}
```

### Pricing (set by owner, updatable)
Prices stored as CLAWD amounts (can be updated by owner as CLAWD price changes):
```solidity
mapping(ServiceType => uint256) public servicePriceInClawd;
```

### Key Functions
- `postJob(ServiceType, string descCID)` — pay CLAWD, create job
- `postJobWithUsdc(ServiceType, string descCID)` — pay USDC → auto-swap via Uniswap V3 → CLAWD
- `acceptJob(uint256 jobId)` — bot marks as IN_PROGRESS (onlyExecutor)
- `completeJob(uint256 jobId, string resultCID)` — bot marks complete, payment released (onlyExecutor)
- `cancelJob(uint256 jobId)` — client cancels if still OPEN, refund
- `disputeJob(uint256 jobId)` — client disputes completed job (time-locked)
- `resolveDispute(uint256 jobId, bool refundClient)` — owner resolves (onlyOwner)
- `updatePrice(ServiceType, uint256 priceInClawd)` — onlyOwner
- `addExecutor(address)` / `removeExecutor(address)` — onlyOwner (multi-executor support)
- `withdrawFees(address to)` — onlyOwner (protocol fee)

### Payment Flow (USDC path)
1. Client approves USDC spend on contract
2. Calls `postJobWithUsdc(serviceType, descCID)`
3. Contract pulls USDC, calls Uniswap V3 exactInputSingle: USDC → CLAWD
4. CLAWD held in contract for the job
5. On completion: bot receives CLAWD (minus protocol fee), remainder stays in contract

### Protocol Fee
5% of each job payment kept as protocol fee, accumulated in contract, withdrawn by owner.

### USDC → CLAWD Swap (Uniswap V3 on Base)
- USDC address: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- WETH address: `0x4200000000000000000000000000000000000006`
- CLAWD address: `0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07`
- Route: USDC → WETH (0.05% pool) → CLAWD (1% pool) via multi-hop
- Slippage: 5% max

### Executor Access
- Initial executor: `0xa822155c242B3a307086F1e2787E393d78A0B5AC` (leftclaw deployer)
- Can add multiple executors (future: rightclaw, other agents)
- Jobs can be accepted by any registered executor (first come first serve for CUSTOM jobs)

---

## Frontend Design

### Tech Stack
- Scaffold-ETH 2 (SE2) on Base
- IPFS hosted via BGIPFS
- ENS: `services.clawdbotatg.eth`
- Domain: `services.clawdbotatg.eth.link`

### Pages/Sections

#### 1. Hero
- "Hire LeftClaw" headline
- What I do (brief)
- CTA: Browse Services + Connect Wallet

#### 2. Service Cards
One card per service type:
- Icon, name, description
- Price in CLAWD (+ USD equivalent)
- "Post a Job" button

#### 3. Post Job Modal
- Selected service pre-filled
- Description textarea (what you need, context, links)
- Payment breakdown
- Approve CLAWD → Post Job (three-button flow per ethskills.com/frontend-ux)

#### 4. My Jobs Tab (when wallet connected)
- List of all jobs by connected address
- Status badges (OPEN / IN PROGRESS / COMPLETED / CANCELLED)
- For COMPLETED: link to result IPFS CID
- Cancel button for OPEN jobs

#### 5. Job Board (public, all jobs)
- All open jobs visible to anyone
- (For transparency + future multi-executor discovery)

#### 6. About Section
- Who is LeftClaw
- What ethskills.com is (how builds are done)
- Track record (link to clawd-dashboard)

### Key UX Rules (from ethskills.com/frontend-ux)
- Three-button approve flow for CLAWD approval
- Loading spinners on all transactions
- USD equivalent shown next to all CLAWD amounts
- Address components with etherscan links
- Dark theme, mobile responsive
- No SE2 branding (BuidlGuidl, "Fork me")

---

## SKILL.md for Bot

A skill file that tells the bot (LeftClaw) exactly how to:
1. Watch for OPEN jobs on the contract
2. Accept a job (mark IN_PROGRESS)
3. Execute the job based on ServiceType
4. Submit result CID (mark COMPLETED)
5. Handle disputes

Location: `/Users/austingriffith/.openclaw/workspace/LEFTCLAW_SERVICES_SKILL.md`
Also posted to IPFS and linked from the contract/frontend.

---

## Consultation Chatbot (services.clawdbotatg.eth.link/chat)

### Architecture
- Vercel AI SDK with Claude claude-opus-4-6
- System prompt: trained on all ethskills.com skills + our full build history + MEMORY.md + project context
- Message count tracking: stored in Vercel KV (keyed by jobId)
- Auth: wallet signature to prove ownership of job NFT / job ID

### Message Limits
- CONSULT_S: 15 messages max
- CONSULT_L: 30 messages max
- Counter increments on each user message
- Shows "X messages remaining" in UI
- Graceful cutoff with summary when limit reached

### What the Bot Knows
Loaded in system prompt:
- All ethskills.com SKILL.md files (fetched fresh at deploy time)
- Our full tech stack (SE2, Foundry, BGIPFS, Alchemy, Base)
- All our deployed contracts (from memory/PROJECTS.md)
- Austin's builder philosophy (from SOUL.md and relevant MEMORY.md entries)
- How to scope and price builds realistically

### Viability Assessment Mode
For each consultation, the bot:
1. Listens to the idea
2. Asks clarifying questions
3. Assesses: Is this buildable? Time estimate? Cost estimate? Risks?
4. Proposes a build plan with phases
5. Recommends: "Build it yourself / Hire LeftClaw / Don't build this"

---

## X402 Integration

### What It Does
Server-side payment middleware on the consultation API endpoint.
Instead of checking onchain job status, the chat endpoint can accept X402 micropayments per message.

### Pricing
- 0.67 USDC per message (= 20 USDC / 30 messages)
- Paid in USDC on Base, immediately swapped to CLAWD

### Implementation
```javascript
app.use(paymentMiddleware({
  "POST /api/chat": {
    accepts: [{ network: "base", asset: "USDC", amount: "0.67" }],
    description: "LeftClaw consultation message"
  }
}));
```

### Fallback
If user has a valid onchain job (OPEN/IN_PROGRESS), skip X402 (already paid via contract).
X402 is for bot-to-bot payments that don't want to post an onchain job first.

---

## ERC-8004 Agent Identity

### What It Is
A standard for AI agent identity on Ethereum. Registers LeftClaw as a discoverable onchain agent with:
- Capabilities list (what services it offers)
- Payment methods (CLAWD, USDC, X402)
- Endpoint (services.clawdbotatg.eth.link)
- Metadata (name, description, avatar)

### Implementation
Follow ethskills.com/standards/SKILL.md for ERC-8004 registration.
Register on Base. ENS profile: `leftclaw.eth` or subname under `clawdbotatg.eth`.

---

## Virtuals Marketplace

### What It Is
Virtuals Protocol is an AI agent tokenization platform. Register LeftClaw as a Virtual agent token that can be traded/held by the community.

### Why
- Additional distribution channel
- Agent-to-agent discoverability  
- Token holders get priority in job queue or fee sharing

### Implementation
Defer to Phase 2 (after core marketplace is live and tested).
Reference: virtuals.io — submit agent registration after mainnet launch.

---

## Deployment Plan

### Phase 1: Core Marketplace
1. Deploy `LeftClawServices.sol` to Base
2. Build SE2 frontend with all service cards + job posting + My Jobs
3. Set up BGIPFS + ENS `services.clawdbotatg.eth`
4. Test end-to-end with test CLAWD

### Phase 2: Consultation Chatbot
1. Build consultation API (Vercel, Claude claude-opus-4-6, message counter)
2. Integrate with job ID lookup (verify CONSULT_S/L jobs onchain)
3. Deploy to Vercel
4. Link from frontend

### Phase 3: X402 + ERC-8004
1. Add X402 middleware to consultation API
2. ERC-8004 registration on Base
3. Update frontend to show agent identity

### Phase 4: Virtuals + Bot SKILL
1. Write LEFTCLAW_SERVICES_SKILL.md
2. Register on Virtuals
3. Full announcement + nerve cord broadcast

---

## Open Questions (ask Austin)

1. **Build payment destination:** Does CLAWD go to our multisig Safe or directly to deployer wallet?
2. **Result delivery:** For BUILD jobs, result is a GitHub repo + contract + IPFS. Is the "resultCID" sufficient or do we also want an email/Telegram notification?
3. **Dispute resolution:** Owner-resolved disputes are centralized. Future: DAO? Kleros?
4. **Message counting for consultation:** On-chain counter vs. Vercel KV? On-chain is more trustless but gas-expensive.
5. **CONSULT results:** Should consultation sessions be public (onchain) or private (only client can see)?
6. **Virtuals:** What tier of Virtuals registration do you want? (They have different tiers/fees)

---

## Addresses
- Deployer: `0xa822155c242B3a307086F1e2787E393d78A0B5AC` (clawd-deployer-3 keystore)
- Owner/Treasury: `0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0` (Safe multisig)
- CLAWD token: `0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07`
- USDC (Base): `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Uniswap V3 Router (Base): `0x2626664c2603336E57B271c5C0b26F421741e481`

---

## GitHub
- Repo: `github.com/clawdbotatg/leftclaw-services`
- Branch: `main`
- SE2 monorepo structure
