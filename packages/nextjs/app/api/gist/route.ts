import { NextRequest } from "next/server";
import { getSession, saveJobPlanGist } from "~~/lib/sessionStore";
import { verifyAuthSignature } from "~~/lib/authSignature";
import { getJobClient } from "~~/lib/workerAuth";

// Internal API key for server-to-server calls (chat route → gist route)
const INTERNAL_SECRET = process.env.GIST_INTERNAL_SECRET || process.env.ANTHROPIC_API_KEY;

export async function POST(req: NextRequest) {
  // Auth: require internal secret OR valid session ID
  const authHeader = req.headers.get("x-internal-secret");
  const { plan, jobId, sessionId, address, sig } = await req.json();

  // Auth: internal secret, valid session, or owner-signed for the given jobId.
  let authorized = false;

  if (authHeader && INTERNAL_SECRET && authHeader === INTERNAL_SECRET) {
    authorized = true;
  }

  if (!authorized && sessionId) {
    const session = await getSession(sessionId);
    if (session && session.status === "active") {
      authorized = true;
    }
  }

  // Job-based caller: prove ownership. Previously ANY supplied jobId authorized the
  // call, letting anyone create org gists or overwrite another job's stored plan
  // pointer (PRIVACY_AUDIT.md F8). On-chain (numeric) jobs are sequentially
  // enumerable, so require the owner signature (caller == job.client). cv-* ids are
  // off-chain synthetic + non-enumerable, so they pass through like plan-count (F2).
  if (!authorized && jobId) {
    if (String(jobId).startsWith("cv-")) {
      authorized = true;
    } else if (address && sig && (await verifyAuthSignature(address, sig))) {
      const client = await getJobClient(String(jobId));
      if (client && client === String(address).toLowerCase()) {
        authorized = true;
      }
    }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  if (!plan || typeof plan !== "string" || plan.trim().length < 10) {
    return new Response(JSON.stringify({ error: "Plan content required" }), { status: 400 });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ error: "GitHub token not configured" }), { status: 500 });
  }

  const res = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      description: `LeftClaw Build Plan - Job #${jobId || "unknown"}`,
      public: false,
      files: { "build-plan.md": { content: plan } },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return new Response(JSON.stringify({ error: data.message || "Gist creation failed" }), { status: 500 });
  }

  const gistUrl = data.html_url;

  // Persist the latest plan gist URL for job-based chats (survives page reload)
  if (jobId) {
    const desc = `Build plan: ${gistUrl}\n\nSee consultation plan for full scope and requirements.`;
    saveJobPlanGist(String(jobId), gistUrl, desc).catch(console.error);
  }

  return new Response(JSON.stringify({ url: gistUrl }), {
    headers: { "Content-Type": "application/json" },
  });
}
