"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useParams } from "next/navigation";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface SessionInfo {
  id: string;
  serviceType: string;
  description: string;
  status: string;
  maxMessages: number;
  expiresAt: string;
  messages: Message[];
}

const SERVICE_LABELS: Record<string, string> = {
  CONSULT_QUICK: "Quick Consult",
  CONSULT_DEEP: "Deep Consult",
  QA_REPORT: "QA Report",
  AUDIT: "Smart Contract Audit",
};

export default function X402ChatClient() {
  const params = useParams();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoSentRef = useRef(false);
  const MAX_CHARS = 1000;

  // Load session info
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/session/${sessionId}`);
        if (!res.ok) {
          setError(res.status === 404 ? "Session not found or expired" : "Failed to load session");
          return;
        }
        const data: SessionInfo = await res.json();
        setSession(data);
        setMessages(data.messages || []);
      } catch {
        setError("Failed to load session");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [sessionId]);

  // Scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string, opts?: { isOpening?: boolean }) => {
      if (!text.trim() || isStreaming || !session) return;
      if (session.status !== "active") return;

      const userMsgCount = messages.filter(m => m.role === "user").length;
      if (userMsgCount >= session.maxMessages) {
        setChatError(`Message limit reached (${session.maxMessages} messages). Session complete.`);
        return;
      }

      setChatError(null);
      const userMsg: Message = { role: "user", content: text.trim() };
      const newMessages = [...messages, userMsg];
      setMessages(newMessages);
      setInput("");
      setIsStreaming(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: newMessages,
            sessionId,
            isOpening: opts?.isOpening,
          }),
        });

        if (!res.ok) {
          setChatError("Failed to get response");
          setIsStreaming(false);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setIsStreaming(false);
          return;
        }

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
      } catch {
        setChatError("Network error");
      } finally {
        setIsStreaming(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    },
    [messages, isStreaming, session, sessionId],
  );

  const greetUser = useCallback(async () => {
    if (isStreaming || !session) return;
    setIsStreaming(true);
    setChatError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "__GREET__" }],
          sessionId,
          isGreeting: true,
        }),
      });
      if (!res.ok) {
        setIsStreaming(false);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setIsStreaming(false);
        return;
      }
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
    } catch {
      console.error("Greet error");
    } finally {
      setIsStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isStreaming, session, sessionId]);

  // Auto-start conversation
  useEffect(() => {
    if (!session || loading || messages.length > 0 || autoSentRef.current) return;
    autoSentRef.current = true;

    if (session.description) {
      sendMessage(session.description, { isOpening: true });
    } else {
      greetUser();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, loading]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-20">
        <p className="text-4xl mb-4">🚫</p>
        <p className="text-xl mb-2">{error}</p>
        <p className="opacity-60 text-sm">x402 sessions expire after their time window.</p>
      </div>
    );
  }

  if (!session) return null;

  const isExpired = new Date(session.expiresAt) < new Date();
  const userMsgCount = messages.filter(m => m.role === "user").length;
  const atLimit = userMsgCount >= session.maxMessages;
  const timeLeft = Math.max(0, new Date(session.expiresAt).getTime() - Date.now());
  const minsLeft = Math.ceil(timeLeft / 60000);

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto overflow-x-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-base-300 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">🦞 LeftClaw {SERVICE_LABELS[session.serviceType] || "Consultation"}</h1>
          <p className="text-sm opacity-60">
            x402 Session • {userMsgCount}/{session.maxMessages} messages • {isExpired ? "Expired" : `${minsLeft}m left`}
          </p>
        </div>
        <div className="badge badge-primary badge-outline">x402</div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col">
       <div className="flex-1" />
       <div className="space-y-2">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center py-10 opacity-60">
            <p className="text-4xl mb-2">🦞</p>
            <p>Tell me what you want to build and I&apos;ll help you find the right way to do it.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}>
            <span className="text-xs opacity-40 px-1">{msg.role === "user" ? "You" : "🦞 LeftClaw"}</span>
            <div
              className={`max-w-[85%] sm:max-w-[80%] px-4 py-2.5 rounded-2xl text-sm break-words overflow-hidden ${
                msg.role === "user"
                  ? "bg-primary text-primary-content whitespace-pre-wrap"
                  : "bg-base-300 text-base-content prose prose-sm max-w-none [&_pre]:overflow-x-auto [&_code]:break-all"
              }`}
            >
              {msg.role === "user" ? (
                msg.content || (isStreaming && i === messages.length - 1 ? "..." : "")
              ) : (
                <ReactMarkdown>{msg.content || (isStreaming && i === messages.length - 1 ? "..." : "")}</ReactMarkdown>
              )}
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

      {/* Input */}
      <div className="px-4 py-3 border-t border-base-300">
        {chatError && <div className="alert alert-error mb-2 py-2 text-sm">{chatError}</div>}
        {(isExpired || atLimit) && (
          <div className="alert alert-warning mb-2 py-2 text-sm">
            {isExpired ? "Session expired." : "Message limit reached."} This consultation is complete.
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              className="textarea textarea-bordered flex-1 min-w-0 rounded-md resize-none text-sm"
              placeholder="Describe what you want to build... (Enter to send, Shift+Enter for new line)"
              autoFocus
              rows={3}
              maxLength={MAX_CHARS}
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={isStreaming || isExpired || atLimit}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim() && !isStreaming) sendMessage(input);
                }
              }}
            />
            <button
              className="btn btn-primary"
              disabled={isStreaming || !input.trim() || isExpired || atLimit}
              onClick={() => sendMessage(input)}
            >
              {isStreaming ? <span className="loading loading-spinner loading-sm" /> : "Send"}
            </button>
          </div>
          <div className="text-xs opacity-40 text-right">
            {input.length}/{MAX_CHARS}
          </div>
        </div>
      </div>
    </div>
  );
}
