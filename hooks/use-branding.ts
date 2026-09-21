"use client";

import * as React from "react";

/**
 * use-branding — برند فعال اپ در کلاینت (وایت‌لیبل)
 *
 * منبع داده: /api/branding (عمومی، با Cache-Control ۶۰ثانیه‌ای) + کش localStorage
 * برای paint فوری. رندر اول (SSR + hydration) همیشه با پیش‌فرض «هوش» انجام
 * می‌شود تا mismatch پیش نیاید؛ پس از mount مقدار واقعی جایگزین می‌شود
 * و در پس‌زمینه همیشه از سرور تازه‌سازی می‌شود.
 *
 * بعد از ذخیره‌ی تنظیمات در پنل سوپرادمین، setBrandingCache() مقدار
 * جدید را هم‌زمان در همه‌ی مصرف‌کننده‌های باز اعمال می‌کند.
 */

export interface Branding {
 appName: string;
 siteName: string;
 primaryColor: string;
 logoUrl: string;
 footerText: string;
 domain: string;
}

export const DEFAULT_BRANDING: Branding = {
 appName: "هوش",
 siteName: "هوش | نرم‌افزار حسابداری هوشمند",
 primaryColor: "#10b981",
 logoUrl: "",
 footerText: "",
 domain: "hoosh.nobatime.ir",
};

const LS_KEY = "hoshhesab_branding";

// کش ماژول‌سطحی — فقط یک fetch بین همه‌ی مصرف‌کننده‌ها
let cachedBranding: Branding | null = null;
let inflight: Promise<Branding> | null = null;
const subscribers = new Set<(b: Branding) => void>();

function normalize(data: Partial<Branding> | null | undefined): Branding | null {
 if (!data || typeof data.appName !== "string" || !data.appName.trim()) return null;
 return { ...DEFAULT_BRANDING, ...data };
}

function readLocalStorage(): Branding | null {
 try {
 const raw = window.localStorage.getItem(LS_KEY);
 if (!raw) return null;
 const parsed = JSON.parse(raw) as { data?: Partial<Branding>; at?: number };
 return normalize(parsed.data);
 } catch {
 return null;
 }
}

function persist(data: Branding): void {
 try {
 window.localStorage.setItem(LS_KEY, JSON.stringify({ data, at: Date.now() }));
 } catch {
 // حالت private mode — نادیده گرفته می‌شود
 }
}

function notify(data: Branding): void {
 subscribers.forEach((fn) => {
 try {
 fn(data);
 } catch {
 // subscriber خطا خورد — بقیه ادامه می‌دهند
 }
 });
}

/**
 * خواندن برند از /api/branding — single-flight.
 * پاسخ API هدر Cache-Control (max-age=60) دارد، پس مرورگر درخواست‌های
 * متوالی را از HTTP cache جواب می‌دهد و سرور عملاً هر ۶۰ ثانیه حداکثر
 * یک‌بار صدا زده می‌شود.
 *
 * @param force حتی اگر مقدار در حافظه باشد دوباره از سرور بخواند
 * (برای رفرش پس‌زمینه پس از هر mount — HTTP cache آن را رایگان می‌کند).
 */
async function fetchBranding(force = false): Promise<Branding> {
 if (!force && cachedBranding) return cachedBranding;
 if (force && inflight) return inflight;
 if (!force && inflight) return inflight;
 inflight = fetch("/api/branding")
 .then((r) => (r.ok ? r.json() : null))
 .then((json) => {
 const data = normalize(json?.success ? json.data : null);
 if (data) {
 cachedBranding = data;
 persist(data);
 notify(data);
 return data;
 }
 return cachedBranding || DEFAULT_BRANDING;
 })
 .catch(() => cachedBranding || DEFAULT_BRANDING)
 .finally(() => {
 inflight = null;
 });
 return inflight;
}

/**
 * به‌روزرسانی دستی کش برند (پس از ذخیره در پنل سوپرادمین) —
 * مقدار جدید را در حافظه + localStorage می‌نویسد و همه‌ی
 * useBranding های فعال را مطلع می‌کند.
 */
export function setBrandingCache(data: Partial<Branding>): void {
 const normalized = normalize({ ...(cachedBranding || DEFAULT_BRANDING), ...data });
 if (!normalized) return;
 cachedBranding = normalized;
 persist(normalized);
 notify(normalized);
}

/** خواندن مقدار کش‌شده فعلی (بدون fetch) — برای فرم‌ها. */
export function getBrandingCache(): Branding {
 return cachedBranding || DEFAULT_BRANDING;
}

export function useBranding(): { branding: Branding; loading: boolean } {
 // رندر اول: پیش‌فرض «هوش» — هم‌رنگ با SSR، بدون hydration mismatch
 const [branding, setBranding] = React.useState<Branding>(DEFAULT_BRANDING);
 const [loading, setLoading] = React.useState(true);

 React.useEffect(() => {
 let cancelled = false;
 const apply = (b: Branding) => {
 if (!cancelled) setBranding((prev) => (prev === b ? prev : b));
 };

 // ۱) مقدار کش‌شده‌ی localStorage فوراً اعمال می‌شود
 // (پیشگیری از «فلش» نام پیش‌فرض قبل از رسیدن پاسخ شبکه)
 const local = readLocalStorage();
 if (local) {
 cachedBranding = local;
 apply(local);
 setLoading(false);
 }

 // ۲) همیشه در پس‌زمینه از سرور تازه می‌خوانیم — اگر سوپرادمین برند را
 // تغییر داده باشد حداکثر ظرف ۶۰ ثانیه (HTTP cache) اصلاح می‌شود.
 fetchBranding(true)
 .then(apply)
 .finally(() => {
 if (!cancelled) setLoading(false);
 });

 subscribers.add(apply);
 return () => {
 cancelled = true;
 subscribers.delete(apply);
 };
 }, []);

 return { branding, loading };
}
