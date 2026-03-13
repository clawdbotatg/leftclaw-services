// Env vars required:
// - GITHUB_TOKEN: GitHub PAT with `repo` scope on the `clawdbotatg` org
// - ANTHROPIC_API_KEY: Anthropic API key for Claude
// - NEXT_PUBLIC_ALCHEMY_API_KEY: Alchemy key for Base RPC (optional)

import { NextRequest } from "next/server";
import { createPublicClient, http, verifyMessage } from "viem";
import { base } from "viem/chains";
import Anthropic from "@anthropic-ai/sdk";
import deployedContracts from "~~/contracts/deployedContracts";
import { getMessages, addJobMessage, type JobMessage } from "~~/lib/jobMessages";

const { address, abi } = deployedContracts[8453].LeftClawServices;

const viemClient = createPublicClient({
  chain: base,
  transport: http(
    process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
      ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
      : undefined,
  ),
});

// Rate limiting: in-memory Map
const rateLimits = new Map<string, number[]>();

function checkRateLimit(jobId: string, clientAddress: string): { allowed: boolean; used: number; remaining: number } {
  const key = `chat:${jobId}:${clientAddress.toLowerCase()}`;
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const timestamps = (rateLimits.get(key) || []).filter(t => t > hourAgo);
  rateLimits.set(key, timestamps);
  if (timestamps.length >= 3) {
    return { allowed: false, used: timestamps.length, remaining: 0 };
  }
  return { allowed: true, used: timestamps.length, remaining: 3 - timestamps.length };
}

function recordUsage(jobId: string, clientAddress: string) {
  const key = `chat:${jobId}:${clientAddress.toLowerCase()}`;
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const timestamps = (rateLimits.get(key) || []).filter(t => t > hourAgo);
  timestamps.push(now);
  rateLimits.set(key, timestamps);
}

async function fetchGitHubFile(jobId: string, path: string): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/clawdbotatg/${jobId}/contents/${path}`, {
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
    valid = await verifyMessage({ address: clientAddress as `0x${string}`, message: signedMessage, signature });
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
  } catch (e) {
    return Response.json({ error: "Job not found on chain" }, { status: 404 });
  }

  if (job.client.toLowerCase() !== clientAddress.toLowerCase()) {
    return Response.json({ error: "Not the job client" }, { status: 401 });
  }

  // Rate limit
  const rl = checkRateLimit(jobId, clientAddress);
  if (!rl.allowed) {
    return Response.json({ error: "Rate limit exceeded (3/hour)", messagesUsed: rl.used, messagesRemaining: 0 }, { status: 429 });
  }

  // Fetch context
  const numericId = jobId.startsWith("cv-") ? BigInt(jobId.slice(3)) : BigInt(jobId);
  const [workLogsRaw, messages, planMd, userJourneyMd] = await Promise.all([
    viemClient.readContract({ address, abi, functionName: "getWorkLogs", args: [numericId] }).catch(() => [] as any[]),
    getMessages(jobId),
    fetchGitHubFile(jobId, "PLAN.md"),
    fetchGitHubFile(jobId, "USERJOURNEY.md"),
  ]);

  const workLogs = (workLogsRaw as any[]).map((l: any) => ({ note: l.note, timestamp: Number(l.timestamp) }));

  const pendingEscalations = messages.filter(
    m => m.type === "escalation" && !messages.some(r => r.type === "escalation_response" && (r.metadata as any)?.escalation_id === m.id),
  );

  // Store client message
  await addJobMessage(jobId, { type: "client_message", from: "client", content: message });
  recordUsage(jobId, clientAddress);

  const systemPrompt = `You are the project manager for a LeftClaw Services build job. You have full context on this job and can answer questions, explain architectural decisions, review progress, and help the client resolve blockers.

Job ID: ${jobId}
Current stage: ${job.currentStage}
Service type: ${Number(job.serviceType)}
Price: $${Number(job.priceUsd)}
Worker: ${job.worker}
Created: ${new Date(Number(job.createdAt) * 1000).toISOString()}

## Work Log (what the bot has done)
${workLogs.map((l: any) => `[${new Date(l.timestamp * 1000).toISOString()}] ${l.note}`).join("\n") || "No logs yet"}

## Build Plan (PLAN.md)
${planMd || "Not yet created"}

## User Journey (USERJOURNEY.md)
${userJourneyMd || "Not yet created"}

## Message History (escalations + prior chat)
${messages.map(m => `[${m.type}] ${m.from}: ${m.content}`).join("\n") || "No prior messages"}

## Pending Escalations
${pendingEscalations.length > 0 ? pendingEscalations.map(e => `BLOCKED: ${(e.metadata as any)?.question}\nDetails: ${e.content}`).join("\n") : "None"}

You have the following capabilities:
- Answer any question about the job using the context above
- If the client answers a pending escalation, use the answer_escalation tool to store their answer — the bot will be unblocked
- If the client wants to roll back to a previous stage, confirm and use the request_stage_rollback tool
- Use read_file to fetch additional files from the repo if needed`;

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
  ];

  // Call Anthropic with tool use loop
  const anthropic = new Anthropic();
  const aiMessages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: message }];

  let finalText = "";
  const maxIterations = 5;

  for (let i = 0; i < maxIterations; i++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
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
      } else {
        result = "Unknown tool";
      }
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }
    aiMessages.push({ role: "user", content: toolResults });
  }

  // Store AI response
  await addJobMessage(jobId, { type: "ai_response", from: "ai", content: finalText });

  const updatedRl = checkRateLimit(jobId, clientAddress);

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
  });
}
