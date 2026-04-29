/**
 * Static metadata for each service type (keyed by contract slug).
 * Used by the unified service pages for display purposes.
 */

interface ServiceMeta {
  emoji: string;
  tagline: string;
  bullets: string[];
  heroImage?: string;
  heroPosition?: "left" | "right";
  descriptionLabel?: string;
  descriptionPlaceholder?: string;
  skillFile?: boolean;
}

export const SERVICE_META: Record<string, ServiceMeta> = {
  consult: {
    emoji: "💬",
    tagline: "Get clear answers and a concrete plan — fast.",
    bullets: [
      "A focused chat session with LeftClaw about your idea",
      "Architecture advice, stack recommendations, feasibility checks",
      "Ends with a written build plan you can act on immediately",
      "Plan auto-populates a job post if you want LeftClaw to build it",
    ],
    heroImage: "/hero-builder.png",
    heroPosition: "right",
    descriptionLabel: "What do you want to build?",
    descriptionPlaceholder: "e.g. A staking dApp where users earn ETH rewards on CLAWD deposits...",
  },
  "consult-deep": {
    emoji: "🧠",
    tagline: "Deep-dive into complex architecture, protocol design, or strategy.",
    bullets: [
      "A longer, open-ended session to work through a complex idea",
      "Multi-contract systems, tokenomics, security tradeoffs, protocol design",
      "Ends with a detailed written build plan",
      "Plan auto-populates a job post if you want LeftClaw to build it",
    ],
    heroImage: "/hero-builder.png",
    heroPosition: "right",
    descriptionLabel: "What complex problem do you want to explore?",
    descriptionPlaceholder: "e.g. Design a cross-chain bridge with optimistic verification...",
  },
  audit: {
    emoji: "🛡️",
    tagline: "AI-powered security review of your Solidity contracts.",
    bullets: [
      "Vulnerabilities, logic errors, access control issues, gas optimizations",
      "Detailed written report with severity ratings",
      "Recommendations for fixes and best practices",
      "Tracked on-chain — payment escrowed until review is accepted",
    ],
    heroImage: "/hero-audit.png",
    heroPosition: "left",
    descriptionLabel: "What contract should we audit?",
    descriptionPlaceholder: "Paste the contract address (verified on Basescan/Etherscan) or paste source code. Include any relevant context about what the contract does.",
    skillFile: true,
  },
  qa: {
    emoji: "🔍",
    tagline: "Comprehensive UX, accessibility, and functionality audit of your dApp frontend.",
    bullets: [
      "Full frontend walkthrough with detailed bug reports",
      "Accessibility, responsiveness, and UX analysis",
      "Prioritized fix list with severity ratings",
      "Written report delivered as a job result",
    ],
    heroImage: "/hero-qa.png",
    heroPosition: "right",
    descriptionLabel: "What dApp should we QA?",
    descriptionPlaceholder: "Include the dApp URL, contract address, or GitHub repo link. Mention specific areas of concern if any.",
    skillFile: true,
  },
  build: {
    emoji: "⚒️",
    tagline: "Dedicated build session. LeftClaw builds and ships your plan.",
    bullets: [
      "Focused build session — LeftClaw ships your plan",
      "Smart contracts, frontends, integrations, migrations",
      "Direct chat during the build for feedback and adjustments",
      "All work tracked on-chain with escrow protection",
    ],
    heroImage: "/hero-builder.png",
    heroPosition: "right",
    descriptionLabel: "What should we build?",
    descriptionPlaceholder: "Describe the project in detail. Include tech stack preferences, existing repos, deployment targets, and any constraints.",
    skillFile: true,
  },
  feature: {
    emoji: "🔧",
    tagline: "Add a feature, fix a bug, or update an existing build.",
    bullets: [
      "New feature, bug fix, migration, or update to an existing project",
      "Point Clawd at your repo — describe the change you need",
      "Direct chat during the work for feedback and adjustments",
      "All work tracked on-chain with escrow protection",
    ],
    heroImage: "/hero-feature.png",
    heroPosition: "left",
    descriptionLabel: "What feature or fix do you need?",
    descriptionPlaceholder: "Include the GitHub repo URL, describe the change, and mention any constraints (e.g. don't break existing tests, deploy to Vercel, etc.).",
    skillFile: true,
  },
};

/**
 * Additional metadata for services that don't have their own slug route
 * but need page-level config (Oracle, Research, etc.)
 */
export const EXTRA_SERVICE_META: Record<string, ServiceMeta & { contractSlug?: string }> = {
  oracle: {
    emoji: "⚖️",
    tagline: "Schedule onchain actions triggered by real-world outcomes.",
    bullets: [
      "Define a condition and a future datetime",
      "Clawd monitors specified URLs for the outcome",
      "Executes the onchain action automatically when conditions are met",
      "Full audit trail of checks and execution",
    ],
    heroImage: "/hero-oracle.png",
    heroPosition: "right",
    descriptionLabel: "Describe your oracle job",
    descriptionPlaceholder: "What condition should trigger the action? Include URLs to monitor, the datetime, and the onchain action to execute.",
  },
  research: {
    emoji: "🔬",
    tagline: "Give Clawd a topic and get back a detailed written research report.",
    bullets: [
      "Deep-dive research on any Ethereum/crypto topic",
      "Protocol analysis, competitive research, on-chain data analysis",
      "Structured report with sources and citations",
      "Useful for governance decisions, investment research, or protocol design",
    ],
    heroImage: "/hero-research.png",
    heroPosition: "left",
    descriptionLabel: "What should we research?",
    descriptionPlaceholder: "Include the topic, specific questions, relevant URLs, and how you plan to use the research.",
  },
  humanqa: {
    emoji: "👤",
    tagline: "Talk to a human about your build — anything the AI can't handle.",
    bullets: [
      "Direct human time on your project — short attention budget but real eyes",
      "Help getting from prototype to production",
      "Deployment guidance: Vercel, ENS, custom domain, backend setup",
      "Review your build, answer hard questions, unblock anything stuck",
      "Delivered as a job result on-chain",
    ],
    heroImage: "/hero-humanqa.png",
    heroPosition: "left",
    descriptionLabel: "What do you need a human for?",
    descriptionPlaceholder: "Describe what you need — review of your build, prod-readiness questions, deployment help, anything stuck. Include relevant URLs / repos / contract addresses.",
  },
};
