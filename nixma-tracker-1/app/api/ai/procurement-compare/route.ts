import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { callClaude, AI_MODELS } from "@/lib/ai";
import { ProcurementQuote, ProcurementSupplier } from "@/lib/types";

// POST /api/ai/procurement-compare
//
// Given an rfq_id, fetches all quotes for that RFQ plus each supplier's
// track record, then asks Claude Sonnet 4.6 to compare them and recommend
// one with reasoning.
//
// Returns:
// {
//   ok: true,
//   comparison: {
//     summary: string,           -- one-para overview
//     recommendation: {
//       quote_id: number,
//       supplier_name: string,
//       reason: string,          -- plain English reasoning
//     },
//     risks: string[],           -- bullets: anything the team should know
//     quotes: QuoteAnalysis[],   -- per-quote breakdown
//   },
//   input_tokens, output_tokens, estimated_cost_usd
// }

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://iszsyffdxvgdpbulujfa.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzenN5ZmZkeHZnZHBidWx1amZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MjU0NTQsImV4cCI6MjA5OTUwMTQ1NH0.yIz4D9vM5TAnRj4WDzwAxRppHu3j85vWsWrqLReQFPc";

interface QuoteAnalysis {
  quote_id: number;
  supplier_name: string;
  total_price: number | null;
  currency: string;
  lead_time_days: number | null;
  payment_terms: string | null;
  strengths: string[];
  weaknesses: string[];
  score: number; // 1-10
}

interface ComparisonResult {
  summary: string;
  recommendation: {
    quote_id: number;
    supplier_name: string;
    reason: string;
  };
  risks: string[];
  quotes: QuoteAnalysis[];
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  let body: { rfq_id?: number; project_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const { rfq_id, project_id } = body;
  if (!rfq_id || !project_id) {
    return NextResponse.json(
      { ok: false, error: "rfq_id and project_id are required." },
      { status: 400 }
    );
  }

  // Use user's scoped client -- RLS will reject if they're not a project member
  const scopedClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "nixma" },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Fetch quotes for this RFQ
  const { data: quotesData, error: quotesErr } = await scopedClient
    .from("procurement_quotes")
    .select("*")
    .eq("rfq_id", rfq_id)
    .eq("project_id", project_id)
    .order("created_at");

  if (quotesErr) {
    return NextResponse.json({ ok: false, error: quotesErr.message }, { status: 400 });
  }

  const quotes = (quotesData as ProcurementQuote[]) || [];
  if (quotes.length < 2) {
    return NextResponse.json(
      { ok: false, error: "Need at least 2 quotes to compare." },
      { status: 400 }
    );
  }

  // Fetch RFQ details
  const { data: rfqData } = await scopedClient
    .from("procurement_rfq")
    .select("item_description, category, quantity, unit")
    .eq("id", rfq_id)
    .single();

  // Fetch supplier track records for any supplier_id in the quotes
  const supplierIds = quotes.map((q) => q.supplier_id).filter(Boolean);
  let supplierMap: Record<number, ProcurementSupplier> = {};

  if (supplierIds.length > 0) {
    const { data: suppData } = await scopedClient
      .from("procurement_suppliers")
      .select("*")
      .in("id", supplierIds as number[]);

    if (suppData) {
      supplierMap = Object.fromEntries(
        (suppData as ProcurementSupplier[]).map((s) => [s.id, s])
      );
    }
  }

  // Build context for Claude
  const rfqDesc = rfqData
    ? `Item: ${rfqData.item_description}${rfqData.category ? ` (${rfqData.category})` : ""}${rfqData.quantity ? `, Qty: ${rfqData.quantity} ${rfqData.unit || ""}` : ""}`
    : "Item details not available";

  const quotesBlock = quotes
    .map((q, i) => {
      const supplier = q.supplier_id ? supplierMap[q.supplier_id] : null;
      const trackRecord = supplier
        ? `Track record: ${supplier.total_orders} orders, ${supplier.on_time_count} on-time, ${supplier.late_count} late${supplier.avg_delay_days != null ? `, avg delay ${supplier.avg_delay_days} days` : ""}${supplier.quality_rejection_count > 0 ? `, ${supplier.quality_rejection_count} quality rejection(s)` : ", no quality rejections"}`
        : "Track record: New supplier (no history)";

      return `Quote ${i + 1} (ID: ${q.id}):
  Supplier: ${q.supplier_name}
  Unit price: ${q.unit_price != null ? `${q.currency} ${q.unit_price}` : "not stated"}
  Total price: ${q.total_price != null ? `${q.currency} ${q.total_price}` : "not stated"}
  Lead time: ${q.lead_time_days != null ? `${q.lead_time_days} days` : "not stated"}
  Payment terms: ${q.payment_terms || "not stated"}
  Delivery terms: ${q.delivery_terms || "not stated"}
  Validity: ${q.validity_date || "not stated"}
  ${trackRecord}
  ${q.notes ? `Notes: ${q.notes}` : ""}`;
    })
    .join("\n\n");

  const prompt = `You are a procurement advisor for an industrial automation company in Malaysia.
Compare these supplier quotes and give a recommendation.

Procurement requirement:
${rfqDesc}

Quotes:
${quotesBlock}

Return ONLY a JSON object (no markdown, no explanation):
{
  "summary": "<one paragraph overview of the comparison>",
  "recommendation": {
    "quote_id": <number — the ID of the recommended quote>,
    "supplier_name": "<name>",
    "reason": "<2-3 sentence plain English reason — balance price, delivery, track record, and payment terms>"
  },
  "risks": ["<risk 1>", "<risk 2>"],
  "quotes": [
    {
      "quote_id": <number>,
      "supplier_name": "<name>",
      "total_price": <number or null>,
      "currency": "<string>",
      "lead_time_days": <number or null>,
      "payment_terms": "<string or null>",
      "strengths": ["<strength 1>", "<strength 2>"],
      "weaknesses": ["<weakness 1>"],
      "score": <1-10 overall score>
    }
  ]
}

Important:
- A supplier with no track record is not necessarily bad, but note it as a risk
- Lead time matters -- factor in the project timeline if you can infer it
- Payment terms affect cash flow -- COD is worse than 30-day credit
- Price is important but not the only factor`;

  let comparison: ComparisonResult;
  let { text, usage, estimatedCostUsd } = { text: "", usage: { inputTokens: 0, outputTokens: 0 }, estimatedCostUsd: null as number | null };

  try {
    const claudeResult = await callClaude({
      model: AI_MODELS.sonnet46,
      prompt,
      maxTokens: 1500,
    });
    text = claudeResult.text;
    usage = claudeResult.usage;
    estimatedCostUsd = claudeResult.estimatedCostUsd;

    const cleaned = text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    comparison = JSON.parse(cleaned) as ComparisonResult;
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error:
          e instanceof Error
            ? `Comparison failed: ${e.message}`
            : "Could not generate comparison. Try again.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    comparison,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    estimated_cost_usd: estimatedCostUsd,
  });
}
