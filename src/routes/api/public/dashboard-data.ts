/**
 * Live dashboard data pipeline — fetches the Greko workbook from Vercel Blob,
 * parses it with SheetJS on the server, applies the Power-BI DAX business
 * rules, and returns a compact JSON payload the browser dashboard renders.
 *
 *   Workbook (single source of truth) →  fetch  →  SheetJS parse
 *     →  DAX aggregation (Sales, Returns, Targets, per period/category/channel/customer)
 *     →  60-second in-memory cache  →  JSON response
 *
 * Replacing the .xlsx in Vercel Blob automatically flows through — no code
 * change, no manual export.
 */
import { createFileRoute } from "@tanstack/react-router";
import * as XLSX from "xlsx";

const WORKBOOK_URL =
  "https://kpvezuvifxoatyen.public.blob.vercel-storage.com/New%20Microsoft%20Excel%20Worksheet.xlsx";

const CACHE_TTL_MS = 60_000;
let cache: { at: number; payload: unknown } | null = null;

// Arabic → month index (1..12) used by both Forecast sheets.
const AR_MONTHS: Record<string, number> = {
  "يناير": 1, "فبراير": 2, "مارس": 3, "أبريل": 4, "مايو": 5, "يونيو": 6,
  "يوليو": 7, "أغسطس": 8, "سبتمبر": 9, "أكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12,
};
const MONTH_NAMES = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

type Unit = "ton" | "carton" | "gross";
// Power-BI DAX calc order for 2026 (Sales table):
//   pr26  = Σ |v| where LEFT(UPPER(Invoice lines/Reference),1) = "R"   (Partial Returns)
//   rinv26 = Σ v where Invoice lines/Number Type = "RINV"              (signed)
//   sum26  = Σ v over all rows                                          (signed)
//   r26    = | rinv26 - pr26 |
//   s26    = sum26 - pr26 - r26
// s26/r26 are derived after aggregation — NEVER accumulated directly.
type Bucket = {
  s25:number; s26:number; r25:number; r26:number; tgt25:number; tgt26:number;
  sum26:number; pr26:number; rinv26:number;
};
type UnitBuckets = Record<Unit, Bucket>;

const emptyBucket = (): Bucket => ({ s25:0, s26:0, r25:0, r26:0, tgt25:0, tgt26:0, sum26:0, pr26:0, rinv26:0 });
const emptyUnits  = (): UnitBuckets => ({ ton:emptyBucket(), carton:emptyBucket(), gross:emptyBucket() });

// Derive s26/r26 from raw component sums per the DAX order above.
function derive26(b: UnitBuckets) {
  (["ton","carton","gross"] as Unit[]).forEach(u => {
    const x = b[u];
    x.r26 = Math.abs(x.rinv26 - x.pr26);
    x.s26 = x.sum26 - x.pr26 - x.r26;
  });
}

// Robust date-parser — Actual 25 uses Excel serial numbers; Actual 2026 sometimes
// has a full text "Wednesday, June 24, 2026" in Delivery Date instead of Date.
function excelSerialToDate(n: number): Date | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  // Excel's day 1 is 1900-01-01, with a fake leap-day. Standard offset: 25569.
  return new Date(Math.round((n - 25569) * 86400_000));
}
function coerceDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return excelSerialToDate(v);
  if (typeof v === "string") {
    const t = Date.parse(v);
    return isNaN(t) ? null : new Date(t);
  }
  return null;
}
const monthOf = (d: Date | null): number | null => (d ? d.getUTCMonth() + 1 : null);
const yearOf  = (d: Date | null): number | null => (d ? d.getUTCFullYear() : null);

const num = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

// Aggregate helpers -----------------------------------------------------------
function addSales(b: UnitBuckets, year: 25, ton: number, carton: number, gross: number) {
  b.ton.s25    += ton;
  b.carton.s25 += carton;
  b.gross.s25  += gross;
}
function addReturn(b: UnitBuckets, year: 25, ton: number, carton: number, gross: number) {
  b.ton.r25    += Math.abs(ton);
  b.carton.r25 += Math.abs(carton);
  b.gross.r25  += Math.abs(gross);
}
// 2026 raw-component adder — feeds sum26/pr26/rinv26; s26/r26 derived later.
function add26Row(
  b: UnitBuckets,
  ton: number, carton: number, gross: number,
  isRINV: boolean, isPartialReturn: boolean,
) {
  b.ton.sum26    += ton;    b.carton.sum26 += carton; b.gross.sum26  += gross;
  if (isRINV) {
    b.ton.rinv26 += ton;    b.carton.rinv26 += carton; b.gross.rinv26 += gross;
  }
  if (isPartialReturn) {
    b.ton.pr26    += Math.abs(ton);
    b.carton.pr26 += Math.abs(carton);
    b.gross.pr26  += Math.abs(gross);
  }
}
function addTarget(b: UnitBuckets, year: 25 | 26, ton: number, carton: number) {
  const k = year === 25 ? "tgt25" : "tgt26";
  b.ton[k]    += ton;
  b.carton[k] += carton;
  // Gross target is not defined in the workbook.
}

// ────────────────────────────────────────────────────────────────────────────
// Core aggregation
// ────────────────────────────────────────────────────────────────────────────
async function buildPayload() {
  const t0 = Date.now();
  const res = await fetch(WORKBOOK_URL, { cf: { cacheEverything: false } } as RequestInit);
  if (!res.ok) throw new Error(`Workbook fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: false });
  console.log("[dashboard-data] SheetNames:", JSON.stringify(wb.SheetNames), "Sheets keys:", JSON.stringify(Object.keys(wb.Sheets)));

  // Robust lookup: SheetNames array is authoritative; some SheetJS builds keep
  // Sheets as a Proxy where keys(...) doesn't enumerate. Match by trimmed name.
  const sheetIndex: Record<string, XLSX.WorkSheet> = {};
  for (const nm of wb.SheetNames) {
    const ws = wb.Sheets[nm];
    if (ws) sheetIndex[nm.trim()] = ws;
  }
  const missingSheets: string[] = [];
  const sheet = (name: string) => {
    const ws = sheetIndex[name.trim()];
    if (!ws) {
      // Preview (Cloudflare Worker, ~128 MB) can silently drop the largest
      // sheet during SheetJS parse — it appears in SheetNames but Sheets[nm]
      // is undefined. On Vercel (Node runtime, ~1 GB) all sheets parse fine.
      // Rather than 500 in preview, treat as empty and continue.
      console.warn(`[dashboard-data] Sheet "${name}" not materialised (likely preview memory limit). Treating as empty.`);
      missingSheets.push(name);
      return [] as Record<string, unknown>[];
    }
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true });
  };

  const mainData   = sheet("Main Data");
  const forecast25 = sheet("Forecast 25");
  const forecast26 = sheet("Forecast 26");
  const actual25   = sheet("Actual 25");
  const actual26   = sheet("Actual 2026");
  const customers  = sheet("Customers");

  // Lookups: Code → Category / Product name / Weight
  const codeCategory = new Map<string, string>();
  const codeProduct  = new Map<string, string>();
  for (const r of mainData) {
    const code = String(r["Code"] ?? "").trim();
    if (!code) continue;
    codeCategory.set(code, String(r["Product Category"] ?? "").trim() || "Uncategorized");
    codeProduct.set(code, String(r["Invoice lines/Product"] ?? "").trim());
  }
  // Customer → channel fallback for 2026 rows without Channel
  const custChannel = new Map<string, string>();
  for (const r of customers) {
    const c = String(r["Customers"] ?? "").trim();
    const ch = String(r["Channel"] ?? "").trim();
    if (c && ch) custChannel.set(c, ch);
  }

  // ── Targets — Forecast 25 & 26 (Arabic month columns × Ton|Carton) ──
  // Structure: totals[year][month] = {ton, carton}, plus by-category and by-code.
  const targetTotals: Record<25|26, Array<{ton:number; carton:number}>> = {
    25: Array.from({length:12}, ()=>({ton:0,carton:0})),
    26: Array.from({length:12}, ()=>({ton:0,carton:0})),
  };
  const targetByCat: Record<25|26, Map<string, Array<{ton:number; carton:number}>>> = {
    25: new Map(), 26: new Map(),
  };
  const targetByCode: Record<25|26, Map<string, Array<{ton:number; carton:number}>>> = {
    25: new Map(), 26: new Map(),
  };

  function readForecast(rows: Record<string,unknown>[], year: 25|26) {
    if (rows.length === 0) return;
    // Detect month columns: keys contain an Arabic month name + a "طن" (ton) or "كراتين"/"كرتون" (carton) marker.
    const cols = Object.keys(rows[0]);
    const monthCols: Array<{key:string; month:number; kind:"ton"|"carton"}> = [];
    for (const k of cols) {
      const parts = k.trim().split(/\s+/);
      const monthName = parts.find(p => AR_MONTHS[p] != null);
      if (!monthName) continue;
      const kind: "ton"|"carton" = k.includes("طن") ? "ton" : (k.includes("كراتين") || k.includes("كرتون")) ? "carton" : (() => { throw new Error("unknown forecast unit: "+k); })();
      monthCols.push({ key:k, month: AR_MONTHS[monthName], kind });
    }
    for (const r of rows) {
      const code = String(r["Code"] ?? "").trim();
      if (!code) continue;
      const catFromRow = String(r["Product Category"] ?? "").trim();
      const cat = catFromRow || codeCategory.get(code) || "Uncategorized";
      const codeArr = targetByCode[year].get(code) ?? Array.from({length:12},()=>({ton:0,carton:0}));
      const catArr  = targetByCat[year].get(cat)   ?? Array.from({length:12},()=>({ton:0,carton:0}));
      for (const mc of monthCols) {
        const v = num(r[mc.key]);
        codeArr[mc.month-1][mc.kind] += v;
        catArr[mc.month-1][mc.kind]  += v;
        targetTotals[year][mc.month-1][mc.kind] += v;
      }
      targetByCode[year].set(code, codeArr);
      targetByCat[year].set(cat, catArr);
    }
  }
  readForecast(forecast25, 25);
  readForecast(forecast26, 26);

  // ── Aggregation containers ── every axis stores per-month buckets so the
  // client can filter globally by any period (YTD / Q1 / Q2 / single month).
  const byMonth: Array<UnitBuckets> = Array.from({length:12}, emptyUnits);
  const byCategoryMonth = new Map<string, Array<UnitBuckets>>();
  const byChannelMonth  = new Map<string, Array<UnitBuckets>>();
  const byProduct  = new Map<string, { name:string; category:string; months: UnitBuckets[] }>();
  const byCustomer = new Map<string, { partner:string; channel:string; months: UnitBuckets[] }>();
  // Customer × SKU per-month components (mirrors byProduct structure).
  type SkuComp = { s25:number; r25:number; sum26:number; pr26:number; rinv26:number };
  const emptySku = (): SkuComp => ({ s25:0, r25:0, sum26:0, pr26:0, rinv26:0 });
  const custSkuMonth = new Map<string, Map<string, SkuComp[]>>(); // partner → product → [12]

  function ensureCatMonth(cat:string){ let a = byCategoryMonth.get(cat); if(!a){ a = Array.from({length:12}, emptyUnits); byCategoryMonth.set(cat, a);} return a; }
  function ensureChannelMonth(ch:string){ let a = byChannelMonth.get(ch); if(!a){ a = Array.from({length:12}, emptyUnits); byChannelMonth.set(ch, a);} return a; }
  function ensureProduct(code:string, name:string, cat:string){ let p = byProduct.get(code); if(!p){ p = { name, category: cat, months: Array.from({length:12}, emptyUnits) }; byProduct.set(code, p);} return p; }
  function ensureCustomer(key:string, partner:string, channel:string){ let c = byCustomer.get(key); if(!c){ c = { partner, channel, months: Array.from({length:12}, emptyUnits) }; byCustomer.set(key, c);} return c; }
  function ensureCustSku(partner:string, product:string): SkuComp[] {
    let m = custSkuMonth.get(partner);
    if(!m){ m = new Map(); custSkuMonth.set(partner, m); }
    let arr = m.get(product);
    if(!arr){ arr = Array.from({length:12}, emptySku); m.set(product, arr); }
    return arr;
  }


  // ── Actual 25 — pre-calculated Sales/Return columns; filter by Delivery Date.
  let max25 = 0;
  const customerSet25 = new Set<string>();
  for (const r of actual25) {
    const d = coerceDate(r["Delivery Date"]) ?? coerceDate(r["Date"]);
    const dMonth = monthOf(d);
    const dYear  = yearOf(d);
    // Prefer Delivery Date; fall back to Month ID only when the row has no date.
    const month = (dYear === 2025 && dMonth) ? dMonth : num(r["Month ID"]);
    if (!month || month < 1 || month > 12) continue;
    if (dYear && dYear !== 2025) continue;
    if (month > 6) continue; // validation window: Jan..Jun
    if (month > max25) max25 = month;
    const cat = String(r["Product Category"] ?? "").trim() || "Uncategorized";
    const code = String(r["Code"] ?? "").trim();
    const product = String(r["Invoice lines/Product"] ?? "").trim() || codeProduct.get(code) || code;
    const partnerRaw = String(r["Partner"] ?? "").trim() || String(r["Invoice Partner Display Name"] ?? "").trim();
    const channel = String(r["channel"] ?? "").trim() || custChannel.get(partnerRaw) || "Other";
    const type = String(r["Type"] ?? "").trim();

    // Actual 25 raw-column reality (verified against workbook + Power BI PDF):
    //   `Sales -Ton` is essentially empty (37 non-zero rows out of 409k).
    //   Authoritative Ton value lives in the signed `Ton` column, split by the
    //   `Type` column: 'Sales' | 'Return' | 'P.Return'.
    //   Power BI DAX (matches PDF for YTD/Q1/Q2/Jan/Feb/Mar exactly):
    //     Sales 2025   = Σ(Ton where Type='Sales') − Σ|Ton where Type='P.Return'|
    //     Returns 2025 = Σ|Ton where Type='Return'|
    //   Partial Returns net against Sales, NOT against Returns — exactly the
    //   same rule the 2026 sheet applies via `s26 = sum26 − pr26 − r26`.
    const tonRaw = num(r["Ton"]);
    const carRaw = num(r["Sales - Carton"]); // signed by type in the sheet
    const grossRaw = num(r["Amount"]);       // signed by type in the sheet
    const isSalesRow    = type === "Sales";
    const isReturnRow   = type === "Return";
    const isPartialRet  = type === "P.Return";

    // Sales = Sales rows minus |Partial Returns|.
    const sTon   = isSalesRow ? tonRaw   : (isPartialRet ? -Math.abs(tonRaw)   : 0);
    const sCar   = isSalesRow ? carRaw   : (isPartialRet ? -Math.abs(carRaw)   : 0);
    const sGross = isSalesRow ? grossRaw : (isPartialRet ? -Math.abs(grossRaw) : 0);
    // Returns = Return rows ONLY (P.Return excluded).
    const rTonSrc   = isReturnRow ? tonRaw : 0;
    const rCarSrc   = isReturnRow ? (num(r["Return - Carton"]) || carRaw) : 0;
    const rGrossSrc = isReturnRow ? grossRaw : 0;


    if ((isSalesRow || isPartialRet) && (sTon || sCar || sGross)) {
      addSales(byMonth[month-1], 25, sTon, sCar, sGross);
      addSales(ensureCatMonth(cat)[month-1], 25, sTon, sCar, sGross);
      addSales(ensureChannelMonth(channel)[month-1], 25, sTon, sCar, sGross);
      if (code) addSales(ensureProduct(code, product, cat).months[month-1], 25, sTon, sCar, sGross);
      if (partnerRaw) {
        addSales(ensureCustomer(partnerRaw, partnerRaw, channel).months[month-1], 25, sTon, sCar, sGross);
        if (product && sTon !== 0) {
          const arr = ensureCustSku(partnerRaw, product);
          arr[month-1].s25 += sTon;
        }
      }
      customerSet25.add(partnerRaw);
    }
    if (isReturnRow && (rTonSrc || rCarSrc || rGrossSrc)) {
      addReturn(byMonth[month-1], 25, rTonSrc, rCarSrc, rGrossSrc);
      addReturn(ensureCatMonth(cat)[month-1], 25, rTonSrc, rCarSrc, rGrossSrc);
      addReturn(ensureChannelMonth(channel)[month-1], 25, rTonSrc, rCarSrc, rGrossSrc);
      if (code) addReturn(ensureProduct(code, product, cat).months[month-1], 25, rTonSrc, rCarSrc, rGrossSrc);
      if (partnerRaw) {
        addReturn(ensureCustomer(partnerRaw, partnerRaw, channel).months[month-1], 25, rTonSrc, rCarSrc, rGrossSrc);
        if (product && Math.abs(rTonSrc) > 0) {
          const arr = ensureCustSku(partnerRaw, product);
          arr[month-1].r25 += Math.abs(rTonSrc);
        }
      }
    }
  }


  // ── Actual 2026 — Power BI DAX calc order (Sales table) ──
  // Every row contributes to sum26 (Σ Num Ton). Rows where
  // LEFT(UPPER(Invoice lines/Reference),1) = "R" are Partial Returns (pr26).
  // Rows where Number Type = "RINV" contribute to rinv26. Sales/Returns are
  // derived after aggregation. Filter: Delivery Date, year = 2026.
  let max26 = 0;
  const customerSet26 = new Set<string>();
  for (const r of actual26) {
    const d = coerceDate(r["Delivery Date"]) ?? coerceDate(r["Date"]);
    const month = monthOf(d);
    const year  = yearOf(d);
    if (!month || year !== 2026) continue;
    if (month > 6) continue; // validation window: Jan..Jun
    if (month > max26) max26 = month;

    const numberType = String(r["Invoice lines/Number Type"] ?? "").trim().toUpperCase();
    const reference  = String(r["Invoice lines/Reference"] ?? "").trim();
    const isRINV = numberType === "RINV";
    const isPR   = reference.length > 0 && reference[0].toUpperCase() === "R";

    const code = String(r["Code"] ?? "").trim();
    const cat  = codeCategory.get(code) || "Uncategorized";
    const product = String(r["Invoice lines/Product"] ?? "").trim() || codeProduct.get(code) || code;
    const partnerRaw = String(r["Invoice Partner Display Name"] ?? "").trim() || String(r["Invoice lines/Partner"] ?? "").trim();
    const channel = String(r["Channel"] ?? "").trim() || custChannel.get(partnerRaw) || "Other";

    const ton   = num(r["Num Ton"]);
    const carton= num(r["Num Carton"]);
    const gross = num(r["Invoice lines/Amount in Currency"]);
    if (!ton && !carton && !gross) continue;

    const targets: UnitBuckets[] = [
      byMonth[month-1],
      ensureCatMonth(cat)[month-1],
      ensureChannelMonth(channel)[month-1],
    ];
    if (code) targets.push(ensureProduct(code, product, cat).months[month-1]);
    if (partnerRaw) {
      targets.push(ensureCustomer(partnerRaw, partnerRaw, channel).months[month-1]);
      customerSet26.add(partnerRaw);
      if (product) {
        const arr = ensureCustSku(partnerRaw, product);
        const c = arr[month-1];
        c.sum26 += ton;
        if (isRINV) c.rinv26 += ton;
        if (isPR)   c.pr26   += Math.abs(ton);
      }
    }
    for (const b of targets) add26Row(b, ton, carton, gross, isRINV, isPR);
  }



  // ── Populate Target buckets on all aggregations (per-month × unit) ──
  for (let mi = 0; mi < 12; mi++) {
    addTarget(byMonth[mi], 25, targetTotals[25][mi].ton, targetTotals[25][mi].carton);
    addTarget(byMonth[mi], 26, targetTotals[26][mi].ton, targetTotals[26][mi].carton);
  }
  for (const [cat, arr] of byCategoryMonth) {
    const tgt25 = targetByCat[25].get(cat);
    const tgt26 = targetByCat[26].get(cat);
    for (let mi = 0; mi < 12; mi++) {
      if (tgt25) addTarget(arr[mi], 25, tgt25[mi].ton, tgt25[mi].carton);
      if (tgt26) addTarget(arr[mi], 26, tgt26[mi].ton, tgt26[mi].carton);
    }
  }
  for (const [code, p] of byProduct) {
    const t25 = targetByCode[25].get(code);
    const t26 = targetByCode[26].get(code);
    for (let mi = 0; mi < 12; mi++) {
      if (t25) addTarget(p.months[mi], 25, t25[mi].ton, t25[mi].carton);
      if (t26) addTarget(p.months[mi], 26, t26[mi].ton, t26[mi].carton);
    }
  }


  // ── Equivalent-period aggregation ──
  // Validation window: Jan..Jun in BOTH years (per Power BI PDF reference).
  // Cap by whatever the latest actual month is in 2026 (in case only Jan..May exists).
  const maxMonth26 = max26 || 12;
  const maxMonth25 = max25 || 12;
  const VALIDATION_CAP = 6; // June
  const ytdRange = Math.min(maxMonth26 || VALIDATION_CAP, VALIDATION_CAP);

  // Sum linear component fields across months, then derive s26/r26 per DAX.
  const COMP_KEYS: Array<keyof Bucket> = ["s25","r25","tgt25","tgt26","sum26","pr26","rinv26"];
  const sumRange = (arr: UnitBuckets[], months: number[]): UnitBuckets => {
    const out = emptyUnits();
    for (const m of months) {
      const src = arr[m-1];
      (["ton","carton","gross"] as Unit[]).forEach(u => {
        for (const k of COMP_KEYS) out[u][k] += src[u][k];
      });
    }
    derive26(out);
    return out;
  };

  const ytdMonths = Array.from({length: ytdRange}, (_, i)=> i+1);
  const totalsYTD = sumRange(byMonth, ytdMonths);

  // Category YTD rollup (only categories with any activity)
  const categoryData: Array<{ category:string; ton:Bucket; carton:Bucket; gross:Bucket }> = [];
  for (const [cat, arr] of byCategoryMonth) {
    const u = sumRange(arr, ytdMonths);
    if (u.ton.s25 || u.ton.s26 || u.ton.r25 || u.ton.r26)
      categoryData.push({ category: cat, ton: u.ton, carton: u.carton, gross: u.gross });
  }
  categoryData.sort((a,b) => (b.ton.s26 + b.ton.s25) - (a.ton.s26 + a.ton.s25));

  // Product / Customer — emit per-month buckets so the client can filter
  // globally by any period. Derive s26/r26 per month before serialising.
  const trimMonths = (arr: UnitBuckets[]) =>
    arr.slice(0, 12).map(u => { derive26(u); return { ton:u.ton, carton:u.carton, gross:u.gross }; });

  const productData = [...byProduct.entries()].map(([code, p]) => ({
    code, product: p.name, category: p.category,
    monthly: trimMonths(p.months),
  }));

  const customerData = [...byCustomer.entries()].map(([key, c]) => ({
    partner: c.partner, channel: c.channel,
    monthly: trimMonths(c.months),
  }));

  // Customer × SKU per-month components → client derives per-period top SKU.
  const customerSkuMonthly: Array<{
    partner: string;
    skus: Array<{ product: string; monthly: SkuComp[] }>;
  }> = [];
  for (const [partner, m] of custSkuMonth) {
    const skus: Array<{ product: string; monthly: SkuComp[] }> = [];
    for (const [product, arr] of m) skus.push({ product, monthly: arr });
    customerSkuMonthly.push({ partner, skus });
  }


  // Channel YTD rollup
  const channelData: Array<{ channel:string; ton:Bucket; carton:Bucket; gross:Bucket }> = [];
  for (const [ch, arr] of byChannelMonth) {
    const u = sumRange(arr, ytdMonths);
    if (u.ton.s25 || u.ton.s26 || u.ton.r25 || u.ton.r26)
      channelData.push({ channel: ch, ton: u.ton, carton: u.carton, gross: u.gross });
  }
  channelData.sort((a,b) => b.ton.s26 - a.ton.s26);

  // Monthly trend (derive per-month s26/r26 before serializing)
  for (const u of byMonth) derive26(u);
  const monthlyData = byMonth.map((u, i) => ({
    month_id: i+1,
    month_name: MONTH_NAMES[i],
    month_short: MONTH_SHORT[i],
    in_ytd: (i+1) <= ytdRange,
    ton: u.ton, carton: u.carton, gross: u.gross,
  }));



  const payload = {
    meta: {
      ytd_label: `Jan-${MONTH_SHORT[ytdRange-1]} 25 vs Jan-${MONTH_SHORT[ytdRange-1]} 26`,
      max_month_25: maxMonth25,
      max_month_26: maxMonth26,
      ytd_range: ytdRange,
      ton: totalsYTD.ton,
      carton: totalsYTD.carton,
      gross: totalsYTD.gross,
      customers_25: customerSet25.size,
      customers_26: customerSet26.size,
      generated_at: new Date().toISOString(),
      source: "vercel-blob:xlsx",
      missing_sheets: missingSheets,
      build_ms: 0, // filled below
    },
    product_data: productData,
    customer_data: customerData,
    category_data: categoryData,
    monthly_data: monthlyData,
    channel_data: channelData,
    customer_top_sku: customerTopSku,
  };
  payload.meta.build_ms = Date.now() - t0;
  return payload;
}

export const Route = createFileRoute("/api/public/dashboard-data")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const now = Date.now();
          if (cache && now - cache.at < CACHE_TTL_MS) {
            return Response.json(cache.payload, {
              headers: { "cache-control": "public, max-age=30", "x-cache": "HIT" },
            });
          }
          const payload = await buildPayload();
          cache = { at: now, payload };
          return Response.json(payload, {
            headers: { "cache-control": "public, max-age=30", "x-cache": "MISS" },
          });
        } catch (err) {
          console.error("[dashboard-data] failed:", err);
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
