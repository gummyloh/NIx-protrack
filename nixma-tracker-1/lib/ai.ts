// Server-only. Deliberately no @anthropic-ai/sdk dependency -- every AI
// feature this app needs is a single non-streaming text response, which a
// plain fetch() to the Messages API handles fine without adding a package
// to manage.
//
// Each feature route picks its own model explicitly via AI_MODELS rather
// than sharing one global default: cheap, read-only features (a digest
// someone reads, doesn't act on blindly) use Haiku; anything that drafts
// changes a human might accept with one click uses Sonnet, since a wrong
// suggestion there costs more in review time than the fractional price
// difference between the two models is worth.

export const AI_MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-5",
} as const;

// $ per model, per million tokens (input, output) -- used only to show a
// rough estimated cost next to a result, not for actual billing (Anthropic's
// own usage dashboard at console.anthropic.com/settings/usage is the source
// of truth for that). Update these if pricing changes.
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  [AI_MODELS.haiku]: { input: 1, output: 5 },
  [AI_MODELS.sonnet]: { input: 2, output: 10 },
};

export interface ClaudeResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  estimatedCostUsd: number | null;
}

export async function callClaude(opts: {
  model: string;
  prompt: string;
  system?: string;
  maxTokens?: number;
}): Promise<ClaudeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it in Vercel -> Project Settings -> " +
        "Environment Variables (create the key at console.anthropic.com)."
    );
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1500,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: "user", content: opts.prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude API error (${res.status}): ${text || res.statusText}`);
  }

  const data = await res.json();
  const block = (data.content as { type: string; text?: string }[] | undefined)?.find(
    (b) => b.type === "text"
  );
  if (!block?.text) {
    throw new Error("Claude API returned no text content.");
  }

  const inputTokens = (data.usage?.input_tokens as number) ?? 0;
  const outputTokens = (data.usage?.output_tokens as number) ?? 0;
  const price = PRICE_PER_MTOK[opts.model];
  const estimatedCostUsd = price
    ? (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output
    : null;

  return {
    text: block.text,
    usage: { inputTokens, outputTokens },
    estimatedCostUsd,
  };
}
