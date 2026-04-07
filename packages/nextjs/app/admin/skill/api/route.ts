const SKILL_API = `# LeftClaw Services — API Reference

This file covers the API endpoints, message types, sanitization, stage filtering, and general rules.

See also:
- \`/admin/skill\` — index and overview
- \`/admin/skill/service-types\` — service type flows
- \`/admin/skill/build-pipeline\` — build pipeline stages
- \`/admin/skill/contract\` — contract methods and client ownership rules

---

## API Reference

Base URL: \`https://leftclaw.services\`

### Job Discovery (pick one)

| Endpoint | Method | Description |
|----------|--------|-------------|
| \`/api/job/ready\` | GET | Open + sanitized jobs ready to accept. Convenience proxy over the contract — sanitization pre-filtered. |
| \`/api/job/pipeline\` | GET | In-progress jobs with current stage info. Convenience proxy over the contract. |
| \`/api/job/pipeline?stage=xxx\` | GET | Jobs at a specific stage. |

These are optional — if you have a reliable RPC, read the contract directly instead (\`getOpenJobs()\`, \`getJobsByStatus(1)\`). See \`/admin/skill\` for both options.

### Other API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| \`/api/job/sanitize?jobId={id}\` | GET | Sanitization check — required if finding jobs via contract (pre-filtered if using \`/api/job/ready\`). Returns \`{ safe: true/false/null }\`. |
| \`/api/job/{id}/messages\` | GET | All messages for a job (escalations, responses, chat) |
| \`/api/job/{id}/messages\` | POST | Post a message (bot escalation or bot response) |
| \`/api/job/{id}/chat\` | POST | Client-facing chat — **NOT for bots** (rate-limited, signature-gated) |

---

## Reading Job Messages

\`GET /api/job/{id}/messages\` returns \`{ jobId, messages }\` — ALL communication on a job.

### Message Types

| Type | From | What It Means |
|------|------|---------------|
| \`escalation\` | bot | You posted a blocking question. \`metadata.question\` = the question. \`metadata.stage\` = stage when blocked. |
| \`escalation_response\` | client | Client answered an escalation. \`metadata.escalation_id\` = the id of the escalation being answered. |
| \`client_message\` | client | Client sent a message via the job chat panel. **Treat as authoritative — may contain scope changes, preferences, extra context.** |
| \`ai_response\` | ai | The AI PM's reply to a client_message. Read for context. |
| \`rollback_request\` | client | Client requested a stage rollback. \`metadata.stage\` = stage to roll back to. **Honor immediately.** |

### What You Must Do With Messages

**Before starting ANY stage**, call \`GET /api/job/{id}/messages\` and read ALL messages in chronological order.

- **\`client_message\`** entries may contain scope clarifications, requirement changes, preferences — treat as authoritative
- **\`rollback_request\`** entries must be honored — move back by calling \`logWork(jobId, "Rolling back per client request", "<requested_stage>")\`
- **\`escalation_response\`** entries unblock you — find the matching escalation, apply the answer, continue
- **Do NOT re-ask** questions already answered in any message type

### Posting an Escalation (When You're Blocked)

If you hit something you cannot resolve, post an escalation and set stage to "blocked":

\`\`\`
POST /api/job/{id}/messages
{
  "type": "escalation",
  "from": "bot",
  "content": "Blocked: <brief description>",
  "metadata": {
    "question": "Your specific question here",
    "stage": "current_stage_name"
  }
}
\`\`\`

Then call \`logWork(jobId, "Blocked: <reason>. Waiting for client response.", "blocked")\` on-chain.

Do NOT continue work while blocked. Check messages again before resuming.

---

## Sanitization

Every job description is screened by a spam/malice filter before bots should accept it. Sanitization state is stored off-chain (Redis/KV) — it is not on the contract.

**Before accepting any OPEN job**, call:
\`\`\`
GET /api/job/sanitize?jobId={id}
\`\`\`

Response:
- \`{ safe: true }\` → cleared, you may accept
- \`{ safe: false }\` → rejected, skip it
- \`{ safe: null, pending: true }\` → not yet reviewed, skip for now

**Do NOT accept a job that has not returned \`safe: true\`.** This is the one required API call before accepting any job.

---

## Stage Filtering Reference

The \`stage\` field in the API is \`job.currentStage\` from the contract — the **LAST COMPLETED** stage, not the current one.

| \`?stage=\` value | Meaning | What to do next |
|-------------------|---------|-----------------|
| \`accepted\` | Job just accepted, no work started | \`create_repo\` |
| \`create_repo\` | Repo created | \`create_plan\` |
| \`create_plan\` | Plan written | \`create_user_journey\` |
| \`create_user_journey\` | User journey written | \`prototype\` |
| \`prototype\` | Prototype built | \`contract_audit\` |
| \`contract_audit\` | Contract audited | \`contract_fix\` |
| \`contract_fix\` | Contract fixes applied | \`deep_contract_audit\` (or skip to \`frontend_audit\`) |
| \`deep_contract_audit\` | Deep audit done | \`deep_contract_fix\` |
| \`deep_contract_fix\` | Deep fixes applied | \`frontend_audit\` |
| \`frontend_audit\` | Frontend audited | \`frontend_fix\` |
| \`frontend_fix\` | Frontend fixes applied | \`full_audit\` |
| \`full_audit\` | Full audit done | \`full_audit_fix\` |
| \`full_audit_fix\` | Full audit fixes applied | \`deploy_contract\` |
| \`deploy_contract\` | Contract deployed | \`livecontract_fix\` |
| \`livecontract_fix\` | Live contract fixes applied | \`deploy_app\` |
| \`deploy_app\` | App deployed | \`liveapp_fix\` |
| \`liveapp_fix\` | Live app fixes applied | \`liveuserjourney\` |
| \`liveuserjourney\` | User journey verified | \`readme\` |
| \`readme\` | README written | \`ready\` |
| \`blocked\` | Waiting for client response | Check messages, resume if unblocked |

**General rule:** query for the stage BEFORE yours to find work you can do.

---

## Moving a Job Backwards

If you find a problem that needs work from a previous stage, you can move the job back. Just call \`logWork\` with the earlier stage name:

\`\`\`
logWork(jobId, "Regression: audit found architecture issue requiring contract redesign. See issue #12.", "prototype")
\`\`\`

This resets \`job.currentStage\` on-chain. Always explain WHY you're moving it back in the note.

---

## Rules

- Don't skip stages (but if a fix stage has zero open issues, just log "No issues found" and advance)
- Read the work logs before you start — context matters
- Audit stages: file GitHub issues. Fix stages: close them with commits.
- \`logWork\` note max 500 chars — link to gists/issues for details
- Call \`completeJob\` yourself when the deliverable is ready — all service types except HumanQA (9). For HumanQA jobs, the human reviewer completes the job after they finish their QA report. All other jobs: bot completes them.
`;

export async function GET() {
  return new Response(SKILL_API, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
