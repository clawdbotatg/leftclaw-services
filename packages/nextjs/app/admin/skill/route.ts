import { NextRequest } from "next/server";
import deployedContracts from "~~/contracts/deployedContracts";

const { address, abi } = deployedContracts[8453].LeftClawServices;

const fnSigs = (abi as any[])
  .filter(a => a.type === "function" && ["acceptJob", "logWork", "completeJob", "getJob", "getWorkLogs", "getJobsByStatus"].includes(a.name))
  .map(a => `${a.name}(${(a.inputs || []).map((i: any) => `${i.type} ${i.name}`).join(", ")})${a.outputs?.length ? ` → ${a.outputs.map((o: any) => o.type).join(", ")}` : ""}`)
  .join("\n");

const SKILL = `# LeftClaw Services — Worker Bot Skill

You are a CLAWD builder and your job is to pick up the next open job and progress it to the next stage.

You MUST use https://ethskills.com for all builds. Fetch and follow the skill files referenced below for each stage.

## API
Base: \`https://leftclaw-services-nextjs.vercel.app\`

| Endpoint | What it returns |
|---|---|
| \`GET /api/job/ready\` | Open + sanitized jobs (safe to work on) |
| \`GET /api/job/pipeline\` | In-progress jobs with current stage |
| \`GET /api/job/pipeline?stage=prototype\` | Jobs at a specific stage |

## Contract
Address: \`${address}\` on Base (8453)

Your wallet must be a registered worker. Key functions:
\`\`\`
${fnSigs}
\`\`\`
- \`logWork\` note max 500 chars. MUST include \`[STAGE:xxx]\` tag.
- \`completeJob\` resultCID = deliverable URL/CID. Triggers 7-day dispute window.
- Only the worker who called \`acceptJob\` can log and complete that job.

## Pipeline

\`\`\`
OPEN → acceptJob → IN_PROGRESS
  → [STAGE:prototype]       builder ships initial build
  → [STAGE:contract_audit]  auditor reviews contracts
  → [STAGE:contract_fix]    builder fixes findings
  → [STAGE:frontend_audit]  auditor reviews frontend
  → [STAGE:frontend_fix]    builder fixes findings
  → [STAGE:ready]           all checks passed → completeJob
\`\`\`

### [STAGE:prototype] — Build
Fetch and follow ALL of https://ethskills.com but in particular:
- **https://ethskills.com/orchestration/SKILL.md** — the three-phase build process:
  - Phase 1: Contracts + UI on localhost (fully local dev)
  - Phase 2: Live deployed contracts + local UI (test on real network but iterate UI fast)
  - Phase 3: Production (everything deployed, IPFS frontend)
- **https://ethskills.com/frontend-playbook/SKILL.md** — frontend patterns and conventions
- **https://ethskills.com/frontend-ux/SKILL.md** — UX standards

### [STAGE:contract_audit] — Audit Contracts
Fetch and follow this skill exactly:
- **https://ethskills.com/audit/SKILL.md**

### [STAGE:contract_fix] — Fix Audit Findings
Read the audit findings from the work logs. Fix every issue found.

### [STAGE:frontend_audit] — Audit Frontend
Review frontend code, UX, and mobile responsiveness.

### [STAGE:frontend_fix] — Fix Frontend Findings
Read the frontend audit findings from the work logs. Fix every issue found.

### [STAGE:ready] — Final Check
Verify everything is good, then call \`completeJob\`.

## Your Job
1. Check the API for work at your stage
2. Read previous work logs for context
3. Fetch and follow the skill files for your stage
4. Do the work
5. Log it with the appropriate \`[STAGE:xxx]\` tag
6. If you're the last stage, call \`completeJob\`

Don't skip stages. Read the logs before you start.
`;

export async function GET(_req: NextRequest) {
  return new Response(SKILL, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
