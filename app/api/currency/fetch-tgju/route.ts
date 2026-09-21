import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { getAuthContext } from "@/lib/auth";
import { applyMarketSyncForAnchor , syncUsdPricedProducts } from "@/lib/market-sync";
import { recordRateHistory } from "@/lib/currency";

export const runtime = "nodejs";
export const maxDuration = 120;

// لیست تمام صفحات profile برای استخراج قیمت
// شامل طلا (geram18, sekee, ons, mesghal) و ارزها (USD, EUR, AED, GBP, TRY, CNY)
const PRICE_PROFILES = [
 { key: "gold:GERAM18", fromCurrency: "GOLD_GERAM18", url: "https://www.tgju.org/profile/geram18", name: "طلا ۱۸ عیار", isGold: true, currencyCode: null, currencyName: null, symbol: null },
 { key: "currency:USD", fromCurrency: "USD", url: "https://www.tgju.org/profile/price_dollar_rl", name: "دلار آمریکا", isGold: false, currencyCode: "USD", currencyName: "دلار آمریکا", symbol: "$" },
 { key: "currency:EUR", fromCurrency: "EUR", url: "https://www.tgju.org/profile/price_eur", name: "یورو", isGold: false, currencyCode: "EUR", currencyName: "یورو", symbol: "€" },
 { key: "currency:AED", fromCurrency: "AED", url: "https://www.tgju.org/profile/price_aed", name: "درهم امارات", isGold: false, currencyCode: "AED", currencyName: "درهم امارات", symbol: "د.إ" },
 { key: "currency:GBP", fromCurrency: "GBP", url: "https://www.tgju.org/profile/price_gbp", name: "پوند انگلیس", isGold: false, currencyCode: "GBP", currencyName: "پوند انگلیس", symbol: "£" },
 { key: "currency:TRY", fromCurrency: "TRY", url: "https://www.tgju.org/profile/price_try", name: "لیر ترکیه", isGold: false, currencyCode: "TRY", currencyName: "لیر ترکیه", symbol: "₺" },
 { key: "currency:CNY", fromCurrency: "CNY", url: "https://www.tgju.org/profile/price_cny", name: "یوآن چین", isGold: false, currencyCode: "CNY", currencyName: "یوآن چین", symbol: "¥" },
 { key: "gold:SEKEE", fromCurrency: "GOLD_SEKEE", url: "https://www.tgju.org/profile/sekee", name: "سکه امامی", isGold: true, currencyCode: null, currencyName: null, symbol: null },
 { key: "gold:ONSE", fromCurrency: "GOLD_ONSE", url: "https://www.tgju.org/profile/ons", name: "انس طلا", isGold: true, currencyCode: null, currencyName: null, symbol: null },
 { key: "gold:MESGHAL", fromCurrency: "GOLD_MESGHAL", url: "https://www.tgju.org/profile/mesghal", name: "مثقال طلا", isGold: true, currencyCode: null, currencyName: null, symbol: null },
] as const;

// تاخیر کوچک برای مدیریت rate-limit
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// استخراج قیمت از HTML صفحه profile تگ‌جو
// چندین الگو برای مقاومت در برابر تغییر ساختار صفحه
function extractPrice(html: string): number | null {
 if (!html || html.length < 500) return null;

 // الگوهای مختلف برای پیدا کردن قیمت در صفحات tgju.org
 // صفحه‌های profile تگ‌جو قیمت را در عنصر <span class="price" data-col="info.last_trade.PDrCotVal">1,865,000</span> نمایش می‌دهند
 const patterns: RegExp[] = [
 // الگوی اصلی: data-col="info.last_trade.PDrCotVal">1,865,000
 /data-col="info\.last_trade\.PDrCotVal"[^>]*>\s*([\d][\d,]*\s*)/i,
 // class="price" data-col="info.last_trade.PDrCotVal">1,865,000
 /class="price"[^>]*data-col="info\.last_trade\.PDrCotVal"[^>]*>\s*([\d][\d,]*)/i,
 // class شامل "price" همراه با عدد بعد از >
 /class="[^"]*\bprice\b[^"]*"[^>]*>\s*([\d][\d.,،\s]*)\s*(?:<|\sریال|&nbsp;)/i,
 // class شامل "price" (هر نوع) با عدد
 /class="[^"]*price[^"]*"[^>]*>\s*([\d][\d.,،\s]*)/i,
 // data-key="p"
 /data-key="p"[^>]*>\s*([\d][\d.,،\s]*)/i,
 // fallback: قیمت لحظه‌ای
 /قیمت\s*لحظه[^<]*<[^>]*>[^<]*<[^>]*>\s*([\d][\d.,،\s]*)/i,
 ];

 for (const re of patterns) {
 const m = html.match(re);
 if (m && m[1]) {
 const cleaned = m[1].replace(/[^\d]/g, "");
 const price = parseInt(cleaned, 10);
 if (price > 0) return price;
 }
 }
 return null;
}

// نگاشت کلیدهای پشتیبان به URLهای alanchand.info (منبع دوم در صورت قطعی tgju)
const ALANCHAND_FALLBACKS: Record<string, string> = {
 "gold:GERAM18": "https://alanchand.com/geram18",
 "currency:USD": "https://alanchand.com/price-dollar",
 "currency:EUR": "https://alanchand.com/price-euro",
 "currency:AED": "https://alanchand.com/price-dirham",
 "currency:GBP": "https://alanchand.com/price-pound",
 "currency:TRY": "https://alanchand.com/price-lira",
 "currency:CNY": "https://alanchand.com/price-yuan",
 "gold:SEKEE": "https://alanchand.com/emami-coin",
 "gold:ONSE": "https://alanchand.com/ounce",
 "gold:MESGHAL": "https://alanchand.com/mesghal",
};

// دریافت HTML با retry برای مقابله با 429/503/پاسخ خالی page_reader
// FIX: پشتیبان alanchand — اگر tgju جواب نداد، از منبع دوم تلاش کن (تکیه بر تک‌منبعی حذف شد)
async function fetchHtmlWithRetry(
 zai: Awaited<ReturnType<typeof ZAI.create>>,
 url: string,
 retries = 2,
 fallbackKey?: string
): Promise<string | null> {
 const attemptUrls = [url];
 // اگر کلید پشتیبان داشت، در تلاش آخر از alanchand استفاده کن
 if (fallbackKey && ALANCHAND_FALLBACKS[fallbackKey]) {
 attemptUrls.push(ALANCHAND_FALLBACKS[fallbackKey]);
 }

 let lastErr: unknown = null;
 for (const attemptUrl of attemptUrls) {
 for (let attempt = 0; attempt < retries; attempt++) {
 try {
 const result = await zai.functions.invoke("page_reader", { url: attemptUrl });
 const html: string = result?.data?.html || "";
 // صفحه معتبر باید حداقل ۵۰۰ کاراکتر داشته باشد
 if (html && html.length > 500) return html;
 } catch (err) {
 lastErr = err;
 // خطای 429 (rate limit) یا 503 — بدون console.error لاگ نکن تا dev.log پر نشود
 }
 await sleep(500 * (attempt + 1));
 }
 }
 if (lastErr) {
 const msg = lastErr instanceof Error? lastErr.message: String(lastErr);
 if (!msg.includes("429") &&!msg.includes("Too many requests")) {
 console.error("page_reader error (both sources):", msg.substring(0, 100));
 }
 }
 return null;
}

// POST /api/currency/fetch-tgju — دریافت نرخ‌های زنده از صفحات profile تگ‌جو
// الگوی stale-while-revalidate: کش تازه → همان کش؛ کش کهنه (تا ۲۴ ساعت) →
// همان کش فوراً + تازه‌سازی پس‌زمینه؛ بدون کش → scrape بلاک‌کننده.

// FIX: قفل سراسری — اگر چند کامپوننت همزمان POST بزنند، فقط یک scrape انجام
// می‌شود و بقیه همان نتیجه را می‌گیرند (جلوگیری از اسپم page_reader و 429)
let inflightScrape: Promise<{ status: number; body: unknown }> | null = null;

/** scrape پس‌زمینه — نتیجه را به کسی برنمی‌گرداند؛ فقط کش DB را تازه می‌کند */
function triggerBackgroundScrape() {
 if (inflightScrape) return; // یکی در حال اجراست
 inflightScrape = doScrape()
 .catch(() => null)
 .finally(() => {
 setTimeout(() => {
 inflightScrape = null;
 }, 1000);
 }) as Promise<{ status: number; body: unknown }> | null;
}

export async function POST(req?: NextRequest) {
 // FIX (LOW): احراز هویت اجباری — قبلاً هر کلاینت بی‌نام می‌توانست scrape
 // پس‌زمینه و نوشتن DB را تریگر کند (نرخ ارز روی محاسبات مالی اثر دارد)
 if (req) {
 const ctx = await getAuthContext(req);
 if (!ctx) {
 return NextResponse.json(
 { success: false, error: "احراز هویت الزامی است" },
 { status: 401 }
 );
 }
 }
 const now = new Date();

 // ─── سن کش را قبل از هر چیز بررسی کن (stale-while-revalidate) ───
 // FIX: قبلاً بعد از ۳ دقیقه هر POST تا ~۱۵ ثانیه (retryهای page_reader)
 // بلاک می‌شد و تیکر کاربر مدت‌ها «در حال بارگذاری» می‌ماند.
 try {
 const freshest = await db.exchangeRate.findFirst({
 where: { source: "tgju" },
 orderBy: { fetchedAt: "desc" },
 select: { fetchedAt: true },
 });
 if (freshest) {
 const ageMs = now.getTime() - new Date(freshest.fetchedAt).getTime();
 const cached = await getCachedData();
 if (Object.keys(cached).length > 0) {
 if (ageMs < 180_000) {
 // تازه — بدون scrape
 return NextResponse.json({
 success: true,
 data: cached,
 updatedAt: new Date(freshest.fetchedAt).toISOString(),
 count: Object.keys(cached).length,
 cached: true,
 });
 }
 if (ageMs < 86_400_000) {
 // کهنه اما قابل‌استفاده — همان را فوراً بده و در پس‌زمینه تازه کن
 triggerBackgroundScrape();
 return NextResponse.json({
 success: true,
 data: cached,
 updatedAt: new Date(freshest.fetchedAt).toISOString(),
 count: Object.keys(cached).length,
 cached: true,
 stale: true,
 });
 }
 }
 }
 } catch {
 // خطای خواندن کش → مسیر scrape بلاک‌کننده
 }

 // اگر scrape ای در حال اجراست، همان نتیجه را share کن
 if (!inflightScrape) {
 inflightScrape = doScrape()
 .catch(() => ({
 status: 500,
 body: { success: false, error: "خطا در دریافت نرخ‌ها" },
 }))
 .finally(() => {
 setTimeout(() => {
 inflightScrape = null;
 }, 1000);
 }) as Promise<{ status: number; body: unknown }>;
 }
 const { status, body } = await inflightScrape;
 return NextResponse.json(body, { status });
}

async function doScrape(): Promise<{ status: number; body: unknown }> {
 try {
 const now = new Date();

 // (سن کش دیگر اینجا بررسی نمی‌شود — در POST اصلی با stale-while-revalidate مدیریت شد)
 const zai = await ZAI.create();
 const results: Record<string, { name: string; price: number; changed: boolean; isGold: boolean; currencyCode: string | null; currencyName: string | null; symbol: string | null }> = {};

 // دریافت قبلی برای تشخیص تغییر
 const previousRates = await db.exchangeRate.findMany({
 where: { source: "tgju" },
 orderBy: { fetchedAt: "desc" },
 });
 const previousMap: Record<string, number> = {};
 for (const r of previousRates) {
 if (previousMap[r.fromCurrency] == null) {
 previousMap[r.fromCurrency] = r.rate;
 }
 }

 // استخراج قیمت‌ها از صفحات profile با retry
 const fetchOne = async (profile: (typeof PRICE_PROFILES)[number]) => {
 const html = await fetchHtmlWithRetry(zai, profile.url, 2, profile.key);
 if (!html) return null;

 let price = extractPrice(html);
 if (price == null || price <= 0) return null;

 // FIX(GOLD-1): انس طلا در تگ‌جو/آلان‌چند به «دلار» است (مثلاً ۴٬۳۶۹$)
 // نه ریال — مقدار < ۵۰٬۰۰۰ قطعاً دلاری است (انس ریالی همیشه > ۱۰۰ میلیون).
 // با تازه‌ترین نرخ دلار (همین اجرا یا قبلی) به ریال تبدیل می‌شود.
 if (profile.key === "gold:ONSE" && price < 50_000) {
 const usdThisRun = results["currency:USD"]?.price;
 const usdRate =
 (typeof usdThisRun === "number" && usdThisRun > 0)
 ? usdThisRun
 : previousMap["USD"] && previousMap["USD"] > 0
 ? previousMap["USD"]
 : (await db.exchangeRate.findFirst({
 where: { fromCurrency: "USD", toCurrency: "IRR" },
 orderBy: { fetchedAt: "desc" },
 select: { rate: true },
 }))?.rate;
 if (usdRate && usdRate > 0) {
 price = Math.round(price * usdRate);
 }
 }

 const changed =
 previousMap[profile.fromCurrency]!= null &&
 previousMap[profile.fromCurrency]!== price;

 // ذخیره در DB ExchangeRate
 try {
 await db.exchangeRate.upsert({
 where: {
 fromCurrency_toCurrency: { fromCurrency: profile.fromCurrency, toCurrency: "IRR" },
 },
 update: { rate: price, source: "tgju", fetchedAt: now },
 create: { fromCurrency: profile.fromCurrency, toCurrency: "IRR", rate: price, source: "tgju" },
 });
 // ⑨ هوک تاریخچه نرخ: هر تغییر نرخ تگ‌جو → یک ردیف ExchangeRateHistory
 // (نرخ قبلی از previousMap — نرخ ثابت ردیف تکراری نمی‌سازد)
 try {
 await recordRateHistory(
 profile.fromCurrency,
 "IRR",
 price,
 "tgju",
 previousMap[profile.fromCurrency] ?? null
 );
 } catch {
 // خطای تاریخچه نباید fetch بقیه نمادها را قطع کند
 }
 // هوک همگام‌سازی بازار: نرخ به IRR تغییر کرد — اگر لنگرِ tenantی همین نماد باشد
 // قیمت کالاهایش به نسبت تغییر نرخ به‌روز می‌شود (فقط لنگرهای مطابق؛ fault-tolerant)
 try {
 await applyMarketSyncForAnchor(profile.fromCurrency, price);
 } catch {
 // خطای هوک نباید fetch بقیه نمادها را قطع کند
 }
 // USD-PRICE: با تغییر نرخ دلار، قیمت کالاهای usdSynced هم بازمحاسبه می‌شود
 // (مستقل از تنظیم anchor هر tenant — درخواست مالک برای قیمت دلاری هر کالا)
 if (profile.fromCurrency === "USD") {
 try {
 const syncedCount = await syncUsdPricedProducts(price);
 if (syncedCount > 0) {
 console.log(`[usd-price-sync] ${syncedCount} کالا با نرخ دلار ${price} به‌روز شد`);
 }
 } catch {
 // خطای سینک دلاری نباید fetch را قطع کند
 }
 }
 } catch {
 // خطای DB نباید کل عملیات را قطع کند
 }

 // برای ارزهای معمولی، رکورد Currency را هم بساز (تا در /api/currency نمایش داده شود)
 if (!profile.isGold && profile.currencyCode && profile.currencyName && profile.symbol) {
 try {
 await db.currency.upsert({
 where: { code: profile.currencyCode },
 update: { name: profile.currencyName, symbol: profile.symbol, isActive: true },
 create: {
 code: profile.currencyCode,
 name: profile.currencyName,
 symbol: profile.symbol,
 isActive: true,
 },
 });
 } catch {
 // خطای DB نباید کل عملیات را قطع کند
 }
 }

 return {
 name: profile.name,
 price,
 changed,
 isGold: profile.isGold,
 currencyCode: profile.currencyCode,
 currencyName: profile.currencyName,
 symbol: profile.symbol,
 };
 };

 // موازی‌سازی با محدودیت (۳ همزمان برای جلوگیری از timeout و rate-limit)
 const batchSize = 3;
 for (let i = 0; i < PRICE_PROFILES.length; i += batchSize) {
 const batch = PRICE_PROFILES.slice(i, i + batchSize);
 const batchResults = await Promise.allSettled(batch.map(fetchOne));
 for (let j = 0; j < batch.length; j++) {
 const r = batchResults[j];
 if (r.status === "fulfilled" && r.value) {
 results[batch[j].key] = r.value;
 }
 }
 }

 const freshCount = Object.keys(results).length;

 // اگر هیچ نرخ زنده‌ای دریافت نشد، از داده‌های cache شده DB استفاده کن
 if (freshCount === 0) {
 const cached = await getCachedData(previousMap);
 if (Object.keys(cached).length > 0) {
 return {
 status: 200,
 body: {
 success: true,
 data: cached,
 updatedAt: now.toISOString(),
 count: Object.keys(cached).length,
 cached: true,
 },
 };
 }
 return {
 status: 502,
 body: { success: false, error: "دریافت نرخ‌ها ناموفق بود. لطفاً دوباره تلاش کنید.", cached: false },
 };
 }

 return {
 status: 200,
 body: {
 success: true,
 data: results,
 updatedAt: now.toISOString(),
 count: freshCount,
 },
 };
 } catch (error) {
 console.error("TGJU fetch error:", error);
 // تلاش برای برگرداندن داده‌های cache شده در صورت خطای کلی
 try {
 const cached = await getCachedData();
 if (Object.keys(cached).length > 0) {
 return {
 status: 200,
 body: {
 success: true,
 data: cached,
 updatedAt: new Date().toISOString(),
 count: Object.keys(cached).length,
 cached: true,
 },
 };
 }
 } catch {
 // ignore
 }
 return { status: 500, body: { success: false, error: "خطا در دریافت نرخ‌ها" } };
 }
}

// دریافت آخرین نرخ‌های ذخیره‌شده و تبدیل به فرمت استاندارد خروجی
async function getCachedData(
 preloadedMap?: Record<string, number>
): Promise<Record<string, { name: string; price: number; changed: boolean; isGold: boolean; currencyCode: string | null; currencyName: string | null; symbol: string | null }>> {
 const rates = await db.exchangeRate.findMany({
 where: { source: "tgju" },
 orderBy: { fetchedAt: "desc" },
 });
 const latestMap: Record<string, number> = preloadedMap?? {};
 if (!preloadedMap) {
 for (const r of rates) {
 if (latestMap[r.fromCurrency] == null) {
 latestMap[r.fromCurrency] = r.rate;
 }
 }
 }
 const out: Record<string, { name: string; price: number; changed: boolean; isGold: boolean; currencyCode: string | null; currencyName: string | null; symbol: string | null }> = {};
 for (const p of PRICE_PROFILES) {
 const rate = latestMap[p.fromCurrency];
 if (rate!= null) {
 out[p.key] = {
 name: p.name,
 price: rate,
 changed: false,
 isGold: p.isGold,
 currencyCode: p.currencyCode,
 currencyName: p.currencyName,
 symbol: p.symbol,
 };
 }
 }
 return out;
}

// GET /api/currency/fetch-tgju — دریافت آخرین نرخ‌های ذخیره‌شده (cache)
// این مسیر سریع است و page_reader فراخوانی نمی‌کند. برای polling هر ۶۰ ثانیه مناسب است.
export async function GET() {
 try {
 const rates = await db.exchangeRate.findMany({
 where: { source: "tgju" },
 orderBy: { fetchedAt: "desc" },
 });

 const latest: Record<string, { rate: number; fetchedAt: Date }> = {};
 for (const r of rates) {
 if (!latest[r.fromCurrency]) {
 latest[r.fromCurrency] = { rate: r.rate, fetchedAt: r.fetchedAt };
 }
 }

 // تبدیل کلیدها به فرمت قابل نمایش
 const formatted: Record<string, { price: number; name: string; fetchedAt: Date; isGold: boolean; currencyCode: string | null; currencyName: string | null; symbol: string | null }> = {};
 for (const p of PRICE_PROFILES) {
 const v = latest[p.fromCurrency];
 if (v) {
 formatted[p.key] = {
 price: v.rate,
 name: p.name,
 fetchedAt: v.fetchedAt,
 isGold: p.isGold,
 currencyCode: p.currencyCode,
 currencyName: p.currencyName,
 symbol: p.symbol,
 };
 }
 }

 return NextResponse.json({
 success: true,
 data: formatted,
 count: Object.keys(formatted).length,
 });
 } catch (error) {
 console.error("TGJU latest error:", error);
 return NextResponse.json(
 { success: false, error: "خطا" },
 { status: 500 }
 );
 }
}
