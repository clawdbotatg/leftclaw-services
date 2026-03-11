# LeftClaw Services — Full Overnight Build Task

You are LeftClaw, an autonomous Ethereum builder. This is a complete overnight build task. Work through every step below without stopping. Be autonomous — figure things out yourself.

## Your Identity & Access
- **GitHub:** ALWAYS push as `clawdbotatg` — NEVER `austintgriffith`
- **Deployer wallet keystore:** `clawd-deployer-3` → address `0xa822155c242B3a307086F1e2787E393d78A0B5AC`
- **Deployer password:** `security find-generic-password -s "clawd-deployer-3" -a "clawd" -w`
- **MetaMask password:** `security find-generic-password -s "metamask" -a "clawd" -w`
- **Foundry PATH:** ALWAYS run `export PATH="$HOME/.foundry/bin:$PATH"` before any forge/cast command
- **ENS rule:** ALWAYS `.eth.link` — NEVER `.eth.limo`
- **onlyLocalBurnerWallet: true** — ALWAYS, never change it
- **Alchemy RPC:** `https://base-mainnet.g.alchemy.com/v2/8GVG8WjDs-sGFRr6Rm839`
- **BGIPFS Key:** `4953f019-8b5d-4fb8-b799-f60417fe3197`

## What You're Building

**LeftClaw Services** — a marketplace where humans and AI agents hire LeftClaw to build Ethereum dApps, run audits, consult on viability, and more. Jobs are posted to a smart contract with CLAWD payment. The bot watches for new jobs and executes them.

- **Project dir:** `~/projects/leftclaw-services`
- **GitHub repo:** `github.com/clawdbotatg/leftclaw-services`
- **Target URL:** `https://leftclaw.services`
- **ENS:** `leftclaw.services`

---

## PHASE 0 — Read All Skills First

Before writing ANY code, fetch and read (curl or read them directly):

```bash
curl -s https://ethskills.com/ship/SKILL.md
curl -s https://ethskills.com/orchestration/SKILL.md
curl -s https://ethskills.com/standards/SKILL.md
curl -s https://ethskills.com/security/SKILL.md
curl -s https://ethskills.com/testing/SKILL.md
curl -s https://ethskills.com/frontend-ux/SKILL.md
curl -s https://ethskills.com/frontend-playbook/SKILL.md
curl -s https://ethskills.com/addresses/SKILL.md
curl -s https://ethskills.com/building-blocks/SKILL.md
```

Follow every instruction in these skills **exactly**. Do not skip or shortcut anything.

Also read the existing ERC-8004 work:
- `~/projects/agent-8004-register/README.md`
- `~/projects/agent-8004-register/register.ts`

---

## PHASE 1 — Setup Project

```bash
mkdir -p ~/projects && cd ~/projects
gh repo create clawdbotatg/leftclaw-services --public --description "LeftClaw Services — hire an AI Ethereum builder"
npx create-eth@latest leftclaw-services --skip-install 2>/dev/null || true
# If create-eth fails, scaffold manually from an existing SE2 project
cd leftclaw-services
git remote set-url origin https://github.com/clawdbotatg/leftclaw-services.git 2>/dev/null || git remote add origin https://github.com/clawdbotatg/leftclaw-services.git
```

If `create-eth` asks questions interactively, use:
- Framework: Scaffold-ETH 2
- Smart contract: Foundry
- Network: Base

---

## PHASE 2 — Smart Contract

### File: `packages/foundry/contracts/LeftClawServices.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
```

**Token Addresses (Base mainnet):**
- CLAWD: `0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07`
- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- WETH: `0x4200000000000000000000000000000000000006`
- Uniswap V3 SwapRouter02: `0x2626664c2603336E57B271c5C0b26F421741e481`

**Enums:**
```solidity
enum ServiceType {
    CONSULT_S,      // 0 - 15 msg consultation
    CONSULT_L,      // 1 - 30 msg consultation
    BUILD_S,        // 2 - simple build ~$500
    BUILD_M,        // 3 - full build ~$1000
    BUILD_L,        // 4 - complex build ~$1500
    BUILD_XL,       // 5 - enterprise build ~$2500
    QA_AUDIT,       // 6 - QA report ~$200
    AUDIT_S,        // 7 - single contract audit ~$300
    AUDIT_L,        // 8 - multi-contract audit ~$600
    CUSTOM          // 9 - custom amount set by poster
}

enum JobStatus {
    OPEN,
    IN_PROGRESS,
    COMPLETED,
    CANCELLED,
    DISPUTED
}
```

**Struct:**
```solidity
struct Job {
    uint256 id;
    address client;
    ServiceType serviceType;
    uint256 paymentClawd;       // in wei (18 decimals)
    uint256 paymentUsdcApprox;  // informational USD cents
    string descriptionCID;      // IPFS CID of job brief
    JobStatus status;
    uint256 createdAt;
    uint256 startedAt;
    uint256 completedAt;
    string resultCID;           // set by executor on completion
    address executor;
}
```

**State variables:**
```solidity
mapping(uint256 => Job) public jobs;
uint256 public nextJobId;
mapping(ServiceType => uint256) public servicePriceInClawd;
mapping(address => bool) public isExecutor;
uint256 public protocolFeeBps; // basis points, e.g. 500 = 5%
uint256 public accumulatedFees; // CLAWD fees accumulated
IERC20 public immutable clawdToken;
IERC20 public immutable usdcToken;
address public immutable uniswapRouter;
address public immutable weth;
uint256 constant DISPUTE_WINDOW = 7 days;
```

**Constructor:**
- Set all token addresses
- Set initial prices (CLAWD amounts at ~$0.0003/CLAWD):
  - CONSULT_S: 66_666e18 (20 USDC)
  - CONSULT_L: 100_000e18 (30 USDC)
  - BUILD_S: 1_666_666e18 (500 USDC)
  - BUILD_M: 3_333_333e18 (1000 USDC)
  - BUILD_L: 5_000_000e18 (1500 USDC)
  - BUILD_XL: 8_333_333e18 (2500 USDC)
  - QA_AUDIT: 666_666e18 (200 USDC)
  - AUDIT_S: 1_000_000e18 (300 USDC)
  - AUDIT_L: 2_000_000e18 (600 USDC)
  - CUSTOM: 0 (set by poster)
- Set protocolFeeBps = 500 (5%)
- Add deployer as executor
- nextJobId = 1

**Functions:**
```solidity
function postJob(ServiceType serviceType, string calldata descriptionCID) external nonReentrant
// Pull price from servicePriceInClawd[serviceType]
// CUSTOM type reverts (use postJobCustom)
// Transfer CLAWD from msg.sender to this contract (SafeERC20)
// Create Job struct, emit JobPosted

function postJobCustom(uint256 clawdAmount, string calldata descriptionCID) external nonReentrant
// clawdAmount > 0 required
// Transfer CLAWD, create CUSTOM job

function postJobWithUsdc(ServiceType serviceType, string calldata descriptionCID) external nonReentrant
// Pull USDC from msg.sender
// Swap USDC → CLAWD via Uniswap V3 multihop (USDC → WETH → CLAWD)
// The received CLAWD amount becomes paymentClawd
// Store USDC value as paymentUsdcApprox
// Create Job

function acceptJob(uint256 jobId) external nonReentrant
// onlyExecutor modifier
// Job must be OPEN
// Set status = IN_PROGRESS, executor = msg.sender, startedAt = block.timestamp
// Emit JobAccepted

function completeJob(uint256 jobId, string calldata resultCID) external nonReentrant
// onlyExecutor modifier
// msg.sender must be the job's executor
// Job must be IN_PROGRESS
// Set status = COMPLETED, resultCID, completedAt
// Calculate fee: feeClawd = job.paymentClawd * protocolFeeBps / 10000
// accumulatedFees += feeClawd
// Transfer (job.paymentClawd - feeClawd) CLAWD to executor
// Emit JobCompleted

function cancelJob(uint256 jobId) external nonReentrant
// Only client (job.client == msg.sender)
// Job must be OPEN (cannot cancel IN_PROGRESS)
// Set status = CANCELLED
// Refund full paymentClawd to client
// Emit JobCancelled

function disputeJob(uint256 jobId) external
// Only client
// Job must be COMPLETED
// block.timestamp <= completedAt + DISPUTE_WINDOW
// Set status = DISPUTED
// Emit JobDisputed

function resolveDispute(uint256 jobId, bool refundClient) external onlyOwner nonReentrant
// Job must be DISPUTED
// If refundClient: transfer paymentClawd back to client, subtract accumulated fee for this job first
// If !refundClient: transfer to executor (they already got paid, so this should only happen if we withheld payment pending dispute — actually: dispute freezes nothing, so handle edge case)
// Note: since payment is already sent to executor on completeJob, resolveDispute for refund means: owner must fund the refund from protocol fees OR we change the design...
// BETTER DESIGN: on completeJob, hold payment in escrow (don't send to executor yet). On resolveDispute(false) = executor wins, send to executor. On resolveDispute(true) = client wins, refund.
// CHANGE DESIGN: completeJob marks COMPLETED but holds CLAWD in contract (minus fee). resolveDispute or claimPayment lets executor withdraw.

function claimPayment(uint256 jobId) external nonReentrant
// Executor claims payment for COMPLETED job (after dispute window)
// Job must be COMPLETED, msg.sender == executor
// block.timestamp > completedAt + DISPUTE_WINDOW (no active dispute)
// Transfer CLAWD to executor

function updatePrice(ServiceType serviceType, uint256 priceInClawd) external onlyOwner
function addExecutor(address executor) external onlyOwner
function removeExecutor(address executor) external onlyOwner
function setProtocolFee(uint256 feeBps) external onlyOwner // max 1000 (10%)
function withdrawProtocolFees(address to) external onlyOwner nonReentrant
function getAllJobs() external view returns (Job[] memory)
function getJobsByClient(address client) external view returns (uint256[] memory)
function getOpenJobs() external view returns (uint256[] memory)
function getJobsByStatus(JobStatus status) external view returns (uint256[] memory)
```

**REVISED PAYMENT FLOW (more secure):**
1. Client posts job → CLAWD locked in contract
2. Executor completes → job marked COMPLETED, payment stays locked
3. Client has 7-day dispute window
4. After window: executor calls `claimPayment()` → gets CLAWD (minus fee)
5. If dispute: owner resolves → refund to client OR release to executor

This is safer than immediate payout.

**Uniswap V3 Multihop Swap in postJobWithUsdc:**
```solidity
// Approve USDC to router
IERC20(usdcToken).approve(uniswapRouter, usdcAmount);

// Build path: USDC → WETH (fee 500) → CLAWD (fee 10000)
bytes memory path = abi.encodePacked(
    address(usdcToken),
    uint24(500),    // USDC/WETH 0.05%
    weth,
    uint24(10000),  // WETH/CLAWD 1%
    address(clawdToken)
);

ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
    path: path,
    recipient: address(this),
    deadline: block.timestamp + 300,
    amountIn: usdcAmount,
    amountOutMinimum: expectedClawd * 95 / 100 // 5% slippage
});

uint256 clawdReceived = ISwapRouter(uniswapRouter).exactInput(params);
```

**Modifiers:**
```solidity
modifier onlyExecutor() {
    require(isExecutor[msg.sender], "Not an executor");
    _;
}
```

**Events:**
```solidity
event JobPosted(uint256 indexed jobId, address indexed client, ServiceType serviceType, uint256 paymentClawd, string descriptionCID);
event JobAccepted(uint256 indexed jobId, address indexed executor);
event JobCompleted(uint256 indexed jobId, address indexed executor, string resultCID);
event JobCancelled(uint256 indexed jobId, address indexed client);
event JobDisputed(uint256 indexed jobId, address indexed client);
event DisputeResolved(uint256 indexed jobId, bool refundedClient);
event PaymentClaimed(uint256 indexed jobId, address indexed executor, uint256 amount);
event PriceUpdated(ServiceType indexed serviceType, uint256 newPrice);
event ExecutorAdded(address indexed executor);
event ExecutorRemoved(address indexed executor);
```

---

## PHASE 3 — Tests

File: `packages/foundry/test/LeftClawServices.t.sol`

Use Base fork: `--fork-url https://base-mainnet.g.alchemy.com/v2/8GVG8WjDs-sGFRr6Rm839`

Tests required:
1. `test_PostJobWithClawd` — post a CONSULT_S job, verify event, storage, CLAWD balance
2. `test_PostJobWithUsdc` — fork test, use real USDC (whale: `0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A` or another USDC whale on Base), verify swap + job creation
3. `test_AcceptJob` — executor accepts, status changes, non-executor reverts
4. `test_CompleteJob_And_ClaimAfterWindow` — complete, warp 8 days, claim payment
5. `test_CompleteJob_CannotClaimDuringDisputeWindow` — complete, try to claim within 7 days, should revert
6. `test_DisputeAndRefund` — complete, dispute, owner resolves refundClient=true
7. `test_DisputeAndReleaseToExecutor` — complete, dispute, owner resolves refundClient=false
8. `test_CancelOpenJob` — cancel OPEN job, get full refund
9. `test_CannotCancelInProgress` — accept job, then try to cancel, should revert
10. `test_CustomJob` — post with custom CLAWD amount
11. `test_UpdatePrice_OnlyOwner` — non-owner reverts
12. `test_Fuzz_PostCustomJob(uint256 amount)` — fuzz with bound(amount, 1e18, 1000000000e18)
13. `test_WithdrawFees` — complete multiple jobs, check accumulated fees, withdraw

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd packages/foundry
forge test --fork-url https://base-mainnet.g.alchemy.com/v2/8GVG8WjDs-sGFRr6Rm839 -vv
```

All tests must pass before proceeding.

---

## PHASE 4 — Security Audit (Pre-Deploy)

Fetch and follow:
```bash
curl -s https://ethskills.com/security/SKILL.md
curl -s https://ethskills.com/audit/SKILL.md
```

Run through EVERY checklist item. Fix all critical and high severity findings.
Write findings to `AUDIT_REPORT.md` in project root.

Also run:
```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd packages/foundry
# slither if available
slither contracts/LeftClawServices.sol --solc-remaps "@openzeppelin=lib/openzeppelin-contracts" 2>&1 | head -100
```

---

## PHASE 5 — Deploy to Base Mainnet

```bash
export PATH="$HOME/.foundry/bin:$PATH"
DEPLOYER_PASS=$(security find-generic-password -s "clawd-deployer-3" -a "clawd" -w)
cd ~/projects/leftclaw-services/packages/foundry
```

Create deploy script at `packages/foundry/script/DeployLeftClawServices.s.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "forge-std/Script.sol";
import "../contracts/LeftClawServices.sol";

contract DeployLeftClawServices is Script {
    function run() external {
        vm.startBroadcast();
        LeftClawServices services = new LeftClawServices(
            0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07, // CLAWD
            0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, // USDC
            0x2626664c2603336E57B271c5C0b26F421741e481, // UniV3 Router
            0x4200000000000000000000000000000000000006  // WETH
        );
        console.log("LeftClawServices deployed at:", address(services));
        vm.stopBroadcast();
    }
}
```

Deploy:
```bash
forge script script/DeployLeftClawServices.s.sol \
  --rpc-url https://base-mainnet.g.alchemy.com/v2/8GVG8WjDs-sGFRr6Rm839 \
  --account clawd-deployer-3 \
  --password "$DEPLOYER_PASS" \
  --broadcast \
  -vvvv
```

After deploy:
1. Note contract address
2. Write to `packages/nextjs/contracts/deployedContracts.ts` or SE2's deployment config
3. Try to verify:
```bash
forge verify-contract <CONTRACT_ADDRESS> contracts/LeftClawServices.sol:LeftClawServices \
  --rpc-url https://base-mainnet.g.alchemy.com/v2/8GVG8WjDs-sGFRr6Rm839 \
  --etherscan-api-key <ETHERSCAN_KEY> \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address)" 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0x2626664c2603336E57B271c5C0b26F421741e481 0x4200000000000000000000000000000000000006)
```

If no etherscan key, skip verification — address is what matters.

4. Transfer ownership to Safe (IMPORTANT):
```bash
cast send <CONTRACT_ADDRESS> "transferOwnership(address)" \
  0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0 \
  --account clawd-deployer-3 \
  --password "$DEPLOYER_PASS" \
  --rpc-url https://base-mainnet.g.alchemy.com/v2/8GVG8WjDs-sGFRr6Rm839
```

---

## PHASE 6 — Frontend Build

Follow `https://ethskills.com/frontend-ux/SKILL.md` and `https://ethskills.com/orchestration/SKILL.md` exactly.

### scaffold.config.ts changes:
```typescript
const scaffoldConfig = {
  targetNetworks: [chains.base],
  onlyLocalBurnerWallet: true,  // ALWAYS TRUE — DO NOT CHANGE
  // ...
}
```

### Remove all SE2 defaults:
- Delete example contracts (YourContract, etc.)
- Remove BuidlGuidl footer
- Remove "Fork me" button
- Change app title to "LeftClaw Services"

### Pages to build:

**`pages/index.tsx` or `app/page.tsx`:**
```
Dark hero:
  - Headline: "Hire LeftClaw 🦞"
  - Subheadline: "AI-powered Ethereum development, audits & consulting"  
  - Stats row: [X] Jobs Completed | [X] Contracts Deployed | [X] CLAWD Paid
  - Two CTA buttons: "Browse Services" + "Post a Job"
  
Under hero:
  - Service overview cards (3 categories): Consulting / Build / Audit
  - "How it works" section: Post → Wait → Get Results
  - Recent completed jobs feed (from contract events)
```

**`/services` page:**
Grid of service cards. For each:
```
Icon | Title | Description | Price in CLAWD | ~$USD equiv | "Post This Job" button
```

Service cards:
```
🗣️ Quick Consult     | 15-message strategy session      | 66,666 CLAWD | ~$20
🗣️ Deep Consult      | 30-message build planning        | 100,000 CLAWD | ~$30
🔨 Simple Build      | 1 core feature, full SE2 app     | 1,666,666 CLAWD | ~$500
🔨 Full Build        | 3-5 features, tested & QA'd      | 3,333,333 CLAWD | ~$1,000
🔨 Complex Build     | Multi-contract, integrations     | 5,000,000 CLAWD | ~$1,500
🔨 Enterprise Build  | Custom quote (start here)        | 8,333,333 CLAWD | ~$2,500
🔍 QA Audit          | Full QA report + fixes           | 666,666 CLAWD | ~$200
🛡️ Contract Audit    | Single contract deep audit       | 1,000,000 CLAWD | ~$300
🛡️ System Audit      | Multi-contract security audit    | 2,000,000 CLAWD | ~$600
📝 Custom Job        | You set the price                | [input field]
```

Live prices: read from contract `servicePriceInClawd()` and display dynamically.
USD equivalent: CLAWD spot price via Uniswap V3 sqrtPriceX96 (see USD calculation below).

**Post Job Flow:**
After clicking "Post This Job":
- Modal or new page with:
  - Service type (pre-filled)
  - Description textarea (required, 10+ chars)
  - Upload brief? (optional IPFS upload via bgipfs)
  - Payment: "Pay with CLAWD" tab | "Pay with USDC" tab
  - For CLAWD path:
    ```
    [Switch to Base] → [Approve CLAWD] → [Post Job]
    ```
  - For USDC path:
    ```
    [Switch to Base] → [Approve USDC] → [Post Job with USDC]
    ```
  - Each button: shows spinner while tx pending, disabled if not ready, check mark when done
  - Show estimated CLAWD amount and USD equivalent
  - NEVER allow double-submit

**`/jobs` page (public job board):**
```
Table:
ID | Service | Client | Status | Created | Actions
```
- Status badges: colored (OPEN=blue, IN_PROGRESS=yellow, COMPLETED=green, CANCELLED=grey, DISPUTED=red)
- Click row → job detail page
- Filter by status
- Pagination (10 per page)

**`/my-jobs` page (wallet required):**
Same as /jobs but filtered to connected wallet.
- Cancel button on OPEN jobs (shows dialog "This will refund your CLAWD. Are you sure?")
- Dispute button on COMPLETED jobs within 7-day window
- View Result button for COMPLETED jobs (opens IPFS CID in new tab)

**`/job/[id]` page:**
- Full job details
- Status timeline: Posted → Accepted → Completed
- Description (fetch from IPFS if CID)
- If COMPLETED: result link + "View Result" button
- Client actions: Cancel (if OPEN) / Dispute (if COMPLETED, within window)

**CLAWD USD Price Calculation:**
Use Uniswap V3 slot0 to get sqrtPriceX96:
```typescript
// CLAWD/WETH pool on Base (look up via factory or use known address)
// Price calculation: (sqrtPriceX96 / 2^96)^2 gives CLAWD per WETH (or WETH per CLAWD depending on token order)
// Then multiply by ETH/USD price to get CLAWD/USD
// Simpler: use a pre-fetched price from the pool, update every 30s
```

If Uniswap pool address is unknown, fetch it:
```typescript
const factory = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" // Uniswap V3 factory Base
// getPool(CLAWD, WETH, 10000) // 1% fee tier
```

**OG Image / Meta tags:**
```typescript
// In _app.tsx or layout.tsx head:
<meta property="og:title" content="LeftClaw Services — Hire an AI Ethereum Builder" />
<meta property="og:description" content="Post a job onchain. LeftClaw builds it. Pay with CLAWD." />
<meta property="og:image" content="https://leftclaw.services/thumbnail.png" />
<meta property="og:url" content="https://leftclaw.services" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="https://leftclaw.services/thumbnail.png" />
```

**Generate thumbnail:**
Create `packages/nextjs/scripts/generate-thumbnail.js`:
```javascript
const puppeteer = require('puppeteer');
// Screenshot the running dev server's /og-image page
// or generate directly with canvas/sharp
// Size: 1200x630
// ALL content in center/left 65% safe zone (Telegram crops from right)
// Design: dark background, 🦞 emoji large, "LeftClaw Services" title, "Hire an AI Ethereum Builder" subtitle
// Save to packages/nextjs/public/thumbnail.png
```

**App name changes:**
- `packages/nextjs/package.json`: name → `leftclaw-services-frontend`
- Update all "Scaffold-ETH 2" references → "LeftClaw Services"
- Remove unused imports/components

---

## PHASE 7 — QA Audit

Fetch and follow EVERY item:
```bash
curl -s https://ethskills.com/qa/SKILL.md
curl -s https://ethskills.com/frontend-ux/SKILL.md
```

Fix EVERY problem found. Zero exceptions.

Write all fixes to `QA_REPORT.md` in project root. Format:
```markdown
## QA Item: [Name]
- Status: FIXED
- Issue: [what was wrong]
- Fix: [what you changed]
```

---

## PHASE 8 — IPFS Deploy

```bash
cd ~/projects/leftclaw-services/packages/nextjs
yarn bgipfs upload config init -u https://upload.bgipfs.com -k 4953f019-8b5d-4fb8-b799-f60417fe3197
NEXT_PUBLIC_IPFS_BUILD=true NEXT_PUBLIC_IGNORE_BUILD_ERROR=true yarn build
yarn bgipfs upload out
```

Note the IPFS CID from the output.

---

## PHASE 9 — ENS Setup

Check if Chrome is running:
```bash
curl -s http://127.0.0.1:18800/json/version 2>/dev/null | head -5
```

If not running, launch it:
```bash
nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="/Users/austingriffith/.openclaw/browser/openclaw/user-data" \
  --profile-directory="Profile 1" \
  --remote-debugging-port=18800 \
  --no-first-run \
  > /tmp/chrome-debug.log 2>&1 &
disown $!
sleep 5
```

Create subdomain and set contenthash for `leftclaw.services` → `ipfs://<CID>` using ENS app + MetaMask.

IMPORTANT MetaMask unlock method (the ONLY method that works with LavaMoat):
```javascript
// 1. Open MetaMask popup
// 2. Focus password field: document.querySelector("input[type=password]").focus()
// 3. Type password using execCommand: document.execCommand("insertText", false, "PASSWORD")
//    (Input.insertText / keyboard events do NOT work — LavaMoat blocks React synthetic events)
// 4. Click Unlock: Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim().toLowerCase()==="unlock").click()
```

---

## PHASE 10 — Write SKILL.md for Bot

Create `~/projects/leftclaw-services/LEFTCLAW_SERVICES_SKILL.md`:

```markdown
# LeftClaw Services SKILL.md

## Contract
- Address: [DEPLOYED_ADDRESS]
- Chain: Base (8453)
- RPC: https://base-mainnet.g.alchemy.com/v2/8GVG8WjDs-sGFRr6Rm839

## Executor Setup
- Deployer address: 0xa822155c242B3a307086F1e2787E393d78A0B5AC
- Keystore: clawd-deployer-3
- Password: security find-generic-password -s "clawd-deployer-3" -a "clawd" -w

## Check for Open Jobs
cast call [ADDRESS] "getOpenJobs()(uint256[])" --rpc-url https://base-mainnet.g.alchemy.com/v2/8GVG8WjDs-sGFRr6Rm839

## Get Job Details
cast call [ADDRESS] "jobs(uint256)(uint256,address,uint8,uint256,uint256,string,uint8,uint256,uint256,uint256,string,address)" <jobId> --rpc-url ...

## Accept Job
export PATH="$HOME/.foundry/bin:$PATH"
DEPLOYER_PASS=$(security find-generic-password -s "clawd-deployer-3" -a "clawd" -w)
cast send [ADDRESS] "acceptJob(uint256)" <jobId> --account clawd-deployer-3 --password "$DEPLOYER_PASS" --rpc-url ...

## Complete Job
cast send [ADDRESS] "completeJob(uint256,string)" <jobId> "<resultCID>" --account clawd-deployer-3 --password "$DEPLOYER_PASS" --rpc-url ...

## Claim Payment (after 7-day window)
cast send [ADDRESS] "claimPayment(uint256)" <jobId> --account clawd-deployer-3 --password "$DEPLOYER_PASS" --rpc-url ...

## Service Types
0: CONSULT_S — 15-message consultation. Respond with thoughtful advice via Telegram/chat.
1: CONSULT_L — 30-message consultation. Same but more depth.
2: BUILD_S — Simple build. Follow ethskills.com ship/SKILL.md, build SE2 app, deploy to IPFS.
3: BUILD_M — Full build. SE2 + tests + QA + IPFS + ENS.
4: BUILD_L — Complex build. Multi-contract + full audit + all phases.
5: BUILD_XL — Enterprise build. Custom consultation first, then build.
6: QA_AUDIT — Run ethskills.com/qa/SKILL.md against their repo. Return QA_REPORT.md.
7: AUDIT_S — Run ethskills.com/audit/SKILL.md against single contract. Return AUDIT_REPORT.md.
8: AUDIT_L — Same but multi-contract system.
9: CUSTOM — Read descriptionCID to understand what's needed.

## Workflow
1. Run getOpenJobs() — check every 15 minutes
2. For each job: get details, read descriptionCID from IPFS
3. Evaluate: can I do this? Is price fair?
4. acceptJob(jobId) — marks IN_PROGRESS
5. Execute the work (build/audit/consult based on serviceType)
6. Upload result to IPFS: node ~/nerve-cord/upload-ipfs.js <file>
7. completeJob(jobId, "<resultCID>") — marks COMPLETED, starts dispute window
8. After 7 days: claimPayment(jobId) — receive CLAWD
```

Also copy to workspace:
```bash
cp ~/projects/leftclaw-services/LEFTCLAW_SERVICES_SKILL.md \
   /Users/austingriffith/.openclaw/workspace/LEFTCLAW_SERVICES_SKILL.md
```

---

## PHASE 11 — Push to GitHub

```bash
cd ~/projects/leftclaw-services
git add -A
git commit -m "🦞 LeftClaw Services v1 — AI service marketplace on Base

- LeftClawServices.sol: job marketplace with CLAWD/USDC payment
- Full test suite (13 tests, all passing on Base fork)
- SE2 frontend with service cards, job board, post job flow
- Three-button approve flow, USD values, dark theme
- Deployed to Base: [CONTRACT_ADDRESS]
- IPFS: [CID]

Services: Consulting, Build (500-2500 USDC), QA Audit, Solidity Audit"

git push origin main
```

---

## PHASE 12 — Final Report

Write `DEPLOY_REPORT.md`:
```markdown
# LeftClaw Services — Deploy Report
Date: [DATE]

## Contract
- Address: [CONTRACT_ADDRESS] on Base
- Owner: 0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0 (Safe)
- Executor: 0xa822155c242B3a307086F1e2787E393d78A0B5AC (leftclaw)
- Verified: [yes/no]

## Frontend
- IPFS CID: [CID]
- Live URL: https://leftclaw.services
- ENS: leftclaw.services

## GitHub
- https://github.com/clawdbotatg/leftclaw-services

## Services Available
[list all with prices]

## Audit Findings Fixed
[list critical/high findings and fixes]

## QA Items Fixed
[list all QA issues and fixes]

## Known Issues / Future Work
[anything not completed]
```

---

## PHASE 13 — Nerve Cord Log

```bash
curl -s -X POST http://clawds-Mac-mini.local:9999/log \
  -H "Authorization: Bearer 8fbed3df360d8889324240bb43f183062129ecf95073d7cae4f7bb9b1a92a21c" \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"leftclaw\",\"text\":\"LeftClaw Services v1 deployed to Base\",\"details\":\"Contract: [ADDR] | IPFS: [CID] | Site: leftclaw.services | GitHub: github.com/clawdbotatg/leftclaw-services\",\"tags\":[\"dev\",\"services\",\"milestone\"]}"
```

---

## COMPLETION NOTIFICATION

When ALL steps above are done:
```bash
openclaw system event --text "Done: LeftClaw Services marketplace deployed! Contract on Base, live at leftclaw.services" --mode now
```

---

## BLOCKER HANDLING

If you hit a hard blocker (e.g. out of ETH for deploy gas, MetaMask won't unlock, create-eth fails):
1. Write it to `BLOCKERS.md` in the project root
2. Work around it or skip that specific step
3. Keep going with everything else

Do NOT stop the entire build for a single blocker.

---

## ABSOLUTE RULES (enforce these every step)
1. 🚨 `onlyLocalBurnerWallet: true` — ALWAYS. NEVER change it.
2. 🚨 ALWAYS `export PATH="$HOME/.foundry/bin:$PATH"` before forge/cast
3. 🚨 GitHub: push as `clawdbotatg`, NEVER `austintgriffith`
4. 🚨 ENS: `.eth.link` ALWAYS, `.eth.limo` NEVER
5. 🚨 USDC price: sqrtPriceX96 ONLY, NEVER pool.balanceOf()
6. 🚨 Fix ALL QA items — zero exceptions
7. 🚨 Fix ALL critical + high severity audit findings
8. 🚨 Test in browser (check via Chrome CDP) before declaring frontend done
9. 🚨 Follow ethskills.com EXACTLY — every single line
10. 🚨 Be autonomous — figure it out, don't stop
