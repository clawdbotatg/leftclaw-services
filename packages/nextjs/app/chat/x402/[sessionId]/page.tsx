import X402ChatClient from "./X402ChatClient";

export default function X402ChatPage() {
  return (
    <div data-chat-page className="fixed inset-0 top-[64px] z-[15] bg-base-100">
      <X402ChatClient />
    </div>
  );
}
