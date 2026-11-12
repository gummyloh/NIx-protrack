import { BomItem, BomStatus, BomDiscipline, BomMakeBuy, StationRow } from "./types";

const ORDERED_STATUSES: BomStatus[] = ["purchased", "received", "nsw_purchased"];

// ─── Excel import: header mapping ─────────────────────────────────────
// Header names accepted from the company template, from files exported
// out of the tracker, and from older master lists engineers copy forward
// from previous projects (which name the same columns a dozen ways).

export type BomField = keyof Pick<
  BomItem,
  | "row_id" | "sub_assembly" | "discipline" | "description" | "part_no" | "manufacturer" | "category"
  | "qty" | "multiple" | "unit" | "make_buy" | "drawing_no" | "nsw_part_no" | "engineer_pic"
  | "issue_date" | "required_date" | "status" | "supplier" | "pr_no" | "po_no" | "po_date"
  | "eta" | "do_invoice_no" | "qty_received" | "received_date" | "unit_price"
  | "qty_issued" | "issued_to" | "issued_date" | "remarks"
> | "tracker_id" | "station_name" | "total_qty_in";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIAS_GROUPS: [BomField, string[]][] = [
  ["tracker_id", ["trackerid"]],
  ["row_id", ["rowid"]],
  ["station_name", ["station", "stationname"]],
  ["sub_assembly", ["subassembly", "subassy", "subassemblyname", "subassyname"]],
  ["discipline", ["discipline"]],
  ["description", [
    "description", "descriptions", "desc", "itemdescription", "partdescription",
    "materialdescription", "partname", "itemname",
  ]],
  ["part_no", [
    "manufacturerpartno", "manufacturerpartnumber", "partno", "partnumber", "pn", "mpn",
    "mfgpartno", "mfrpartno", "mfgpn", "mfrpn", "model", "modelno", "modelnumber",
    "partnomodel", "modelpartno", "catalogno", "catalogueno", "ordercode",
  ]],
  ["manufacturer", [
    "manufacturer", "brand", "brandmaker", "makerbrand", "maker", "mfr", "mfg",
    "brandmanufacturer", "manufacturerbrand",
  ]],
  ["category", ["category", "type", "parttype", "itemtype"]],
  ["qty", [
    "qtyset", "qty", "quantity", "qtyperset", "qtyperunit", "qtyunit", "qtypermachine",
    "qtymachine", "reqqty", "requiredqty", "bomqty",
  ]],
  ["total_qty_in", ["totalqty", "totalquantity", "ttlqty", "totqty"]],
  ["multiple", ["multiple", "multiplier", "noofsets"]],
  ["unit", ["unit", "units", "uom", "unitofmeasure"]],
  ["make_buy", ["makebuy", "makeorbuy", "buymake"]],
  ["drawing_no", ["drawingnorev", "drawingno", "drawingnumber", "drawing", "dwgno", "dwg", "drgno"]],
  ["nsw_part_no", ["nswpartno", "nswpn", "nswpart", "nswcode"]],
  ["engineer_pic", ["engineerpic", "pic", "engineer", "designer"]],
  ["issue_date", ["issuedate", "dateissued", "releasedate"]],
  ["required_date", ["requireddate", "daterequired", "requiredby", "needdate", "needbydate", "targetdate"]],
  ["status", ["status", "procurementstatus", "purchasestatus", "partstatus", "itemstatus"]],
  ["supplier", ["supplier", "suppliername", "vendor", "vendorname"]],
  ["pr_no", ["prno", "prnumber", "pr"]],
  ["po_no", ["pono", "ponumber", "po", "purchaseorder", "purchaseorderno"]],
  ["po_date", ["podate", "orderdate", "dateordered"]],
  ["eta", ["eta", "etadate", "deliverydate", "expecteddelivery", "expecteddate"]],
  ["do_invoice_no", ["doinvoiceno", "doinvoice", "dono", "donumber", "do", "invoiceno"]],
  ["qty_received", ["qtyreceived", "receivedqty", "qtyrecv", "qtyrcvd", "rcvdqty"]],
  ["received_date", ["receiveddate", "datereceived", "rcvddate", "arrivaldate"]],
  ["unit_price", ["unitpricerm", "unitpricemyr", "unitprice", "price", "unitcost"]],
  ["qty_issued", ["qtyissued", "issuedqty", "qtytaken"]],
  ["issued_to", ["takenby", "issuedto", "collectedby"]],
  ["issued_date", ["issuedateassy", "issueddate", "datetaken"]],
  ["remarks", ["remarks", "remark", "notes", "note", "comments", "comment"]],
];

const HEADER_ALIASES: Record<string, BomField> = {};
for (const [field, names] of ALIAS_GROUPS) for (const n of names) HEADER_ALIASES[n] = field;

/** Field for one header cell, or null. Tolerates notes/units after the name: "Qty (pcs)", "Description\n(part name)". */
export function headerField(raw: string | null | undefined): BomField | null {
  if (!raw) return null;
  const full = norm(raw);
  if (!full) return null;
  if (HEADER_ALIASES[full]) return HEADER_ALIASES[full];
  const base = norm(raw.split(/[\n([]/)[0]);
  return (base && HEADER_ALIASES[base]) || null;
}

/** Maps a header row to column index → field. Unknown headers are ignored. */
export function mapHeaders(headers: (string | null | undefined)[]): Map<number, BomField> {
  const out = new Map<number, BomField>();
  const seen = new Set<BomField>();
  headers.forEach((h, i) => {
    const f = headerField(h == null ? null : String(h));
    // First match wins: older lists have both "Issue Date" (engineering)
    // and a later "Date" under Assembly; template has "Issue Date (Assy)".
    if (f && !seen.has(f)) {
      out.set(i, f);
      seen.add(f);
    }
  });
  return out;
}

// ─── Cell parsers ─────────────────────────────────────────────────────

export function parseStatus(v: string | null | undefined): BomStatus | null {
  if (!v) return null;
  const n = norm(v);
  if (!n) return null;
  if (n.includes("cancel") || n === "void" || n.includes("obsolete")) return "cancelled";
  if (n.includes("nsw") && (n.includes("request") || n.includes("new"))) return "nsw_requested";
  if (n.includes("nsw")) return "nsw_purchased";
  // "Not received" / "Not yet arrived" means it's on order, not "not finalized".
  if (/^not(yet)?(received|arrived|delivered)/.test(n)) return "purchased";
  if (n.startsWith("not") || n.includes("notyet") || n.includes("indesign") || n === "tbc" || n === "tbd" || n === "draft" || n === "kiv" || n === "onhold" || n === "hold")
    return "not_finalized";
  // "Finalized – Not Purchased" contains "purchased", so test it first.
  if (n.startsWith("final") || n.includes("released") || n.startsWith("prraised") || n.startsWith("prissued") || n.startsWith("prsubmitted"))
    return "finalized";
  if (n.includes("purchased") || n.includes("ordered") || n.includes("poissued") || n.includes("intransit") || n.includes("onorder") || n.includes("shipped"))
    return "purchased";
  if (n.includes("received") || n.includes("delivered") || n.includes("arrived") || n === "instock" || n === "instore")
    return "received";
  if (n.includes("final") || n.includes("released")) return "finalized";
  return null;
}

export function parseDiscipline(v: string | null | undefined): BomDiscipline | null {
  if (!v) return null;
  const n = norm(v);
  if (n.startsWith("mech")) return "mechanical";
  if (n.startsWith("elec")) return "electrical";
  if (n.startsWith("pneu")) return "pneumatic";
  if (n.startsWith("soft") || n.includes("vision")) return "software";
  if (n) return "others";
  return null;
}

/** The company template has no Discipline column; infer it from Category so the BOM page's filter still works. */
export function disciplineFromCategory(category: string | null | undefined): BomDiscipline | null {
  if (!category) return null;
  const n = norm(category);
  if (n.startsWith("electr") || n === "sensor") return "electrical";
  if (n.startsWith("pneu") || n.startsWith("vacuum")) return "pneumatic";
  if (n.startsWith("vision") || n.startsWith("soft")) return "software";
  if (n.startsWith("fabricated") || n.startsWith("stdmech") || n.startsWith("motion") || n.startsWith("safety")) return "mechanical";
  if (n.startsWith("consumable")) return "others";
  return null;
}

export function parseMakeBuy(v: string | null | undefined): BomMakeBuy | null {
  if (!v) return null;
  const n = norm(v);
  if (n.startsWith("make") || n.includes("fabric") || n === "inhouse") return "make";
  if (n.startsWith("cust") || n === "fis" || n.includes("freeissue")) return "customer";
  if (n.includes("stock") || n === "store" || n === "fromstore") return "stock";
  if (n.startsWith("buy") || n.startsWith("purchase") || n === "standard" || n === "std") return "buy";
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDate() !== d) return null; // 31 Feb, 31 Apr …
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Excel stores dates as days since 1899-12-30; cells formatted "General" arrive as that number. */
function fromSerial(n: number): string | null {
  if (!isFinite(n) || n < 32874 || n > 73415) return null; // 1990-01-01 … 2100-12-31
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
}

/**
 * Accepts a JS Date, an Excel serial number, ISO, dd-mmm-yy(yy), "Oct 15, 2026",
 * and dd/mm/yy(yy) with / . or - separators (day first, as written in Malaysia;
 * swapped only when the "month" is over 12). Returns yyyy-mm-dd or null.
 */
export function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10); // exceljs: UTC midnight
  if (typeof v === "number") return fromSerial(v);
  // Purchasing writes promised dates in brackets: "(31/10/2026)".
  const s = String(v).trim().replace(/^[([]\s*(.*?)\s*[)\]]$/, "$1");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[-\s/.,]+([A-Za-z]{3})[A-Za-z]*[-\s/.,]+(\d{2,4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return ymd(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  m = s.match(/^([A-Za-z]{3})[A-Za-z]*[-\s/.,]+(\d{1,2})(?:st|nd|rd|th)?[-\s/.,]+(\d{2,4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return ymd(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    let d = Number(m[1]), mo = Number(m[2]);
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    return ymd(Number(m[3]), mo, d);
  }
  if (/^\d{5}$/.test(s)) return fromSerial(Number(s));
  return null;
}

/** Number from a cell; tolerates thousands separators and a trailing unit ("2 pcs", "1,200", "4x"). */
function parseNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const m = String(v).trim().replace(/,(?=\d{3}\b)/g, "").match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function parseText(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

export function normalizeUnit(u: string): string {
  const n = norm(u);
  if (n.startsWith("pc") || n === "ea" || n === "each" || n === "nos" || n === "no" || n === "unit" || n === "units") return "Pcs";
  if (n.startsWith("set")) return "Set";
  if (/^(m|mtr|mtrs|meter|meters|metre|metres)$/.test(n)) return "Mtr";
  if (n.startsWith("lot")) return "Lot";
  if (n.startsWith("roll")) return "Roll";
  return u.trim();
}

// ─── Row parsing ──────────────────────────────────────────────────────

export type ParsedBomRow = Partial<Omit<BomItem, "id" | "project_id" | "station_id" | "total_qty">> & {
  tracker_id?: number;
  station_name?: string;
  source_row: number;
  /** Sheet the row came from, when the workbook has more than one BOM sheet. */
  source_sheet?: string;
  /** Discipline implied by the part's Category, else by the sheet name ("Mech BOM"); used only when the row has none. */
  discipline_hint?: BomDiscipline;
};

/** Keys on a parsed row that describe where it came from, not what to store. */
export const ROW_META_KEYS = ["source_row", "source_sheet", "tracker_id", "station_name", "discipline_hint"] as const;
const META = new Set<string>(ROW_META_KEYS);

/** Something in the file the importer couldn't use as-is. Shown to the user before they commit. */
export interface ImportIssue {
  sheet?: string;
  row: number;
  /** skipped: the whole row was left out. value: one cell was ignored. note: FYI. */
  kind: "skipped" | "value" | "note";
  message: string;
}

const SECTION_RE = /^[A-Z]{1,4}\d{2,4}(-[0-9A-Z]{1,4})+(\s|$)/;
const NUMBERED_SECTION_RE = /^\d{2,4}[\s.\-:]+[A-Za-z]/;
const TOTAL_RE = /^(sub[\s-]?total|grand\s*total|total)\b/i;
// The template keeps an "UNASSIGNED" banner row in the data area.
const BANNER_RE = /^unassigned\b/i;

const PLACEHOLDER_FIELDS = new Set<BomField>([
  "tracker_id", "row_id", "total_qty_in", "sub_assembly", "station_name", "discipline", "category", "unit", "make_buy", "multiple", "status",
]);
const DATE_FIELDS = ["issue_date", "required_date", "po_date", "eta", "received_date", "issued_date"] as const;
const FIELD_LABEL: Partial<Record<BomField, string>> = {
  qty: "Qty", multiple: "Multiple", qty_received: "Qty Received", qty_issued: "Qty Issued",
  issue_date: "Issue Date", required_date: "Required Date", po_date: "PO Date", eta: "ETA",
  received_date: "Received Date", issued_date: "Issue Date (Assy)", status: "Status", make_buy: "Make / Buy",
};
/** Placeholders people type into date/qty cells that mean "nothing yet" — not worth a warning. */
const BLANKISH_RE = /^(-+|n\/?a|nil|none|tbc|tbd|tba|\?+|pending)$/i;

/**
 * Excel on a PC set to US dates reads a typed "5/11/26" as 11 May, and leaves
 * "30/10/26" as text because there is no month 30. So a column typed
 * day-first ends up half text (correct) and half real dates with day and
 * month swapped. Detects that: every real date has day ≤ 12, and swapping
 * brings each one closer to the dates that stayed as text.
 */
function swappedDateColumn(values: unknown[]): boolean {
  const text: number[] = [];
  const cells: Date[] = [];
  for (const v of values) {
    if (v instanceof Date && !isNaN(v.getTime())) cells.push(v);
    else if (typeof v === "string") {
      const d = parseDate(v);
      if (d) text.push(Date.parse(d));
    }
  }
  if (!text.length || !cells.length) return false;
  text.sort((a, b) => a - b);
  const mid = text[Math.floor(text.length / 2)];
  return cells.every((c) => {
    const d = c.getUTCDate(), m = c.getUTCMonth() + 1;
    if (d > 12) return false;
    if (d === m) return true;
    const sw = Date.UTC(c.getUTCFullYear(), d - 1, m);
    return Math.abs(sw - mid) < Math.abs(c.getTime() - mid);
  }) && cells.some((c) => c.getUTCDate() !== c.getUTCMonth() + 1);
}
const swapDayMonth = (c: Date) => new Date(Date.UTC(c.getUTCFullYear(), c.getUTCDate() - 1, c.getUTCMonth() + 1));
const nice = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const clip = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * Turns raw sheet rows (already sliced below the header) into BOM rows.
 *
 * Old-style master lists group parts under section title rows such as
 * "MH063-120-00 SINGULATOR" or "120 SINGULATOR" — those become the
 * sub_assembly of the rows beneath them when the file has no Sub-Assembly
 * column. Lists that do have the column but only fill it on the first row
 * of each group are filled down.
 *
 * Nothing is dropped silently: rows left out and cells that couldn't be
 * read come back in `issues`.
 */
export function parseBomRows(
  cells: unknown[][],
  headerMap: Map<number, BomField>,
  firstRowNumber: number,
  sheet?: string
): { rows: ParsedBomRow[]; skipped: number; issues: ImportIssue[] } {
  const rows: ParsedBomRow[] = [];
  const issues: ImportIssue[] = [];
  let skipped = 0;
  let section: string | null = null;
  const fields = new Set(headerMap.values());
  const hasSubAssyCol = fields.has("sub_assembly");
  const hasTrackerId = fields.has("tracker_id");
  const colOf = new Map<BomField, number>();
  for (const [i, f] of headerMap) colOf.set(f, i);
  const explicitSubAssy: boolean[] = [];

  // Cells that couldn't be read, grouped so 30 rows with the same comment in
  // the ETA column come out as one line, not 30.
  const unreadCells = new Map<string, { label: string; text: string; what: string; rows: number[]; desc: string }>();
  const swapped = new Map<BomField, { n: number; example?: string }>();
  for (const f of DATE_FIELDS) {
    if (colOf.has(f) && swappedDateColumn(cells.map((r) => r?.[colOf.get(f)!]))) swapped.set(f, { n: 0 });
  }
  let nameFromPartNo = 0;
  let etaNotes = 0;
  let etaNoteExample = "";

  cells.forEach((row, idx) => {
    const rowNo = firstRowNumber + idx;
    const issue = (kind: ImportIssue["kind"], message: string) => issues.push({ sheet, row: rowNo, kind, message });
    const get = (f: BomField) => (colOf.has(f) ? row[colOf.get(f)!] : undefined);
    let desc = parseText(get("description"));
    const pn = parseText(get("part_no"));
    const qty = parseNum(get("qty"));
    const mfr = parseText(get("manufacturer"));

    // Fabricated parts are often listed by drawing number alone, in the
    // Part No. column. That's a real part: use the number as its name.
    if (!desc && pn) {
      desc = pn;
      nameFromPartNo += 1;
    }
    if (!desc) {
      // A lone label on the row ("120 SINGULATOR" typed in the Item column)
      // is a section title in lists without a Sub-Assembly column.
      const filled = row.map(parseText).filter(Boolean) as string[];
      if (!hasSubAssyCol && filled.length === 1 && filled[0].length >= 3 && /[A-Za-z]/.test(filled[0]) && !TOTAL_RE.test(filled[0])) {
        section = filled[0];
        return;
      }
      // Only rows with real data in a known column count as skipped — the
      // template's pre-filled formula rows and stray notes don't.
      // (a row with only its Sub-Assembly / Category / Unit dropdowns picked
      // is a placeholder someone hasn't filled in yet, not a lost part).
      const lost = [...headerMap]
        .filter(([, f]) => !PLACEHOLDER_FIELDS.has(f))
        .map(([i]) => parseText(row[i]))
        .filter(Boolean) as string[];
      if (lost.length) {
        skipped += 1;
        issue("skipped", `No description — row left out (${pn ? `part no. ${clip(pn, 30)}` : clip(lost[0], 30)})`);
      }
      return;
    }
    if (TOTAL_RE.test(desc) && !pn) return; // subtotal lines aren't parts
    if (BANNER_RE.test(desc) && !pn && qty == null) return; // nor is the template's UNASSIGNED banner
    if (!hasSubAssyCol && !pn && qty == null && !mfr && (SECTION_RE.test(desc) || NUMBERED_SECTION_RE.test(desc))) {
      section = desc;
      return;
    }

    const out: ParsedBomRow = { description: desc, source_row: rowNo };
    if (sheet) out.source_sheet = sheet;
    let totalIn: number | null = null;
    let etaNote: string | null = null;
    for (const [i, field] of headerMap) {
      const raw = row[i];
      // A date typed into the wrong column should read as a date in the warning.
      const text = raw instanceof Date && !isNaN(raw.getTime()) ? nice(raw.toISOString().slice(0, 10)) : parseText(raw);
      const unread = (what: string) => {
        if (!text || BLANKISH_RE.test(text)) return;
        const key = `${field}|${text.toLowerCase()}`;
        const g = unreadCells.get(key);
        if (g) g.rows.push(rowNo);
        else unreadCells.set(key, { label: FIELD_LABEL[field] ?? field, text, what, rows: [rowNo], desc: desc! });
      };
      switch (field) {
        case "tracker_id": {
          const n = parseNum(raw);
          if (n != null) out.tracker_id = n;
          break;
        }
        case "description":
          break;
        case "row_id":
          if (text) out.row_id = text.toUpperCase();
          break;
        case "total_qty_in":
          totalIn = parseNum(raw);
          break;
        case "qty": case "multiple": case "qty_received": case "unit_price": case "qty_issued": {
          const n = parseNum(raw);
          if (n != null) out[field] = n;
          else if (field !== "unit_price") unread("isn't a number, left blank");
          // "2 SET" typed into the qty cell carries the unit with it.
          if (field === "qty" && n != null && typeof raw === "string") {
            const u = raw.trim().match(/^-?[\d.,]+\s*([A-Za-z]{1,6})$/);
            if (u && !out.unit) out.unit = u[1];
          }
          break;
        }
        case "issue_date": case "required_date": case "po_date": case "eta":
        case "received_date": case "issued_date": {
          const sw = swapped.get(field);
          if (sw && raw instanceof Date && raw.getUTCDate() !== raw.getUTCMonth() + 1) {
            out[field] = swapDayMonth(raw).toISOString().slice(0, 10);
            sw.n += 1;
            sw.example ??= `${nice(raw.toISOString().slice(0, 10))} → ${nice(out[field]!)}`;
            break;
          }
          const d = parseDate(raw);
          if (d) out[field] = d;
          else if (field === "eta" && text && !BLANKISH_RE.test(text)) {
            // Purchasing's running comment ("15/10: 4 to 6 weeks…") lives in
            // the ETA column until there's a date. Keep it — in Remarks.
            etaNote = text;
          } else unread("isn't a date, left blank");
          break;
        }
        case "status": {
          const s = parseStatus(text);
          if (s) out.status = s;
          else unread("isn't a known status, left as it is");
          break;
        }
        case "discipline": {
          const d = parseDiscipline(text);
          if (d) out.discipline = d;
          break;
        }
        case "make_buy": {
          const m = parseMakeBuy(text);
          if (m) out.make_buy = m;
          else unread("isn't Make / Buy / Customer / Stock, left as it is");
          break;
        }
        case "unit":
          if (text) out.unit = text;
          break;
        default:
          if (text) (out as Record<string, unknown>)[field] = text;
      }
    }
    // A list with only a "Total Qty" column: use it as the per-set qty.
    if (out.qty == null && totalIn != null) {
      const mult = out.multiple && out.multiple > 0 ? out.multiple : 1;
      out.qty = totalIn / mult;
    }
    if (!out.discipline) {
      const d = disciplineFromCategory(out.category);
      if (d) out.discipline_hint = d;
    }
    if (etaNote) {
      const tag = `ETA: ${etaNote}`;
      if (!out.remarks?.includes(etaNote)) out.remarks = out.remarks ? `${out.remarks} · ${tag}` : tag;
      etaNotes += 1;
      etaNoteExample ||= etaNote;
    }
    explicitSubAssy.push(!!out.sub_assembly);
    if (!out.sub_assembly && section) out.sub_assembly = section;
    if (out.unit) out.unit = normalizeUnit(out.unit);
    rows.push(out);
  });

  const at = rows[0]?.source_row ?? firstRowNumber;
  for (const g of unreadCells.values()) {
    const where = g.rows.length === 1 ? clip(g.desc, 30) : `${g.rows.length} rows (${g.rows.slice(0, 4).join(", ")}${g.rows.length > 4 ? "…" : ""})`;
    issues.push({ sheet, row: g.rows[0], kind: "value", message: `${g.label} “${clip(g.text)}” ${g.what} — ${where}` });
  }
  issues.sort((a, b) => a.row - b.row);
  for (const [f, sw] of swapped) {
    if (sw.n) {
      issues.push({
        sheet, row: at, kind: "note",
        message: `${sw.n} ${FIELD_LABEL[f] ?? f} dates were stored by Excel with day and month swapped and have been corrected (${sw.example})`,
      });
    }
  }
  if (etaNotes) {
    issues.push({
      sheet, row: at, kind: "note",
      message: `${etaNotes} ETA cells hold a comment, not a date (“${clip(etaNoteExample, 45)}”) — kept in Remarks, ETA left blank`,
    });
  }
  if (nameFromPartNo) {
    issues.push({
      sheet, row: at, kind: "note",
      message: `${nameFromPartNo} rows have no Description — the Part No. is used as the name`,
    });
  }

  // Fill-down: the Sub-Assembly column is written once per group and left
  // blank underneath. Only when the sheet clearly works that way (each label
  // appears about once, most rows blank) — a template file with a few
  // genuinely unassigned rows is left alone, as is anything exported from
  // the tracker.
  if (hasSubAssyCol && !hasTrackerId) {
    const labelled = rows.filter((_, i) => explicitSubAssy[i]);
    const distinct = new Set(labelled.map((r) => norm(r.sub_assembly!))).size;
    if (labelled.length > 0 && labelled.length <= rows.length / 2 && distinct >= labelled.length * 0.8) {
      let last: string | null = null;
      let filled = 0;
      rows.forEach((r, i) => {
        if (explicitSubAssy[i]) last = r.sub_assembly!;
        else if (last) { r.sub_assembly = last; filled += 1; }
      });
      if (filled) {
        issues.push({
          sheet, row: rows[0].source_row, kind: "note",
          message: `${filled} rows had a blank Sub-Assembly and took the one written above them`,
        });
      }
    }
  }
  return { rows, skipped, issues };
}

// ─── Sheet detection ──────────────────────────────────────────────────

export interface HeaderHit {
  /** 0-based index of the first header row. */
  index: number;
  /** 1, or 2 when the header is split over two rows (group title above, column name below). */
  span: 1 | 2;
  map: Map<number, BomField>;
  /** Header text per column (lower row wins on two-row headers). */
  headers: (string | null)[];
}

const headerCells = (r: unknown[] | undefined) => (r ?? []).map((c) => (typeof c === "string" ? c : null));

/**
 * Finds the header row in the top of a sheet: the row that names the most
 * known columns and includes Description. Title blocks, project info and a
 * coloured "ENGINEERING / PURCHASING" band above it are skipped; a header
 * split over two rows is merged.
 */
export function findHeader(all: unknown[][], scan = 40): HeaderHit | null {
  let best: HeaderHit | null = null;
  const better = (h: HeaderHit) => !best || h.map.size > best.map.size;
  const usable = (m: Map<number, BomField>) => {
    const f = new Set(m.values());
    return f.has("description") && m.size >= 2;
  };
  const limit = Math.min(scan, all.length);
  const singles: Map<number, BomField>[] = [];
  for (let r = 0; r < limit; r++) singles.push(mapHeaders(headerCells(all[r])));

  for (let r = 0; r < limit; r++) {
    if (usable(singles[r]) && better({ index: r, span: 1, map: singles[r], headers: headerCells(all[r]) })) {
      best = { index: r, span: 1, map: singles[r], headers: headerCells(all[r]) };
    }
  }
  // Two-row headers: the lower row is the specific name, the upper fills
  // columns the lower leaves blank. Must add at least two columns over the
  // best single row to be believed.
  for (let r = 0; r + 1 < limit; r++) {
    const lower = headerCells(all[r + 1]);
    const upper = headerCells(all[r]);
    const merged = lower.map((c, i) => c ?? upper[i] ?? null);
    for (let i = lower.length; i < upper.length; i++) merged[i] = upper[i];
    const map = mapHeaders(merged);
    const gain = map.size - Math.max(singles[r].size, singles[r + 1].size);
    if (usable(map) && gain >= 2 && map.size >= (best?.map.size ?? 0) + 2) {
      best = { index: r, span: 2, map, headers: merged };
    }
  }
  return best;
}

export interface RawSheet {
  name: string;
  rows: unknown[][];
  hidden?: boolean;
}

export interface SheetRead {
  name: string;
  /** 1-based row number of the header. */
  headerRow: number;
  rows: ParsedBomRow[];
  skipped: number;
  unknownHeaders: string[];
  issues: ImportIssue[];
  disciplineHint: BomDiscipline | null;
  /** Whether the sheet is ticked by default in the import preview. */
  included: boolean;
  /** Why a sheet is unticked by default. */
  excludedWhy?: string;
}

const DERIVED_SHEET_RE = /customer|summary|progress|dashboard|how\s*to|\blists?\b|revision|\blog\b|legend|cover|pivot|template|sample|example|old|backup|copy/i;
const IGNORED_HEADER_RE = /^(item|items?\s*no\.?|no\.?|s\/?n|#|flags?|module|total)$/i;

/**
 * Sub-assemblies are identified by their drawing code. "MH063-110-00" in one
 * revision of the list and "MH063-110-00 BASE & STRUCTURE" in another are the
 * same sub-assembly.
 */
const SA_CODE_RE = /^[A-Za-z]{1,4}\d{2,4}(-[0-9A-Za-z]{1,4})+/;
export function subAssyKey(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  const m = t.match(SA_CODE_RE);
  return norm(m ? m[0] : t);
}

function sheetDiscipline(name: string): BomDiscipline | null {
  const n = norm(name);
  if (n.includes("mech")) return "mechanical";
  if (n.includes("elec") || n.includes("wiring") || n.includes("control")) return "electrical";
  if (n.includes("pneu")) return "pneumatic";
  if (n.includes("soft") || n.includes("vision")) return "software";
  return null;
}

/**
 * Reads every sheet in a workbook that looks like a BOM. Engineers keep one
 * sheet per discipline as often as one list; both work. Which sheets are
 * ticked by default:
 *  - a sheet named "BOM" (the company template / tracker export) → only that
 *  - otherwise every visible sheet with parts, except ones whose name says
 *    they're derived or stale ("Customer View", "Summary", "old", …)
 */
export function readBomSheets(sheets: RawSheet[]): SheetRead[] {
  const out: SheetRead[] = [];
  for (const sh of sheets) {
    const hit = findHeader(sh.rows);
    if (!hit) continue;
    const first = hit.index + hit.span;
    const body = sh.rows.slice(first).map((r) => r ?? []);
    const { rows, skipped, issues } = parseBomRows(body, hit.map, first + 1, sh.name);
    // An empty sheet is only worth mentioning when it's the template's BOM
    // sheet — so a blank template doesn't fall through to its example row.
    if (rows.length === 0 && norm(sh.name) !== "bom") continue;
    const disciplineHint = sheetDiscipline(sh.name);
    if (disciplineHint) rows.forEach((r) => { if (!r.discipline && !r.discipline_hint) r.discipline_hint = disciplineHint; });
    const unknownHeaders = hit.headers
      .filter((h, i): h is string => !!h && !hit.map.has(i) && !IGNORED_HEADER_RE.test(h.trim()))
      .map((h) => h.replace(/\s+/g, " ").trim());
    out.push({
      name: sh.name, headerRow: hit.index + 1, rows, skipped, unknownHeaders, issues, disciplineHint,
      included: true,
      excludedWhy: sh.hidden ? "hidden sheet" : DERIVED_SHEET_RE.test(sh.name) ? "looks like a summary or old copy" : undefined,
    });
  }
  const main = out.find((s) => norm(s.name) === "bom");
  for (const s of out) {
    if (main) {
      s.included = s === main;
      if (s !== main && !s.excludedWhy) s.excludedWhy = "the BOM sheet is used";
    } else {
      s.included = !s.excludedWhy;
    }
  }
  return out;
}

// ─── Import planning ──────────────────────────────────────────────────

/** Identity used to match a re-imported row when the Row ID can't be used (older lists, or a first upload). */
export function matchKey(r: { sub_assembly?: string | null; part_no?: string | null; description?: string | null }): string {
  const sa = subAssyKey(r.sub_assembly);
  return r.part_no?.trim() ? `${sa}|pn:${norm(r.part_no)}` : `${sa}|d:${norm(r.description ?? "")}`;
}

/**
 * Columns owned by Purchasing and Assembly. People update these in the
 * tracker after the BOM is first uploaded, so an engineer re-uploading
 * their Excel (whose purchasing columns are usually stale or empty) must
 * not roll them back.
 */
export const PROTECTED_FIELDS = [
  "status", "supplier", "pr_no", "po_no", "po_date", "eta", "do_invoice_no", "qty_received", "received_date",
  "qty_issued", "issued_to", "issued_date",
] as const;
const PROTECTED = new Set<string>(PROTECTED_FIELDS);

/** Engineering edits that matter once a part has been ordered — shown as a warning in the import preview. */
export const ORDER_SENSITIVE_FIELDS = ["description", "part_no", "manufacturer", "qty", "multiple", "unit", "make_buy", "drawing_no"] as const;
const ORDER_SENSITIVE = new Set<string>(ORDER_SENSITIVE_FIELDS);

const STATUS_RANK: Record<BomStatus, number> = {
  not_finalized: 0, finalized: 1, nsw_requested: 1, purchased: 2, received: 3, nsw_purchased: 3, cancelled: 9,
};

/**
 * Whether a re-uploaded file may change the Status of a part the tracker
 * already has: it can move it forward (release a design, record an order or a
 * receipt) and cancel a part nobody has ordered. It can never move it back,
 * revive a cancelled part, or cancel something already on order.
 */
export function fileMayChangeStatus(current: BomStatus, fromFile: BomStatus): boolean {
  if (current === fromFile || current === "cancelled") return false;
  if (fromFile === "cancelled") return !ORDERED_STATUSES.includes(current);
  return STATUS_RANK[fromFile] > STATUS_RANK[current];
}

export interface KeptValue {
  id: number;
  field: string;
  fileValue: unknown;
  trackerValue: unknown;
  row: ParsedBomRow;
}

export interface ImportUpdate {
  id: number;
  patch: Partial<BomItem>;
  changed: string[];
  row: ParsedBomRow;
  /** Engineering edits to a part that has already been ordered or received — purchasing should look. */
  orderSensitive: string[];
}

export interface ImportPlan {
  /** Rows to create. A row_id is only left on a row when it's free to use in this project. */
  inserts: ParsedBomRow[];
  updates: ImportUpdate[];
  unchanged: number;
  /** File values ignored because the tracker already holds a newer purchasing/assembly value. */
  kept: KeptValue[];
  /** Rows matched by something other than Row ID or the exact key — worth showing so nobody is surprised. */
  rematched: { id: number; row: ParsedBomRow; how: "part_no_changed" | "moved" }[];
  /** Tracker parts in the sub-assemblies this file covers that the file no longer lists. */
  missing: BomItem[];
  /** The same part listed more than once under one sub-assembly in the file. */
  duplicates: { label: string; rows: number[] }[];
  /**
   * How the file's Row IDs were used. "trusted": they line up with the tracker
   * and rows were matched on them. "mismatch": the tracker's Row IDs belong to
   * different parts (numbered before this file existed), so parts were matched
   * by sub-assembly + part no. instead. "none": nothing to compare.
   */
  rowIds: "trusted" | "mismatch" | "none";
  /** Rows whose file Row ID couldn't be kept because another part in the tracker already holds it. */
  rowIdClashes: number;
}

export interface ImportOptions {
  /** Let the file overwrite purchasing/assembly columns too. Default false. */
  fileWins?: boolean;
  /** Discipline assumed for rows that don't state one (used to scope `missing`). */
  defaultDiscipline?: BomDiscipline;
}

const sameValue = (cur: unknown, v: unknown) => (typeof v === "number" ? cur != null && Number(cur) === v : cur === v);
const isBlank = (v: unknown) => v == null || v === "";
const NEVER_PATCHED = new Set<string>([...ROW_META_KEYS, "row_id", "unit_price"]);

/** Same part, judged loosely: used to check a Row ID match isn't a coincidence of numbering. */
const looksLikeSamePart = (row: ParsedBomRow, e: BomItem) =>
  (!!row.part_no?.trim() && !!e.part_no?.trim() && norm(row.part_no) === norm(e.part_no)) ||
  (!!row.description && norm(row.description) === norm(e.description));

/**
 * Plans an import without touching the database.
 *
 * Matching, in order:
 *  0. Row ID (the template's own column) — but only once the file's
 *     numbering is seen to agree with the tracker's. A tracker BOM that was
 *     numbered before the file existed has R0001… on unrelated parts; in
 *     that case Row IDs are only believed where the part also agrees.
 *  1. Tracker ID column (files exported from the tracker)
 *  2. sub-assembly code + part no. (or description when there's no part
 *     no.). A part listed twice matches two tracker rows, so re-uploading
 *     the same file never grows the BOM.
 *  3. same sub-assembly + description, part no. added or corrected since
 *  4. same part no. under a different sub-assembly — only when it's
 *     unambiguous on both sides
 *
 * For matched rows only non-empty cells are considered — a blank cell in
 * Excel never wipes data someone entered in the tracker. Engineering
 * columns follow the file. Purchasing and assembly columns only fill
 * blanks and status only moves forward, unless `fileWins` is set.
 */
export function planImport(parsed: ParsedBomRow[], existing: BomItem[], opts: ImportOptions = {}): ImportPlan {
  const plan: ImportPlan = {
    inserts: [], updates: [], unchanged: 0, kept: [], rematched: [], missing: [], duplicates: [],
    rowIds: "none", rowIdClashes: 0,
  };
  const sorted = [...existing].sort((a, b) => a.id - b.id);
  const byId = new Map(sorted.map((e) => [e.id, e]));
  const byRowId = new Map<string, BomItem>();
  for (const e of sorted) if (e.row_id) byRowId.set(e.row_id.trim().toUpperCase(), e);
  const claimed = new Set<number>();
  const hits: (BomItem | undefined)[] = new Array(parsed.length).fill(undefined);
  const claim = (i: number, e: BomItem) => { hits[i] = e; claimed.add(e.id); };
  const pool = (keyOf: (e: BomItem) => string | null) => {
    const m = new Map<string, BomItem[]>();
    for (const e of sorted) {
      if (claimed.has(e.id)) continue;
      const k = keyOf(e);
      if (k == null) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  };

  // 0. Row ID
  const idPairs: [number, BomItem][] = [];
  const seenRowIds = new Set<string>();
  parsed.forEach((row, i) => {
    if (!row.row_id || seenRowIds.has(row.row_id)) return; // a copy-pasted row keeps its ID; only the first counts
    seenRowIds.add(row.row_id);
    const e = byRowId.get(row.row_id);
    if (e) idPairs.push([i, e]);
  });
  if (idPairs.length) {
    const agree = idPairs.filter(([i, e]) => looksLikeSamePart(parsed[i], e)).length;
    const trusted = agree >= idPairs.length * 0.6;
    plan.rowIds = trusted ? "trusted" : "mismatch";
    for (const [i, e] of idPairs) {
      if (trusted || looksLikeSamePart(parsed[i], e)) claim(i, e);
    }
  }

  // 1. Tracker ID
  parsed.forEach((row, i) => {
    if (hits[i]) return;
    const e = row.tracker_id != null ? byId.get(row.tracker_id) : undefined;
    if (e && !claimed.has(e.id)) claim(i, e);
  });

  // 2. Exact key, one tracker row per file row
  const exact = pool(matchKey);
  parsed.forEach((row, i) => {
    if (hits[i]) return;
    const e = exact.get(matchKey(row))?.find((x) => !claimed.has(x.id));
    if (e) claim(i, e);
  });

  // 3 & 4. Looser keys, only where exactly one unmatched row on each side shares it.
  const loose = (
    how: "part_no_changed" | "moved",
    rowKey: (r: ParsedBomRow) => string | null,
    itemKey: (e: BomItem) => string | null
  ) => {
    const items = pool(itemKey);
    const rowsByKey = new Map<string, number[]>();
    parsed.forEach((row, i) => {
      if (hits[i]) return;
      const k = rowKey(row);
      if (k == null) return;
      if (!rowsByKey.has(k)) rowsByKey.set(k, []);
      rowsByKey.get(k)!.push(i);
    });
    for (const [k, idxs] of rowsByKey) {
      const cands = items.get(k);
      if (idxs.length !== 1 || !cands || cands.length !== 1) continue;
      claim(idxs[0], cands[0]);
      plan.rematched.push({ id: cands[0].id, row: parsed[idxs[0]], how });
    }
  };
  const descKey = (r: { sub_assembly?: string | null; description?: string | null }) =>
    r.description ? `${subAssyKey(r.sub_assembly)}|${norm(r.description)}` : null;
  loose("part_no_changed", descKey, descKey);
  const pnKey = (r: { part_no?: string | null }) => (r.part_no?.trim() ? norm(r.part_no) : null);
  loose("moved", pnKey, pnKey);

  // Patches
  const insertRowIds = new Set<string>();
  parsed.forEach((row, i) => {
    const hit = hits[i];
    if (!hit) {
      // The database keeps Row IDs unique per project and never changes one.
      // Keep the file's ID on a new part only when nothing else holds it.
      if (row.row_id && (byRowId.has(row.row_id) || insertRowIds.has(row.row_id))) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { row_id, ...rest } = row;
        plan.inserts.push(rest);
        plan.rowIdClashes += 1;
      } else {
        if (row.row_id) insertRowIds.add(row.row_id);
        plan.inserts.push(row);
      }
      return;
    }
    const patch: Partial<BomItem> = {};
    const changed: string[] = [];
    for (const [k, v] of Object.entries(row)) {
      if (NEVER_PATCHED.has(k) || v == null) continue;
      const cur = (hit as unknown as Record<string, unknown>)[k];
      if (sameValue(cur, v)) continue;
      // "MH063-110-00" in the file vs "MH063-110-00 BASE & STRUCTURE" in the
      // tracker: same sub-assembly, and the tracker's name says more.
      if (k === "sub_assembly" && typeof cur === "string" && subAssyKey(cur) === subAssyKey(v as string) && cur.length >= (v as string).length) continue;
      if (!opts.fileWins && PROTECTED.has(k)) {
        const allowed = k === "status" ? fileMayChangeStatus(hit.status, v as BomStatus) : isBlank(cur);
        if (!allowed) {
          plan.kept.push({ id: hit.id, field: k, fileValue: v, trackerValue: cur, row });
          continue;
        }
      }
      (patch as Record<string, unknown>)[k] = v;
      changed.push(k);
    }
    if (changed.length) {
      const orderSensitive = ORDERED_STATUSES.includes(hit.status) ? changed.filter((c) => ORDER_SENSITIVE.has(c)) : [];
      plan.updates.push({ id: hit.id, patch, changed, row, orderSensitive });
    } else plan.unchanged += 1;
  });

  // Parts the file dropped. Scoped to what the file covers, so uploading
  // only the mechanical BOM doesn't flag every electrical part as missing.
  if (parsed.length) {
    const subAssys = new Set(parsed.map((r) => subAssyKey(r.sub_assembly)));
    const disciplines = new Set(
      parsed.map((r) => r.discipline ?? r.discipline_hint ?? opts.defaultDiscipline).filter(Boolean) as BomDiscipline[]
    );
    plan.missing = sorted.filter(
      (e) =>
        !claimed.has(e.id) &&
        e.status !== "cancelled" &&
        subAssys.has(subAssyKey(e.sub_assembly)) &&
        (disciplines.size === 0 || disciplines.has(e.discipline))
    );
  }

  const seen = new Map<string, { label: string; rows: number[] }>();
  for (const row of parsed) {
    const k = `${row.source_sheet ?? ""}|${matchKey(row)}`;
    if (!seen.has(k)) seen.set(k, { label: row.part_no?.trim() || row.description || "", rows: [] });
    seen.get(k)!.rows.push(row.source_row);
  }
  plan.duplicates = [...seen.values()].filter((d) => d.rows.length > 1);

  return plan;
}

const INSERT_TEXT_COLS = [
  "sub_assembly", "part_no", "manufacturer", "category", "drawing_no", "nsw_part_no", "engineer_pic",
  "issue_date", "required_date", "supplier", "pr_no", "po_no", "po_date", "eta", "do_invoice_no",
  "received_date", "issued_to", "issued_date", "remarks",
] as const;
const INSERT_NUM_COLS = ["qty", "qty_received", "qty_issued"] as const;

/**
 * The database row for a new part. Every column is spelled out on every row:
 * a batch insert sends one column list for the whole batch, and a column
 * missing from one row arrives as NULL — not as the column's default — which
 * the required columns (Make / Buy, Unit, Status, Multiple) reject.
 */
export function toInsertPayload(
  row: ParsedBomRow,
  ctx: { projectId: string; stationId: number | null; defaultDiscipline: BomDiscipline; userId: string | null; sortOrder?: number | null }
): Record<string, unknown> {
  const r = row as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {
    project_id: ctx.projectId,
    station_id: ctx.stationId,
    row_id: row.row_id ?? null, // null → the database assigns the next free R####
    description: row.description,
    discipline: row.discipline ?? row.discipline_hint ?? ctx.defaultDiscipline,
    multiple: row.multiple ?? 1,
    unit: row.unit ?? "Pcs",
    make_buy: row.make_buy ?? "buy",
    status: row.status ?? "not_finalized",
    sort_order: ctx.sortOrder ?? null,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  };
  for (const k of INSERT_TEXT_COLS) out[k] = r[k] ?? null;
  for (const k of INSERT_NUM_COLS) out[k] = r[k] ?? null;
  return out;
}

/**
 * Order to send new rows in: those bringing their own Row ID first. The
 * database numbers a row without one as "highest so far + 1", so sending such
 * a row early could hand it an ID that a later row in the same file carries.
 * (Display order is unaffected — that follows sort_order.)
 */
export function insertOrder<T extends { row_id?: unknown }>(payloads: T[]): T[] {
  return [...payloads.filter((p) => p.row_id), ...payloads.filter((p) => !p.row_id)];
}

/** Best-guess station for a sub-assembly name, by shared words. */
export function guessStation(subAssembly: string, stations: StationRow[]): number | null {
  const words = (s: string) =>
    new Set(s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
  const sa = words(subAssembly);
  let best: { id: number; score: number } | null = null;
  for (const st of stations) {
    const sw = words(st.name);
    let score = 0;
    sa.forEach((w) => {
      if ([...sw].some((x) => x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))) score += 1;
    });
    if (score > 0 && (!best || score > best.score)) best = { id: st.id, score };
  }
  return best?.id ?? null;
}
