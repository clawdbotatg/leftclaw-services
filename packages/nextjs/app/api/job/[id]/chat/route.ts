// Env vars required:
// - GITHUB_TOKEN: GitHub PAT with `repo` scope on the `clawdbotatg` org
// - ANTHROPIC_API_KEY: Anthropic API key for Claude
// - NEXT_PUBLIC_ALCHEMY_API_KEY: Alchemy key for Base RPC (optional)

import { NextRequest } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { execSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import deployedContracts from "~~/contracts/deployedContracts";
import { getMessages, addJobMessage } from "~~/lib/jobMessages";
import { getConsultPrompt } from "~~/lib/consultPrompt";

const { address, abi } = deployedContracts[8453].LeftClawServicesV2;

const viemClient = createPublicClient({
  chain: base,
  transport: http(
    process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
      ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
      : undefined,
  ),
});

// Track which jobs have already been accepted (in-memory, survives hot reloads via module scope)
const acceptedJobs = new Set<string>();

// Consultation service type IDs (Quick Consultation = 1, Deep Consultation = 2)
const CONSULTATION_TYPE_IDS = [1, 2];

// SSRF / exfil guard for the `fetch_url` tool. An injected job description drives
// the model to call fetch_url ~88% of the time (measured); the model's textual
// "I won't do that" is unreliable — the tool call fires regardless. So the fetch
// is gated deterministically here: HTTPS only, host must be on the allowlist.
// Fail-closed — anything unparseable or off-list is refused, not fetched.
const ALLOWED_FETCH_HOSTS = ["github.com", "raw.githubusercontent.com", "gist.githubusercontent.com", "ethskills.com"];
function isFetchAllowed(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  return ALLOWED_FETCH_HOSTS.some(h => host === h || host.endsWith("." + h));
}

/**
 * Get a wallet client using the deployer key from the macOS keychain + foundry keystore.
 * Returns null if running in an environment where the keychain/cast is not available.
 */
function getDeployerWalletClient() {
  try {
    const password = execSync('security find-generic-password -s "clawd-deployer-local" -a "clawd" -w 2>/dev/null').toString().trim();
    const privateKeyHex = execSync(
      `cast wallet decrypt-keystore clawd-deployer-local --unsafe-password "${password}"`,
      { env: { ...process.env, PATH: `${process.env.PATH}:/Users/clawd/.foundry/bin` } }
    ).toString().trim();
    // Extract hex key from output like "clawd-deployer-local's private key is: 0x..."
    const match = privateKeyHex.match(/(0x[0-9a-fA-F]{64})/);
    if (!match) return null;
    const account = privateKeyToAccount(match[1] as `0x${string}`);
    return createWalletClient({
      account,
      chain: base,
      transport: http(
        process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
          ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
          : "https://mainnet.base.org",
      ),
    });
  } catch (e) {
    console.error("[chat] Failed to create deployer wallet client:", e);
    return null;
  }
}

/**
 * Accept a consultation job on-chain (OPEN → IN_PROGRESS).
 * Only called once per job — tracked in acceptedJobs set.
 */
async function acceptConsultationJob(jobId: bigint): Promise<boolean> {
  const key = jobId.toString();
  if (acceptedJobs.has(key)) return true; // Already accepted

  const walletClient = getDeployerWalletClient();
  if (!walletClient) {
    console.error("[chat] Cannot accept job — no deployer wallet available");
    return false;
  }

  try {
    const hash = await walletClient.writeContract({
      address,
      abi,
      functionName: "acceptJob",
      args: [jobId],
    });
    console.log(`[chat] Accepted consultation job ${key} on-chain, tx: ${hash}`);
    acceptedJobs.add(key);
    return true;
  } catch (e: any) {
    // If the job was already accepted (e.g. by another process), mark it and move on
    if (e.message?.includes("already") || e.message?.includes("IN_PROGRESS")) {
      console.log(`[chat] Job ${key} already accepted on-chain`);
      acceptedJobs.add(key);
      return true;
    }
    console.error(`[chat] Failed to accept job ${key}:`, e);
    return false;
  }
}

// Rate limiting: in-memory Map
// - Per-window (hourly) rate limit for active jobs: 3/hour per client per job
// - Post-completion: max 2 messages after job reaches COMPLETED/DECLINED/CANCELLED, then hard close forever
const rateLimits = new Map<string, number[]>();
const postCompletionCounts = new Map<string, number>();

function checkRateLimit(jobId: string, clientAddress: string, jobStatus: number): { allowed: boolean; used: number; remaining: number; closed?: boolean } {
  const key = `chat:${jobId}:${clientAddress.toLowerCase()}`;

  // If job is in a terminal state, check post-completion cap
  if (jobStatus === 2 || jobStatus === 3 || jobStatus === 4) {
    const used = postCompletionCounts.get(key) || 0;
    if (used >= 2) {
      return { allowed: false, used, remaining: 0, closed: true };
    }
    return { allowed: true, used, remaining: 2 - used, closed: false };
  }

  // Active job: sliding hourly window, 3 max
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const timestamps = (rateLimits.get(key) || []).filter(t => t > hourAgo);
  rateLimits.set(key, timestamps);
  if (timestamps.length >= 3) {
    return { allowed: false, used: timestamps.length, remaining: 0 };
  }
  return { allowed: true, used: timestamps.length, remaining: 3 - timestamps.length };
}

function recordUsage(jobId: string, clientAddress: string, jobStatus: number) {
  const key = `chat:${jobId}:${clientAddress.toLowerCase()}`;

  // If job is in a terminal state, increment post-completion counter (never resets)
  if (jobStatus === 2 || jobStatus === 3 || jobStatus === 4) {
    const used = postCompletionCounts.get(key) || 0;
    postCompletionCounts.set(key, used + 1);
    return;
  }

  // Active job: sliding hourly window
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const timestamps = (rateLimits.get(key) || []).filter(t => t > hourAgo);
  timestamps.push(now);
  rateLimits.set(key, timestamps);
}

const SERVICE_TYPE_NAMES: Record<number, string> = {
  1: "Quick Consultation",
  2: "Deep Consultation",
  3: "PFP Generator",
  4: "Contract Audit",
  5: "Frontend QA Audit",
  6: "Build",
  7: "Research Report",
  8: "Judge / Oracle",
  9: "HumanQA",
  10: "Feature",
};

async function fetchDescriptionContent(descriptionCID: string): Promise<string> {
  if (!descriptionCID) return "No description provided";

  const parts: string[] = [`Raw description: ${descriptionCID}`];

  // Extract all URLs from the description text
  const urlMatches: string[] = descriptionCID.match(/https?:\/\/[^\s<>"]+/g) || [];

  // Also handle bare IPFS CIDs
  if (descriptionCID.startsWith("Qm") || descriptionCID.startsWith("bafy")) {
    urlMatches.push(`https://ipfs.io/ipfs/${descriptionCID}`);
  }

  const uniqueUrls = [...new Set(urlMatches)].slice(0, 3);

  for (const url of uniqueUrls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) {
        parts.push(`[${url}]: HTTP ${res.status}`);
        continue;
      }
      const contentType = res.headers.get("content-type") || "";
      let text = await res.text();
      // Strip HTML tags if HTML response
      if (contentType.includes("html")) {
        text = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      }
      parts.push(`[Content from ${url}]:\n${text.slice(0, 2000)}`);
    } catch (e: any) {
      parts.push(`[${url}]: Failed to fetch (${e.message})`);
    }
  }

  return parts.join("\n\n");
}

async function fetchSkillMd(jobId: string): Promise<string | null> {
  // Try job repo first
  const jobSkill = await fetchGitHubFile(jobId, "SKILL.md");
  if (jobSkill) return jobSkill.slice(0, 4000);
  // Fall back to main repo
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch("https://raw.githubusercontent.com/clawdbotatg/leftclaw-services/main/SKILL.md", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 4000);
  } catch {
    return null;
  }
}

async function fetchGitHubFile(jobId: string, path: string): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/clawdbotatg/leftclaw-service-job-${jobId}/contents/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.content && data.encoding === "base64") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!jobId) return Response.json({ error: "Job ID required" }, { status: 400 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { message, clientAddress, signature, signedMessage } = body;
  if (!message || !clientAddress || !signature || !signedMessage) {
    return Response.json({ error: "message, clientAddress, signature, signedMessage required" }, { status: 400 });
  }

  // Verify signature window (5 min)
  const window = Math.floor(Date.now() / 300000) * 300000;
  const expectedMsg = `LeftClaw Job Chat - Job #${jobId} - ${window}`;
  // Also allow previous window for clock skew
  const prevWindow = window - 300000;
  const expectedMsgPrev = `LeftClaw Job Chat - Job #${jobId} - ${prevWindow}`;
  if (signedMessage !== expectedMsg && signedMessage !== expectedMsgPrev) {
    return Response.json({ error: "Invalid or expired signed message" }, { status: 401 });
  }

  // Verify wallet signature
  let valid = false;
  try {
    valid = await viemClient.verifyMessage({ address: clientAddress as `0x${string}`, message: signedMessage, signature });
  } catch {
    return Response.json({ error: "Signature verification failed" }, { status: 401 });
  }
  if (!valid) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Fetch job from chain and verify client
  let job: any;
  try {
    // jobId format: "cv-1773321831954" — extract numeric part or use as bigint
    const numericId = jobId.startsWith("cv-") ? BigInt(jobId.slice(3)) : BigInt(jobId);
    job = await viemClient.readContract({ address, abi, functionName: "getJob", args: [numericId] });
  } catch {
    return Response.json({ error: "Job not found on chain" }, { status: 404 });
  }

  if (job.client.toLowerCase() !== clientAddress.toLowerCase()) {
    return Response.json({ error: "Not the job client" }, { status: 401 });
  }

  // Auto-accept consultation jobs on first client message
  const jobServiceTypeId = Number(job.serviceTypeId);
  const jobStatus = Number(job.status);
  if (CONSULTATION_TYPE_IDS.includes(jobServiceTypeId) && jobStatus === 0 /* OPEN */) {
    const numericIdForAccept = jobId.startsWith("cv-") ? BigInt(jobId.slice(3)) : BigInt(jobId);
    const accepted = await acceptConsultationJob(numericIdForAccept);
    if (accepted) {
      console.log(`[chat] Consultation job ${jobId} auto-accepted on first client message`);
    }
  }

  // Rate limit
  const rl = checkRateLimit(jobId, clientAddress, Number(job.status));
  if (!rl.allowed) {
    if (rl.closed) {
      return Response.json({ error: "Chat closed — job is complete. Open a new job if you need more work." }, { status: 429 });
    }
    return Response.json({ error: "Rate limit exceeded (3/hour for active jobs)", messagesUsed: rl.used, messagesRemaining: 0 }, { status: 429 });
  }

  // For consult jobs, the on-chain description is a placeholder; the real prompt
  // lives off-chain in KV (consultPrompt store). Old consult jobs have the real
  // prompt on-chain — fall back to that.
  const isConsultJob = CONSULTATION_TYPE_IDS.includes(jobServiceTypeId);
  const offChainPrompt = isConsultJob ? await getConsultPrompt(jobId) : null;
  const descriptionForContext = offChainPrompt || job.description || "";

  // Fetch context
  const numericId = jobId.startsWith("cv-") ? BigInt(jobId.slice(3)) : BigInt(jobId);
  const [workLogsRaw, messages, planMd, userJourneyMd, descriptionContent, skillMd] = await Promise.all([
    viemClient.readContract({ address, abi, functionName: "getWorkLogs", args: [numericId] }).catch(() => [] as any[]),
    getMessages(jobId),
    fetchGitHubFile(jobId, "PLAN.md"),
    fetchGitHubFile(jobId, "USERJOURNEY.md"),
    fetchDescriptionContent(descriptionForContext),
    fetchSkillMd(jobId),
  ]);

  const workLogs = (workLogsRaw as any[]).map((l: any) => ({ note: l.note, timestamp: Number(l.timestamp) }));

  const pendingEscalations = messages.filter(
    m => m.type === "escalation" && !messages.some(r => r.type === "escalation_response" && (r.metadata as any)?.escalation_id === m.id),
  );

  // Store client message
  await addJobMessage(jobId, { type: "client_message", from: "client", content: message });
  recordUsage(jobId, clientAddress, Number(job.status));

  const serviceTypeName = SERVICE_TYPE_NAMES[Number(job.serviceTypeId)] || `Unknown (${Number(job.serviceTypeId)})`;
  const cvAmount = Number(job.paymentClawd) / 1e18;
  const cvFormatted =
    cvAmount >= 1_000_000
      ? `${(cvAmount / 1_000_000).toFixed(1)}M CV`
      : cvAmount >= 1_000
        ? `${(cvAmount / 1_000).toFixed(1)}K CV`
        : `${cvAmount} CV`;
  const usdFormatted = (Number(job.priceUsd) / 1e6).toFixed(2);
  const priceDisplay =
    cvAmount > 0 && Number(job.priceUsd) === 0
      ? cvFormatted
      : cvAmount > 0
        ? `${cvFormatted} + $${usdFormatted} USDC`
        : `$${usdFormatted} USDC`;

  const systemPrompt = `You are the project manager for a LeftClaw Services build job. You have full context on this job and can answer any question the client asks — about what's being built, the current status, architectural decisions, blockers, or next steps.

## About LeftClaw Services
LeftClaw Services is an AI-powered Ethereum builder marketplace where clients hire CLAWD worker bots to build onchain apps, smart contracts, and web3 projects. Jobs are posted on-chain on Base (contract: 0x103c5FAfd8734AE9Ec4Cc2f116eD03Ff6cc2Ca5F). Payment is in CLAWD tokens (the project's conviction token) or USDC. Workers are AI bots (leftclaw.eth, rightclaw.eth, clawdheart.eth, clawdgut.eth) that build autonomously through stages: create_plan → create_repo → setup_scaffold → develop → test → deploy → ready.

## About CV (Conviction / Clawdviction)
CV is a token earned by staking CLAWD on larv.ai. It is used as an alternative payment method for jobs on LeftClaw Services. **CV is NOT dollars, NOT USDC, and NOT any stablecoin.** Amounts like "10M CV" or "500,000 CV" refer to CV tokens only — do NOT convert CV to USD, do NOT multiply by any price, and do NOT mention a dollar equivalent. A job priced at 10,000,000 CV is simply "10M CV" — not $10,000,000 or any other dollar figure.

When a client pays in CV, the amount signals their conviction level:
- Under 100K CV: casual interest
- 100K–1M CV: serious commitment
- 1M–10M CV: high conviction — this client believes strongly in the project
- 10M+ CV: maximum conviction — this is a major bet on the outcome

The more CV a client pays, the more skin they have in the game. High CV jobs are prioritized and signal strong alignment between client and project.

## This Job
- **Job ID:** ${jobId}
- **Client:** ${job.client}
- **Service:** ${serviceTypeName}
- **Price:** ${priceDisplay}
- **Status:** ${job.status} | **Stage:** ${job.currentStage || "not started"}
- **Created:** ${new Date(Number(job.createdAt) * 1000).toISOString()}
- **Worker:** ${job.worker || "unassigned"}

## Project Description
${descriptionContent}

## Build Process (SKILL.md)
${skillMd || "Not available"}

## Build Standards (ethskills.com)
The CLAWD worker bot builds according to ethskills.com — a library of SKILL.md files covering every aspect of building on Ethereum. Before starting any task, the bot fetches the relevant skill file and follows it exactly. No shortcuts. No assumptions.

Key skill files the bot uses:
- Ship process: https://ethskills.com/ship/SKILL.md
- Security: https://ethskills.com/security/SKILL.md
- Testing: https://ethskills.com/testing/SKILL.md
- Solidity standards: https://ethskills.com/standards/SKILL.md
- Tools (Foundry, Scaffold-ETH): https://ethskills.com/tools/SKILL.md
- Frontend: https://ethskills.com/frontend-playbook/SKILL.md
- DeFi/money legos: https://ethskills.com/building-blocks/SKILL.md
- QA pre-ship: https://ethskills.com/qa/SKILL.md
- Audit: https://ethskills.com/audit/SKILL.md
- All skills index: https://ethskills.com/SKILL.md

If the client asks why something was built a certain way, the answer is probably in one of these skill files. You can reference them when explaining decisions.

## Work Log (what the bot has done so far)
${workLogs.map((l: any) => `[${new Date(l.timestamp * 1000).toISOString()}] ${l.note}`).join("\n") || "No work started yet"}

## Build Plan (PLAN.md from repo)
${planMd || "Not yet created — the bot hasn't started the build plan stage yet"}

## User Journey (USERJOURNEY.md from repo)
${userJourneyMd || "Not yet created"}

## Message History
${messages.map(m => `[${m.type}] ${m.from}: ${m.content}`).join("\n") || "No prior messages"}

## Pending Escalations (blocking the bot)
${pendingEscalations.length > 0 ? pendingEscalations.map(e => `BLOCKED: ${(e.metadata as any)?.question}\nDetails: ${e.content}`).join("\n") : "None — bot is not blocked"}

You can use your tools to read additional repo files, answer escalations, or request a stage rollback. Be direct and specific — the client wants to know what's actually happening with their build, not generic platitudes.`;

  const tools: Anthropic.Messages.Tool[] = [
    {
      name: "read_file",
      description: "Read a file from the job's GitHub repo",
      input_schema: {
        type: "object" as const,
        properties: { path: { type: "string", description: "File path, e.g. PLAN.md or src/contracts/Token.sol" } },
        required: ["path"],
      },
    },
    {
      name: "answer_escalation",
      description: "Store the client's answer to a pending escalation question",
      input_schema: {
        type: "object" as const,
        properties: {
          escalation_id: { type: "string" },
          answer: { type: "string" },
        },
        required: ["escalation_id", "answer"],
      },
    },
    {
      name: "request_stage_rollback",
      description: "Request the worker bot roll back the job to a previous stage",
      input_schema: {
        type: "object" as const,
        properties: {
          stage: { type: "string", description: "Stage to roll back to, e.g. create_plan" },
          reason: { type: "string" },
        },
        required: ["stage", "reason"],
      },
    },
    {
      name: "fetch_url",
      description: "Fetch and read any URL — GitHub gists, documentation, external resources, or any link the client mentions",
      input_schema: {
        type: "object" as const,
        properties: {
          url: { type: "string", description: "The full URL to fetch" },
        },
        required: ["url"],
      },
    },
    {
      name: "fetch_ethskill",
      description: "Fetch a skill file from ethskills.com to answer a client question about standards, tools, security, or best practices",
      input_schema: {
        type: "object" as const,
        properties: {
          skill: {
            type: "string",
            description: "The skill path, e.g. 'security', 'testing', 'standards', 'tools', 'ship', 'frontend-playbook', 'qa', 'audit', 'building-blocks', 'l2s', 'gas', 'wallets', 'indexing', 'frontend-ux', 'orchestration', 'addresses', 'concepts', 'why'",
          },
        },
        required: ["skill"],
      },
    },
  ];

  // Call Bankr LLM gateway (Anthropic-compatible) with tool use loop
  const anthropic = new Anthropic({ apiKey: process.env.BANKR_API_KEY, baseURL: "https://llm.bankr.bot" });
  const aiMessages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: message }];

  let finalText = "";
  const maxIterations = 5;

  for (let i = 0; i < maxIterations; i++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4.6",
      max_tokens: 2000,
      system: systemPrompt,
      tools,
      messages: aiMessages,
    });

    // Collect text blocks
    const textBlocks = response.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text");
    finalText = textBlocks.map(b => b.text).join("\n");

    if (response.stop_reason !== "tool_use") break;

    // Process tool calls
    const toolUseBlocks = response.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
    aiMessages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const tu of toolUseBlocks) {
      let result: string;
      const input = tu.input as any;

      if (tu.name === "read_file") {
        const content = await fetchGitHubFile(jobId, input.path);
        result = content || `File not found: ${input.path}`;
      } else if (tu.name === "answer_escalation") {
        await addJobMessage(jobId, {
          type: "escalation_response",
          from: "client",
          content: input.answer,
          metadata: { escalation_id: input.escalation_id },
        });
        result = `Escalation ${input.escalation_id} answered. The bot will see this when it resumes.`;
      } else if (tu.name === "request_stage_rollback") {
        await addJobMessage(jobId, {
          type: "rollback_request" as any,
          from: "client",
          content: input.reason,
          metadata: { stage: input.stage },
        });
        result = `Rollback to ${input.stage} requested. The bot will honor this when it resumes.`;
      } else if (tu.name === "fetch_url") {
        if (!isFetchAllowed(input.url)) {
          console.warn(`[chat] blocked fetch_url to disallowed host for job ${jobId}: ${input.url}`);
          result = `Blocked: "${input.url}" is not an allowed destination. External fetches are restricted to github.com and ethskills.com. If you need this content, ask the client to put it in a GitHub repo or gist.`;
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
          continue;
        }
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const res = await fetch(input.url, { signal: controller.signal });
          clearTimeout(timeout);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const contentType = res.headers.get("content-type") || "";
          let text = await res.text();
          if (contentType.includes("html")) {
            text = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          }
          result = text.slice(0, 4000);
        } catch (e: any) {
          result = `Failed to fetch ${input.url}: ${e.message}`;
        }
      } else if (tu.name === "fetch_ethskill") {
        try {
          const res = await fetch(`https://ethskills.com/${input.skill}/SKILL.md`, { signal: AbortSignal.timeout(5000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          result = text.slice(0, 4000);
        } catch (e: any) {
          result = `Failed to fetch ethskills.com/${input.skill}/SKILL.md: ${e.message}`;
        }
      } else {
        result = "Unknown tool";
      }
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }
    aiMessages.push({ role: "user", content: toolResults });
  }

  // Store AI response
  await addJobMessage(jobId, { type: "ai_response", from: "ai", content: finalText });

  const updatedRl = checkRateLimit(jobId, clientAddress, Number(job.status));

  return Response.json({
    reply: finalText,
    pendingEscalations: pendingEscalations.map(e => ({
      id: e.id,
      question: (e.metadata as any)?.question,
      details: e.content,
      stage: (e.metadata as any)?.stage,
      timestamp: e.timestamp,
    })),
    messagesUsed: updatedRl.used,
    messagesRemaining: updatedRl.remaining,
    chatClosed: updatedRl.closed || false,
  });
}
