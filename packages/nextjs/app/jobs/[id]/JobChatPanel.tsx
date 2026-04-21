"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSignMessage } from "wagmi";
import { AUTH_SIGN_MESSAGE } from "~~/lib/authSignature";
import { getCachedAuthSignature, setCachedAuthSignature } from "~~/utils/authSignatureCache";

interface JobMessage {
  id: string;
  type: "client_message" | "ai_response" | "escalation" | "escalation_response" | "rollback_request";
  content: string;
  from: "client" | "bot" | "ai";
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface SigCache {
  signature: string;
  signedMessage: string;
  timestamp: number;
}

export default function JobChatPanel({ jobId, clientAddress }: { jobId: string; clientAddress: string }) {
  const [messages, setMessages] = useState<JobMessage[]>([]);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messagesRemaining, setMessagesRemaining] = useState<number | null>(null);
  const [sigCache, setSigCache] = useState<SigCache | null>(null);
  const [sigPending, setSigPending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { signMessageAsync } = useSignMessage();

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load remaining from localStorage
  useEffect(() => {
    const key = `chat-remaining-${jobId}-${clientAddress}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const { count, hour } = JSON.parse(stored);
        const currentHour = Math.floor(Date.now() / 3600000);
        if (hour === currentHour) {
          setMessagesRemaining(count);
        } else {
          localStorage.removeItem(key);
          setMessagesRemaining(3);
        }
      } catch {
        setMessagesRemaining(3);
      }
    } else {
      setMessagesRemaining(3);
    }
  }, [jobId, clientAddress]);

  const saveRemaining = useCallback(
    (count: number) => {
      setMessagesRemaining(count);
      const key = `chat-remaining-${jobId}-${clientAddress}`;
      localStorage.setItem(key, JSON.stringify({ count, hour: Math.floor(Date.now() / 3600000) }));
    },
    [jobId, clientAddress],
  );

  // Get pending escalations
  const pendingEscalations = messages.filter(m => {
    if (m.type !== "escalation") return false;
    const escId = m.metadata?.escalation_id || m.id;
    return !messages.some(r => r.type === "escalation_response" && r.metadata?.escalation_id === escId);
  });

  const loadMessages = useCallback(
    async (authSig: string) => {
      try {
        const res = await fetch(
          `/api/job/${jobId}/messages?address=${encodeURIComponent(clientAddress)}&sig=${encodeURIComponent(authSig)}`,
        );
        const data = await res.json();
        if (data.messages) {
          setMessages(data.messages);
          setMessagesLoaded(true);
        }
      } catch {}
    },
    [jobId, clientAddress],
  );

  // Auto-load messages on mount if a cached auth sig is already in localStorage
  useEffect(() => {
    if (!clientAddress || messagesLoaded) return;
    const cached = getCachedAuthSignature(clientAddress);
    if (cached) loadMessages(cached);
  }, [clientAddress, messagesLoaded, loadMessages]);

  const getSignature = useCallback(async (): Promise<SigCache | null> => {
    // Check cache
    if (sigCache && Date.now() - sigCache.timestamp < 300000) {
      return sigCache;
    }
    setSigPending(true);
    setError(null);
    try {
      const windowTs = Math.floor(Date.now() / 300000) * 300000;
      const signedMessage = `LeftClaw Job Chat - Job #${jobId} - ${windowTs}`;
      const signature = await signMessageAsync({ message: signedMessage });
      const cache: SigCache = { signature, signedMessage, timestamp: Date.now() };
      setSigCache(cache);
      setSigPending(false);
      return cache;
    } catch {
      setSigPending(false);
      setError("Signature required to send messages");
      return null;
    }
  }, [sigCache, jobId, signMessageAsync]);

  const handleLoadMessages = async () => {
    if (!clientAddress) return;
    const cached = getCachedAuthSignature(clientAddress);
    if (cached) {
      await loadMessages(cached);
      return;
    }
    setSigPending(true);
    setError(null);
    try {
      const signature = await signMessageAsync({ message: AUTH_SIGN_MESSAGE });
      setCachedAuthSignature(clientAddress, signature);
      await loadMessages(signature);
    } catch {
      setError("Signature required to load messages");
    } finally {
      setSigPending(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setError(null);

    if (!messagesLoaded) await handleLoadMessages();

    const sig = await getSignature();
    if (!sig) return;

    const messageText = input.trim();
    setInput("");
    setSending(true);

    // Optimistic add
    const optimisticMsg: JobMessage = {
      id: `temp-${Date.now()}`,
      type: "client_message",
      content: messageText,
      from: "client",
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, optimisticMsg]);

    try {
      const res = await fetch(`/api/job/${jobId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: messageText,
          clientAddress,
          signature: sig.signature,
          signedMessage: sig.signedMessage,
        }),
      });

      if (res.status === 429) {
        setError("Rate limit reached — 3 messages per hour");
        setSending(false);
        return;
      }
      if (res.status === 401) {
        setSigCache(null);
        setError("Signature invalid — please try again");
        setSending(false);
        return;
      }

      const data = await res.json();
      if (data.reply) {
        const aiMsg: JobMessage = {
          id: `ai-${Date.now()}`,
          type: "ai_response",
          content: data.reply,
          from: "ai",
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, aiMsg]);
      }
      if (data.messagesRemaining !== undefined) {
        saveRemaining(data.messagesRemaining);
      }
    } catch {
      setError("Failed to send message — please try again");
    } finally {
      setSending(false);
    }
  };

  const handleEscalationClick = (esc: JobMessage) => {
    const question = (esc.metadata?.question as string) || "your question";
    setInput(`Answering your question about ${question}: `);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts > 1e12 ? ts : ts * 1000);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="mt-6">
      <h3 className="font-bold text-lg">💬 Job Chat</h3>
      <p className="text-sm opacity-50 mb-4">Ask questions, review decisions, or resolve blockers.</p>

      {/* Pending escalations */}
      {pendingEscalations.length > 0 && (
        <div className="space-y-2 mb-4">
          {pendingEscalations.map(esc => (
            <div
              key={esc.id}
              className="alert alert-error cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => handleEscalationClick(esc)}
            >
              <div>
                <p className="font-bold">🚨 Bot is blocked — needs your input</p>
                <p>Q: {(esc.metadata?.question as string) || "Unknown"}</p>
                <p className="text-sm opacity-80">Details: {esc.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Message history */}
      <div className="bg-base-200 rounded-lg p-4 max-h-96 overflow-y-auto space-y-3 mb-4">
        {!messagesLoaded ? (
          <div className="flex flex-col items-center py-8 gap-3">
            {clientAddress ? (
              <>
                <p className="text-sm opacity-50">Sign to view your message history</p>
                <button className="btn btn-sm btn-outline" onClick={handleLoadMessages} disabled={sigPending}>
                  {sigPending ? <span className="loading loading-spinner loading-xs" /> : "Load messages"}
                </button>
              </>
            ) : (
              <p className="text-sm opacity-50">Connect wallet to view messages</p>
            )}
          </div>
        ) : (
          <>
            {messages.length === 0 && (
              <p className="text-center text-sm opacity-40 py-8">No messages yet. Start the conversation!</p>
            )}
          </>
        )}
        {messagesLoaded && messages.map(msg => {
          if (msg.type === "client_message") {
            return (
              <div key={msg.id} className="flex flex-col items-end">
                <div className="bg-primary text-primary-content rounded-2xl rounded-br-sm px-4 py-2 max-w-[80%]">
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
                <span className="text-xs opacity-30 mt-1">{formatTime(msg.timestamp)}</span>
              </div>
            );
          }
          if (msg.type === "ai_response") {
            return (
              <div key={msg.id} className="flex items-start gap-2">
                <span className="text-xl mt-1">🦞</span>
                <div className="flex flex-col">
                  <div className="bg-base-300 rounded-2xl rounded-bl-sm px-4 py-2 max-w-[80%]">
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  <span className="text-xs opacity-30 mt-1">{formatTime(msg.timestamp)}</span>
                </div>
              </div>
            );
          }
          if (msg.type === "escalation") {
            return (
              <div key={msg.id} className="flex items-start gap-2">
                <div className="flex flex-col">
                  <div className="border-2 border-error rounded-lg px-4 py-2 max-w-[80%]">
                    <p className="text-sm font-bold">⚠️ Bot blocked: {(msg.metadata?.question as string) || ""}</p>
                    <p className="text-sm opacity-80 whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  <span className="text-xs opacity-30 mt-1">{formatTime(msg.timestamp)}</span>
                </div>
              </div>
            );
          }
          if (msg.type === "escalation_response") {
            return (
              <div key={msg.id} className="flex items-start gap-2">
                <div className="flex flex-col">
                  <div className="border-2 border-success rounded-lg px-4 py-2 max-w-[80%]">
                    <p className="text-sm">✅ Answered: {msg.content}</p>
                  </div>
                  <span className="text-xs opacity-30 mt-1">{formatTime(msg.timestamp)}</span>
                </div>
              </div>
            );
          }
          if (msg.type === "rollback_request") {
            return (
              <div key={msg.id} className="flex items-start gap-2">
                <div className="flex flex-col">
                  <div className="border-2 border-warning rounded-lg px-4 py-2 max-w-[80%]">
                    <p className="text-sm">🔄 Rollback requested to: {(msg.metadata?.stage as string) || "unknown"}</p>
                  </div>
                  <span className="text-xs opacity-30 mt-1">{formatTime(msg.timestamp)}</span>
                </div>
              </div>
            );
          }
          return null;
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Signature pending */}
      {sigPending && (
        <div className="alert alert-info mb-3">
          <span className="loading loading-spinner loading-sm" />
          <span>Sign the message in your wallet to authenticate</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="alert alert-error mb-3">
          <span>{error}</span>
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <textarea
          className="textarea textarea-bordered flex-1 text-sm"
          rows={2}
          placeholder="Ask about your build, review a decision, or answer a bot question…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={sending}
        />
        <button className="btn btn-primary self-end" onClick={handleSend} disabled={sending || !input.trim()}>
          {sending ? <span className="loading loading-spinner loading-sm" /> : "Send →"}
        </button>
      </div>
      <p className="text-xs opacity-40 mt-1">
        {messagesRemaining !== null ? `${messagesRemaining} messages remaining this hour` : ""}
      </p>
    </div>
  );
}
