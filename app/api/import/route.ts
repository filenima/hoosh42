import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { encryptField } from "@/lib/db-encryption";
import { auditLog } from "@/lib/auth";
import { requireUser } from "@/lib/user-auth";
import { rateLimitCheck, getClientIp } from "@/lib/rate-limit";
import { jalaliToGregorian, toEnglishDigits } from "@/lib/persian";
import { getVatRateFraction } from "@/lib/accounting";
import { nationalIdBlindIndex } from "@/lib/validators";
import { resolveDefaultWarehouse } from "@/lib/stock-movements";
// ماژول مشترک پارسر ایمپورت (client-safe — بدون وابستگی سروری)
import { combineCategory, isBlankOrNumeric } from "@/lib/import-parser";

export const runtime = "nodejs";

type EntityType = "invoices" | "products" | "parties";
type DuplicateStrategy = "skip" | "update";

interface ImportError {
  row: number;
  message: string;
}

interface ImportResponse {
  success: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
  skippedRows: ImportError[];
  error?: string;
}

/* ============================================================
 * سقف‌های ایمپورت:
 *  - MAX_ROWS_PER_REQUEST = ۵۰۰۰ — کلاینت فایل‌های بزرگ‌تر را خودش به
 *    چانک‌های ۵۰۰تایی تقسیم و ارسال می‌کند (الگوی chunking موجود).
 *  - سقف کل فایل = ۱۰۰,۰۰۰ ردیف (تضمین‌شده سمت کلاینت در
 *    components/modules/data-import-export.tsx).
 *  - Rate limit = ۲۴۰ درخواست/دقیقه — چون ایمپورت ۱۰۰k ردیف یعنی
 *    ~۲۰۰ چانک ۵۰۰تایی.
 * ============================================================ */
const MAX_ROWS_PER_REQUEST = 5000;

// ============ FIX(Persian headers): نگاشت کلیدهای فارسی → انگلیسی ============
// خروجی نرم‌افزارهای حسابداری ایرانی (هلو، سپیدار، محک و...) معمولاً هدرهای
// فارسی دارند. این نگاشت در سمت سرور هم اعمال می‌شود تا هر فراخوانی API
// مستقیم با هدر فارسی هم درست کار کند (سمت کلاینت هم نگاشت مشابهی هست).
//
// FIX(21-A): هدرهای فایل واقعی مالک (خروجی هلو) اضافه شد — «رديف، گروه اصلي،
// گروه فرعي، نام كالا، موجودي، ميانگين خريد، في فروش، آخرين في خريد، درصد
// تخفيف، واحد هاي کالا...» — با ي/ك عربی که normalizeHeaderKey یکسان می‌کند.
const PERSIAN_KEY_MAP: Record<string, string> = {
  // --- کالاها (products) ---
  "نام کالا": "name", "نام": "name", "شرح کالا": "name", "شرح": "name", "عنوان": "name",
  "کد کالا": "sku", "کد": "sku", "شناسه کالا": "sku", "کد شناسایی": "sku", "کد یکتا": "sku",
  "واحد شمارش": "unit", "واحد": "unit", "واحد کالا": "unit", "واحد های کالا": "unit", "آیتم": "unit",
  "قیمت فروش": "salePrice", "قیمت": "salePrice", "فروش": "salePrice", "نرخ فروش": "salePrice", "قیمت واحد فروش": "salePrice",
  "فی فروش": "salePrice", "فی": "salePrice",
  "قیمت خرید": "purchasePrice", "نرخ خرید": "purchasePrice", "قیمت واحد خرید": "purchasePrice", "بهای خرید": "purchasePrice",
  // میانگین خرید = بهای تمام‌شده میانگین متحرک (ترجیحی)؛ آخرین فی خرید = fallback
  "میانگین خرید": "purchasePriceAvg",
  "آخرین فی خرید": "purchasePriceLast", "آخرین نرخ خرید": "purchasePriceLast",
  "قیمت عمده": "wholesalePrice", "نرخ عمده": "wholesalePrice",
  "بارکد": "barcode", "کد بارکد": "barcode", "باركد": "barcode",
  "دسته‌بندی": "category", "گروه کالا": "category", "گروه": "category", "دسته": "category",
  "گروه اصلی": "categoryMain", "گروه فرعی": "categorySub",
  "توضیحات": "description", "شرح توضیحات": "description",
  // موجودی اولیه کالا (مثل POST /api/products → StockItem + StockMovement)
  "موجودی": "stock", "تعداد": "stock", "کمیت": "stock", "مقدار": "stock",
  // ردیف ردیفِ فایل — نادیده گرفته می‌شود
  "ردیف": "rowNo",
  // --- طرف‌حساب‌ها (parties) ---
  "نام طرف‌حساب": "name", "نام مشتری": "name", "نام شخص": "name", "حساب": "name",
  "نام و نام خانوادگی": "name",
  "کد مشتری": "code", "کد حساب": "code", "کد طرف‌حساب": "code", "شماره حساب": "code",
  "نوع": "type", "نوع طرف‌حساب": "type",
  "تلفن": "phone", "شماره تلفن": "phone", "موبایل": "mobile", "همراه": "mobile", "تلفن همراه": "mobile",
  "شماره موبایل": "mobile",
  "کد ملی": "nationalId", "شناسه ملی": "nationalId", "کد ملی/شناسه ملی": "nationalId",
  "کد اقتصادی": "economicCode", "شناسه اقتصادی": "economicCode", "شماره اقتصادی": "economicCode",
  "کد مالیاتی": "taxId", "شناسه مالیاتی": "taxId", "شماره مالیاتی": "taxId", "شناسه یکتای مالیاتی": "taxId",
  "ایمیل": "email", "پست الکترونیکی": "email",
  "آدرس": "address", "نشانی": "address",
  // --- فاکتورها (invoices) ---
  "شماره فاکتور": "number", "شماره": "number", "شماره سند": "number",
  "تاریخ فاکتور": "date", "تاریخ": "date", "تاریخ سند": "date",
  "کد مشتری/طرف‌حساب": "partyCode",
  "اقلام": "items", "ردیف‌ها": "items",
  "مبلغ کل": "total", "جمع کل": "total", "مبلغ فاکتور": "total", "مبلغ": "total",
};

// نرمال‌سازی یک ردیف: کلیدهای فارسی → انگلیسی + حذف فاصله‌های اضافی کلید
// FIX: کلیدهای انگلیسی camelCase (مثل salePrice) باید دست‌نخورده بمانند —
// قبلاً lowercase می‌شدند و ایمپورترها row.salePrice را پیدا نمی‌کردند (قیمت صفر!)
//
// FIX(3b-پیوست): کلیدهای نقشه با «نیم‌فاصله» (ZWNJ U+200C) تعریف شده‌اند اما
// خروجی واقعی هلو/سپیدار/اکسل کاربران اغلب «فاصله معمولی» یا ی/ک عربی دارد →
// نگاشت بی‌صدا شکست می‌خورد و ردیف با خطای گمراه‌کننده رد می‌شد. حالا هر دو
// طرف با normalizeHeaderKey یکسان می‌شوند (هم‌راستا با migration-wizard کلاینت).
function normalizeHeaderKey(key: string): string {
  return key
    .replace(/[\u200c\u200f\u200e]/g, "") // ZWNJ و کاراکترهای جهت‌دهی RTL
    .replace(/[\s_\-.\u0640]/g, "") // فاصله، زیرخط، خط تیره، کشیده (ـ)
    .replace(/\u064a/g, "\u06cc") // ي عربی → ی فارسی
    .replace(/\u0643/g, "\u06a9") // ك عربی → ک فارسی
    .replace(/[\u0623\u0625\u0622]/g, "\u0627") // أ إ آ → ا
    .toLowerCase();
}

// نقشه نرمال‌شده — یک‌بار ساخته می‌شود (lazy)
let normalizedKeyMap: Record<string, string> | null = null;
function getNormalizedKeyMap(): Record<string, string> {
  if (!normalizedKeyMap) {
    normalizedKeyMap = {};
    for (const [k, v] of Object.entries(PERSIAN_KEY_MAP)) {
      const nk = normalizeHeaderKey(k);
      if (nk && !(nk in normalizedKeyMap)) normalizedKeyMap[nk] = v;
    }
  }
  return normalizedKeyMap;
}

function normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const nmap = getNormalizedKeyMap();
  for (const [rawKey, value] of Object.entries(row)) {
    const key = rawKey.trim();
    // ۱) اگر کلید در نگاشت فارسی بود → معادل انگلیسی استاندارد را بگذار
    const mapped = PERSIAN_KEY_MAP[key] ?? nmap[normalizeHeaderKey(key)];
    if (mapped) {
      out[mapped] = value;
      continue;
    }
    // ۲) اگر دقیقاً یکی از فیلدهای API بود → همان بماند (camelCase حفظ می‌شود)
    const apiFields = new Set([
      "name", "sku", "unit", "salePrice", "purchasePrice", "wholesalePrice",
      "barcode", "description", "category", "code", "type", "phone", "mobile",
      "nationalId", "economicCode", "taxId", "email", "address",
      "number", "date", "partyCode", "items", "total",
      // FIX(21-A): فیلدهای جدید ایمپورت کالا
      "stock", "rowNo", "purchasePriceAvg", "purchasePriceLast", "categoryMain", "categorySub",
    ]);
    if (apiFields.has(key)) {
      out[key] = value;
      continue;
    }
    // ۳) در غیر این‌صورت: فقط فاصله/خط تیره انگلیسی را حذف کن (بدون lowercase)
    //    و اگر با حرف بزرگ شروع می‌شد، همان بماند — مقدار با کلید اصلی هم حفظ می‌شود
    const compact = key.replace(/[ \-]/g, "");
    out[compact] = value;
    // اگر کلید اصلی با نسخه compact فرق دارد، نسخه اصلی را هم نگه دار (پشتیبان)
    if (compact !== key) out[key] = value;
  }
  return out;
}

// ============ Bearer auth (optional, env-based) ============
//
// اگر متغیر محیطی IMPORT_BEARER_TOKEN تنظیم شده باشد، درخواست‌ها باید
// هدر Authorization: Bearer <token> داشته باشند. در غیر این صورت (محیط توسعه)،
// احراز هویت نادیده گرفته می‌شود و از rate-limit + active tenant استفاده می‌کنیم.
function verifyBearer(req: NextRequest): boolean {
  const expected = process.env.IMPORT_BEARER_TOKEN;
  if (!expected) return true; // احراز هویت غیرفعال
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return false;
  const parts = auth.split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return false;
  // مقایسه‌ی ثابت‌زمانی برای جلوگیری از timing attack
  const provided = parts[1];
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// ============ Helpers ============

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    // حذف جداکننده‌های فارسی/عربی/انگلیسی و تبدیل ارقام فارسی به انگلیسی
    // FIX: پشتیبانی کامل از همه جداکننده‌های یونیکد:
    //   ٬ U+066C (جداکننده هزارگان عربی — خروجی اکسل فارسی)
    //   ٮ/، کامای فارسی، , کامای انگلیسی
    //   ٫ U+066B (ممیز عربی) و / (ممیز فارسی) → نقطه اعشار
    const normalized = value
      .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
      .replace(/[٫/]/g, ".")
      .replace(/[,،٬\s\u00A0\u200C\u200E\u200F]/g, "");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/** آیا سلول مقدار غیرخالی دارد؟ */
function cellFilled(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function normalizeDate(value: unknown): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  // FIX(3b-بیگ‌۵) HIGH: ارقام فارسی/عربی در تاریخ (هلو/سپیدار) → انگلیسی
  const str = toEnglishDigits(String(value).trim());
  // پشتیبانی از YYYY-MM-DD یا YYYY/MM/DD
  // FIX(3b-بیگ‌۵) CRITICAL: تاریخ شمسی («1403/05/12») قبلاً به‌عنوان سال میلادیِ
  // 1403 پارس می‌شد (۱۷۰۰ سال آینده!). خروجی نرم‌افزارهای ایرانی تاریخ شمسی
  // دارند — سال ۱xxx (بازهٔ واقعی جلالی ۱۲۰۰–۱۶۰۰) تشخیص داده و با
  // jalaliToGregorian تبدیل می‌شود (الگوی موجود import/bank-statement).
  const m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    // الگوی جلالی: سال ۱xxx در بازهٔ ۱۲۰۰–۱۶۰۰ (سال میلادی ۱۲۰۰–۱۶۰۰ منطقی نیست)
    if (/^1\d{3}$/.test(m[1]) && y >= 1200 && y <= 1600 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const [gy, gm, gd] = jalaliToGregorian(y, mo, d);
      const jDate = new Date(gy, gm - 1, gd, 0, 0, 0, 0);
      if (!isNaN(jDate.getTime())) return jDate;
    }
    const d2 = new Date(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T00:00:00Z`);
    if (!isNaN(d2.getTime())) return d2;
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function parseItems(itemsStr: string): Array<{ description: string; quantity: number; unitPrice: number }> {
  // فرمت: "description|qty|price;description|qty|price"
  return itemsStr
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const [description, qty, price] = part.split("|").map((x) => (x ?? "").trim());
      return {
        description: description || "—",
        quantity: toNumber(qty, 1),
        unitPrice: toNumber(price, 0),
      };
    });
}

// ============ Importers ============

/* ============================================================
 * FIX(21-A) importProducts — بازنویسی کامل برای ۱۰۰k ردیف بدون ردیف گم‌شده:
 *
 *  - پیش‌بارگذاری (بدون findFirst سطر به سطر — که برای ۱۰۰k ردیف دقیقه‌ها
 *    طول می‌کشید): همهٔ SKU های tenant در یک findMany → Map؛ همهٔ دسته‌ها → Map
 *  - دسته‌بندی هر ردیف به یکی از: ایجاد / به‌روزرسانی / ردِ تکراری / خطا
 *    (جمعِ این چهار دقیقاً برابر تعداد ردیف‌های دریافتی است — هیچ کالایی
 *    «گم» نمی‌شود)
 *  - ایجاد گروهی با $transaction های ۲۰۰تایی (SQLite) + fallback سطری در
 *    صورت شکک تراکنش (خطا به همان ردیف نسبت داده می‌شود)
 *  - موجودی اولیه: دقیقاً مثل POST /api/products — StockItem + StockMovement
 *    (type IN/OUT + referenceType ADJUSTMENT) در انبار پیش‌فرض
 *    (resolveDefaultWarehouse — در نبود انبار «انبار اصلی» می‌سازد)
 *  - استراتژی تکراری SKU: skip (پیش‌فرض) یا update (قیمت/توضیحات +
 *    تعدیل موجودی با دلتا)
 * ============================================================ */

interface ProductCreateItem {
  row: number;
  sku: string;
  name: string;
  unit: string;
  barcode: string | null;
  description: string | null;
  categoryId: string | null;
  salePrice: number;
  purchasePrice: number;
  wholesalePrice: number;
  stock: number;
}

interface ProductUpdateItem {
  row: number;
  productId: string;
  sku: string;
  updateData: {
    salePrice?: bigint;
    purchasePrice?: bigint;
    wholesalePrice?: bigint;
    description?: string | null;
  };
  /** موجودی جدید — undefined یعنی فایل ستون موجودی نداشت/خالی بود */
  newStock?: number;
}

async function importProducts(
  rowsRaw: Record<string, unknown>[],
  tenantId: string,
  req: NextRequest,
  fileName?: string,
  strategy: DuplicateStrategy = "skip"
): Promise<{
  created: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
  skippedRows: ImportError[];
}> {
  const rows = rowsRaw.map(normalizeRowKeys);
  const errors: ImportError[] = [];
  const skippedRows: ImportError[] = [];
  let skipped = 0; // ردیف‌های تکراری (استراتژی skip)
  const creates: ProductCreateItem[] = [];
  const updates: ProductUpdateItem[] = [];

  // ۱) پیش‌بارگذاری SKU های موجود (یک کوئری — نه findFirst در هر ردیف)
  const existingProducts = await db.product.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, sku: true, purchasePrice: true },
  });
  const skuMap = new Map<string, { id: string; purchasePrice: bigint }>();
  for (const p of existingProducts) skuMap.set(p.sku, { id: p.id, purchasePrice: p.purchasePrice });

  // ۲) پیش‌بارگذاری دسته‌بندی‌ها
  const existingCats = await db.productCategory.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  });
  const catMap = new Map<string, string>();
  for (const c of existingCats) {
    if (!catMap.has(c.name)) catMap.set(c.name, c.id);
  }

  // شمارنده SKU خودکار (یکتا در هر درخواست)
  let autoSkuCounter = 0;
  const autoSkuStamp = Date.now().toString(36).toUpperCase().slice(-4);
  const autoSkuRand = Math.random().toString(36).toUpperCase().slice(2, 5);
  // SKU های دیده‌شده در همین فایل (تشخیص تکراری داخل فایل)
  const seenSkus = new Set<string>();
  // نام دسته‌های ناموفق (تا ردیف‌های آن‌ها خطای شفاف بگیرند)
  const failedCategories = new Set<string>();

  // ۳) طبقه‌بندی ردیف‌ها (بدون هیچ کوئری سطر به سطر)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const idx = i + 1;
    try {
      let sku = String(row.sku ?? "").trim();
      const name = String(row.name ?? "").trim();
      const unitRaw = String(row.unit ?? "").trim();
      // «واحد هاي کالا» در خروجی هلو عددی/خالی است → «عدد»
      const unit = unitRaw && !isBlankOrNumeric(unitRaw) ? unitRaw.slice(0, 20) : "عدد";
      const salePrice = toNumber(row.salePrice, 0);

      // قیمت خرید: میانگین خرید (ترجیحی — منطق بهای میانگین متحرک) > آخرین فی خرید
      const avgFilled = cellFilled(row.purchasePriceAvg);
      const lastFilled = cellFilled(row.purchasePriceLast);
      let purchasePrice: number;
      if (cellFilled(row.purchasePrice) && toNumber(row.purchasePrice) > 0) {
        purchasePrice = toNumber(row.purchasePrice);
      } else if (avgFilled && toNumber(row.purchasePriceAvg) > 0) {
        purchasePrice = toNumber(row.purchasePriceAvg);
      } else if (lastFilled) {
        purchasePrice = toNumber(row.purchasePriceLast);
      } else if (cellFilled(row.purchasePrice)) {
        purchasePrice = toNumber(row.purchasePrice);
      } else {
        purchasePrice = 0;
      }

      const wholesalePrice = row.wholesalePrice !== undefined ? toNumber(row.wholesalePrice, salePrice) : salePrice;
      const barcode = String(row.barcode ?? "").trim() || null;
      const description = String(row.description ?? "").trim() || null;

      // دسته‌بندی: مقدار مستقیم یا ترکیب «گروه اصلی / گروه فرعی»
      let category = String(row.category ?? "").trim() || null;
      if (!category) {
        category =
          combineCategory(String(row.categoryMain ?? ""), String(row.categorySub ?? "")) || null;
      }

      if (!name) {
        errors.push({ row: idx, message: "نام کالا الزامی است" });
        continue;
      }

      // FIX(auto-sku): اگر کد کالا خالی بود، خودکار تولید کن (یکتا در فایل)
      if (!sku) {
        autoSkuCounter++;
        sku = `IMP-${autoSkuStamp}-${autoSkuRand}-${String(autoSkuCounter).padStart(4, "0")}`;
        while (seenSkus.has(sku) || skuMap.has(sku)) {
          autoSkuCounter++;
          sku = `IMP-${autoSkuStamp}-${autoSkuRand}-${String(autoSkuCounter).padStart(4, "0")}`;
        }
      }

      // موجودی اولیه (فقط وقتی ستون موجودی در فایل مقدار داشت)
      const stockProvided = cellFilled(row.stock);
      const stock = stockProvided ? toNumber(row.stock, 0) : 0;

      if (seenSkus.has(sku)) {
        errors.push({ row: idx, message: `کد کالا تکراری در همین فایل: ${sku}` });
        continue;
      }
      seenSkus.add(sku);

      const existing = skuMap.get(sku);
      if (existing) {
        if (strategy === "update") {
          // به‌روزرسانی قیمت‌ها/توضیحات + تعدیل موجودی (اگر فایل موجودی داشت)
          const updateData: ProductUpdateItem["updateData"] = {};
          if (cellFilled(row.salePrice)) updateData.salePrice = BigInt(Math.round(salePrice));
          if (cellFilled(row.purchasePrice) || avgFilled || lastFilled) {
            updateData.purchasePrice = BigInt(Math.round(purchasePrice));
          }
          if (row.wholesalePrice !== undefined && cellFilled(row.wholesalePrice)) {
            updateData.wholesalePrice = BigInt(Math.round(wholesalePrice));
          }
          if (description) updateData.description = description;
          updates.push({
            row: idx,
            productId: existing.id,
            sku,
            updateData,
            newStock: stockProvided ? Math.max(stock, 0) : undefined,
          });
          // SKU تازه به‌روزرسانی‌شده را در نقشه نگه دار (زنجیره چانک‌ها)
          skuMap.set(sku, {
            id: existing.id,
            purchasePrice: updateData.purchasePrice ?? existing.purchasePrice,
          });
        } else {
          skipped++;
          skippedRows.push({ row: idx, message: `کد کالا تکراری: ${sku}` });
        }
        continue;
      }

      // دسته‌بندی: پیدا/بساز (فقط برای ایجادها) — با کش catMap
      let categoryId: string | null = null;
      if (category) {
        if (failedCategories.has(category)) {
          errors.push({ row: idx, message: `دسته‌بندی ساخته نشد: ${category}` });
          continue;
        }
        const cached = catMap.get(category);
        if (cached) {
          categoryId = cached;
        } else {
          try {
            const cat = await db.productCategory.create({
              data: { tenantId, name: category },
            });
            catMap.set(category, cat.id);
            categoryId = cat.id;
          } catch {
            failedCategories.add(category);
            errors.push({ row: idx, message: `دسته‌بندی ساخته نشد: ${category}` });
            continue;
          }
        }
      }

      // SKU موقت را برای زنجیره چانک‌ها در نقشه درون‌درخواستی ثبت نکن —
      // تکراری داخل فایل قبلاً با seenSkus گرفته می‌شود
      creates.push({
        row: idx,
        sku,
        name,
        unit,
        barcode,
        description,
        categoryId,
        salePrice,
        purchasePrice,
        wholesalePrice,
        stock,
      });
    } catch (err) {
      errors.push({
        row: idx,
        message: err instanceof Error ? err.message : "خطا در آماده‌سازی ردیف کالا",
      });
    }
  }

  // ۴) انبار پیش‌فرض — فقط اگر به موجودی نیاز باشد (مثل POST /api/products
  //    که فقط با stock>0 انبار می‌سازد؛ resolveDefaultWarehouse در نبود انبار
  //    «انبار اصلی» ایجاد می‌کند)
  let warehouseId: string | null = null;
  const needsStock =
    creates.some((c) => c.stock > 0) || updates.some((u) => u.newStock !== undefined);
  if (needsStock) {
    warehouseId = await resolveDefaultWarehouse(tenantId);
  }

  // ۵) موجودی فعلی کالاهایی که به‌روزرسانی می‌شوند (یک کوئری)
  const currentStock = new Map<string, number>();
  if (warehouseId && updates.some((u) => u.newStock !== undefined)) {
    const updateIds = updates.filter((u) => u.newStock !== undefined).map((u) => u.productId);
    const stockItems = await db.stockItem.findMany({
      where: { tenantId, warehouseId, productId: { in: updateIds } },
      select: { productId: true, quantity: true },
    });
    for (const s of stockItems) currentStock.set(s.productId, s.quantity);
  }

  let created = 0;
  let updated = 0;

  // کلاینت دیتابیس (db یا کلاینت تراکنش تعاملی — ساختار یکسان)
  type DbLike = typeof db;

  // ایجاد یک کالا + موجودی اولیه (آینه‌ی POST /api/products → setProductStock
  // → applyStockChange: StockItem + StockMovement{type IN, referenceType ADJUSTMENT})
  const createProductRow = async (
    tx: DbLike,
    item: ProductCreateItem,
    whId: string | null
  ): Promise<void> => {
    const productId = randomUUID();
    await tx.product.create({
      data: {
        id: productId,
        tenantId,
        sku: item.sku,
        name: item.name,
        unit: item.unit,
        type: "GOODS",
        barcode: item.barcode,
        description: item.description,
        categoryId: item.categoryId,
        purchasePrice: BigInt(Math.round(item.purchasePrice)),
        salePrice: BigInt(Math.round(item.salePrice)),
        wholesalePrice: BigInt(Math.round(item.wholesalePrice)),
      },
    });
    if (whId && item.stock > 0) {
      // StockItem (قید یکتای tenant+product+warehouse — کالای تازه است → create)
      await tx.stockItem.create({
        data: { tenantId, productId, warehouseId: whId, quantity: item.stock },
      });
      // StockMovement — دقیقاً مثل applyStockChange با unitCost=null:
      // type=IN، referenceType=ADJUSTMENT، unitCost=قیمت خرید کالا (میانگین)
      const movementCost = item.purchasePrice > 0 ? BigInt(Math.round(item.purchasePrice)) : null;
      await tx.stockMovement.create({
        data: {
          tenantId,
          productId,
          type: "IN",
          quantity: item.stock,
          fromWarehouseId: null,
          toWarehouseId: whId,
          referenceType: "ADJUSTMENT",
          referenceId: null,
          unitCost: movementCost,
        },
      });
    }
  };

  // ۶) ایجاد گروهی — تراکنش‌های ۲۰۰تایی (SQLite) با fallback سطری
  const BATCH = 200;
  for (let i = 0; i < creates.length; i += BATCH) {
    const batch = creates.slice(i, i + BATCH);
    try {
      await db.$transaction(async (tx) => {
        for (const item of batch) {
          await createProductRow(tx as unknown as DbLike, item, warehouseId);
        }
      });
      created += batch.length;
    } catch {
      // شکک تراکنش دسته → تلاش سطری تا خطا دقیقاً به ردیفِ مقصر نسبت یابد
      for (const item of batch) {
        try {
          await createProductRow(db, item, warehouseId);
          created++;
        } catch (err) {
          errors.push({
            row: item.row,
            message: err instanceof Error ? err.message : "خطا در ایجاد کالا",
          });
        }
      }
    }
  }

  // ۷) به‌روزرسانی گروهی (استراتژی update)
  const updateOne = async (tx: DbLike, u: ProductUpdateItem): Promise<void> => {
    if (Object.keys(u.updateData).length > 0) {
      await tx.product.update({
        where: { id: u.productId },
        data: u.updateData,
      });
    }
    if (warehouseId && u.newStock !== undefined) {
      const currentQty = currentStock.get(u.productId) ?? 0;
      const delta = u.newStock - currentQty;
      if (delta === 0) return;
      // StockItem — قید یکتای tenant+product+warehouse (مثل applyStockChange)
      const existingItem = await tx.stockItem.findUnique({
        where: {
          tenantId_productId_warehouseId: {
            tenantId,
            productId: u.productId,
            warehouseId,
          },
        },
        select: { id: true },
      });
      if (existingItem) {
        await tx.stockItem.update({
          where: { id: existingItem.id },
          data: { quantity: u.newStock },
        });
      } else {
        await tx.stockItem.create({
          data: { tenantId, productId: u.productId, warehouseId, quantity: u.newStock },
        });
      }
      // حرکت تعدیل — type IN/OUT + referenceType ADJUSTMENT
      const newPurchase = u.updateData.purchasePrice;
      const fallbackPurchase = skuMap.get(u.sku)?.purchasePrice ?? null;
      const unitCostRaw =
        newPurchase !== undefined && newPurchase > 0 ? newPurchase : fallbackPurchase;
      await tx.stockMovement.create({
        data: {
          tenantId,
          productId: u.productId,
          type: delta > 0 ? "IN" : "OUT",
          quantity: Math.abs(delta),
          fromWarehouseId: delta > 0 ? null : warehouseId,
          toWarehouseId: delta > 0 ? warehouseId : null,
          referenceType: "ADJUSTMENT",
          referenceId: null,
          unitCost: unitCostRaw && unitCostRaw > 0 ? unitCostRaw : null,
        },
      });
    }
  };
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    try {
      await db.$transaction(async (tx) => {
        for (const u of batch) {
          await updateOne(tx as unknown as DbLike, u);
        }
      });
      updated += batch.length;
    } catch {
      for (const u of batch) {
        try {
          await updateOne(db, u);
          updated++;
        } catch (err) {
          errors.push({
            row: u.row,
            message: err instanceof Error ? err.message : "خطا در به‌روزرسانی کالا",
          });
        }
      }
    }
  }

  await auditLog({
    tenantId,
    action: "BULK_IMPORT",
    entity: "Product",
    entityId: "bulk",
    changes: {
      count: created,
      updated,
      skipped,
      errors: errors.length,
      total: rows.length,
      strategy,
      fileName: fileName ?? null,
    },
    req,
  });

  return { created, updated, skipped, errors, skippedRows };
}

async function importParties(
  rowsRaw: Record<string, unknown>[],
  tenantId: string,
  req: NextRequest,
  fileName?: string
): Promise<{
  created: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
  skippedRows: ImportError[];
}> {
  const errors: ImportError[] = [];
  const rows = rowsRaw.map(normalizeRowKeys);

  const validTypes = new Set(["CUSTOMER", "SUPPLIER", "BOTH"]);

  // نگاشت مقادیر فارسی نوع طرف‌حساب → مقادیر سیستم
  const persianTypeMap: Record<string, string> = {
    "مشتری": "CUSTOMER", "خریدار": "CUSTOMER", "فروش": "CUSTOMER",
    "تامین‌کننده": "SUPPLIER", "تأمین‌کننده": "SUPPLIER", "فروشنده": "SUPPLIER", "خرید": "SUPPLIER",
    "هردو": "BOTH", "مشتری/فروشنده": "BOTH",
  };

  // FIX(21-A): پیش‌بارگذاری همهٔ کدها در یک کوئری (به‌جای findFirst سطر به سطر)
  const existingParties = await db.party.findMany({
    where: { tenantId, deletedAt: null },
    select: { code: true },
  });
  const codeSet = new Set(existingParties.map((p) => p.code));
  const seenCodes = new Set<string>();

  // FIX(auto-code): شمارنده برای تولید خودکار کد وقتی کد در فایل نیست
  let autoCodeCounter = 0;
  const autoStamp = Date.now().toString(36).toUpperCase().slice(-4);
  const autoRand = Math.random().toString(36).toUpperCase().slice(2, 5);

  interface PartyCreateItem {
    row: number;
    data: Prisma.PartyUncheckedCreateInput;
  }
  const creates: PartyCreateItem[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const idx = i + 1;
    try {
      let code = String(row.code ?? "").trim();
      const name = String(row.name ?? "").trim();
      const typeRaw = String(row.type ?? "CUSTOMER").trim();
      const type = validTypes.has(typeRaw.toUpperCase())
        ? typeRaw.toUpperCase()
        : persianTypeMap[typeRaw] ?? "CUSTOMER";
      const phone = String(row.phone ?? "").trim() || null;
      const mobile = String(row.mobile ?? "").trim() || null;
      const email = String(row.email ?? "").trim() || null;
      const address = String(row.address ?? "").trim() || null;
      // FIX(3b-بیگ۱۰): نرمال‌سازی ارقام فارسی کد ملی قبل از رمزنگاری/ایندکس
      const nationalId = toEnglishDigits(String(row.nationalId ?? "").trim()).replace(/[\s\-(),،.]/g, "") || null;
      // FIX(modian-import): پشتیبانی کد اقتصادی و کد مالیاتی — برای کاربرانی که
      // از هلو/سپیدار/محک می‌آیند و اطلاعات مودیان‌شان را هم می‌آورند
      const economicCode = toEnglishDigits(String(row.economicCode ?? "").trim()).replace(/[\s\-(),،.]/g, "") || null;
      const taxId = toEnglishDigits(String(row.taxId ?? "").trim()).replace(/[\s\-(),،.]/g, "") || null;

      if (!name) {
        errors.push({ row: idx, message: "نام طرف‌حساب الزامی است" });
        continue;
      }

      // FIX(auto-code): اگر کد خالی بود، خودکار تولید کن
      if (!code) {
        autoCodeCounter++;
        code = `C-${autoStamp}-${autoRand}-${String(autoCodeCounter).padStart(4, "0")}`;
        while (seenCodes.has(code) || codeSet.has(code)) {
          autoCodeCounter++;
          code = `C-${autoStamp}-${autoRand}-${String(autoCodeCounter).padStart(4, "0")}`;
        }
      }

      if (seenCodes.has(code)) {
        errors.push({ row: idx, message: `کد طرف‌حساب تکراری در همین فایل: ${code}` });
        continue;
      }
      seenCodes.add(code);

      if (codeSet.has(code)) {
        errors.push({ row: idx, message: `کد طرف‌حساب تکراری: ${code}` });
        continue;
      }
      codeSet.add(code);

      creates.push({
        row: idx,
        data: {
          tenantId,
          code,
          name,
          type,
          phone,
          mobile,
          email,
          address,
          nationalId: encryptField(nationalId),
          // FIX(3b-بیگ‌۸): ایندکس کور کد ملی — برای جستجوی واقعی (nationalId رمز است)
          nationalIdIndex: nationalIdBlindIndex(nationalId),
          economicCode,
          taxId,
          creditLimit: BigInt(0),
          openingBalance: BigInt(0),
        },
      });
    } catch (err) {
      errors.push({
        row: idx,
        message: err instanceof Error ? err.message : "خطا در آماده‌سازی ردیف طرف‌حساب",
      });
    }
  }

  // ایجاد گروهی — تراکنش‌های ۲۰۰تایی با fallback سطری
  let created = 0;
  const BATCH = 200;
  for (let i = 0; i < creates.length; i += BATCH) {
    const batch = creates.slice(i, i + BATCH);
    try {
      await db.$transaction(async (tx) => {
        for (const item of batch) {
          await tx.party.create({ data: item.data });
        }
      });
      created += batch.length;
    } catch {
      for (const item of batch) {
        try {
          await db.party.create({ data: item.data });
          created++;
        } catch (err) {
          errors.push({
            row: item.row,
            message: err instanceof Error ? err.message : "خطا در ایجاد طرف‌حساب",
          });
        }
      }
    }
  }

  await auditLog({
    tenantId,
    action: "BULK_IMPORT",
    entity: "Party",
    entityId: "bulk",
    changes: {
      count: created,
      updated: 0,
      skipped: 0,
      errors: errors.length,
      total: rows.length,
      fileName: fileName ?? null,
    },
    req,
  });

  return { created, updated: 0, skipped: 0, errors, skippedRows: [] };
}

async function importInvoices(
  rowsRaw: Record<string, unknown>[],
  tenantId: string,
  req: NextRequest,
  fileName?: string
): Promise<{
  created: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
  skippedRows: ImportError[];
}> {
  let created = 0;
  const errors: ImportError[] = [];
  const rows = rowsRaw.map(normalizeRowKeys);

  // FIX(3b-بیگ‌۵/۶): نرخ مالیات ارزش افزوده از SystemSettings (tax.vatRate —
  // درصد، پیش‌فرض ۱۰٪) — قبلاً ۰٫۰۹ hardcode بود (نرخ قانونی از ۱۴۰۴ = ۱۰٪).
  const vatRate = await getVatRateFraction();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const idx = i + 1;
    try {
      const number = String(row.number ?? "").trim();
      const dateRaw = row.date;
      const partyCode = String(row.partyCode ?? "").trim();
      // FIX(migration): پشتیبانی از partyName — وقتی فقط «نام مشتری» در فایل هست
      // (خروجی بسیاری از نرم‌افزارها فقط نام دارد نه کد) اول با کد، بعد با نام
      // می‌گردیم؛ اگر نبود، طرف‌حساب جدید با کد خودکار ساخته می‌شود.
      const partyName = String(row.partyName ?? row.name ?? "").trim(); // «نام مشتری» → name نرمال‌سازی می‌شود
      const itemsStr = String(row.items ?? "").trim();
      const totalInput = toNumber(row.total, 0);

      if (!number || (!partyCode && !partyName) || !itemsStr) {
        errors.push({ row: idx, message: "شماره فاکتور و مشتری (کد یا نام) و اقلام الزامی هستند" });
        continue;
      }

      // پیدا کردن طرف‌حساب با کد — سپس با نام
      let party = partyCode
        ? await db.party.findFirst({
            where: { tenantId, code: partyCode, deletedAt: null },
            select: { id: true },
          })
        : null;
      if (!party && partyName) {
        party = await db.party.findFirst({
          where: { tenantId, name: partyName, deletedAt: null },
          select: { id: true },
        });
      }
      // اگر پیدا نشد ولی نام داشتیم → ساخت خودکار طرف‌حساب با کد یکتا
      if (!party && partyName) {
        const autoCode = "MIG-" + Date.now().toString(36).toUpperCase().slice(-6) + "-" + String(idx).padStart(3, "0");
        party = await db.party.create({
          data: {
            tenantId,
            code: autoCode,
            name: partyName,
            type: "CUSTOMER",
            creditLimit: BigInt(0),
            openingBalance: BigInt(0),
          },
        });
      }
      if (!party) {
        errors.push({ row: idx, message: `طرف‌حساب با کد ${partyCode} یافت نشد` });
        continue;
      }

      // بررسی تکراری نبودن شماره فاکتور
      const invExists = await db.invoice.findFirst({
        where: { tenantId, number },
        select: { id: true },
      });
      if (invExists) {
        errors.push({ row: idx, message: `شماره فاکتور تکراری: ${number}` });
        continue;
      }

      const items = parseItems(itemsStr);
      if (items.length === 0) {
        errors.push({ row: idx, message: "اقلام فاکتور نامعتبر است" });
        continue;
      }

      // محاسبه مبالغ — با نرخ مالیاتِ تنظیمات (نه ۹٪ hardcode)
      let subtotal = 0;
      let tax = 0;
      const processedItems = items.map((it) => {
        const lineTotal = it.quantity * it.unitPrice;
        const lineTax = lineTotal * vatRate;
        subtotal += lineTotal;
        tax += lineTax;
        return {
          description: it.description,
          quantity: it.quantity,
          unitPrice: BigInt(Math.round(it.unitPrice)),
          discount: 0,
          taxRate: vatRate,
          taxAmount: BigInt(Math.round(lineTax)),
          total: BigInt(Math.round(lineTotal + lineTax)),
        };
      });

      const totalCalc = subtotal + tax;
      // استفاده از مبلغ ورودی یا مبلغ محاسبه‌شده
      const finalTotal = totalInput > 0 ? totalInput : totalCalc;

      await db.invoice.create({
        data: {
          tenantId,
          number,
          type: "SALE",
          partyId: party.id,
          date: normalizeDate(dateRaw),
          subtotal: BigInt(Math.round(subtotal)),
          tax: BigInt(Math.round(tax)),
          total: BigInt(Math.round(finalTotal)),
          status: "DRAFT",
          modianStatus: "PENDING",
          currency: "IRR",
          exchangeRate: 1,
          items: { create: processedItems },
        },
      });
      created++;
    } catch (err) {
      errors.push({
        row: idx,
        message: err instanceof Error ? err.message : "خطا در ایجاد فاکتور",
      });
    }
  }

  await auditLog({
    tenantId,
    action: "BULK_IMPORT",
    entity: "Invoice",
    entityId: "bulk",
    changes: {
      count: created,
      updated: 0,
      skipped: 0,
      errors: errors.length,
      total: rows.length,
      fileName: fileName ?? null,
    },
    req,
  });

  return { created, updated: 0, skipped: 0, errors, skippedRows: [] };
}

// ============ Route ============

// GET /api/import — تاریخچه واقعی واردات (از AuditLog با اکشن BULK_IMPORT)
// FIX: قبلاً UI تاریخچه را به‌صورت داده‌ی فیک (SAMPLE_HISTORY) نشان می‌داد.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;
    const tenantId = auth.user.tenantId;

    const logs = await db.auditLog.findMany({
      where: { tenantId, action: "BULK_IMPORT" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        entity: true,
        changes: true,
        createdAt: true,
      },
    });

    const history = logs.map((log) => {
      let changes: {
        count?: number;
        updated?: number;
        skipped?: number;
        errors?: number;
        total?: number;
        fileName?: string;
      } = {};
      try {
        changes = log.changes ? JSON.parse(log.changes) : {};
      } catch {
        /* ignore */
      }
      const total = changes.total ?? 0;
      const created = changes.count ?? 0;
      const updated = changes.updated ?? 0;
      const skipped = changes.skipped ?? 0;
      const success = created + updated;
      const errorCount =
        changes.errors ?? Math.max(total - created - updated - skipped, 0);
      const status =
        success === 0 && errorCount > 0
          ? "failed"
          : errorCount > 0
            ? "partial"
            : "success";
      return {
        id: log.id,
        entity: (log.entity || "products").toLowerCase(),
        fileName: typeof changes.fileName === "string" ? changes.fileName : "",
        totalRows: total,
        createdRows: created,
        updatedRows: updated,
        skippedRows: skipped,
        successRows: success,
        errorRows: errorCount,
        date: log.createdAt.toISOString(),
        status: status as "success" | "partial" | "failed",
      };
    });

    return NextResponse.json({ success: true, data: history });
  } catch {
    return NextResponse.json(
      { success: false, error: "خطا در دریافت تاریخچه واردات" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    // احراز هویت کاربر — فقط کاربران واردشده می‌توانند داده وارد کنند
    let tenantIdFromAuth: string | undefined;
    try {
      const auth = await requireUser(req);
      if (!("error" in auth)) {
        tenantIdFromAuth = auth.user.tenantId;
      }
    } catch {
      // fallback به Bearer auth
    }

    // احراز هویت Bearer (اختیاری — فقط اگر IMPORT_BEARER_TOKEN تنظیم شده باشد)
    if (!tenantIdFromAuth && !verifyBearer(req)) {
      return NextResponse.json(
        {
          success: false,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: [],
          skippedRows: [],
          error: "احراز هویت الزامی است",
        } satisfies ImportResponse,
        { status: 401 }
      );
    }

    // Rate limiting (per-IP) — FIX(21-A): از ۳۰ به ۲۴۰ در دقیقه افزایش یافت چون
    // ایمپورت تا ۱۰۰,۰۰۰ ردیف به‌صورت چانک‌های ۵۰۰تایی (~۲۰۰ درخواست) ارسال می‌شود
    const ip = getClientIp(req);
    const rl = rateLimitCheck(`bulk-import:${ip}`, 240, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        {
          success: false,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: [],
          skippedRows: [],
          error: "درخواست بیش از حد. کمی بعد تلاش کنید.",
        } satisfies ImportResponse,
        { status: 429 }
      );
    }

    const body = await req.json();
    const entityType = body.entityType as EntityType;
    const data: Record<string, unknown>[] = Array.isArray(body.data) ? body.data : [];
    const strategyRaw = String(body.duplicateStrategy ?? "skip");
    const strategy: DuplicateStrategy = strategyRaw === "update" ? "update" : "skip";

    if (!entityType || !["invoices", "products", "parties"].includes(entityType)) {
      return NextResponse.json(
        {
          success: false,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: [],
          skippedRows: [],
          error: "نوع موجودیت نامعتبر است",
        } satisfies ImportResponse,
        { status: 400 }
      );
    }
    if (data.length === 0) {
      return NextResponse.json(
        {
          success: false,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: [],
          skippedRows: [],
          error: "داده‌ای برای وارد کردن وجود ندارد",
        } satisfies ImportResponse,
        { status: 400 }
      );
    }
    // FIX(21-A): سقف هر درخواست ۵۰۰۰ ردیف (کلاینت فایل‌های بزرگ‌تر را به چانک
    // تقسیم می‌کند؛ سقف کل فایل ۱۰۰,۰۰۰ ردیف در کلاینت تضمین می‌شود)
    if (data.length > MAX_ROWS_PER_REQUEST) {
      return NextResponse.json(
        {
          success: false,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: [],
          skippedRows: [],
          error: `حداکثر ${MAX_ROWS_PER_REQUEST} ردیف در هر درخواست مجاز است — فایل را به بخش‌های کوچکتر تقسیم کنید`,
        } satisfies ImportResponse,
        { status: 400 }
      );
    }

    const tenant = tenantIdFromAuth
      ? await db.tenant.findUnique({ where: { id: tenantIdFromAuth } })
      : null;
    if (!tenant) {
      return NextResponse.json(
        {
          success: false,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: [],
          skippedRows: [],
          error: "احراز هویت الزامی است — tenant کاربر پیدا نشد",
        } satisfies ImportResponse,
        { status: 401 }
      );
    }

    let result: {
      created: number;
      updated: number;
      skipped: number;
      errors: ImportError[];
      skippedRows: ImportError[];
    };
    const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 200) : undefined;
    if (entityType === "products") {
      result = await importProducts(data, tenant.id, req, fileName, strategy);
    } else if (entityType === "parties") {
      result = await importParties(data, tenant.id, req, fileName);
    } else {
      result = await importInvoices(data, tenant.id, req, fileName);
    }

    return NextResponse.json({
      success: true,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
      skippedRows: result.skippedRows,
    } satisfies ImportResponse);
  } catch (error) {
    console.error("Bulk import error:", error);
    return NextResponse.json(
      {
        success: false,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [],
        skippedRows: [],
        error: error instanceof Error ? error.message : "خطا در وارد کردن داده",
      } satisfies ImportResponse,
      { status: 500 }
    );
  }
}
