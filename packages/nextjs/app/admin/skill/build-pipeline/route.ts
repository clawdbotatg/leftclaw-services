const SKILL_BUILD_PIPELINE = `# LeftClaw Services — Build Pipeline (Service Type 6)

This file covers the complete multi-stage pipeline for full builds (Service Type 6).

See also:
- \`/admin/skill\` — index and overview
- \`/admin/skill/service-types\` — flows for all service types
- \`/admin/skill/contract\` — contract methods and client ownership rules
- \`/admin/skill/api\` — API reference, messages, stage filtering

---

## Pipeline Overview

\`\`\`
OPEN → acceptJob → "accepted"
  → "create_repo"
  → "create_plan"
  → "create_user_journey"
  → "prototype"
  → "contract_audit"
  → "contract_fix"
  → "deep_contract_audit" ← SKIP if contract is simple (< 100 lines, no swaps/reentrancy/access control)
  → "deep_contract_fix" ← SKIP if no findings or skipped deep audit
  → "frontend_audit"
  → "frontend_fix"
  → "full_audit"
  → "full_audit_fix"
  → "deploy_contract"
  → "livecontract_fix"
  → "deploy_app"
  → "liveapp_fix"
  → "liveuserjourney"
  → "readme"
  → "ready" ← STOP HERE. Human reviews.
  → "blocked" ← Special state: bot is waiting for client answer to an escalation
\`\`\`

**Note on "accepted" stage:** When you call \`acceptJob(jobId)\`, the contract sets \`currentStage\` to \`"accepted"\`. This means the job is claimed but no work has started yet. The first real work stage is \`create_repo\`.

Every time you finish a stage, call \`logWork(jobId, note, stage)\` on-chain. The \`stage\` param (3rd arg) sets \`job.currentStage\` on-chain. That's how the next bot knows where the job is.

---

## Stage Instructions

### [STAGE:create_repo] — Create GitHub Repo
- Create a new repo in the \`clawdbotatg\` GitHub org
- Name the repo \`leftclaw-service-job-JOBID\` where JOBID is the job's ID — e.g., if jobId is \`42\`, the repo is \`leftclaw-service-job-42\`
- Initialize with a README
- Log the repo URL in the work log
- Advance to \`create_plan\`
- If you hit anything you cannot resolve during this stage, post an escalation (see API skill) and stop.

### [STAGE:create_plan] — Build Plan
- Clone the repo created in \`create_repo\` (repo name = \`leftclaw-service-job-JOBID\`)
- Scaffold the project (use scaffold-eth-2 if it's an Ethereum dapp)
- Write \`PLAN.md\`: architecture, contracts, frontend, integrations, everything the builder needs
- Commit and push
- If you hit anything you cannot resolve, escalate and stop.

### [STAGE:create_user_journey] — Write User Journey
- Write \`USERJOURNEY.md\` in the repo
- Step by step: what the user sees, what they click, what happens
- Cover happy path AND edge cases (wrong network, insufficient balance, no wallet, etc.)
- This doc guides the builder AND every auditor after

### [STAGE:prototype] — Build It
Before starting: call \`GET /api/job/{id}/messages\` to check for any pending escalation responses from the client. If there are \`rollback_request\` messages, honor them by moving back to the requested stage.

This is the biggest stage. Take your time. Get it right.

You MUST fetch and follow https://ethskills.com skills:
- **https://ethskills.com/orchestration/SKILL.md** — three-phase build:
  - Phase 1: Contracts + UI on localhost (fully local dev)
  - Phase 2: Live deployed contracts + local UI (real network, fast UI iteration)
  - Phase 3: Production (everything deployed, IPFS frontend)
- **https://ethskills.com/frontend-playbook/SKILL.md** — frontend patterns
- **https://ethskills.com/frontend-ux/SKILL.md** — UX standards

### [STAGE:contract_audit] — Audit Smart Contracts
Fetch and follow exactly: **https://ethskills.com/audit/SKILL.md**
Create GitHub issues on the project repo for each finding. Label: \`job-{id}\`, \`contract-audit\`

### [STAGE:contract_fix] — Fix Contract Audit Findings
List open issues labeled \`job-{id}\` + \`contract-audit\`. Fix each one. Close with commit reference.

### [STAGE:deep_contract_audit] — Deep Contract Audit (conditional)
**SKIP if the contract is simple** — basic storage, simple getters/setters, < 100 lines, no token swaps, no reentrancy vectors, no complex access control. Just log "Simple contract, skipping deep audit" and advance.

**DO this if the contract is complex** — has token swaps, multi-contract interactions, reentrancy risks, financial logic, upgradeable proxies, or > 200 lines.

How: audit using **https://github.com/pashov/smart-contract-audits** as your reference.
Create GitHub issues for each finding. Label: \`job-{id}\`, \`deep-contract-audit\`

### [STAGE:deep_contract_fix] — Fix Deep Contract Audit Findings
**SKIP if deep_contract_audit was skipped or had no findings.**
List open issues labeled \`job-{id}\` + \`deep-contract-audit\`. Fix each one. Close with commit reference.

### [STAGE:frontend_audit] — Audit Frontend
Fetch and follow exactly:
- **https://ethskills.com/qa/SKILL.md**
- **https://ethskills.com/frontend-ux/SKILL.md**
- **https://ethskills.com/frontend-playbook/SKILL.md**
Create GitHub issues for each finding. Label: \`job-{id}\`, \`frontend-audit\`

### [STAGE:frontend_fix] — Fix Frontend Audit Findings
List open issues labeled \`job-{id}\` + \`frontend-audit\`. Fix each one. Close with commit reference.

### [STAGE:full_audit] — Final Full Audit
One last pass on everything:
- No glaring problems
- Safe and secure — no one can lose money or get money locked
- Step through EACH skill at https://ethskills.com/ and verify it's been followed
Create GitHub issues for each finding. Label: \`job-{id}\`, \`full-audit\`

### [STAGE:full_audit_fix] — Fix Final Audit Findings
List open issues labeled \`job-{id}\` + \`full-audit\`. Fix each one. Close with commit reference.

### [STAGE:deploy_contract] — Deploy Contract & Test on Localhost
- Deploy contract to the live chain (default: Base)
- Verify on block explorer
- Run app on localhost against the live contract
- Test all flows end-to-end
- GitHub issues for problems. Label: \`job-{id}\`, \`deploy-contract\`

### [STAGE:livecontract_fix] — Fix Live Contract Issues
List open issues labeled \`job-{id}\` + \`deploy-contract\`. Fix each one. Close with commit reference.

### [STAGE:deploy_app] — Deploy to BGIPFS & Test Live
- Deploy frontend to BGIPFS (\`yarn ipfs\`)
- Test the fully live app (live contract + live frontend)
- GitHub issues for problems. Label: \`job-{id}\`, \`deploy-app\`

### [STAGE:liveapp_fix] — Fix Live App Issues
List open issues labeled \`job-{id}\` + \`deploy-app\`. Fix each one. Close with commit reference.

### [STAGE:liveuserjourney] — Walk the User Journey Live
(Requires browser automation + wallet. If you don't have browser access, log that and advance.)
- Open the live app in a browser WITH YOUR WALLET
- Follow \`USERJOURNEY.md\` step by step as a real user
- Actually click, connect, transact — everything
- If ANYTHING is broken or doesn't match the doc: go back to \`[STAGE:liveapp_fix]\`, file issues
- Only advance when the entire journey works perfectly

### [STAGE:readme] — Write README
- Write \`README.md\` for the repo
- Avoid slop. Only document what an LLM/human doesn't already know:
  - Contract addresses, chain, deployment info
  - How to run locally
  - Architecture decisions, non-obvious stuff
- Don't explain what React or Solidity is. Don't pad.

### [STAGE:ready] — Final Steps
- Log that all stages are complete
- Upload final deliverables to IPFS (README, source, etc.)
- \`completeJob(jobId, resultURL)\` — resultURL = **FULL IPFS URL** to the project.
  - Format: \`https://{CID}.ipfs.community.bgipfs.com/\`
  - Do NOT pass just the raw CID.
- Send the live working app URL to the client via \`POST /api/job/{id}/messages\` with type \`bot_message\` so they know it's done
- The job is complete. Move on to the next one.

**For ALL stages:** If you hit anything you cannot resolve, post an escalation (see API skill) and stop. Before starting any stage, call \`GET /api/job/{id}/messages\` to check for pending \`escalation_response\` or \`rollback_request\` messages.

---

## Moving a Job Backwards

If you find a problem that needs work from a previous stage, you can move the job back. Just call \`logWork\` with the earlier stage name:

\`\`\`
logWork(jobId, "Regression: audit found architecture issue requiring contract redesign. See issue #12.", "prototype")
\`\`\`

This resets \`job.currentStage\` on-chain. Always explain WHY you're moving it back in the note.
`;

export async function GET() {
  return new Response(SKILL_BUILD_PIPELINE, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
