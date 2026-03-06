import { NextRequest, NextResponse } from "next/server";
import { getSession } from "~~/lib/sessionStore";

export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = await getSession(sessionId);

  if (!session) {
    return NextResponse.json({ error: "Session not found or expired" }, { status: 404 });
  }

  return NextResponse.json({
    id: session.id,
    serviceType: session.serviceType,
    description: session.description,
    status: session.status,
    maxMessages: session.maxMessages,
    expiresAt: session.expiresAt,
    messages: session.messages,
  });
}
