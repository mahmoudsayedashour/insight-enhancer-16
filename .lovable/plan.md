## Reality check on the workbook

I successfully downloaded your Google Sheet as an XLSX via Drive's public download endpoint (works with CORS, no OAuth). But when I inspected it:

- File size: **93 MB**
- `Actual 25`: **409,640 rows** × 47 columns (raw invoice lines)
- `Actual 2026`: **257,152 rows** × 24 columns (raw invoice lines)
- Other sheets are small (Main Data 61 rows, Forecasts <50 rows, Customers 253 rows)

Doing "fetch + SheetJS parse in the browser on every refresh" is technically what you asked for, but on this file it means:

- ~30–90 s download + ~30–90 s parse on desktop
- 600 MB+ peak memory (browser tab likely crashes on mobile)
- Every visitor re-downloads 93 MB

That will not feel like a dashboard. So I want your OK to change **one** thing: move the fetch + parse to the server (a TanStack server function that runs in the Cloudflare Worker), keep an in-memory cache with a short TTL (e.g. 60 s), and have the browser hit a small `/api/dashboard-data` JSON endpoint. Behavior you asked for is preserved: no manual export, no code changes when you update the sheet, every dashboard refresh pulls the latest workbook. The only difference is where the parsing happens.

Everything below assumes you say yes to that.

## What I'll build

### 1. Server pipeline (replaces `data.js`)
- `src/lib/workbook.functions.ts` — `getDashboardData()` server function.
  - Downloads `https://drive.usercontent.google.com/download?id=1Zd_NmkqRLSZajMSz9mZ56fsCgf2Bidgc&export=download&confirm=t`.
  - Parses with SheetJS (`xlsx` npm package).
  - Aggregates `Actual 25` + `Actual 2026` line by line into the same shape the front-end expects today (`meta`, `product_data`, `customer_data`, `category_data`, `monthly_data`) plus new `channel_data` and `customer_sku_data`.
  - In-memory cache with 60 s TTL so back-to-back page loads are instant.
- `src/routes/api/public/dashboard-data.ts` — thin GET route that returns the cached JSON (public, read-only).
- Delete `public/dashboard/data.js`. `index.html` will `fetch('/api/public/dashboard-data')` on load and populate `window.GREKO_DATA` before `app.js` runs.

### 2. DAX-aligned calculations (from raw invoice lines)
Rules applied consistently across every page and both units (Ton / Carton / Gross):
- **Sales** = sum of `Num Ton` / `Num Carton` / `Amount` where `Invoice lines/Number Type = INV`.
- **Returns** = sum where `Number Type = RINV` (absolute value).
- **Net** = Sales − Returns.
- **Target** = sum across Jan…current-month from Forecast 25 / Forecast 26.
- **Achievement %** = Net / Target — same formula for every unit; only displayed values change.
- **Category** rollup uses `Product Category` from `Main Data` joined on `Code`.
- **Channel** rollup uses `channel` column (Actual 25) and Customers sheet fallback for 2026 (Actual 2026 has no channel column — it joins to `Customers` on partner code).

### 3. Page changes
- **Executive Dashboard → merged into Year Comparison**, dashboard title becomes **"Greko Company Dashboard"**. Sidebar item renamed.
- **Year Comparison**: Achievement by Category recomputed; two donuts replaced by one grouped bar (2025 vs 2026 per category); Best Growing Products ranked by `Sales 2026 vs Target 2026`; Worst Performing ranked by lowest Achievement %; "Best Performing Customers" removed.
- **SKU YTD Performance**: absorbs Product Analysis; Bottom 10 uses Ton; Top 10 shows full product names.
- **Channel Performance**: rebuilt entirely from the `channel` field (Actual 2025 direct; Actual 2026 joined via Customers sheet). No duplicated analyses from other pages.
- **Customer Analysis**: per-customer Top Selling SKU and Top Returned SKU computed from `Invoice lines/Product`, distinct per customer.

### 4. Authentication (new)
- New route `/auth` (TanStack) — login form, username `mahmoudashour`, password `Greko@2026`, checked client-side against constants, wrong creds show inline error.
- On success: set `localStorage['greko_auth'] = '1'` and navigate to `/`.
- `/` (dashboard redirect) checks the flag; if missing, redirects to `/auth`. Dashboard header gets a **Logout** button that clears the flag and returns to `/auth`.
- **Login background**: you asked me to reuse the "previously generated" login image, but there is none in the repo (only `greko_logo.png`). I'll use a branded gradient background with the logo — no new image generation — so we don't burn credits or block on assets. Say the word if you'd rather I generate one.

### 5. GitHub
Lovable auto-syncs every edit to the connected GitHub repo. Nothing extra to do; once this plan is applied all files land in the repo and are ready to deploy to Vercel.

## What I need from you
- **OK to move fetch+parse to the server** (only sensible way given the file size)?
- **OK to use a branded gradient login background** instead of an image?

Reply "go" and I'll ship it end to end.
