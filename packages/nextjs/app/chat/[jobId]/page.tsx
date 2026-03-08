import ChatClient from "./ChatClient";

// For static export — pre-render a range of possible job IDs
// (Chat requires API routes so won't work on IPFS, but this allows the build to succeed)
export function generateStaticParams() {
  return Array.from({ length: 50 }, (_, i) => ({ jobId: String(i + 1) }));
}

export default function ChatPage() {
  return (
    <div className="absolute inset-0 bg-base-100">
      <ChatClient />
    </div>
  );
}
