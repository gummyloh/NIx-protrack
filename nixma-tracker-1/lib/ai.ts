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

export async function callClaude(opts: {
  model: string;
  prompt: string;
  system?: string;
  maxTokens?: number;
}): Promise<string> {
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
  return block.text;
}
