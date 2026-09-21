import { db } from "@/lib/db";
import { DEFAULT_POLICY, type PasswordPolicy } from "@/lib/password-policy";
import { cacheGetOrSet, cacheDeleteByPrefix, CACHE_TTL } from "@/lib/cache";

// ============ System Settings Helpers ============
// خواندن تنظیمات سیستم از دیتابیس با fallback به پیش‌فرض
// قابل استفاده در lib ها و API route های دیگر
//
// توجه: تمام getter‌ها از کش درون‌حافظه‌ای (TTL ۵ دقیقه) استفاده می‌کنند
// چون این تنظیمات به‌ندرت تغییر می‌کنند ولی روی هر درخواست خوانده می‌شوند.
// پس از هر upsert باید cacheDeleteByPrefix("system_settings:") صدا زده شود.

// پیشوند کلید کش برای همه‌ی تنظیمات سیستم
const CACHE_PREFIX = "system_settings:";

const SETTING_KEYS = {
 PASSWORD_POLICY: "password_policy",
 SESSION_TIMEOUT_DAYS: "session_timeout_days",
 AUDIT_RETENTION_DAYS: "audit_retention_days",
 // پیکربندی درگاه‌های پرداخت
 PAYMENT_ZARINPAL_MERCHANT: "payment_zarinpal_merchant",
 PAYMENT_ZARINPAL_ENABLED: "payment_zarinpal_enabled",
 PAYMENT_IDPAY_MERCHANT: "payment_idpay_merchant",
 PAYMENT_IDPAY_ENABLED: "payment_idpay_enabled",
 // FIX(PAY-2): آدرس پایه کال‌بک + حالت sandbox زرین‌پال — قابل ویرایش از پنل سوپرادمین
 PAYMENT_CALLBACK_BASE_URL: "payment_callback_base_url",
 PAYMENT_ZARINPAL_SANDBOX: "payment_zarinpal_sandbox",
 // ===== تنظیمات پلتفرم =====
 MAINTENANCE_MODE: "maintenance_mode",
 MAINTENANCE_MESSAGE: "maintenance_message",
 REGISTRATION_OPEN: "registration_open",
 DEFAULT_TRIAL_DAYS: "default_trial_days",
 DEFAULT_PLAN: "default_plan",
 // ماژول‌های فعال در سطح پلتفرم (JSON array)
 PLATFORM_FEATURE_FLAGS: "platform_feature_flags",
 // تنظیمات ایمیل
 EMAIL_FROM: "email_from",
 EMAIL_FROM_NAME: "email_from_name",
 EMAIL_PROVIDER: "email_provider", // formsubmit | smtp |...
 EMAIL_SMTP_HOST: "email_smtp_host",
 EMAIL_SMTP_PORT: "email_smtp_port",
 EMAIL_SMTP_USER: "email_smtp_user",
 // تنظیمات SEO
 SEO_META_TITLE: "seo_meta_title",
 SEO_META_DESCRIPTION: "seo_meta_description",
 SEO_META_KEYWORDS: "seo_meta_keywords",
 SEO_GA_ID: "seo_ga_id",
 SEO_SEARCH_CONSOLE: "seo_search_console",
 SEO_OG_TITLE: "seo_og_title",
 SEO_OG_DESCRIPTION: "seo_og_description",
 SEO_OG_IMAGE: "seo_og_image",
 SEO_TWITTER_CARD: "seo_twitter_card",
 SEO_ROBOTS_TXT: "seo_robots_txt",
 SEO_SITEMAP_ENABLED: "seo_sitemap_enabled",
 SEO_SOCIAL_TWITTER: "seo_social_twitter",
 SEO_SOCIAL_LINKEDIN: "seo_social_linkedin",
 SEO_SOCIAL_INSTAGRAM: "seo_social_instagram",
 SEO_SOCIAL_TELEGRAM: "seo_social_telegram",
 // ===== تنظیمات ارتباطی (SMTP/SMS/formsubmit) — JSON =====
 SMTP_SETTINGS: "smtp_settings",
 SMS_SETTINGS: "sms_settings",
 FORMSUBMIT_SETTINGS: "formsubmit_settings",
 // ===== حالت‌های پلتفرم =====
 READ_ONLY_MODE: "read_only_mode",
 DEBUG_MODE: "debug_mode",
 // ===== برندینگ =====
 BRANDING_APP_NAME: "branding_app_name",
 BRANDING_SITE_NAME: "branding_site_name",
 BRANDING_PRIMARY_COLOR: "branding_primary_color",
 BRANDING_LOGO_URL: "branding_logo_url",
 BRANDING_FOOTER_TEXT: "branding_footer_text",
 BRANDING_DOMAIN: "branding_domain",
 // ===== نمادهای اعتماد (اینماد و...) — JSON =====
 TRUST_BADGES: "trust_badges",
 // ===== پاداش خودکار گزارش باگ — JSON =====
 // {enabled, criticalDays, highDays, plan} — Task 10-b
 BUG_REWARD_RULES: "bug_reward_rules",
 // ===== هشدارهای سلامت پلتفرم (Telegram + Email) — JSON =====
 // {enabled, telegramBotToken, telegramChatId, emailTo} — Task 12-b
 HEALTH_ALERTS: "health_alerts",
} as const;

// لیست کلیدهای مجاز برای اعتبارسنجی در API
export const ALLOWED_SETTING_KEYS: string[] = [
 SETTING_KEYS.PASSWORD_POLICY,
 SETTING_KEYS.SESSION_TIMEOUT_DAYS,
 SETTING_KEYS.AUDIT_RETENTION_DAYS,
 SETTING_KEYS.PAYMENT_ZARINPAL_MERCHANT,
 SETTING_KEYS.PAYMENT_ZARINPAL_ENABLED,
 SETTING_KEYS.PAYMENT_IDPAY_MERCHANT,
 SETTING_KEYS.PAYMENT_IDPAY_ENABLED,
 SETTING_KEYS.PAYMENT_CALLBACK_BASE_URL,
 SETTING_KEYS.PAYMENT_ZARINPAL_SANDBOX,
 SETTING_KEYS.MAINTENANCE_MODE,
 SETTING_KEYS.MAINTENANCE_MESSAGE,
 SETTING_KEYS.REGISTRATION_OPEN,
 SETTING_KEYS.DEFAULT_TRIAL_DAYS,
 SETTING_KEYS.DEFAULT_PLAN,
 SETTING_KEYS.PLATFORM_FEATURE_FLAGS,
 SETTING_KEYS.EMAIL_FROM,
 SETTING_KEYS.EMAIL_FROM_NAME,
 SETTING_KEYS.EMAIL_PROVIDER,
 SETTING_KEYS.EMAIL_SMTP_HOST,
 SETTING_KEYS.EMAIL_SMTP_PORT,
 SETTING_KEYS.EMAIL_SMTP_USER,
 SETTING_KEYS.SEO_META_TITLE,
 SETTING_KEYS.SEO_META_DESCRIPTION,
 SETTING_KEYS.SEO_META_KEYWORDS,
 SETTING_KEYS.SEO_GA_ID,
 SETTING_KEYS.SEO_SEARCH_CONSOLE,
 SETTING_KEYS.SEO_OG_TITLE,
 SETTING_KEYS.SEO_OG_DESCRIPTION,
 SETTING_KEYS.SEO_OG_IMAGE,
 SETTING_KEYS.SEO_TWITTER_CARD,
 SETTING_KEYS.SEO_ROBOTS_TXT,
 SETTING_KEYS.SEO_SITEMAP_ENABLED,
 SETTING_KEYS.SEO_SOCIAL_TWITTER,
 SETTING_KEYS.SEO_SOCIAL_LINKEDIN,
 SETTING_KEYS.SEO_SOCIAL_INSTAGRAM,
 SETTING_KEYS.SEO_SOCIAL_TELEGRAM,
 SETTING_KEYS.SMTP_SETTINGS,
 SETTING_KEYS.SMS_SETTINGS,
 SETTING_KEYS.FORMSUBMIT_SETTINGS,
 SETTING_KEYS.READ_ONLY_MODE,
 SETTING_KEYS.DEBUG_MODE,
 SETTING_KEYS.BRANDING_APP_NAME,
 SETTING_KEYS.BRANDING_SITE_NAME,
 SETTING_KEYS.BRANDING_PRIMARY_COLOR,
 SETTING_KEYS.BRANDING_LOGO_URL,
 SETTING_KEYS.BRANDING_FOOTER_TEXT,
 SETTING_KEYS.BRANDING_DOMAIN,
 SETTING_KEYS.BUG_REWARD_RULES,
 SETTING_KEYS.HEALTH_ALERTS,
];

// خواندن سیاست رمز عبور — پیش‌فرض DEFAULT_POLICY
export async function getPasswordPolicy(): Promise<PasswordPolicy> {
 return cacheGetOrSet(
 `${CACHE_PREFIX}password_policy`,
 async () => {
 try {
 const setting = await db.systemSettings.findUnique({
 where: { key: SETTING_KEYS.PASSWORD_POLICY },
 });
 if (setting) {
 return {...DEFAULT_POLICY,...JSON.parse(setting.value) };
 }
 } catch {
 // ignore
 }
 return DEFAULT_POLICY;
 },
 CACHE_TTL.MEDIUM
 );
}

// خواندن مدت نشست (روز) — پیش‌فرض ۷
export async function getSessionTimeoutDays(): Promise<number> {
 return cacheGetOrSet(
 `${CACHE_PREFIX}session_timeout_days`,
 async () => {
 try {
 const setting = await db.systemSettings.findUnique({
 where: { key: SETTING_KEYS.SESSION_TIMEOUT_DAYS },
 });
 if (setting) {
 const n = parseInt(setting.value, 10);
 if (!isNaN(n) && n > 0 && n <= 90) return n;
 }
 } catch {
 // ignore
 }
 return 7;
 },
 CACHE_TTL.MEDIUM
 );
}

// خواندن مدت نگهداری لاگ ممیزی — پیش‌فرض ۹۰
export async function getAuditRetentionDays(): Promise<number> {
 return cacheGetOrSet(
 `${CACHE_PREFIX}audit_retention_days`,
 async () => {
 try {
 const setting = await db.systemSettings.findUnique({
 where: { key: SETTING_KEYS.AUDIT_RETENTION_DAYS },
 });
 if (setting) {
 const n = parseInt(setting.value, 10);
 if (!isNaN(n) && n > 0) return n;
 }
 } catch {
 // ignore
 }
 return 90;
 },
 CACHE_TTL.MEDIUM
 );
}

// ============ Payment Gateway Settings ============

export interface PaymentGatewayConfig {
 merchantId: string;
 enabled: boolean;
 configured: boolean; // merchantId غیرخالی و معتبر باشد
 /** حالت sandbox درگاه (فقط زرین‌پال) */
 sandbox?: boolean;
}

export interface PaymentSettings {
 zarinpal: PaymentGatewayConfig;
 idpay: PaymentGatewayConfig;
 /**
 * FIX(PAY-2): آدرس پایه کال‌بک پرداخت (مثل https://hoosh.nobatime.ir)
 * از پنل سوپرادمین قابل تنظیم است — همه مسیرهای پرداخت از این به عنوان
 * مرجع ساخت callback_url استفاده می‌کنند (بالاتر از تشخیص خودکار).
 * خالی = تشخیص خودکار (env → برندینگ → هدرهای پروکسی).
 */
 callbackBaseUrl: string;
}

// ماسک کردن کد پذیرنده برای نمایش امن — فقط ۴ کاراکتر آخر نمایان
export function maskMerchantId(merchant: string): string {
 if (!merchant) return "";
 const trimmed = merchant.trim();
 if (trimmed.length <= 8) return "••••";
 const last4 = trimmed.slice(-4);
 const masked = "•".repeat(Math.min(12, trimmed.length - 4));
 return `${masked}${last4}`;
}

// خواندن تنظیمات درگاه‌های پرداخت — همیشه برای هر دو درگاه برمی‌گردد
export async function getPaymentSettings(): Promise<PaymentSettings> {
 return cacheGetOrSet(
 `${CACHE_PREFIX}payment`,
 async () => {
 const [zMerchant, zEnabled, iMerchant, iEnabled, cbBase, zSandbox] = await Promise.all([
 db.systemSettings.findUnique({ where: { key: SETTING_KEYS.PAYMENT_ZARINPAL_MERCHANT } }),
 db.systemSettings.findUnique({ where: { key: SETTING_KEYS.PAYMENT_ZARINPAL_ENABLED } }),
 db.systemSettings.findUnique({ where: { key: SETTING_KEYS.PAYMENT_IDPAY_MERCHANT } }),
 db.systemSettings.findUnique({ where: { key: SETTING_KEYS.PAYMENT_IDPAY_ENABLED } }),
 db.systemSettings.findUnique({ where: { key: SETTING_KEYS.PAYMENT_CALLBACK_BASE_URL } }),
 db.systemSettings.findUnique({ where: { key: SETTING_KEYS.PAYMENT_ZARINPAL_SANDBOX } }),
 ]);

 const zMerchantValue = (zMerchant?.value?? "").trim();
 const iMerchantValue = (iMerchant?.value?? "").trim();

 return {
 zarinpal: {
 merchantId: zMerchantValue,
 enabled: zEnabled?.value === "true",
 configured: zMerchantValue.length >= 6,
 sandbox: zSandbox?.value === "true",
 },
 idpay: {
 merchantId: iMerchantValue,
 enabled: iEnabled?.value === "true",
 configured: iMerchantValue.length >= 6,
 },
 // FIX(PAY-2): آدرس پایه کال‌بک از تنظیمات — با حذف اسلش انتهایی
 callbackBaseUrl: (cbBase?.value?? "").trim().replace(/\/+$/, ""),
 };
 },
 CACHE_TTL.MEDIUM
 );
}

// میان‌بر برای خواندن کد پذیرنده زرین‌پال در API پرداخت
export async function getZarinpalMerchant(): Promise<string | null> {
 const settings = await getPaymentSettings();
 if (!settings.zarinpal.enabled ||!settings.zarinpal.configured) return null;
 return settings.zarinpal.merchantId;
}

// ذخیره تنظیمات یک درگاه (upsert)
export async function savePaymentGatewaySettings(
 gateway: "zarinpal" | "idpay",
 data: { merchantId?: string; enabled?: boolean; sandbox?: boolean }
): Promise<void> {
 const updates: Array<{ key: string; value: string }> = [];
 if (typeof data.merchantId === "string") {
 const merchantKey =
 gateway === "zarinpal"
? SETTING_KEYS.PAYMENT_ZARINPAL_MERCHANT
: SETTING_KEYS.PAYMENT_IDPAY_MERCHANT;
 updates.push({ key: merchantKey, value: data.merchantId.trim() });
 }
 if (typeof data.enabled === "boolean") {
 const enabledKey =
 gateway === "zarinpal"
? SETTING_KEYS.PAYMENT_ZARINPAL_ENABLED
: SETTING_KEYS.PAYMENT_IDPAY_ENABLED;
 updates.push({ key: enabledKey, value: data.enabled? "true": "false" });
 }
 // FIX(PAY-2): sandbox فقط برای زرین‌پال معنا دارد
 if (gateway === "zarinpal" && typeof data.sandbox === "boolean") {
 updates.push({ key: SETTING_KEYS.PAYMENT_ZARINPAL_SANDBOX, value: data.sandbox? "true": "false" });
 }
 if (updates.length === 0) return;
 await Promise.all(
 updates.map((u) =>
 db.systemSettings.upsert({
 where: { key: u.key },
 update: { value: u.value },
 create: { key: u.key, value: u.value },
 })
 )
 );
 cacheDeleteByPrefix(CACHE_PREFIX);
}

// FIX(PAY-2): ذخیره/حذف آدرس پایه کال‌بک پرداخت (مستقل از درگاه خاص)
export async function savePaymentCallbackBaseUrl(url: string | null): Promise<void> {
 const clean = (url?? "").trim().replace(/\/+$/, "");
 if (clean) {
 // اعتبارسنجی — فقط http/https با دامنه معتبر
 let parsed: URL | null = null;
 try {
 parsed = new URL(clean);
 } catch {
 parsed = null;
 }
 if (!parsed || (parsed.protocol!== "https:" && parsed.protocol!== "http:")) {
 throw new Error("آدرس کال‌بک معتبر نیست — باید با https:// یا http:// شروع شود");
 }
 await db.systemSettings.upsert({
 where: { key: SETTING_KEYS.PAYMENT_CALLBACK_BASE_URL },
 update: { value: clean },
 create: { key: SETTING_KEYS.PAYMENT_CALLBACK_BASE_URL, value: clean },
 });
 } else {
 await db.systemSettings.deleteMany({ where: { key: SETTING_KEYS.PAYMENT_CALLBACK_BASE_URL } });
 }
 cacheDeleteByPrefix(CACHE_PREFIX);
}

export { SETTING_KEYS };

// ============ Notification Settings (SMTP / SMS / formsubmit) ============

export interface SmtpSettings {
 host: string;
 port: string;
 user: string;
 pass: string;
 from: string;
}

export interface SmsSettings {
 provider: string;
 apiKey: string;
 sender: string;
}

export interface FormsubmitSettings {
 email: string;
}

async function readJsonSetting<T>(
 key: string,
 fallback: T
): Promise<T> {
 try {
 const setting = await db.systemSettings.findUnique({ where: { key } });
 if (setting) {
 const parsed = JSON.parse(setting.value);
 if (parsed && typeof parsed === "object") {
 return {...fallback,...parsed } as T;
 }
 }
 } catch {
 // ignore parse error fallback
 }
 return fallback;
}

// خواندن تنظیمات SMTP — ذخیره‌شده به‌صورت JSON در SystemSettings
export async function getSmtpSettings(): Promise<SmtpSettings> {
 return readJsonSetting<SmtpSettings>(SETTING_KEYS.SMTP_SETTINGS, {
 host: "",
 port: "587",
 user: "",
 pass: "",
 from: "",
 });
}

// خواندن تنظیمات پیامک — ذخیره‌شده به‌صورت JSON در SystemSettings
export async function getSmsSettings(): Promise<SmsSettings> {
 return readJsonSetting<SmsSettings>(SETTING_KEYS.SMS_SETTINGS, {
 provider: "",
 apiKey: "",
 sender: "",
 });
}

// خواندن تنظیمات formsubmit.co — ذخیره‌شده به‌صورت JSON در SystemSettings
export async function getFormsubmitSettings(): Promise<FormsubmitSettings> {
 return readJsonSetting<FormsubmitSettings>(SETTING_KEYS.FORMSUBMIT_SETTINGS, {
 email: "",
 });
}

// ============ Platform Settings (مدیریت پلتفرم) ============

export interface PlatformSettings {
 maintenance: {
 enabled: boolean;
 message: string;
 };
 registration: {
 open: boolean;
 };
 trial: {
 defaultDays: number;
 defaultPlan: string;
 };
 featureFlags: Record<string, boolean>; // ماژول‌های فعال پلتفرم
 readOnly: {
 enabled: boolean;
 };
 debugMode: {
 enabled: boolean;
 };
 email: {
 from: string;
 fromName: string;
 provider: string;
 smtpHost: string;
 smtpPort: string;
 smtpUser: string;
 };
}

const DEFAULT_PLATFORM_FEATURE_FLAGS: Record<string, boolean> = {
 core: true,
 invoices: true,
 inventory: true,
 treasury: true,
 payroll: true,
 tax: true,
 modian: true,
 ecommerce: true,
 crm: true,
 ai: true,
 mobile: true,
 multi_currency: true,
 loyalty: true,
 reports_builder: true,
 smart_dashboard: true,
};

// خواندن تنظیمات پلتفرم از دیتابیس (با fallback به مقادیر پیش‌فرض)
export async function getPlatformSettings(): Promise<PlatformSettings> {
 return cacheGetOrSet(
 `${CACHE_PREFIX}platform`,
 async () => {
 const keys = [
 SETTING_KEYS.MAINTENANCE_MODE,
 SETTING_KEYS.MAINTENANCE_MESSAGE,
 SETTING_KEYS.REGISTRATION_OPEN,
 SETTING_KEYS.DEFAULT_TRIAL_DAYS,
 SETTING_KEYS.DEFAULT_PLAN,
 SETTING_KEYS.PLATFORM_FEATURE_FLAGS,
 SETTING_KEYS.READ_ONLY_MODE,
 SETTING_KEYS.DEBUG_MODE,
 SETTING_KEYS.EMAIL_FROM,
 SETTING_KEYS.EMAIL_FROM_NAME,
 SETTING_KEYS.EMAIL_PROVIDER,
 SETTING_KEYS.EMAIL_SMTP_HOST,
 SETTING_KEYS.EMAIL_SMTP_PORT,
 SETTING_KEYS.EMAIL_SMTP_USER,
 ];
 const rows = await db.systemSettings.findMany({ where: { key: { in: keys } } });
 const map: Record<string, string> = {};
 for (const r of rows) map[r.key] = r.value;

 let featureFlags = {...DEFAULT_PLATFORM_FEATURE_FLAGS };
 try {
 if (map[SETTING_KEYS.PLATFORM_FEATURE_FLAGS]) {
 const parsed = JSON.parse(map[SETTING_KEYS.PLATFORM_FEATURE_FLAGS]);
 if (parsed && typeof parsed === "object") {
 featureFlags = {...DEFAULT_PLATFORM_FEATURE_FLAGS,...parsed };
 }
 }
 } catch {
 // ignore parse error
 }

 return {
 maintenance: {
 enabled: map[SETTING_KEYS.MAINTENANCE_MODE] === "true",
 message: map[SETTING_KEYS.MAINTENANCE_MESSAGE] || "سامانه در حال به‌روزرسانی است. لطفاً چند دقیقه بعد تلاش کنید.",
 },
 registration: {
 open: map[SETTING_KEYS.REGISTRATION_OPEN]!== "false", // پیش‌فرض: باز
 },
 trial: {
 defaultDays: parseInt(map[SETTING_KEYS.DEFAULT_TRIAL_DAYS] || "14", 10) || 14,
 defaultPlan: map[SETTING_KEYS.DEFAULT_PLAN] || "free",
 },
 featureFlags,
 readOnly: {
 enabled: map[SETTING_KEYS.READ_ONLY_MODE] === "true",
 },
 debugMode: {
 enabled: map[SETTING_KEYS.DEBUG_MODE] === "true",
 },
 email: {
 from: map[SETTING_KEYS.EMAIL_FROM] || "noreply@hoosh.nobatime.ir",
 fromName: map[SETTING_KEYS.EMAIL_FROM_NAME] || "هوش",
 provider: map[SETTING_KEYS.EMAIL_PROVIDER] || "formsubmit",
 smtpHost: map[SETTING_KEYS.EMAIL_SMTP_HOST] || "",
 smtpPort: map[SETTING_KEYS.EMAIL_SMTP_PORT] || "587",
 smtpUser: map[SETTING_KEYS.EMAIL_SMTP_USER] || "",
 },
 };
 },
 CACHE_TTL.MEDIUM
 );
}

// ذخیره‌ی چند کلید تنظیمات به‌صورت یکجا (upsert)
export async function saveSettings(
 updates: Array<{ key: string; value: string }>
): Promise<void> {
 if (updates.length === 0) return;
 await Promise.all(
 updates.map((u) =>
 db.systemSettings.upsert({
 where: { key: u.key },
 update: { value: u.value },
 create: { key: u.key, value: u.value },
 })
 )
 );
 // کش را باطل کن تا تغییرات فوراً دیده شوند
 cacheDeleteByPrefix(CACHE_PREFIX);
}

// باطل کردن دستی کش تنظیمات (مثلاً پس از حذف مستقیم رکوردها)
export function invalidateSettingsCache(): void {
 cacheDeleteByPrefix(CACHE_PREFIX);
}

// ============ SEO Settings ============

export interface SeoSettings {
 metaTitle: string;
 metaDescription: string;
 metaKeywords: string;
 gaId: string;
 searchConsole: string;
 ogTitle: string;
 ogDescription: string;
 ogImage: string;
 twitterCard: string;
 robotsTxt: string;
 sitemapEnabled: boolean;
 social: {
 twitter: string;
 linkedin: string;
 instagram: string;
 telegram: string;
 };
}

const DEFAULT_ROBOTS_TXT = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/
Disallow: /superadmin/

Sitemap: https://hoosh.nobatime.ir/sitemap.xml`;

// ============ Branding Settings (برندینگ و وایت‌لیبل) ============

export interface BrandingSettings {
 appName: string;
 siteName: string;
 primaryColor: string;
 logoUrl: string;
 footerText: string;
 domain: string;
}

// مقادیر پیش‌فرض برند — وقتی هیچ کلیدی در SystemSettings تنظیم نشده باشد
export const DEFAULT_BRANDING: BrandingSettings = {
 appName: "هوش",
 siteName: "هوش | نرم‌افزار حسابداری هوشمند",
 primaryColor: "#10b981",
 logoUrl: "",
 footerText: "",
 domain: "hoosh.nobatime.ir",
};

// نرمال‌سازی دامنه — اگر سوپرادمین با پروتکل/اسلش وارد کرد، پاک شود
function normalizeDomain(raw: string | undefined): string {
 if (!raw) return "";
 return raw.trim().replace(/^[a-zA-Z]+:\/\//, "").replace(/\/+$/, "");
}

/**
 * خواندن تنظیمات برندینگ (نام برند، لوگو، دامنه و...) — سرور-ساید.
 * با کش درون‌حافظه‌ای ۵ دقیقه‌ای؛ پس از ذخیره در
 * /api/platform/settings/branding (saveSettings) کش باطل می‌شود.
 */
export async function getBrandingSettings(): Promise<BrandingSettings> {
 return cacheGetOrSet(
 `${CACHE_PREFIX}branding`,
 async () => {
 try {
 const keys = [
 SETTING_KEYS.BRANDING_APP_NAME,
 SETTING_KEYS.BRANDING_SITE_NAME,
 SETTING_KEYS.BRANDING_PRIMARY_COLOR,
 SETTING_KEYS.BRANDING_LOGO_URL,
 SETTING_KEYS.BRANDING_FOOTER_TEXT,
 SETTING_KEYS.BRANDING_DOMAIN,
 ];
 const rows = await db.systemSettings.findMany({ where: { key: { in: keys } } });
 const map: Record<string, string> = {};
 for (const r of rows) map[r.key] = r.value;

 return {
 appName: map[SETTING_KEYS.BRANDING_APP_NAME]?.trim() || DEFAULT_BRANDING.appName,
 siteName: map[SETTING_KEYS.BRANDING_SITE_NAME]?.trim() || DEFAULT_BRANDING.siteName,
 primaryColor: map[SETTING_KEYS.BRANDING_PRIMARY_COLOR]?.trim() || DEFAULT_BRANDING.primaryColor,
 logoUrl: map[SETTING_KEYS.BRANDING_LOGO_URL]?.trim() || "",
 footerText: map[SETTING_KEYS.BRANDING_FOOTER_TEXT]?.trim() || "",
 domain: normalizeDomain(map[SETTING_KEYS.BRANDING_DOMAIN]) || DEFAULT_BRANDING.domain,
 };
 } catch {
 return DEFAULT_BRANDING;
 }
 },
 CACHE_TTL.MEDIUM
 );
}

// میان‌بر برای دامنه‌ی برند (برای ساخت لینک‌های ایمیل و...)
export async function getBrandDomain(): Promise<string> {
 return (await getBrandingSettings()).domain;
}

/* ============ نمادهای اعتماد (اینماد و...) ============ */

export interface TrustBadge {
 id: string;
 title: string;
 /** کد HTML کامل نماد (لینک + تصویر) — فقط سوپرادمین وارد می‌کند */
 html: string;
 /** محل نمایش — فعلاً فقط فوتر */
 placement: "footer";
 enabled: boolean;
}

/** اعتبارسنجی ایمن کد نماد — فقط تگ‌های مجاز */
export function sanitizeTrustBadgeHtml(raw: string): { ok: boolean; html: string; reason?: string } {
 const trimmed = raw.trim();
 if (!trimmed) return { ok: false, html: "", reason: "کد خالی است" };
 if (trimmed.length > 4000) return { ok: false, html: "", reason: "کد بیش از حد طولانی است (حداکثر ۴۰۰۰ کاراکتر)" };
 // تگ‌های خطرناک مطلقاً ممنوع
 const forbidden = /<\s*(script|iframe|object|embed|form|input|link|meta|style)\b/i;
 if (forbidden.test(trimmed)) {
 return { ok: false, html: "", reason: "تگ‌های مجاز: a, img, div, span (script/iframe و مشابه ممنوع است)" };
 }
 // handler های inline ممنوع
 if (/on\s*[a-z]+\s*=/i.test(trimmed)) {
 return { ok: false, html: "", reason: "رویدادهای inline (onclick و...) مجاز نیستند" };
 }
 if (/javascript\s*:/i.test(trimmed)) {
 return { ok: false, html: "", reason: "آدرس javascript: مجاز نیست" };
 }
 // فقط a و img اجازه‌ی صفات href/src/target/alt/width/height/style/referrerpolicy دارند
 return { ok: true, html: trimmed };
}

/** خواندن نمادهای فعال — عمومی (فوتر لندینگ) */
export async function getTrustBadges(): Promise<TrustBadge[]> {
 return cacheGetOrSet(
 `${CACHE_PREFIX}trust_badges`,
 async () => {
 try {
 const row = await db.systemSettings.findUnique({
 where: { key: SETTING_KEYS.TRUST_BADGES },
 });
 if (!row?.value) return [];
 const parsed = JSON.parse(row.value) as TrustBadge[];
 if (!Array.isArray(parsed)) return [];
 return parsed
 .filter((b) => b && typeof b.html === "string" && b.enabled !== false)
 .map((b) => ({
 id: String(b.id || `badge-${Math.random().toString(36).slice(2, 8)}`),
 title: String(b.title || "").slice(0, 80),
 html: String(b.html).slice(0, 4000),
 placement: b.placement === "footer" ? "footer" : "footer",
 enabled: true,
 }));
 } catch {
 return [];
 }
 },
 CACHE_TTL.MEDIUM
 );
}

/** ذخیره نمادها (سوپرادمین) — باطل‌کردن کش پس از ذخیره */
export async function saveTrustBadges(badges: TrustBadge[]): Promise<void> {
 const clean = badges
 .filter((b) => b && typeof b.html === "string" && b.html.trim())
 .slice(0, 12) // حداکثر ۱۲ نماد
 .map((b, i) => ({
 id: String(b.id || `badge-${i}-${Date.now().toString(36)}`),
 title: String(b.title || "").slice(0, 80),
 html: String(b.html).trim().slice(0, 4000),
 placement: "footer" as const,
 enabled: b.enabled !== false,
 }));
 const json = JSON.stringify(clean);
 await db.systemSettings.upsert({
 where: { key: SETTING_KEYS.TRUST_BADGES },
 update: { value: json },
 create: { key: SETTING_KEYS.TRUST_BADGES, value: json },
 });
 cacheDeleteByPrefix(CACHE_PREFIX);
}

/* ============ پاداش خودکار گزارش باگ (Task 10-b) ============ */

export interface BugRewardRules {
 /** اعطای خودکار پاداش هنگام تأیید گزارش (بحرانی/زیاد) */
 enabled: boolean;
 /** روزهای پاداش برای شدت بحرانی — پیش‌فرض ۳۰ (یک ماه) */
 criticalDays: number;
 /** روزهای پاداش برای شدت زیاد — پیش‌فرض ۱۵ */
 highDays: number;
 /** پلن اهدایی — پیش‌فرض «pro» (حرفه‌ای) */
 plan: string;
}

const DEFAULT_BUG_REWARD_RULES: BugRewardRules = {
 enabled: true, // پیش‌فرض روشن — وقتی کلید در SystemSettings نباشد
 criticalDays: 30,
 highDays: 15,
 plan: "pro",
};

/** خواندن قوانین پاداش باگ — با کش ۵ دقیقه‌ای */
export async function getBugRewardRules(): Promise<BugRewardRules> {
 return readJsonSetting<BugRewardRules>(
 SETTING_KEYS.BUG_REWARD_RULES,
 DEFAULT_BUG_REWARD_RULES
 ).then((rules) => ({
 enabled: typeof rules.enabled === "boolean" ? rules.enabled : true,
 criticalDays:
 typeof rules.criticalDays === "number" && rules.criticalDays > 0 && rules.criticalDays <= 365
 ? Math.round(rules.criticalDays)
 : DEFAULT_BUG_REWARD_RULES.criticalDays,
 highDays:
 typeof rules.highDays === "number" && rules.highDays > 0 && rules.highDays <= 365
 ? Math.round(rules.highDays)
 : DEFAULT_BUG_REWARD_RULES.highDays,
 plan: typeof rules.plan === "string" && rules.plan.trim() ? rules.plan.trim() : "pro",
 }));
}

/** ذخیره قوانین پاداش باگ (upsert + باطل‌سازی کش) */
export async function saveBugRewardRules(rules: BugRewardRules): Promise<void> {
 const json = JSON.stringify({
 enabled: rules.enabled === true,
 criticalDays: Math.min(365, Math.max(1, Math.round(rules.criticalDays) || 30)),
 highDays: Math.min(365, Math.max(1, Math.round(rules.highDays) || 15)),
 plan: rules.plan || "pro",
 });
 await db.systemSettings.upsert({
 where: { key: SETTING_KEYS.BUG_REWARD_RULES },
 update: { value: json },
 create: { key: SETTING_KEYS.BUG_REWARD_RULES, value: json },
 });
 cacheDeleteByPrefix(CACHE_PREFIX);
}

/* ============ هشدارهای سلامت پلتفرم (Task 12-b) ============ */

export interface HealthAlertSettings {
 enabled: boolean;
 /** توکن ربات تلگرام (از BotFather) */
 telegramBotToken: string;
 /** chat_id مقصد هشدارها */
 telegramChatId: string;
 /** آدرس ایمیل مقصد هشدارها */
 emailTo: string;
}

const DEFAULT_HEALTH_ALERTS: HealthAlertSettings = {
 enabled: false,
 telegramBotToken: "",
 telegramChatId: "",
 emailTo: "",
};

/** خواندن تنظیمات هشدار سلامت — با کش ۵ دقیقه‌ای */
export async function getHealthAlertSettings(): Promise<HealthAlertSettings> {
 const s = await readJsonSetting<HealthAlertSettings>(
 SETTING_KEYS.HEALTH_ALERTS,
 DEFAULT_HEALTH_ALERTS
 );
 return {
 enabled: s.enabled === true,
 telegramBotToken: (s.telegramBotToken || "").trim(),
 telegramChatId: (s.telegramChatId || "").trim(),
 emailTo: (s.emailTo || "").trim(),
 };
}

/** ذخیره تنظیمات هشدار سلامت (upsert + باطل‌سازی کش) */
export async function saveHealthAlertSettings(
 settings: HealthAlertSettings
): Promise<void> {
 const json = JSON.stringify({
 enabled: settings.enabled === true,
 telegramBotToken: (settings.telegramBotToken || "").trim().slice(0, 200),
 telegramChatId: (settings.telegramChatId || "").trim().slice(0, 100),
 emailTo: (settings.emailTo || "").trim().slice(0, 200),
 });
 await db.systemSettings.upsert({
 where: { key: SETTING_KEYS.HEALTH_ALERTS },
 update: { value: json },
 create: { key: SETTING_KEYS.HEALTH_ALERTS, value: json },
 });
 cacheDeleteByPrefix(CACHE_PREFIX);
}

export async function getSeoSettings(): Promise<SeoSettings> {
 return cacheGetOrSet(
 `${CACHE_PREFIX}seo`,
 async () => {
 const keys = [
 SETTING_KEYS.SEO_META_TITLE,
 SETTING_KEYS.SEO_META_DESCRIPTION,
 SETTING_KEYS.SEO_META_KEYWORDS,
 SETTING_KEYS.SEO_GA_ID,
 SETTING_KEYS.SEO_SEARCH_CONSOLE,
 SETTING_KEYS.SEO_OG_TITLE,
 SETTING_KEYS.SEO_OG_DESCRIPTION,
 SETTING_KEYS.SEO_OG_IMAGE,
 SETTING_KEYS.SEO_TWITTER_CARD,
 SETTING_KEYS.SEO_ROBOTS_TXT,
 SETTING_KEYS.SEO_SITEMAP_ENABLED,
 SETTING_KEYS.SEO_SOCIAL_TWITTER,
 SETTING_KEYS.SEO_SOCIAL_LINKEDIN,
 SETTING_KEYS.SEO_SOCIAL_INSTAGRAM,
 SETTING_KEYS.SEO_SOCIAL_TELEGRAM,
 ];
 const rows = await db.systemSettings.findMany({ where: { key: { in: keys } } });
 const map: Record<string, string> = {};
 for (const r of rows) map[r.key] = r.value;

 return {
 metaTitle: map[SETTING_KEYS.SEO_META_TITLE] || "هوش — نرم‌افزار حسابداری آنلاین هوشمند",
 metaDescription: map[SETTING_KEYS.SEO_META_DESCRIPTION] || "نرم‌افزار حسابداری ابری هوش با هوش مصنوعی، اتصال به سامانه مودیان، انبار، خزانه‌داری، حقوق و دستمزد و گزارش‌های حرفه‌ای.",
 metaKeywords: map[SETTING_KEYS.SEO_META_KEYWORDS] || "حسابداری, نرم افزار حسابداری, حسابداری آنلاین, هوش, سامانه مودیان, فاکتور الکترونیکی",
 gaId: map[SETTING_KEYS.SEO_GA_ID] || "",
 searchConsole: map[SETTING_KEYS.SEO_SEARCH_CONSOLE] || "",
 ogTitle: map[SETTING_KEYS.SEO_OG_TITLE] || "هوش — نرم‌افزار حسابداری هوشمند",
 ogDescription: map[SETTING_KEYS.SEO_OG_DESCRIPTION] || "حسابداری ابری با هوش مصنوعی برای کسب‌وکارهای ایرانی",
 ogImage: map[SETTING_KEYS.SEO_OG_IMAGE] || "",
 twitterCard: map[SETTING_KEYS.SEO_TWITTER_CARD] || "summary_large_image",
 robotsTxt: map[SETTING_KEYS.SEO_ROBOTS_TXT] || DEFAULT_ROBOTS_TXT,
 sitemapEnabled: map[SETTING_KEYS.SEO_SITEMAP_ENABLED]!== "false",
 social: {
 twitter: map[SETTING_KEYS.SEO_SOCIAL_TWITTER] || "",
 linkedin: map[SETTING_KEYS.SEO_SOCIAL_LINKEDIN] || "",
 instagram: map[SETTING_KEYS.SEO_SOCIAL_INSTAGRAM] || "",
 telegram: map[SETTING_KEYS.SEO_SOCIAL_TELEGRAM] || "",
 },
 };
 },
 CACHE_TTL.LONG
 );
}
