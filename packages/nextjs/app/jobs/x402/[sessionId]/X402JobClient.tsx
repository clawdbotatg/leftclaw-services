"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { useAccount, useSignMessage } from "wagmi";
import { AUTH_SIGN_MESSAGE } from "~~/lib/authSignature";
import { getCachedAuthSignature, setCachedAuthSignature } from "~~/utils/authSignatureCache";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface SessionInfo {
  id: string;
  serviceType: string;
  description: string | null;
  status: string;
  maxMessages: number;
  planGenerations: number;
  expiresAt: string;
  messages: Message[];
  authed: boolean;
}

const SERVICE_LABELS: Record<string, { name: string; icon: string }> = {
  CONSULT_QUICK: { name: "Quick Consultation", icon: "💬" },
  CONSULT_DEEP: { name: "Deep Consultation", icon: "🧠" },
  QA_REPORT: { name: "Frontend QA Report", icon: "🔍" },
  AUDIT: { name: "Smart Contract Audit", icon: "🛡️" },
  RESEARCH: { name: "Research Report", icon: "📚" },
  JUDGE: { name: "Judge / Oracle", icon: "⚖️" },
  BUILD_DAILY: { name: "Build", icon: "🔨" },
};

const STATUS_CONFIG: Record<string, { label: string; badge: string; desc: string }> = {
  active: { label: "In Progress", badge: "badge-warning", desc: "LeftClaw is working on this" },
  completed: { label: "Completed", badge: "badge-success", desc: "Work delivered" },
  expired: { label: "Expired", badge: "badge-error", desc: "Session time window has passed" },
};

export default function X402JobClient() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [sigPending, setSigPending] = useState(false);
  const [sigError, setSigError] = useState<string | null>(null);

  const fetchSession = async (sig?: string): Promise<SessionInfo | null> => {
    const qs = address && sig ? `?address=${encodeURIComponent(address)}&sig=${encodeURIComponent(sig)}` : "";
    const res = await fetch(`/api/session/${sessionId}${qs}`);
    if (!res.ok) {
      setError(res.status === 404 ? "Session not found or expired" : "Failed to load session");
      return null;
    }
    return (await res.json()) as SessionInfo;
  };

  // Initial load — try with cached sig if available, else fetch unauthed.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const cached = address ? getCachedAuthSignature(address) : null;
      const data = await fetchSession(cached || undefined);
      if (cancelled) return;
      if (data) setSession(data);
      setLoading(false);
    }
    load();

    const interval = setInterval(async () => {
      const cached = address ? getCachedAuthSignature(address) : null;
      const data = await fetchSession(cached || undefined);
      if (cancelled) return;
      if (data) {
        setSession(data);
        if (data.status !== "active") clearInterval(interval);
      }
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, address]);

  const handleUnlock = async () => {
    if (!address) return;
    setSigError(null);
    setSigPending(true);
    try {
      let sig = getCachedAuthSignature(address);
      if (!sig) {
        sig = await signMessageAsync({ message: AUTH_SIGN_MESSAGE });
        setCachedAuthSignature(address, sig);
      }
      const data = await fetchSession(sig);
      if (data) {
        setSession(data);
        if (!data.authed) {
          setSigError("This wallet is not the session owner.");
        }
      }
    } catch {
      setSigError("Signature required to view this session.");
    } finally {
      setSigPending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex flex-col items-center py-20">
        <div className="text-6xl mb-4">❌</div>
        <p className="text-xl mb-2">{error || "Session not found"}</p>
        <p className="opacity-60 text-sm mb-4">x402 sessions expire after their time window.</p>
        <Link href="/jobs" className="btn btn-primary">
          ← Back to Jobs
        </Link>
      </div>
    );
  }

  const service = SERVICE_LABELS[session.serviceType] || { name: session.serviceType, icon: "🦞" };
  const status = STATUS_CONFIG[session.status] || { label: session.status, badge: "badge-ghost", desc: "" };
  const isExpired = new Date(session.expiresAt) < new Date();
  const isComplete = session.status === "completed" || isExpired;
  const timeLeft = Math.max(0, new Date(session.expiresAt).getTime() - Date.now());
  const hoursLeft = Math.floor(timeLeft / 3600000);
  const minsLeft = Math.ceil((timeLeft % 3600000) / 60000);
  const userMsgCount = session.messages.filter(m => m.role === "user").length;
  const atLimit = userMsgCount >= session.maxMessages;

  // Find the final deliverable — last assistant message
  const assistantMessages = session.messages.filter(m => m.role === "assistant");
  const finalMessage = assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1] : null;

  // For the work log, show all messages in order
  const allMessages = session.messages;
  const recentMessages = showAllMessages ? allMessages : allMessages.slice(-6);

  return (
    <div className="flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-2xl">
        <Link href="/jobs" className="btn btn-ghost btn-sm mb-4">
          ← Back to Jobs
        </Link>

        {/* Main job card */}
        <div className="card bg-base-200">
          <div className="card-body">
            <div className="flex justify-between items-start">
              <h1 className="card-title text-2xl">
                {service.icon} {service.name}
              </h1>
              <div className="flex gap-2 items-center">
                <span className={`badge ${status.badge}`}>{status.label}</span>
                <span className="badge badge-primary badge-outline">x402</span>
              </div>
            </div>

            <p className="text-sm opacity-60">{status.desc}</p>
            <div className="divider" />

            {/* Job details grid */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm opacity-50">Service</span>
                <p className="font-bold">{service.name}</p>
              </div>
              <div>
                <span className="text-sm opacity-50">Payment</span>
                <p className="font-mono font-bold">x402 USDC</p>
              </div>
              <div>
                <span className="text-sm opacity-50">Messages</span>
                <p className="text-sm">
                  {userMsgCount}/{session.maxMessages} used
                  {atLimit && <span className="text-warning ml-1">(limit reached)</span>}
                </p>
              </div>
              <div>
                <span className="text-sm opacity-50">Time Remaining</span>
                <p className="text-sm">
                  {isExpired ? (
                    <span className="text-error">Expired</span>
                  ) : (
                    `${hoursLeft}h ${minsLeft}m`
                  )}
                </p>
              </div>
            </div>

            {/* Description — gated behind owner signature */}
            <div className="divider" />
            <div>
              <span className="text-sm opacity-50">Request</span>
              {session.authed && session.description ? (
                <p className="mt-1 whitespace-pre-wrap">{session.description}</p>
              ) : (
                <div className="mt-1">
                  <p className="italic opacity-60 text-sm">
                    🔒 Session content is private. Sign with the paying wallet to view your request and chat history.
                  </p>
                  {address ? (
                    <button
                      className="btn btn-sm btn-outline mt-2"
                      onClick={handleUnlock}
                      disabled={sigPending}
                    >
                      {sigPending ? "Signing..." : "Unlock with wallet"}
                    </button>
                  ) : (
                    <p className="mt-2 text-sm opacity-60">Connect the wallet that paid for this session.</p>
                  )}
                  {sigError && <p className="mt-2 text-sm text-error">{sigError}</p>}
                </div>
              )}
            </div>

            {/* Final deliverable — shown prominently when complete */}
            {(isComplete || atLimit) && finalMessage && (
              <>
                <div className="divider" />
                <div className="bg-success/10 border border-success/30 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xl">✅</span>
                    <span className="font-bold text-lg">Deliverable</span>
                  </div>
                  <div className="prose prose-sm max-w-none [&_pre]:overflow-x-auto [&_code]:break-all">
                    <ReactMarkdown>{finalMessage.content}</ReactMarkdown>
                  </div>
                </div>
              </>
            )}

            {/* Action buttons */}
            <div className="divider" />
            <div className="flex flex-wrap gap-3">
              {!isExpired && !atLimit && (
                <Link
                  href={`/chat/x402/${sessionId}`}
                  className="btn btn-primary"
                >
                  💬 {session.messages.length > 0 ? "Continue Chat" : "Start Chat"}
                </Link>
              )}
              {(isComplete || atLimit) && (
                <Link
                  href={`/chat/x402/${sessionId}`}
                  className="btn btn-ghost"
                >
                  💬 View Full Conversation
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Work log — message history */}
        {allMessages.length > 0 && (
          <div className="mt-6">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-lg">📋 Work Log</h3>
              {allMessages.length > 6 && (
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => setShowAllMessages(!showAllMessages)}
                >
                  {showAllMessages ? "Show recent" : `Show all (${allMessages.length})`}
                </button>
              )}
            </div>
            <div className="space-y-2">
              {recentMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex gap-4 rounded-lg px-4 py-3 ${
                    msg.role === "user" ? "bg-primary/10" : "bg-base-200"
                  }`}
                >
                  <div className="text-sm font-bold opacity-50 whitespace-nowrap pt-0.5 min-w-[70px]">
                    {msg.role === "user" ? "You" : "🦞 LeftClaw"}
                  </div>
                  <div className="text-sm prose prose-sm max-w-none flex-1 overflow-hidden [&_pre]:overflow-x-auto [&_code]:break-all">
                    {msg.role === "user" ? (
                      <p className="whitespace-pre-wrap m-0">{msg.content}</p>
                    ) : (
                      <ReactMarkdown>{msg.content.length > 500 && !showAllMessages ? msg.content.slice(0, 500) + "..." : msg.content}</ReactMarkdown>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {allMessages.length === 0 && !isExpired && (
          <div className="mt-6 text-center py-10 bg-base-200 rounded-xl">
            <p className="text-4xl mb-3">🦞</p>
            <p className="text-lg font-bold mb-2">Your session is ready</p>
            <p className="opacity-60 mb-4">
              Click &ldquo;Start Chat&rdquo; to begin your {service.name.toLowerCase()} session.
            </p>
            <Link href={`/chat/x402/${sessionId}`} className="btn btn-primary">
              💬 Start Chat
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
