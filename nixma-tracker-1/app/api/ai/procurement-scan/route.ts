import { NextRequest, NextResponse } from "next/server";
import { callClaude, AI_MODELS } from "@/lib/ai";
import { AiScanResult } from "@/lib/types";

// POST /api/ai/procurement-scan
//
// Accepts a base64-encoded file (PDF or image) and extracts structured
// procurement data from it using Claude Sonnet 4.6 vision.
//
// The caller passes: { file_base64: string, media_type: string, project_id: string }
// Returns: { ok: true, result: AiScanResult, input_tokens, output_tokens, estimated_cost_usd }
//
// This route does NOT write to the database -- the client shows the extracted
// fields in a review form and only writes after the user confirms. This keeps
// a mis-read document from silently creating wrong cost entries.

const SYSTEM_PROMPT = `You are a procurement assistant for an industrial automation and engineering company.
Your job is to extract structured data from procurement documents.

The company deals with:
- Electrical components (switchgear, drives, panels)
- Mechanical parts (pneumatics, motors, bearings, precision assemblies)
- Fabrication work (custom machined/welded parts, enclosures)
- Test and automation equipment
- Consumables and misc items

You must identify the document type and extract ALL relevant fields.
Return ONLY a valid JSON object. No markdown, no explanation, no code fences.`;

const USER_PROMPT = `Extract structured procurement data from this document.

Return a JSON object with exactly these fields (use null for any field not found):
{
  "document_type": one of: "quotation", "purchase_order", "delivery_order", "invoice", "fabrication_order", "receipt", "unknown",
  "supplier_name": string or null,
  "item_description": string or null (main item or service being quoted/ordered),
  "category": one of: "Mechanical", "Electrical", "Fabrication", "Software", "Consumables", "Labour", "Misc", or null,
  "quantity": number or null,
  "unit": string or null (pcs, sets, kg, m, lots, etc.),
  "unit_price": number or null,
  "total_price": number or null,
  "currency": string or null (default "MYR" if Malaysian document with no currency shown),
  "lead_time_days": number or null (convert weeks to days if needed, e.g. "2 weeks" = 14),
  "payment_terms": string or null (e.g. "30 days", "COD", "50% upfront"),
  "validity_date": string or null (ISO date YYYY-MM-DD),
  "delivery_terms": string or null (e.g. "ex-works", "delivered to site"),
  "po_number": string or null (PO or order reference number),
  "date_ordered": string or null (ISO date YYYY-MM-DD),
  "expected_delivery": string or null (ISO date YYYY-MM-DD),
  "drawing_ref": string or null (drawing number or reference, for fabrication items),
  "expected_completion": string or null (ISO date YYYY-MM-DD, for fabrication jobs),
  "cost": number or null (total cost for fabrication orders),
  "confidence": "high" if most fields extracted cleanly, "medium" if some ambiguity, "low" if poor quality or unrecognised document,
  "notes": string or null (any important caveats, e.g. "Multiple line items found - only first item extracted", "Currency assumed MYR")
}`;

export async function POST(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  let body: { file_base64?: string; media_type?: string; project_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const { file_base64, media_type, project_id } = body;

  if (!file_base64 || !media_type || !project_id) {
    return NextResponse.json(
      { ok: false, error: "file_base64, media_type, and project_id are required." },
      { status: 400 }
    );
  }

  // Validate supported media types
  const supported = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
  if (!supported.includes(media_type)) {
    return NextResponse.json(
      { ok: false, error: `Unsupported file type: ${media_type}. Use JPEG, PNG, WebP, or PDF.` },
      { status: 400 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "ANTHROPIC_API_KEY not configured." },
      { status: 500 }
    );
  }

  // Build the vision message -- images and PDFs both work as base64 source blocks
  const contentBlock =
    media_type === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: file_base64 },
        }
      : {
          type: "image",
          source: { type: "base64", media_type, data: file_base64 },
        };

  let result: AiScanResult;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd: number | null = null;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: AI_MODELS.sonnet46,
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              contentBlock,
              { type: "text", text: USER_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `Claude API error (${res.status}): ${text || res.statusText}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const block = (data.content as { type: string; text?: string }[] | undefined)?.find(
      (b) => b.type === "text"
    );
    if (!block?.text) throw new Error("No text in response");

    inputTokens = data.usage?.input_tokens ?? 0;
    outputTokens = data.usage?.output_tokens ?? 0;

    // Estimate cost: sonnet-4-6 ~ $3 input / $15 output per 1M tokens
    estimatedCostUsd =
      (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;

    const cleaned = block.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    result = JSON.parse(cleaned) as AiScanResult;
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error:
          e instanceof Error
            ? `Extraction failed: ${e.message}`
            : "Could not read the document. Try a clearer scan.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    result,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_usd: estimatedCostUsd,
  });
}
