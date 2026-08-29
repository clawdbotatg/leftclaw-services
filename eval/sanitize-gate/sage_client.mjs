// Minimal Levanto Sage yesno client.
//
// UNVERIFIED SCAFFOLD: the sage-wisdom skill's reference.md (which documents the
// verified request envelope, UA/WAF quirks, and `instructions` field) was
// unreachable when this was written. Endpoint + envelope below are configurable
// so they can be corrected against reference.md without touching the callers.
// Set SAGE_API_URL if the default is wrong.

const SAGE_API_URL = process.env.SAGE_API_URL || "https://api.levanto.ai/v1/decide";

export async function sageYesno(question, text, { timeoutMs = 10_000 } = {}) {
  const apiKey = process.env.SAGE_API_KEY;
  if (!apiKey) throw new Error("SAGE_API_KEY not set (keys at https://platform.levanto.ai)");

  const t0 = Date.now();
  const res = await fetch(SAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // Sage's WAF is known to reject default fetch UAs — plain browser-ish UA.
      "User-Agent": "Mozilla/5.0 (compatible; leftclaw-sanitize-eval)",
    },
    body: JSON.stringify({
      kind: "yesno",
      questions: [question],
      document: text,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`Sage HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();

  // Envelope nesting varies by version — probe the known shapes.
  const answer =
    data.answers?.[0] ??
    data.result?.answers?.[0] ??
    data.results?.[0] ??
    data;
  const yes = answer.yes ?? answer.answer ?? answer.value;
  const confidence = answer.confidence ?? answer.probability ?? answer.score;
  if (typeof confidence !== "number" && typeof yes !== "boolean") {
    throw new Error(`Sage: unrecognized response shape: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { yes: !!yes, confidence: typeof confidence === "number" ? confidence : yes ? 1 : 0, ms, meta: data.meta };
}
