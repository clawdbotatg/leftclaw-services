"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useParams, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;
  const { address } = useAccount();

  const storageKey = `chat-messages-${jobId}`;
  const [messages, setMessages] = useState<Message[]>([]);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const autoSentRef = useRef(false);

  // Load from sessionStorage after hydration
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) setMessages(JSON.parse(saved));
    } catch {}
    setStorageLoaded(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const MAX_CHARS = 1000;

  const { data: job, isLoading: jobLoading } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "getJob",
    args: [BigInt(jobId || "0")],
  });

  const jobExists = job && job.id > 0n;
  const isAuthorized = !jobExists || (address && job && job.client.toLowerCase() === address.toLowerCase());
  const totalMessages = messages.length;

  useEffect(() => {
    if (messages.length > 0) {
      try { sessionStorage.setItem(storageKey, JSON.stringify(messages)); } catch {}
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const sendMessage = useCallback(async (text: string, opts?: { isOpening?: boolean }) => {
    if (!text.trim() || isStreaming) return;
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
        body: JSON.stringify({ messages: newMessages, jobId, isOpening: opts?.isOpening }),
      });

      if (!res.ok) {
        setError("Failed to get response");
        setIsStreaming(false);
        return;
      }

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
          await createGistAndRedirect(planMatch[1].trim());
        }
      }
    } catch (e) {
      setError("Network error");
      console.error(e);
    } finally {
      setIsStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [messages, isStreaming, jobId]);

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
        router.push(`/build?gist=${encodeURIComponent(data.url)}&description=${encodeURIComponent(desc)}`);
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
        body: JSON.stringify({ messages: [{ role: "user", content: "__GREET__" }], jobId, isGreeting: true }),
      });
      if (!res.ok) { setIsStreaming(false); return; }
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
  }, [isStreaming, jobId]);

  // Auto-kick the conversation on first load:
  // - if topic came from consult form → send it as user message, bot asks clarifying question
  // - if no topic (direct nav) → bot greets first with no user message shown
  useEffect(() => {
    if (!storageLoaded) return;
    if (jobLoading) return;
    if (!jobExists) return;
    if (messages.length > 0) return; // returning user — don't re-trigger
    if (autoSentRef.current) return;

    autoSentRef.current = true;

    const topicKey = `consult-topic-${jobId}`;
    let savedTopic = "";
    try { savedTopic = sessionStorage.getItem(topicKey) || ""; } catch {}

    if (savedTopic) {
      try { sessionStorage.removeItem(topicKey); } catch {}
      sendMessage(savedTopic, { isOpening: true });
    } else {
      greetUser();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageLoaded, jobLoading, jobExists]);

  const handleGeneratePlan = () => {
    sendMessage("Please finalize the build plan based on our discussion.");
  };

  if (jobLoading) {
    return (
      <div className="flex justify-center py-20">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  if (!address) {
    return (
      <div className="flex flex-col items-center py-20">
        <p className="text-xl mb-4">🔒 Connect your wallet to access the consultation</p>
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
      <div className="px-4 py-3 border-b border-base-300 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">🦞 LeftClaw Consultation</h1>
          <p className="text-sm opacity-60">Job #{jobId}</p>
        </div>
        {totalMessages >= 4 && !isStreaming && (
          <button className="btn btn-primary btn-sm" onClick={handleGeneratePlan}>
            📋 Generate Plan
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center py-10 opacity-60">
            <p className="text-4xl mb-2">🦞</p>
            <p>Tell me what you want to build and I&apos;ll help you find the right way to do it.</p>
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

      {/* Input */}
      <div className="px-3 sm:px-4 py-2 border-t border-base-300">
        {error && (
          <div className="alert alert-error mb-2 py-2 text-sm">{error}</div>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            className="textarea textarea-bordered flex-1 rounded-md resize-none text-sm leading-snug py-2 min-h-0"
            placeholder="What do you want to build?"
            autoFocus
            rows={1}
            maxLength={MAX_CHARS}
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={isStreaming}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() && !isStreaming) sendMessage(input);
              }
            }}
          />
          <button
            className="btn btn-primary btn-sm sm:btn-md"
            disabled={isStreaming || !input.trim()}
            onClick={() => sendMessage(input)}
          >
            {isStreaming ? <span className="loading loading-spinner loading-sm" /> : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
