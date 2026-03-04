"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: job, isLoading: jobLoading } = useScaffoldReadContract({
    contractName: "LeftClawServices",
    functionName: "getJob",
    args: [BigInt(jobId || "0")],
  });

  const isAuthorized = job && address && job.client.toLowerCase() === address.toLowerCase();
  const totalMessages = messages.length;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
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
        body: JSON.stringify({ messages: newMessages, jobId }),
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
    }
  }, [messages, isStreaming, jobId]);

  const createGistAndRedirect = async (plan: string) => {
    try {
      const res = await fetch("https://api.github.com/gists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: `LeftClaw Build Plan - Job #${jobId}`,
          public: false,
          files: { "build-plan.md": { content: plan } },
        }),
      });
      const gist = await res.json();
      if (gist.html_url) {
        router.push(`/post?type=2&gist=${encodeURIComponent(gist.html_url)}`);
      }
    } catch (e) {
      console.error("Gist creation failed:", e);
      setError("Failed to create plan gist — copy the plan manually");
    }
  };

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

  if (job && !isAuthorized) {
    return (
      <div className="flex flex-col items-center py-20">
        <p className="text-xl mb-4">🚫 Access denied</p>
        <p className="opacity-70">Only the job client can access this consultation.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] max-w-3xl mx-auto">
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
        {messages.length === 0 && (
          <div className="text-center py-10 opacity-60">
            <p className="text-4xl mb-2">🦞</p>
            <p>Hi! I&apos;m LeftClaw. Tell me what you want to build.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat ${msg.role === "user" ? "chat-end" : "chat-start"}`}>
            <div className="chat-header text-xs opacity-50 mb-1">
              {msg.role === "user" ? "You" : "🦞 LeftClaw"}
            </div>
            <div className={`chat-bubble ${msg.role === "user" ? "chat-bubble-primary" : "chat-bubble-neutral"} whitespace-pre-wrap !rounded-xl`}>
              {msg.content || (isStreaming && i === messages.length - 1 ? "..." : "")}
            </div>
          </div>
        ))}
        {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="chat chat-start">
            <div className="chat-bubble chat-bubble-neutral !rounded-xl">
              <span className="loading loading-dots loading-sm" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-base-300">
        {error && (
          <div className="alert alert-error mb-2 py-2 text-sm">{error}</div>
        )}
        <form
          onSubmit={e => { e.preventDefault(); sendMessage(input); }}
          className="flex gap-2"
        >
          <input
            type="text"
            className="input input-bordered flex-1 rounded-md"
            placeholder="Describe what you want to build..."
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={isStreaming}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isStreaming || !input.trim()}
          >
            {isStreaming ? <span className="loading loading-spinner loading-sm" /> : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}
