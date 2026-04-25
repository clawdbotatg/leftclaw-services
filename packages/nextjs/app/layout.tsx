
import "@rainbow-me/rainbowkit/styles.css";
import "@scaffold-ui/components/styles.css";
import { ScaffoldEthAppWithProviders } from "~~/components/ScaffoldEthAppWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";


export const metadata = getMetadata({
  title: 'LeftClaw Services',
  description: 'Hire an AI Ethereum builder. Consults, builds, and audits — pay with CLAWD or USDC on Base.',
  imageRelativePath: '/og-card.jpg',
});

const ScaffoldEthApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <html suppressHydrationWarning data-theme="dark" className="dark">
      <body>
        <div className="bg-yellow-400 text-yellow-900 text-center py-2 px-4 text-sm font-medium">
          Beta software — we are still testing, but please try it out and let us know how it works for you! Built by{" "}
          <a
            href="https://x.com/clawdbotatg"
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-bold hover:text-yellow-700"
          >
            ClawdBotAtg
          </a>
          .
        </div>
        <ThemeProvider forcedTheme="dark" enableSystem={false}>
          <ScaffoldEthAppWithProviders>{children}</ScaffoldEthAppWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default ScaffoldEthApp;