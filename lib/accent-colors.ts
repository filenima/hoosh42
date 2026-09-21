"use client";

/**
 * ACCENT (درخواست مالک): «انتخاب رنگ تم باید واقعاً رنگ پنل و آیکون‌ها را
 * عوض کند» — سیستم رنگ تأکیدی که متغیرهای CSS واقعی (--primary و...) را
 * بازنویسی می‌کند تا همهٔ اجزای shadcn/Tailwind (bg-primary، text-primary،
 * آیکون‌ها، دکمه‌ها، چارت‌ها) هم‌رنگ شوند.
 *
 * سازوکار:
 * - هر تم یک جفت رنگ (روشن/تاریک) دارد — روی <html> به‌صورت inline style
 *   ست می‌شود (اولویت روی stylesheet).
 * - ذخیره در localStorage: hoosh_accent = JSON {id}
 * - اسکریپت داخل <head> همان مقدار را قبل از اولین رندر اعمال می‌کند (بدون FOUC)
 * - MutationObserver روی class تاریکی html — با تغییر حالت روشن/تاریک، جفت
 *   رنگ مناسب دوباره اعمال می‌شود.
 */

export interface AccentOption {
 id: string;
 label: string;
 light: string;
 dark: string;
 /** رنگ متن روی دکمهٔ primary */
 lightFg: string;
 darkFg: string;
}

export const ACCENT_OPTIONS: AccentOption[] = [
 {
 id: "indigo",
 label: "پیش‌فرض هوش",
 light: "#4f46e5",
 dark: "#818cf8",
 lightFg: "#ffffff",
 darkFg: "#0a0a0b",
 },
 {
 id: "emerald",
 label: "زمرد",
 light: "#059669",
 dark: "#34d399",
 lightFg: "#ffffff",
 darkFg: "#052e1f",
 },
 {
 id: "teal",
 label: "فیروزه‌ای",
 light: "#0d9488",
 dark: "#2dd4bf",
 lightFg: "#ffffff",
 darkFg: "#04302b",
 },
 {
 id: "rose",
 label: "گلبهی",
 light: "#e11d48",
 dark: "#fb7185",
 lightFg: "#ffffff",
 darkFg: "#3f0a17",
 },
 {
 id: "amber",
 label: "کهربایی",
 light: "#d97706",
 dark: "#fbbf24",
 lightFg: "#ffffff",
 darkFg: "#3b2304",
 },
 {
 id: "orange",
 label: "نارنجی",
 light: "#ea580c",
 dark: "#fb923c",
 lightFg: "#ffffff",
 darkFg: "#3a1804",
 },
 {
 id: "violet",
 label: "بنفش",
 light: "#7c3aed",
 dark: "#a78bfa",
 lightFg: "#ffffff",
 darkFg: "#1e1145",
 },
 {
 id: "slate",
 label: "دودی",
 light: "#475569",
 dark: "#94a3b8",
 lightFg: "#ffffff",
 darkFg: "#101826",
 },
];

export const ACCENT_STORAGE_KEY = "hoosh_accent";

export function getStoredAccentId(): string | null {
 try {
 const raw = localStorage.getItem(ACCENT_STORAGE_KEY);
 if (!raw) return null;
 const parsed = JSON.parse(raw) as { id?: string };
 return parsed?.id ?? null;
 } catch {
 return null;
 }
}

export function isDarkMode(): boolean {
 if (typeof document === "undefined") return false;
 if (document.documentElement.classList.contains("dark")) return true;
 try {
 return window.matchMedia("(prefers-color-scheme: dark)").matches;
 } catch {
 return false;
 }
}

/** اعمال جفت رنگ روی <html> — بدون ذخیره */
export function applyAccentVars(id: string): void {
 if (typeof document === "undefined") return;
 const opt = ACCENT_OPTIONS.find((o) => o.id === id);
 if (!opt) return;
 const dark = isDarkMode();
 const root = document.documentElement;
 root.style.setProperty("--primary", dark ? opt.dark : opt.light);
 root.style.setProperty("--primary-foreground", dark ? opt.darkFg : opt.lightFg);
 // رنگ حلقهٔ فوکوس هم‌رنگ تم
 const ring = dark ? opt.dark : opt.light;
 root.style.setProperty("--ring", ring);
 root.setAttribute("data-accent", id);
}

/** ذخیره + اعمال + راه‌اندازی observer برای تغییر حالت روشن/تاریک */
let observerInstalled = false;
export function setAccent(id: string): void {
 try {
 localStorage.setItem(ACCENT_STORAGE_KEY, JSON.stringify({ id, at: Date.now() }));
 } catch {
 /* private mode */
 }
 applyAccentVars(id);
 if (!observerInstalled && typeof MutationObserver !== "undefined") {
 observerInstalled = true;
 const mo = new MutationObserver(() => {
 const cur = getStoredAccentId();
 if (cur) applyAccentVars(cur);
 });
 mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
 // تغییر سیستم‌عامل (وقتی تم = سیستم)
 try {
 window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
 const cur = getStoredAccentId();
 if (cur) applyAccentVars(cur);
 });
 } catch {
 /* مرورگر قدیمی */
 }
 }
}

/** اسکریپت داخل <head> — قبل از اولین رندر اعمال می‌کند (بدون FOUC)
 * (متن کامل اسکریپت در app/layout.tsx نگه داشته شده — هم‌گام با این ماژول) */
export const ACCENT_STORAGE_KEY_NAME = "hoosh_accent";
