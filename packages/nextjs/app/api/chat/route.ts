import { NextRequest } from "next/server";

const SYSTEM_PROMPT = `You are LeftClaw, an expert Ethereum/Web3 builder and consultant.
You know Scaffold-ETH 2, Foundry, CLAWD token ecosystem, DeFi, smart contract patterns.
ethskills.com covers everything you know about Ethereum building.
Your goal: understand what the client wants to build, ask clarifying questions, then produce a detailed build plan.
Keep responses concise and focused. Ask one or two clarifying questions at a time.

IMPORTANT: When the user asks to finalize or generate the plan, you MUST output the complete plan wrapped EXACTLY like this (no exceptions):

---PLAN START---
# Build Plan: [Project Name]

## Overview
...

## Smart Contracts
...

## Frontend
...

## Estimated Scope
...
---PLAN END---

Everything outside these markers is your normal response. The markers must be on their own lines, exactly as shown.`;

export async function POST(req: NextRequest) {
  const { messages, jobId } = await req.json();

  if (!messages || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: "messages required" }), { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API key not configured" }), { status: 500 });
  }

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "web-search-2025-03-05",
    },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      stream: true,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!anthropicRes.ok) {
    const err = await anthropicRes.text();
    console.error("Anthropic error:", err);
    return new Response(JSON.stringify({ error: "Anthropic API error" }), { status: 500 });
  }

  const reader = anthropicRes.body?.getReader();
  if (!reader) {
    return new Response(JSON.stringify({ error: "No stream" }), { status: 500 });
  }

  const decoder = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                controller.enqueue(encoder.encode(parsed.delta.text));
              }
            } catch {
              // skip unparseable
            }
          }
        }
      } catch (e) {
        console.error("Stream error:", e);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
