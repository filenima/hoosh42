/**
 * تعریف یکپارچه پلن‌ها و قیمت‌ها — تمام صفحات باید از این فایل بخوانند.
 * --------------------------------------------------------------------------
 * منبع واحد قیمت‌گذاری هوش. هر تغییری در قیمت‌ها فقط در اینجا انجام شود.
 *
 * قیمت‌ها به تومان ایران (سالانه):
 * - رایگان: ۰ تومان
 * - پایه: ۹,۷۵۰,۰۰۰ تومان/سال
 * - حرفه‌ای: ۱۳,۹۰۰,۰۰۰ تومان/سال (محبوب‌ترین)
 * - سازمانی: ۳۴,۹۰۰,۰۰۰ تومان/سال
 *
 * تمام مبالغ به تومان است. برای ریال ضرب در ۱۰.
 */

export type PlanId = "free" | "basic" | "pro" | "enterprise";

export interface Plan {
 id: PlanId;
 /** نام نمایشی فارسی */
 name: string;
 /** نام انگلیسی برای API و دیتابیس */
 nameEn: string;
 /** قیمت سالانه به تومان */
 priceToman: number;
 /** قیمت سالانه به ریال */
 priceRial: number;
 /** دوره صورتحساب */
 period: "سالانه" | "رایگان";
 /** توضیح کوتاه */
 description: string;
 /** لیست امکانات */
 features: string[];
 /** پلن محبوب؟ */
 popular?: boolean;
 /** متن دکمه CTA */
 cta: string;
 /** رنگ تم پلن (برای کارت) */
 accent: "slate" | "emerald" | "violet" | "amber";
 /** حداکثر کاربر */
 maxUsers: number;
 /** حداکثر انبار */
 maxWarehouses: number;
 /**
 * FIX(v18-لایسنس): سقف فاکتور سالانه — -1 یعنی نامحدود.
 * منبع واحد برای اعمال سهمیه (server-side) و ساخت لایسنس.
 */
 maxInvoices: number;
 /** آیا آزمایش رایگان دارد؟ */
 trialAvailable: boolean;
 /** تعداد روزهای آزمایش رایگان (در صورت وجود) */
 trialDays?: number;
 /** آیا پلن در صفحه قیمت‌گذاری مخفی باشد؟ (برای backward compat) */
 hidden?: boolean;
}

export const PLANS: Plan[] = [
 {
 id: "free",
 name: "رایگان",
 nameEn: "Free",
 priceToman: 0,
 priceRial: 0,
 period: "رایگان",
 description: "۱۴ روز رایگان با تمام امکانات — بدون نیاز به کارت بانکی",
 features: [
 "۱۴ روز دسترسی کامل به تمام امکانات",
 "۲ کاربر + ۲ انبار",
 "تا ۵۰ فاکتور در ماه",
 "حسابداری پایه و گزارش ساده",
 "داشبورد پایه",
 "پشتیبانی ایمیلی (۴۸ ساعت پاسخ)",
 ],
 cta: "شروع آزمایش ۱۴ روزه",
 accent: "slate",
 // FIX(v10-plans): سقف کاربر/انبار دوبرابر شد (درخواست صریح مالک پلتفرم)
 maxUsers: 2,
 maxWarehouses: 2,
 maxInvoices: 600,
 trialAvailable: true,
 trialDays: 14,
 hidden: true,
 },
 {
 id: "basic",
 name: "پایه",
 nameEn: "Basic",
 priceToman: 9_750_000,
 priceRial: 97_500_000,
 period: "سالانه",
 description: "برای فروشگاه‌های کوچک و کسب‌وکارهای نوپا",
 features: [
 "۲ کاربر + ۴ انبار",
 "تا ۲,۴۰۰ فاکتور در سال",
 "حسابداری، انبار، خرید و فروش",
 "ارز و نرخ لحظه‌ای طلا و دلار",
 "اتصال به سامانه مودیان",
 "چک و خزانه‌داری",
 "داشبورد و گزارش‌های پایه",
 "اپ موبایل + PWA",
 "پشتیبانی ایمیلی",
 ],
 cta: "انتخاب پلن پایه",
 accent: "emerald",
 // FIX(v10-plans): سقف کاربر/انبار دوبرابر شد (درخواست صریح مالک پلتفرم)
 maxUsers: 2,
 maxWarehouses: 4,
 maxInvoices: 2_400,
 trialAvailable: true,
 },
 {
 id: "pro",
 name: "حرفه‌ای",
 nameEn: "Professional",
 priceToman: 13_900_000,
 priceRial: 139_000_000,
 period: "سالانه",
 description: "محبوب‌ترین انتخاب شرکت‌های کوچک و متوسط",
 features: [
 "۴ کاربر + ۶ انبار",
 "تمام ماژول‌های حسابداری",
 "هوش مصنوعی (OCR + چت‌بات + پیش‌بینی)",
 "اتصال به ووکامرس و دیجی‌کالا",
 "حقوق و دستمزد + ارزش افزوده",
 "CRM + باشگاه مشتریان",
 "اپ موبایل + PWA",
 "API کامل + Webhook",
 "پشتیبانی تلفنی اولویت‌دار",
 ],
 popular: true,
 cta: "انتخاب پلن حرفه‌ای",
 accent: "violet",
 // FIX(v10-plans): سقف کاربر/انبار دوبرابر شد (درخواست صریح مالک پلتفرم)
 maxUsers: 4,
 maxWarehouses: 6,
 maxInvoices: 15_000,
 trialAvailable: true,
 },
 {
 id: "enterprise",
 name: "سازمانی",
 nameEn: "Enterprise",
 priceToman: 34_900_000,
 priceRial: 349_000_000,
 period: "سالانه",
 description: "برای شرکت‌های بزرگ، تولیدی و پیمانکاری",
 features: [
 "کاربر و انبار نامحدود",
 "۱۶ ماژول کامل + تولیدی پیشرفته",
 "هوش مصنوعی پیشرفته (تشخیص تقلب + ML)",
 "پیمانکاری + BOM چندسطحی",
 "GraphQL + Multi-company",
 "SSO + Audit Trail پیشرفته",
 "بکاپ ابری رمزنگاری‌شده",
 "مدیر اختصاصی حساب + SLA",
 "پشتیبانی ۲۴/۷ اختصاصی",
 ],
 cta: "تماس با فروش",
 accent: "amber",
 maxUsers: -1, // نامحدود
 maxWarehouses: -1, // نامحدود
 maxInvoices: -1, // نامحدود
 trialAvailable: true,
 },
];

/** پلن‌های قابل نمایش در صفحه قیمت‌گذاری (پلن‌های مخفی حذف شده‌اند) */
export const VISIBLE_PLANS: Plan[] = PLANS.filter((p) =>!p.hidden);

/** نقشه‌ی سریع id پلن */
export const PLAN_BY_ID: Record<PlanId, Plan> = PLANS.reduce(
 (acc, p) => {
 acc[p.id] = p;
 return acc;
 },
 {} as Record<PlanId, Plan>
);

/** قیمت‌ها به تومان — برای محاسبات درآمد داخلی */
export const PLAN_PRICES_TOMAN: Record<string, number> = PLANS.reduce(
 (acc, p) => {
 acc[p.id] = p.priceToman;
 return acc;
 },
 {} as Record<string, number>
);

/** پلن‌های معتبر برای API */
export const VALID_PLANS: string[] = PLANS.map((p) => p.id);

/**
 * FIX(v18-لایسنس): تنظیمات پیش‌فرض ساخت لایسنس بر اساس پلن — منبع واحد.
 * قبلاً ۴ جای مختلف ۴ ماتریس متناقض داشتند (plans.ts / platform/licenses /
 * quick-login / payment-verify). حالا همه از اینجا می‌خوانند.
 * features = توکن‌های ماشینی (نه متن فارسی) — هم‌راستا با lib/plan-features.ts
 */
export interface LicenseDefaults {
 maxUsers: number;
 maxInvoices: number;
 maxWarehouses: number;
 features: string[];
}

export const LICENSE_DEFAULTS: Record<PlanId, LicenseDefaults> = {
 free: {
 // FIX(v10-plans): سقف کاربر/انبار دوبرابر — هم‌راستا با PLANS بالا
 maxUsers: 2,
 maxInvoices: 600,
 maxWarehouses: 2,
 features: ["core", "dashboard", "invoices", "calculator"],
 },
 basic: {
 maxUsers: 2,
 maxInvoices: 2_400,
 maxWarehouses: 4,
 features: [
 "core", "dashboard", "invoices", "calculator",
 "inventory", "treasury", "multi-currency", "modian", "crm",
 "reports-basic", "price-alerts",
 ],
 },
 pro: {
 maxUsers: 4,
 maxInvoices: 15_000,
 maxWarehouses: 6,
 features: [
 "core", "dashboard", "invoices", "calculator",
 "inventory", "treasury", "multi-currency", "modian", "crm",
 "reports-builder", "budget", "forecast", "ai",
 "payroll", "tax", "tax-filing", "bank-reconciliation",
 "fixed-assets", "manufacturing", "payment", "api",
 "time-attendance", "loyalty", "market-sync",
 ],
 },
 enterprise: {
 maxUsers: -1,
 maxInvoices: -1,
 maxWarehouses: -1,
 features: ["all"],
 },
};

/** گرفتن تنظیمات پیش‌فرض لایسنس یک پلن (با normalize نام‌های قدیمی) */
export function getLicenseDefaults(plan: string): LicenseDefaults {
 const normalized = normalizePlanName(plan) as PlanId;
 const base = LICENSE_DEFAULTS[normalized]?? LICENSE_DEFAULTS.free;
 // FIX(v12.1): ادغام پوشش‌های سوپرادمین (اگر در کش هستند)
 const ov = getCachedPlanOverrides()[normalized];
 if (ov) {
 return {
 maxUsers: ov.maxUsers?? base.maxUsers,
 maxInvoices: ov.maxInvoices?? base.maxInvoices,
 maxWarehouses: ov.maxWarehouses?? base.maxWarehouses,
 features: ov.features?? base.features,
 };
 }
 return base;
}

/**
 * FIX(SECURITY-C1) — تطبیق مبلغ پرداخت با قیمت واقعی پلن.
 * در تسویه پرداخت، مبلغ رکورد ذخیره‌شده باید دقیقاً با قیمت رسمی پلن
 * (با احتساب دوره: ماهانه = ۱/۱۲ قیمت سالانه) برابر باشد؛ در غیر این‌صورت
 * لایسنس صادر نمی‌شود.
 */
export function getPlanByPriceCheck(
 planId: string,
 amountRial: number,
 period: "monthly" | "yearly" = "yearly"
): { ok: boolean; expectedRial: number } {
 const plan = PLAN_BY_ID[planId as PlanId];
 if (!plan) return { ok: false, expectedRial: 0 };
 // پلن رایگان قابل خرید نیست
 if (plan.priceToman <= 0) return { ok: false, expectedRial: 0 };
 const expectedRial =
 period === "monthly"
? Math.round(plan.priceToman / 12) * 10
 : plan.priceRial;
 return { ok: amountRial === expectedRial, expectedRial };
}

// =====================================================================
// FIX(v12.1 — قابلیت جدید): پوشش محدودیت پلن‌ها از پنل سوپرادمین
// ---------------------------------------------------------------------
// سوپرادمین می‌تواند maxUsers/maxInvoices/maxWarehouses هر پلن را
// در SystemSettings (کلید: plan_overrides) تغییر دهد. این ماژول کش
// درون‌حافظه‌ای با TTL دارد و getEffectiveLicenseDefaults آن را با
// پیش‌فرض‌ها ادغام می‌کند.
// =====================================================================

export interface PlanOverride {
 maxUsers?: number;
 maxInvoices?: number;
 maxWarehouses?: number;
  /** لیست کامل قابلیت‌ها (جایگزین کامل پیش‌فرض) */
  features?: string[];
}
export type PlanOverridesMap = Record<string, PlanOverride>;

let planOverridesCache: PlanOverridesMap = {};
let planOverridesLoadedAt = 0;
const PLAN_OVERRIDES_TTL_MS = 30_000;

/** خواندن کش فعلی (بدون fetch) — برای مسیرهای sync */
export function getCachedPlanOverrides(): PlanOverridesMap {
 return planOverridesCache;
}

/**
 * بارگذاری async پوشش‌ها از SystemSettings با TTL — باید در مسیرهای
 * async (ساخت لایسنس/بررسی سهمیه) صدا زده شود.
 * FIX(9-a): سقف‌های v2 (plan_overrides_v2) هم خوانده و روی legacy ادغام
 * می‌شوند (v2 اولویت دارد) — features v2 فقط نمایشی است و روی توکن‌های
 * ماشینی لایسنس اعمال نمی‌شود.
 */
export async function getEffectiveLicenseDefaults(plan: string): Promise<LicenseDefaults> {
 const normalized = normalizePlanName(plan) as PlanId;
 const now = Date.now();
 if (now - planOverridesLoadedAt > PLAN_OVERRIDES_TTL_MS || !planOverridesLoadedAt) {
 try {
 const { db } = await import("@/lib/db");
 const [legacyRow, v2Row] = await Promise.all([
 db.systemSettings.findUnique({ where: { key: "plan_overrides" } }),
 db.systemSettings.findUnique({ where: { key: PLAN_OVERRIDES_V2_KEY } }),
 ]);
 const merged: PlanOverridesMap = {};
 // ۱) پوشش‌های legacy (توکن‌های ماشین + سقف‌ها) — مبنای اولیه
 if (legacyRow?.value) {
 try {
 const parsed = JSON.parse(legacyRow.value) as PlanOverridesMap;
 if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
 Object.assign(merged, parsed);
 }
 } catch {
 // JSON legacy نامعتبر → نادیده
 }
 }
 // ۲) سقف‌های v2 روی آن (اولویت بالاتر)
 if (v2Row?.value) {
 try {
 const v2 = sanitizePlanOverridesV2(JSON.parse(v2Row.value));
 for (const [pid, ov] of Object.entries(v2)) {
 const lim: PlanOverride = { ...(merged[pid] || {}) };
 if (ov.maxUsers !== undefined) lim.maxUsers = ov.maxUsers;
 if (ov.maxInvoices !== undefined) lim.maxInvoices = ov.maxInvoices;
 if (ov.maxWarehouses !== undefined) lim.maxWarehouses = ov.maxWarehouses;
 merged[pid] = lim;
 }
 } catch {
 // JSON v2 نامعتبر → نادیده (بدون کرش)
 }
 }
 planOverridesCache = merged;
 } catch {
 // DB error → پیش‌فرض‌ها استفاده می‌شوند
 }
 planOverridesLoadedAt = now;
 }
 return getLicenseDefaults(normalized);
}

/** اعمال فوری پوشش‌های جدید (بعد از ذخیره سوپرادمین) — کش را به‌روز می‌کند */
export function applyPlanOverrides(overrides: PlanOverridesMap): void {
 planOverridesCache = overrides;
 planOverridesLoadedAt = Date.now();
}

// =====================================================================
// FIX(9-a — ویرایش کامل پلن‌ها): لایه پوشش‌های v2 (قیمت/ویژگی/سقف)
// ---------------------------------------------------------------------
// سوپرادمین می‌تواند علاوه بر سقف‌ها، قیمت (تومان)، نام، توضیح، امکانات
// نمایشی، محبوب‌بودن و مخفی‌بودن هر پلن را در SystemSettings (کلید
// plan_overrides_v2) ویرایش کند. getEffectivePlans این پوشش‌ها را روی
// PLANS استاتیک اعمال می‌کند (کش درون‌حافظه‌ای ۶۰ ثانیه‌ای) — منبع واحد
// نمایش قیمت/ویژگی در سراسر سایت (صفحه قیمت، لندینگ، چک‌اوت، درگاه).
//
// نکته مهم: features در v2 «امکانات نمایشی» (متن فارسی صفحه قیمت) است؛
// توکن‌های ماشینی لایسنس همچنان از LICENSE_DEFAULTS می‌آیند (پوشش legacy
// plan_overrides همچنان روی آن‌ها اعمال می‌شود).
// =====================================================================

/** کلید SystemSettings برای پوشش‌های v2 */
export const PLAN_OVERRIDES_V2_KEY = "plan_overrides_v2";

export interface PlanOverrideV2 {
 /** نام نمایشی جدید (فارسی) */
 name?: string;
 /** توضیح جدید */
 description?: string;
 /** قیمت سالانه به تومان (۰ = رایگان) */
 priceToman?: number;
 /** امکانات نمایشی — هر خط یک مورد (جایگزین کامل پیش‌فرض) */
 features?: string[];
 /** نشان «محبوب‌ترین» */
 popular?: boolean;
 /** مخفی‌کردن از صفحه قیمت‌گذاری */
 hidden?: boolean;
 /** سقف کاربر (-1 = نامحدود) */
 maxUsers?: number;
 /** سقف فاکتور سالانه (-1 = نامحدود) */
 maxInvoices?: number;
 /** سقف انبار (-1 = نامحدود) */
 maxWarehouses?: number;
}
export type PlanOverridesV2Map = Record<string, PlanOverrideV2>;

/** حداکثر قیمت قابل تنظیم — ۱۰ میلیارد تومان */
export const MAX_PLAN_PRICE_TOMAN = 10_000_000_000;
/** حداکثر سقف قابل تنظیم برای کاربر/فاکتور/انبار */
const MAX_PLAN_LIMIT = 1_000_000;

/**
 * اعتبارسنجی/سقف‌گذاری یک عدد محدودیت: فقط عدد صحیح، -1 (نامحدود)
 * یا ≥ ۱ (تا ۱,۰۰۰,۰۰۰). مقدار نامعتبر → undefined (نادیده گرفته می‌شود).
 */
function clampPlanLimit(value: unknown): number | undefined {
 if (value === undefined || value === null || value === "") return undefined;
 const num = Number(value);
 if (!Number.isFinite(num) || !Number.isInteger(num)) return undefined;
 if (num === -1) return -1;
 if (num < 1) return undefined; // 0 نامعتبر است — یا -1 یا حداقل ۱
 return Math.min(num, MAX_PLAN_LIMIT);
}

/**
 * پاک‌سازی کامل نقشه پوشش‌های v2 — خروجی همیشه امن است:
 * فقط پلن‌های معتبر + فیلدهای clamp شده. ورودی نامعتبر → {} (بدون کرش).
 */
export function sanitizePlanOverridesV2(raw: unknown): PlanOverridesV2Map {
 const out: PlanOverridesV2Map = {};
 if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
 for (const [planId, value] of Object.entries(raw as Record<string, unknown>)) {
 if (!(planId in PLAN_BY_ID)) continue; // فقط پلن‌های معتبر
 if (!value || typeof value !== "object") continue;
 const v = value as Record<string, unknown>;
 const clean: PlanOverrideV2 = {};
 if (typeof v.name === "string" && v.name.trim()) {
 clean.name = v.name.trim().slice(0, 60);
 }
 if (typeof v.description === "string" && v.description.trim()) {
 clean.description = v.description.trim().slice(0, 300);
 }
 if (v.priceToman !== undefined && v.priceToman !== null && v.priceToman !== "") {
 const num = Number(v.priceToman);
 if (Number.isFinite(num) && num >= 0) {
 clean.priceToman = Math.min(Math.round(num), MAX_PLAN_PRICE_TOMAN);
 }
 }
 if (Array.isArray(v.features)) {
 const feats = v.features
 .filter((f): f is string => typeof f === "string")
 .map((f) => f.trim().slice(0, 200))
 .filter(Boolean)
 .slice(0, 50);
 if (feats.length > 0) clean.features = feats;
 }
 if (typeof v.popular === "boolean") clean.popular = v.popular;
 if (typeof v.hidden === "boolean") clean.hidden = v.hidden;
 const maxUsers = clampPlanLimit(v.maxUsers);
 if (maxUsers !== undefined) clean.maxUsers = maxUsers;
 const maxInvoices = clampPlanLimit(v.maxInvoices);
 if (maxInvoices !== undefined) clean.maxInvoices = maxInvoices;
 const maxWarehouses = clampPlanLimit(v.maxWarehouses);
 if (maxWarehouses !== undefined) clean.maxWarehouses = maxWarehouses;
 if (Object.keys(clean).length > 0) out[planId] = clean;
 }
 return out;
}

/** اعمال یک پوشش v2 روی پلن پایه — priceRial همیشه از priceToman محاسبه می‌شود */
function applyPlanOverrideV2(base: Plan, ov: PlanOverrideV2): Plan {
 const merged: Plan = { ...base };
 if (ov.name !== undefined) merged.name = ov.name;
 if (ov.description !== undefined) merged.description = ov.description;
 if (ov.priceToman !== undefined) {
 merged.priceToman = ov.priceToman;
 merged.priceRial = ov.priceToman * 10;
 }
 if (ov.features !== undefined) merged.features = ov.features;
 if (ov.popular !== undefined) merged.popular = ov.popular;
 if (ov.hidden !== undefined) merged.hidden = ov.hidden;
 if (ov.maxUsers !== undefined) merged.maxUsers = ov.maxUsers;
 if (ov.maxInvoices !== undefined) merged.maxInvoices = ov.maxInvoices;
 if (ov.maxWarehouses !== undefined) merged.maxWarehouses = ov.maxWarehouses;
 return merged;
}

let effectivePlansCache: Plan[] | null = null;
let effectivePlansLoadedAt = 0;
/** جلوگیری از بارگذاری موازی (dogpile) — همه فراخوان‌های هم‌زمان یک Promise می‌گیرند */
let effectivePlansLoading: Promise<Plan[]> | null = null;
const EFFECTIVE_PLANS_TTL_MS = 60_000;

/**
 * پلن‌های مؤثر — PLANS استاتیک + پوشش‌های v2 سوپرادمین.
 * - کش درون‌حافظه‌ای ۶۰ ثانیه‌ای
 * - JSON نامعتبر → پوشش‌ها بی‌صدا نادیده گرفته می‌شوند (هرگز کرش نمی‌کند)
 * - خطای DB → مقادیر استاتیک برگردانده می‌شوند
 */
export async function getEffectivePlans(): Promise<Plan[]> {
 const now = Date.now();
 if (effectivePlansCache && now - effectivePlansLoadedAt <= EFFECTIVE_PLANS_TTL_MS) {
 return effectivePlansCache;
 }
 if (effectivePlansLoading) return effectivePlansLoading;
 effectivePlansLoading = (async () => {
 try {
 let overrides: PlanOverridesV2Map = {};
 try {
 const { db } = await import("@/lib/db");
 const row = await db.systemSettings.findUnique({
 where: { key: PLAN_OVERRIDES_V2_KEY },
 });
 if (row?.value) {
 overrides = sanitizePlanOverridesV2(JSON.parse(row.value));
 }
 } catch {
 overrides = {}; // JSON نامعتبر یا خطای DB → بدون پوشش
 }
 effectivePlansCache = PLANS.map((p) => {
 const ov = overrides[p.id];
 return ov ? applyPlanOverrideV2(p, ov) : { ...p };
 });
 } catch {
 effectivePlansCache = PLANS.map((p) => ({ ...p }));
 } finally {
 effectivePlansLoadedAt = Date.now();
 effectivePlansLoading = null;
 }
 return effectivePlansCache;
 })();
 return effectivePlansLoading;
}

/** بی‌اعتبار کردن کش پلن‌های مؤثر — بعد از هر ذخیره سوپرادمین صدا زده شود */
export function invalidateEffectivePlansCache(): void {
 effectivePlansCache = null;
 effectivePlansLoadedAt = 0;
}

/** دریافت پلن مؤثر با id (با normalize نام‌های قدیمی) */
export async function getEffectivePlan(planId: string): Promise<Plan | undefined> {
 const normalized = normalizePlanName(planId) as PlanId;
 const plans = await getEffectivePlans();
 return plans.find((p) => p.id === normalized);
}

/**
 * FIX(9-a): نسخه async ِ getPlanByPriceCheck با قیمت مؤثر — این نسخه در تمام
 * مسیرهای تسویه/اعتبارسنجی پرداخت استفاده می‌شود تا قیمت ویرایش‌شدهٔ
 * سوپرادمین واقعاً در چک‌اوت اعمال شود (نه قیمت استاتیک کد).
 */
export async function getPlanByPriceCheckEffective(
 planId: string,
 amountRial: number,
 period: "monthly" | "yearly" = "yearly"
): Promise<{ ok: boolean; expectedRial: number }> {
 const plan = await getEffectivePlan(planId);
 if (!plan) return { ok: false, expectedRial: 0 };
 // پلن رایگان قابل خرید نیست
 if (plan.priceToman <= 0) return { ok: false, expectedRial: 0 };
 const expectedRial =
 period === "monthly"
 ? Math.round(plan.priceToman / 12) * 10
 : plan.priceRial;
 return { ok: amountRial === expectedRial, expectedRial };
}

/**
 * نقشه قیمت مؤثر (id → تومان) — برای گزارش‌های درآمدی/تحلیلی سمت سرور
 * که قبلاً از PLAN_PRICES_TOMAN استاتیک می‌خواندند.
 */
export async function getEffectivePlanPricesToman(): Promise<Record<string, number>> {
 const plans = await getEffectivePlans();
 return plans.reduce(
 (acc, p) => {
 acc[p.id] = p.priceToman;
 return acc;
 },
 {} as Record<string, number>
 );
}

/**
 * نرمال‌سازی نام پلن — یکپارچه‌سازی نام‌های قدیمی و جدید.
 *
 * نگاشت (از نظر تاریخی UI پلن‌های starter/business/accountant می‌فرستاده ولی
 * مدل اصلی ما free/basic/pro/enterprise است):
 * starter free
 * business pro
 * accountant pro
 * enterprise enterprise
 * free / basic / pro بدون تغییر
 *
 * رشته‌های ناشناخته بدون تغییر بازمی‌گردند تا در صورت داده‌ی کثیف، کرش نکنیم.
 */
export function normalizePlanName(plan: string | undefined | null): string {
 if (!plan) return "free";
 const aliases: Record<string, string> = {
 starter: "free",
 business: "pro",
 accountant: "pro",
 enterprise: "enterprise",
 free: "free",
 basic: "basic",
 pro: "pro",
 };
 return aliases[plan]?? plan;
}

/** دریافت پلن با id */
export function getPlan(id: string): Plan | undefined {
 return PLAN_BY_ID[id as PlanId];
}

/** دریافت نام فارسی پلن */
export function getPlanName(id: string): string {
 return PLAN_BY_ID[id as PlanId]?.name?? id;
}

/** تبدیل تومان به ریال */
export function tomanToRial(toman: number): number {
 return toman * 10;
}

/** تبدیل ریال به تومان */
export function rialToToman(rial: number): number {
 return Math.round(rial / 10);
}

/** فرمت‌بندی مبلغ تومان با جداکننده هزارگان فارسی */
export function formatToman(amount: number): string {
 if (amount === 0) return "رایگان";
 return amount.toLocaleString("fa-IR") + " تومان";
}

/** فرمت‌بندی مبلغ ریال با جداکننده هزارگان فارسی */
export function formatRial(amount: number): string {
 if (amount === 0) return "رایگان";
 return amount.toLocaleString("fa-IR") + " ریال";
}

/** فرمت‌بندی مبلغ کوتاه (مثلا ۷.۹ م تومان) */
export function formatTomanShort(amount: number): string {
 if (amount === 0) return "رایگان";
 if (amount >= 1_000_000) {
 return (amount / 1_000_000).toLocaleString("fa-IR", { maximumFractionDigits: 1 }) + " م تومان";
 }
 if (amount >= 1_000) {
 return (amount / 1_000).toLocaleString("fa-IR", { maximumFractionDigits: 0 }) + " هزار تومان";
 }
 return amount.toLocaleString("fa-IR") + " تومان";
}

/**
 * ابزار کمکی برای ساخت data-attribute رنگ پلن (Tailwind)
 */
export function planAccentClasses(accent: Plan["accent"]): {
 badge: string;
 border: string;
 button: string;
 glow: string;
} {
 const map = {
 slate: {
 badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
 border: "border-slate-200 dark:border-slate-800",
 button: "bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900",
 glow: "shadow-slate-200/50 dark:shadow-slate-900/50",
 },
 emerald: {
 badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
 border: "border-emerald-200 dark:border-emerald-900",
 button: "bg-emerald-600 hover:bg-emerald-700 text-white",
 glow: "shadow-emerald-200/50 dark:shadow-emerald-900/50",
 },
 violet: {
 badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
 border: "border-violet-300 dark:border-violet-800",
 button: "bg-violet-600 hover:bg-violet-700 text-white",
 glow: "shadow-violet-300/50 dark:shadow-violet-900/50",
 },
 amber: {
 badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
 border: "border-amber-200 dark:border-amber-900",
 button: "bg-amber-500 hover:bg-amber-600 text-white",
 glow: "shadow-amber-200/50 dark:shadow-amber-900/50",
 },
 };
 return map[accent];
}
