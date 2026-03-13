import { NextRequest } from "next/server";
import { getMessages, addJobMessage } from "~~/lib/jobMessages";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;

  if (!jobId) {
    return new Response(JSON.stringify({ error: "Job ID required" }), { status: 400 });
  }

  const messages = await getMessages(jobId);

  return new Response(JSON.stringify({ jobId, messages }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;

  if (!jobId) {
    return Response.json({ error: "Job ID required" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { type, from, question, details, stage } = body;

    if (type !== "escalation" || from !== "bot") {
      return Response.json({ error: "Only escalation messages from bot are accepted via this endpoint" }, { status: 400 });
    }

    if (!question) {
      return Response.json({ error: "question is required" }, { status: 400 });
    }

    const msg = await addJobMessage(jobId, {
      type: "escalation",
      from: "bot",
      content: details || question,
      metadata: { question, stage: stage || "unknown" },
    });

    return Response.json({ ok: true, messageId: msg.id });
  } catch (e) {
    console.error("POST /api/job/[id]/messages error:", e);
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}
