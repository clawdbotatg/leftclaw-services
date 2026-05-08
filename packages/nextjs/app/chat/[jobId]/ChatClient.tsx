"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useParams, useRouter } from "next/navigation";
import { useAccount, useWalletClient } from "wagmi";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { getCachedAuthSignature, setCachedAuthSignature, clearCachedAuthSignature } from "~~/utils/authSignatureCache";
import { AUTH_SIGN_MESSAGE } from "~~/lib/authSignature";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const isCvJob = jobId.startsWith("cv-");

  const [authSignature, setAuthSignature] = useState<string | null>(null);
  const [isSigning, setIsSigning] = useState(false);

  // Load cached auth signature when address becomes available
  useEffect(() => {
    if (address) {
      const cached = getCachedAuthSignature(address);
      setAuthSignature(cached);
    } else {
      setAuthSignature(null);
    }
  }, [address]);

  const handleSign = useCallback(async () => {
    if (!walletClient || !address) return;
    setIsSigning(true);
    try {
      const sig = await walletClient.signMessage({ message: AUTH_SIGN_MESSAGE });
      setCachedAuthSignature(address, sig);
      setAuthSignature(sig);
    } catch {
      // User rejected or signing failed
    } finally {
      setIsSigning(false);
    }
  }, [walletClient, address]);

  const storageKey = `chat-messages-${jobId}`;
  const [messages, setMessages] = useState<Message[]>([]);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const autoSentRef = useRef(false);

  // Load from localStorage after hydration
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setMessages(JSON.parse(saved));
    } catch {}
    setStorageLoaded(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatClosed, setChatClosed] = useState(false);
  const [planGistUrl, setPlanGistUrl] = useState<string | null>(null);
  const [planDescription, setPlanDescription] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isStartingBuild, setIsStartingBuild] = useState(false);
  const [routeSuggestion, setRouteSuggestion] = useState<{ type: "AUDIT" | "QA" | "PFP" | "BUILD" | "FEATURE" | "HUMANQA" | "RESEARCH"; summary: string } | null>(null);
  const [planGenerations, setPlanGenerations] = useState(0);
  const MAX_PLAN_GENERATIONS = 3;
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const MAX_CHARS = 3000;

  // On-chain job read — skip for CV jobs (they're off-chain)
  const { data: job, isLoading: jobLoading } = useScaffoldReadContract({
    contractName: "LeftClawServicesV2",
    functionName: "getJob",
    args: [BigInt(isCvJob ? "0" : (jobId || "0"))],
  });

  // CV jobs are always valid (paid off-chain via ClawdViction)
  const jobExists = isCvJob || (job && job.id > 0n);
  const isAuthorized = isCvJob || !jobExists || (address && job && job.client.toLowerCase() === address.toLowerCase());
  const totalMessages = messages.length;

  // Message limit tracking for consultations
  const serviceTypeId = job ? Number((job as any).serviceTypeId ?? (job as any).serviceType ?? 0) : 0;
  const isConsultation = serviceTypeId === 1 || serviceTypeId === 2;
  const maxMessages = 9999; // TEMP: no limit during testing
  const userMessageCount = messages.filter(m => m.role === "user").length;
  const [serverMsgUsed, setServerMsgUsed] = useState<number | null>(null);
  // Use server count when available (more accurate), otherwise client count
  const displayedUsed = serverMsgUsed ?? userMessageCount;
  const messagesRemaining = isConsultation ? maxMessages - displayedUsed : null;
  const isAtLimit = isConsultation && displayedUsed >= maxMessages;

  // Load plan generation count + latest plan gist from server
  useEffect(() => {
    fetch(`/api/job/plan-count?jobId=${jobId}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.planGenerations) setPlanGenerations(data.planGenerations);
        if (data?.latestPlanGistUrl) {
          setPlanGistUrl(data.latestPlanGistUrl);
          setPlanDescription(data.latestPlanDescription || "");
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Sanitization gate — CV jobs auto-pass (set at payment time)
  const [sanitized, setSanitized] = useState<boolean | null>(isCvJob ? true : null);
  const [sanitizeError, setSanitizeError] = useState<string | null>(null);
  const sanitizeRef = useRef(isCvJob);

  // DEBUG
  useEffect(() => {
    console.log("[ChatClient] mount", { jobId, isCvJob, sanitized, jobExists });
  }, []);

  useEffect(() => {
    if (isCvJob) return; // CV jobs skip sanitization gate entirely
    if (!jobExists || sanitizeRef.current) return;
    sanitizeRef.current = true;

    // Poll the sanitize status. If still pending after a few seconds, fire a
    // recovery POST — the server-side endpoint resolves the description from
    // KV (consultPrompt) or chain on its own, so this safely recovers from
    // stuck states where the original POST died (e.g. function timeout).
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let elapsedMs = 0;
    let recoveryFired = false;
    const POLL_INTERVAL_MS = 4000;
    const RECOVERY_AT_MS = 8000;
    const GIVE_UP_AT_MS = 90_000;

    const poll = async () => {
      try {
        const res = await fetch(`/api/job/sanitize?jobId=${jobId}`);
        if (cancelled) return;
        if (res.ok) {
          const d = await res.json();
          if (d.safe === true) {
            setSanitized(true);
            return;
          }
          if (d.safe === false) {
            setSanitized(false);
            setSanitizeError(d.reason || "Job flagged for manual review");
            return;
          }
          // d.safe === null/undefined → still pending
        }
        // Either non-OK response or pending: kick off recovery POST after a short wait
        if (!recoveryFired && elapsedMs >= RECOVERY_AT_MS) {
          recoveryFired = true;
          fetch("/api/job/sanitize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId: String(jobId) }),
          }).catch(() => {});
        }
        if (elapsedMs >= GIVE_UP_AT_MS) {
          setSanitized(false);
          setSanitizeError("Security review is taking longer than expected. Please refresh — if this persists, contact support.");
          return;
        }
        elapsedMs += POLL_INTERVAL_MS;
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch {
        if (cancelled) return;
        if (elapsedMs >= GIVE_UP_AT_MS) {
          setSanitized(false);
          setSanitizeError("Failed to verify job safety");
          return;
        }
        elapsedMs += POLL_INTERVAL_MS;
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobExists, jobId]);

  useEffect(() => {
    if (messages.length > 0) {
      try { localStorage.setItem(storageKey, JSON.stringify(messages)); } catch {}
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const sendMessage = useCallback(async (text: string, opts?: { isOpening?: boolean; isPlanGeneration?: boolean }) => {
    if (!text.trim() || isStreaming || chatClosed) return;
    if (isAtLimit && !opts?.isPlanGeneration) return;
    setError(null);
    const userMsg: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, jobId, isOpening: opts?.isOpening, isPlanGeneration: opts?.isPlanGeneration || false, clientAddress: address, authSignature }),
      });

      if (!res.ok) {
        if (res.status === 401 && address) {
          clearCachedAuthSignature(address);
          setAuthSignature(null);
        }
        const errBody = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
        const errMsg = errBody.error || `Failed to get response (${res.status})`;
        if (errMsg.includes("Message limit reached")) {
          if (errBody.messagesUsed) setServerMsgUsed(errBody.messagesUsed);
          setError("🚫 Message limit reached — consultation complete");
          setChatClosed(true);
        } else if (errMsg.includes("Chat closed")) {
          setChatClosed(true);
          setError(null);
        } else {
          setError(errMsg);
        }
        setIsStreaming(false);
        return;
      }

      // Read message count headers
      const headerUsed = res.headers.get("X-Messages-Used");
      if (headerUsed) setServerMsgUsed(parseInt(headerUsed, 10));

      const reader = res.body?.getReader();
      if (!reader) { setIsStreaming(false); return; }

      const decoder = new TextDecoder();
      let assistantContent = "";
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantContent += decoder.decode(value, { stream: true });
        const snap = assistantContent;
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: snap };
          return copy;
        });
      }

      // Check for plan markers
      if (assistantContent.includes("---PLAN START---") && assistantContent.includes("---PLAN END---")) {
        const planMatch = assistantContent.match(/---PLAN START---([\s\S]*?)---PLAN END---/);
        if (planMatch) {
          setPlanGenerations(prev => prev + 1);
          await createGistAndRedirect(planMatch[1].trim());
        }
      }

      // Check for route markers
      const routeMatch = assistantContent.match(/---ROUTE:\s*(AUDIT|QA|PFP|BUILD|FEATURE|HUMANQA|RESEARCH)---\s*([\s\S]*?)---ROUTE END---/);
      if (routeMatch) {
        setRouteSuggestion({ type: routeMatch[1] as "AUDIT" | "QA" | "PFP" | "BUILD" | "FEATURE" | "HUMANQA" | "RESEARCH", summary: routeMatch[2].trim() });
      }
    } catch (e) {
      setError("Network error");
      console.error(e);
    } finally {
      setIsStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [messages, isStreaming, jobId, isAtLimit, address, authSignature]);

  const createGistAndRedirect = async (plan: string) => {
    try {
      const res = await fetch("/api/gist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, jobId }),
      });
      const data = await res.json();
      if (data.url) {
        const desc = `Build plan: ${data.url}\n\nSee consultation plan for full scope and requirements.`;
        setPlanGistUrl(data.url);
        setPlanDescription(desc);
      } else {
        setError("Failed to save plan: " + (data.error || "unknown error"));
      }
    } catch (e) {
      console.error("Gist creation failed:", e);
      setError("Failed to save plan — please try again");
    }
  };

  // Greeting-only: bot opens without any user message shown
  const greetUser = useCallback(async () => {
    if (isStreaming) return;
    setIsStreaming(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "__GREET__" }], jobId, isGreeting: true, clientAddress: address, authSignature }),
      });
      if (!res.ok) {
        if (res.status === 401 && address) {
          clearCachedAuthSignature(address);
          setAuthSignature(null);
        }
        setIsStreaming(false);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) { setIsStreaming(false); return; }
      const decoder = new TextDecoder();
      let content = "";
      setMessages([{ role: "assistant", content: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        content += decoder.decode(value, { stream: true });
        const snap = content;
        setMessages([{ role: "assistant", content: snap }]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isStreaming, jobId, address, authSignature]);

  // Auto-kick the conversation on first load:
  // - if topic came from consult form → send it as user message, bot asks clarifying question
  // - if no topic (direct nav) → bot greets first with no user message shown
  useEffect(() => {
    if (!storageLoaded) return;
    if (!isCvJob && jobLoading) return; // CV jobs skip on-chain loading
    if (!jobExists) return;
    if (sanitized !== true) return; // wait for sanitization (CV jobs start with true)
    if (!authSignature) return; // wait for auth signature before sending any messages
    if (messages.length > 0) return; // returning user — don't re-trigger
    if (autoSentRef.current) return;

    autoSentRef.current = true;

    const topicKey = `consult-topic-${jobId}`;
    let savedTopic = "";
    try { savedTopic = localStorage.getItem(topicKey) || ""; } catch {}

    if (savedTopic) {
      try { localStorage.removeItem(topicKey); } catch {}
      sendMessage(savedTopic, { isOpening: true });
    } else {
      greetUser();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageLoaded, jobLoading, jobExists, sanitized, authSignature]);

  const handleGeneratePlan = () => {
    sendMessage("Please finalize the build plan based on our discussion.", { isPlanGeneration: true });
  };

  if (!isCvJob && jobLoading) {
    return (
      <div className="flex justify-center py-20">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  // DEBUG log why we're showing the loading state
  if (sanitized === null && jobExists) {
    console.log("[ChatClient] showing loading because sanitized=null, jobExists=true", { sanitized, jobExists, isCvJob });
    return (
      <div className="flex flex-col items-center py-20 gap-3">
        <span className="loading loading-spinner loading-lg" />
        <p className="text-sm opacity-60">Reviewing your request...</p>
      </div>
    );
  }

  if (sanitized === false) {
    return (
      <div className="flex flex-col items-center py-20 gap-3">
        <p className="text-2xl">🛡️</p>
        <p className="text-lg font-bold">Request Flagged for Review</p>
        <p className="text-sm opacity-60 max-w-md text-center">
          {sanitizeError || "Your request has been flagged for manual review. A human will check it shortly."}
        </p>
      </div>
    );
  }

  if (!address) {
    return (
      <div className="flex flex-col items-center py-20">
        <p className="text-xl mb-4">🔒 Connect your wallet to access the consultation</p>
        <RainbowKitCustomConnectButton />
      </div>
    );
  }

  if (!authSignature) {
    return (
      <div className="flex flex-col items-center py-20">
        <p className="text-xl mb-4">🔐 Verify your identity</p>
        <p className="opacity-70 mb-4 max-w-sm text-center text-sm">Sign a message to prove you own this wallet. This is free and only required once.</p>
        <button className="btn btn-primary" onClick={handleSign} disabled={isSigning || !walletClient}>
          {isSigning ? <span className="loading loading-spinner loading-sm" /> : "Sign to Continue"}
        </button>
      </div>
    );
  }

  if (jobExists && !isAuthorized) {
    return (
      <div className="flex flex-col items-center py-20">
        <p className="text-xl mb-4">🚫 Access denied</p>
        <p className="opacity-70">Only the job client can access this consultation.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto overflow-x-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-base-300 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">🦞 LeftClaw Consultation</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm opacity-60">Job #{jobId}</p>
            {isConsultation && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                isAtLimit
                  ? "bg-error/20 text-error"
                  : messagesRemaining !== null && messagesRemaining <= 3
                    ? "bg-warning/20 text-warning"
                    : "bg-base-300 text-base-content/70"
              }`}>
                {isAtLimit
                  ? "🚫 Limit reached"
                  : `💬 ${displayedUsed} / ∞`
                }
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {totalMessages >= 4 && !isStreaming && planGenerations < MAX_PLAN_GENERATIONS && (
            <button className="btn btn-primary btn-sm" onClick={handleGeneratePlan}>
              📋 Generate Plan{planGenerations > 0 ? ` (${MAX_PLAN_GENERATIONS - planGenerations} left)` : ""}
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col">
       <div className="flex-1" />
       <div className="space-y-2">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center py-10 opacity-60">
            <p className="text-4xl mb-2">🦞</p>
            <p>Tell me what you need help with — builds, audits, QA reports, or anything else.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}>
            <span className="text-xs opacity-40 px-1">{msg.role === "user" ? "You" : "🦞 LeftClaw"}</span>
            <div className={`max-w-[85%] sm:max-w-[80%] px-4 py-2.5 rounded-2xl text-sm break-words overflow-hidden ${msg.role === "user" ? "bg-primary text-primary-content whitespace-pre-wrap" : "bg-base-300 text-base-content prose prose-sm max-w-none [&_pre]:overflow-x-auto [&_code]:break-all"}`}>
              {msg.role === "user"
                ? (msg.content || (isStreaming && i === messages.length - 1 ? "..." : ""))
                : <ReactMarkdown>{msg.content || (isStreaming && i === messages.length - 1 ? "..." : "")}</ReactMarkdown>
              }
            </div>
          </div>
        ))}
        {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex flex-col items-start gap-1">
            <span className="text-xs opacity-40 px-1">🦞 LeftClaw</span>
            <div className="bg-base-300 px-4 py-2.5 rounded-2xl">
              <span className="loading loading-dots loading-sm" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
       </div>
      </div>

      {/* Route suggestion buttons */}
      {routeSuggestion && routeSuggestion.type !== "BUILD" && (
        <div className="px-3 sm:px-4 py-3 border-t border-base-300 flex gap-2">
          <button
            className="btn btn-ghost btn-sm flex-1"
            onClick={() => setRouteSuggestion(null)}
          >
            💬 Continue chatting
          </button>
          <button
            className="btn btn-primary btn-sm flex-1"
            onClick={() => {
              if (routeSuggestion.type === "AUDIT") router.push("/post?type=7");
              else if (routeSuggestion.type === "QA") router.push("/post?type=6");
              else if (routeSuggestion.type === "PFP") router.push("/pfp");
              else if (routeSuggestion.type === "FEATURE") router.push("/post?type=feature");
              else if (routeSuggestion.type === "HUMANQA") router.push("/humanqa");
              else if (routeSuggestion.type === "RESEARCH") router.push("/research");
            }}
          >
            {routeSuggestion.type === "AUDIT" && "🛡️ Go to Audit Service →"}
            {routeSuggestion.type === "QA" && "🔍 Go to QA Service →"}
            {routeSuggestion.type === "PFP" && "🦞 Generate My PFP →"}
            {routeSuggestion.type === "FEATURE" && "🔧 Go to Feature/Bug Fix →"}
            {routeSuggestion.type === "HUMANQA" && "👤 Talk to a Human →"}
            {routeSuggestion.type === "RESEARCH" && "📚 Go to Research Report →"}
          </button>
        </div>
      )}

      {/* Plan buttons */}
      {planGistUrl && (
        <div className="px-3 sm:px-4 py-3 border-t border-base-300 flex gap-2">
          <button
            className="btn btn-outline btn-sm flex-1"
            onClick={() => {
              if (planGistUrl) {
                navigator.clipboard.writeText(planGistUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            }}
          >
            {copied ? "✓ Copied!" : "🔗 Copy Plan Link"}
          </button>
          <button
            className="btn btn-primary btn-sm flex-1"
            disabled={isStartingBuild}
            onClick={async () => {
              setIsStartingBuild(true);
              // Close consultation on-chain via backend (no user tx needed).
              // Must await — router.push would otherwise unmount the page and
              // abort the in-flight request before it reaches the server.
              if (!isCvJob) {
                try {
                  await fetch("/api/job/close-consultation", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jobId, resultCID: planGistUrl || "", address }),
                    keepalive: true,
                  });
                } catch (err) {
                  console.error("close-consultation failed:", err);
                }
              }
              // Append post-plan chat messages so that decisions made after the plan
              // (renames, scope tweaks) propagate to the build job. Without this, the
              // immutable gist locks in old decisions and the build worker never sees
              // updates the user agreed to in chat.
              let finalDescription = planDescription || "";
              let lastPlanIdx = -1;
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === "assistant" && messages[i].content.includes("---PLAN END---")) {
                  lastPlanIdx = i;
                  break;
                }
              }
              const postPlan = lastPlanIdx >= 0 ? messages.slice(lastPlanIdx + 1) : [];
              if (postPlan.length > 0) {
                const formatted = postPlan
                  .map(m => `**${m.role === "user" ? "Client" : "Consultant"}:** ${m.content}`)
                  .join("\n\n");
                finalDescription = `${finalDescription}\n\n---\n\n**POST-PLAN UPDATES** (decisions made after the plan was generated — these supersede anything in the plan that conflicts):\n\n${formatted}`;
              }
              router.push(`/build?gist=${encodeURIComponent(planGistUrl)}&description=${encodeURIComponent(finalDescription)}`);
            }}
          >
            {isStartingBuild ? <span className="loading loading-spinner loading-xs"></span> : "🚀 Start Build Job"}
          </button>
        </div>
      )}

      {/* Input */}
      <div className="px-3 sm:px-4 py-2 border-t border-base-300">
        {isAtLimit && (
          <div className="alert alert-warning mb-2 py-2 text-sm">
            🚫 Message limit reached ({maxMessages} messages). Generate a plan or open a new consultation.
          </div>
        )}
        {!isAtLimit && isConsultation && messagesRemaining !== null && messagesRemaining <= 3 && messagesRemaining > 0 && (
          <div className="text-xs text-warning mb-1 px-1">
            ⚠️ {messagesRemaining} message{messagesRemaining === 1 ? "" : "s"} remaining
          </div>
        )}
        {chatClosed && !isAtLimit && (
          <div className="alert alert-info mb-2 py-2 text-sm">
            💬 Chat closed — job is complete. Open a new job if you need more work.
          </div>
        )}
        {error && (
          <div className="alert alert-error mb-2 py-2 text-sm">{error}</div>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            className="textarea textarea-bordered flex-1 min-w-0 rounded-md resize-none text-base leading-snug py-2 min-h-0"
            placeholder="What do you need help with?"
            autoFocus
            rows={6}
            maxLength={MAX_CHARS}
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={isStreaming || chatClosed || isAtLimit}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() && !isStreaming && !chatClosed && !isAtLimit) sendMessage(input);
              }
            }}
          />
          <button
            className="btn btn-primary btn-sm sm:btn-md"
            disabled={isStreaming || !input.trim() || chatClosed || isAtLimit}
            onClick={() => sendMessage(input)}
          >
            {isStreaming ? <span className="loading loading-spinner loading-sm" /> : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
