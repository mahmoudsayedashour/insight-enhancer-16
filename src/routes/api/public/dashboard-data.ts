/**
 * Live dashboard data pipeline — fetches the Greko workbook from Vercel Blob,
 * parses it with SheetJS on the server, applies the SHARED Power-BI DAX
 * business rules identically to Actual 25 and Actual 2026, and returns a
 * compact JSON payload the browser dashboard renders.
 *
 *   Workbook (single source of truth) →  fetch  →  SheetJS parse
 *     →  ONE shared aggregation pipeline (both years, identical logic)
 *     →  60-second in-memory cache  →  JSON response
 *
 * Business rules (applied identically to Ton / Carton / Gross for BOTH years):
 *   Partial Returns  = Σ |value|   where LEFT(UPPER(Invoice lines/Reference),1) = "R"
 *   RINV total       = Σ  value    where Invoice lines/Number Type = "RINV"
 *   Total            = Σ  value    over all rows
 *   Returns          = | RINV total − Partial Returns |
 *   Sales            = Total − Partial Returns − Returns
 *
 * Filtering: Delivery Date determines month + year (25 vs 26). No year-specific
 * code paths. No manual adjustments. Vercel Blob workbook = only source.
 */
import { createFileRoute } from "@tanstack/react-router";
import * as XLSX from "xlsx";

const WORKBOOK_URL =
  "https://kpvezuvifxoatyen.public.blob.vercel-storage.com/New%20Microsoft%20Excel%20Worksheet.xlsx";

const CACHE_TTL_MS = 60_000;
let cache: { at: number; payload: unknown } | null = null;

const AR_MONTHS: Record<string, number> = {
  "يناير": 1, "فبراير": 2, "مارس": 3, "أبريل": 4, "مايو": 5, "يونيو": 6,
  "يوليو": 7, "أغسطس": 8, "سبتمبر": 9, "أكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12,
};
const MONTH_NAMES = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

type Unit = "ton" | "carton" | "gross";
// Raw components stored per year; s/r are DERIVED after aggregation.
type Bucket = {
  s25:number; s26:number; r25:number; r26:number;
  tgt25:number; tgt26:number;
  sum25:number; pr25:number; rinv25:number;
  sum26:number; pr26:number; rinv26:number;
};
type UnitBuckets = Record<Unit, Bucket>;

const emptyBucket = (): Bucket => ({
  s25:0, s26:0, r25:0, r26:0, tgt25:0, tgt26:0,
  sum25:0, pr25:0, rinv25:0, sum26:0, pr26:0, rinv26:0,
});
const emptyUnits = (): UnitBuckets => ({ ton:emptyBucket(), carton:emptyBucket(), gross:emptyBucket() });

// Derive s25/r25 and s26/r26 from raw components per the shared DAX order.
function deriveAll(b: UnitBuckets) {
  (["ton","carton","gross"] as Unit[]).forEach(u => {
    const x = b[u];
    x.r25 = Math.abs(x.rinv25 - x.pr25);
    x.s25 = x.sum25 - x.pr25 - x.r25;
    x.r26 = Math.abs(x.rinv26 - x.pr26);
    x.s26 = x.sum26 - x.pr26 - x.r26;
  });
}

// Date coercion — Excel serial or textual date string.
function excelSerialToDate(n: number): Date | null {
  if (!Number.isFinite(n) || n <= 0) return null;
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

// Add a raw-component contribution to a UnitBuckets slot (year-scoped).
function addRow(
  b: UnitBuckets,
  year: 25 | 26,
  ton: number, carton: number, gross: number,
  isRINV: boolean, isPartialReturn: boolean,
) {
  const sumK  = year === 25 ? "sum25"  : "sum26";
  const prK   = year === 25 ? "pr25"   : "pr26";
  const rinvK = year === 25 ? "rinv25" : "rinv26";
  b.ton[sumK]    += ton;
  b.carton[sumK] += carton;
  b.gross[sumK]  += gross;
  if (isRINV) {
    b.ton[rinvK]    += ton;
    b.carton[rinvK] += carton;
    b.gross[rinvK]  += gross;
  }
  if (isPartialReturn) {
    b.ton[prK]    += Math.abs(ton);
    b.carton[prK] += Math.abs(carton);
    b.gross[prK]  += Math.abs(gross);
  }
}
function addTarget(b: UnitBuckets, year: 25 | 26, ton: number, carton: number) {
  const k = year === 25 ? "tgt25" : "tgt26";
  b.ton[k]    += ton;
  b.carton[k] += carton;
}

// ────────────────────────────────────────────────────────────────────────────
async function buildPayload() {
  const t0 = Date.now();
  const res = await fetch(WORKBOOK_URL, { cf: { cacheEverything: false } } as RequestInit);
  if (!res.ok) throw new Error(`Workbook fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: false });

  const sheetIndex: Record<string, XLSX.WorkSheet> = {};
  for (const nm of wb.SheetNames) {
    const ws = wb.Sheets[nm];
    if (ws) sheetIndex[nm.trim()] = ws;
  }
  const missingSheets: string[] = [];
  const sheet = (name: string) => {
    const ws = sheetIndex[name.trim()];
    if (!ws) {
      console.warn(`[dashboard-data] Sheet "${name}" not materialised. Treating as empty.`);
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

  // Lookups
  const codeCategory = new Map<string, string>();
  const codeProduct  = new Map<string, string>();
  for (const r of mainData) {
    const code = String(r["Code"] ?? "").trim();
    if (!code) continue;
    codeCategory.set(code, String(r["Product Category"] ?? "").trim() || "Uncategorized");
    codeProduct.set(code, String(r["Invoice lines/Product"] ?? "").trim());
  }
  const custChannel = new Map<string, string>();
  for (const r of customers) {
    const c = String(r["Customers"] ?? "").trim();
    const ch = String(r["Channel"] ?? "").trim();
    if (c && ch) custChannel.set(c, ch);
  }

  // Forecast targets
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
    const cols = Object.keys(rows[0]);
    const monthCols: Array<{key:string; month:number; kind:"ton"|"carton"}> = [];
    for (const k of cols) {
      const parts = k.trim().split(/\s+/);
      const monthName = parts.find(p => AR_MONTHS[p] != null);
      if (!monthName) continue;
      const kind: "ton"|"carton" = k.includes("طن") ? "ton"
        : (k.includes("كراتين") || k.includes("كرتون")) ? "carton"
        : (() => { throw new Error("unknown forecast unit: "+k); })();
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

  // Aggregation containers
  const byMonth: Array<UnitBuckets> = Array.from({length:12}, emptyUnits);
  const byCategoryMonth = new Map<string, Array<UnitBuckets>>();
  const byChannelMonth  = new Map<string, Array<UnitBuckets>>();
  const byProduct  = new Map<string, { name:string; category:string; months: UnitBuckets[] }>();
  const byCustomer = new Map<string, { partner:string; channel:string; months: UnitBuckets[] }>();
  // Customer × SKU per-month components (raw components — client derives).
  type SkuComp = { sum25:number; pr25:number; rinv25:number; sum26:number; pr26:number; rinv26:number };
  const emptySku = (): SkuComp => ({ sum25:0, pr25:0, rinv25:0, sum26:0, pr26:0, rinv26:0 });
  const custSkuMonth = new Map<string, Map<string, SkuComp[]>>();

  const ensureCatMonth = (cat:string) => { let a = byCategoryMonth.get(cat); if(!a){ a = Array.from({length:12}, emptyUnits); byCategoryMonth.set(cat, a);} return a; };
  const ensureChannelMonth = (ch:string) => { let a = byChannelMonth.get(ch); if(!a){ a = Array.from({length:12}, emptyUnits); byChannelMonth.set(ch, a);} return a; };
  const ensureProduct = (code:string, name:string, cat:string) => { let p = byProduct.get(code); if(!p){ p = { name, category: cat, months: Array.from({length:12}, emptyUnits) }; byProduct.set(code, p);} return p; };
  const ensureCustomer = (key:string, partner:string, channel:string) => { let c = byCustomer.get(key); if(!c){ c = { partner, channel, months: Array.from({length:12}, emptyUnits) }; byCustomer.set(key, c);} return c; };
  const ensureCustSku = (partner:string, product:string): SkuComp[] => {
    let m = custSkuMonth.get(partner);
    if(!m){ m = new Map(); custSkuMonth.set(partner, m); }
    let arr = m.get(product);
    if(!arr){ arr = Array.from({length:12}, emptySku); m.set(product, arr); }
    return arr;
  };

  // ── SHARED processor — same code, same DAX, both sheets ─────────────────
  const customerSet: Record<25|26, Set<string>> = { 25: new Set(), 26: new Set() };
  const maxMonth: Record<25|26, number> = { 25: 0, 26: 0 };
  const VALIDATION_CAP = 6; // Jan..Jun window

  function processSheet(rows: Record<string, unknown>[]) {
    for (const r of rows) {
      const d = coerceDate(r["Delivery Date"]);
      const month = monthOf(d);
      const year  = yearOf(d);
      if (!month || (year !== 2025 && year !== 2026)) continue;
      if (month > VALIDATION_CAP) continue;
      const y: 25 | 26 = year === 2025 ? 25 : 26;
      if (month > maxMonth[y]) maxMonth[y] = month;

      const numberType = String(r["Invoice lines/Number Type"] ?? "").trim().toUpperCase();
      const reference  = String(r["Invoice lines/Reference"] ?? "").trim();
      const isRINV = numberType === "RINV";
      const isPR   = reference.length > 0 && reference[0].toUpperCase() === "R";

      const code = String(r["Code"] ?? "").trim();
      const cat  = codeCategory.get(code) || String(r["Product Category"] ?? "").trim() || "Uncategorized";
      const product = String(r["Invoice lines/Product"] ?? "").trim() || codeProduct.get(code) || code;
      const partnerRaw = String(r["Invoice Partner Display Name"] ?? "").trim()
        || String(r["Invoice lines/Partner"] ?? "").trim()
        || String(r["Partner"] ?? "").trim();
      const channel = String(r["Channel"] ?? "").trim()
        || String(r["channel"] ?? "").trim()
        || custChannel.get(partnerRaw) || "Other";

      const ton    = num(r["Num Ton"]);
      const carton = num(r["Num Carton"]);
      const gross  = num(r["Invoice lines/Amount in Currency"]) || num(r["Amount"]);
      if (!ton && !carton && !gross) continue;

      const targets: UnitBuckets[] = [
        byMonth[month-1],
        ensureCatMonth(cat)[month-1],
        ensureChannelMonth(channel)[month-1],
      ];
      if (code) targets.push(ensureProduct(code, product, cat).months[month-1]);
      if (partnerRaw) {
        targets.push(ensureCustomer(partnerRaw, partnerRaw, channel).months[month-1]);
        customerSet[y].add(partnerRaw);
        if (product) {
          const arr = ensureCustSku(partnerRaw, product);
          const c = arr[month-1];
          const sumK  = y === 25 ? "sum25"  : "sum26";
          const prK   = y === 25 ? "pr25"   : "pr26";
          const rinvK = y === 25 ? "rinv25" : "rinv26";
          c[sumK] += ton;
          if (isRINV) c[rinvK] += ton;
          if (isPR)   c[prK]   += Math.abs(ton);
        }
      }
      for (const b of targets) addRow(b, y, ton, carton, gross, isRINV, isPR);
    }
  }

  processSheet(actual25);
  processSheet(actual26);

  // Populate targets on all aggregations
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

  // ── Period aggregation (YTD Jan..Jun cap) ──
  const maxMonth26 = maxMonth[26] || 12;
  const maxMonth25 = maxMonth[25] || 12;
  const ytdRange = Math.min(maxMonth26 || VALIDATION_CAP, VALIDATION_CAP);

  const COMP_KEYS: Array<keyof Bucket> = [
    "tgt25","tgt26",
    "sum25","pr25","rinv25",
    "sum26","pr26","rinv26",
  ];
  const sumRange = (arr: UnitBuckets[], months: number[]): UnitBuckets => {
    const out = emptyUnits();
    for (const m of months) {
      const src = arr[m-1];
      (["ton","carton","gross"] as Unit[]).forEach(u => {
        for (const k of COMP_KEYS) out[u][k] += src[u][k];
      });
    }
    deriveAll(out);
    return out;
  };

  const ytdMonths = Array.from({length: ytdRange}, (_, i)=> i+1);
  const totalsYTD = sumRange(byMonth, ytdMonths);

  // Per-month bucket serializer: derive s/r from components then emit.
  const trimMonths = (arr: UnitBuckets[]) =>
    arr.slice(0, 12).map(m => {
      const c = emptyUnits();
      (["ton","carton","gross"] as Unit[]).forEach(un => {
        for (const k of COMP_KEYS) c[un][k] = m[un][k];
      });
      deriveAll(c);
      return { ton: c.ton, carton: c.carton, gross: c.gross };
    });

  // Category
  const categoryData: Array<{
    category:string; ton:Bucket; carton:Bucket; gross:Bucket;
    monthly: Array<{ton:Bucket; carton:Bucket; gross:Bucket}>;
  }> = [];
  for (const [cat, arr] of byCategoryMonth) {
    const u = sumRange(arr, ytdMonths);
    if (!(u.ton.s25 || u.ton.s26 || u.ton.r25 || u.ton.r26)) continue;
    categoryData.push({ category: cat, ton: u.ton, carton: u.carton, gross: u.gross, monthly: trimMonths(arr) });
  }
  categoryData.sort((a,b) => (b.ton.s26 + b.ton.s25) - (a.ton.s26 + a.ton.s25));

  const productData = [...byProduct.entries()].map(([code, p]) => ({
    code, product: p.name, category: p.category,
    monthly: trimMonths(p.months),
  }));

  const customerData = [...byCustomer.entries()].map(([, c]) => ({
    partner: c.partner, channel: c.channel,
    monthly: trimMonths(c.months),
  }));

  // Customer × SKU raw components → client derives per-period totals.
  const customerSkuMonthly: Array<{
    partner: string;
    skus: Array<{ product: string; monthly: SkuComp[] }>;
  }> = [];
  for (const [partner, m] of custSkuMonth) {
    const skus: Array<{ product: string; monthly: SkuComp[] }> = [];
    for (const [product, arr] of m) skus.push({ product, monthly: arr });
    customerSkuMonthly.push({ partner, skus });
  }

  // Channel
  const channelData: Array<{
    channel:string; ton:Bucket; carton:Bucket; gross:Bucket;
    monthly: Array<{ton:Bucket; carton:Bucket; gross:Bucket}>;
  }> = [];
  for (const [ch, arr] of byChannelMonth) {
    const u = sumRange(arr, ytdMonths);
    if (!(u.ton.s25 || u.ton.s26 || u.ton.r25 || u.ton.r26)) continue;
    channelData.push({ channel: ch, ton: u.ton, carton: u.carton, gross: u.gross, monthly: trimMonths(arr) });
  }
  channelData.sort((a,b) => b.ton.s26 - a.ton.s26);

  // Monthly trend
  for (const u of byMonth) deriveAll(u);
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
      customers_25: customerSet[25].size,
      customers_26: customerSet[26].size,
      generated_at: new Date().toISOString(),
      source: "vercel-blob:xlsx",
      missing_sheets: missingSheets,
      build_ms: 0,
    },
    product_data: productData,
    customer_data: customerData,
    category_data: categoryData,
    monthly_data: monthlyData,
    channel_data: channelData,
    customer_sku_monthly: customerSkuMonthly,
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
