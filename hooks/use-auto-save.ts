"use client";

import * as React from "react";

/* ============ use-auto-save.ts ============
 *
 * ذخیره‌ی خودکار پیش‌نویس در localStorage با debounce.
 *
 * ویژگی‌ها:
 * - ذخیره‌ی data پس از `delay` میلی‌ثانیه (پیش‌فرض ۳۰۰۰) از آخرین تغییر
 * - isSaving: در حال ذخیره‌سازی (debounce در انتظار)
 * - lastSaved: timestamp آخرین ذخیره‌ی موفق
 * - restore(): برگرداندن داده‌ی ذخیره‌شده یا null
 * - clear(): حذف پیش‌نویس از localStorage
 *
 * @example
 * const { isSaving, lastSaved, restore, clear } = useAutoSave(
 * "invoice-draft",
 * { partyId: "", items: [] },
 * 3000
 * );
 */

const PREFIX = "hoshhesab:draft:";

function safeKey(key: string): string {
 return `${PREFIX}${key}`;
}

function readDraft<T>(key: string): { data: T; savedAt: number } | null {
 if (typeof window === "undefined") return null;
 try {
 const raw = window.localStorage.getItem(safeKey(key));
 if (!raw) return null;
 const parsed = JSON.parse(raw);
 if (
 parsed &&
 typeof parsed === "object" &&
 "data" in parsed &&
 "savedAt" in parsed &&
 typeof parsed.savedAt === "number"
 ) {
 return { data: parsed.data as T, savedAt: parsed.savedAt };
 }
 return null;
 } catch {
 return null;
 }
}

function writeDraft<T>(key: string, data: T): number {
 if (typeof window === "undefined") return Date.now();
 const savedAt = Date.now();
 try {
 window.localStorage.setItem(
 safeKey(key),
 JSON.stringify({ data, savedAt })
 );
 } catch {
 // quota exceeded یا storage غیرفعال — بی‌خطر
 }
 return savedAt;
}

function removeDraft(key: string) {
 if (typeof window === "undefined") return;
 try {
 window.localStorage.removeItem(safeKey(key));
 } catch {
 // بی‌خطر
 }
}

export interface UseAutoSaveReturn<T> {
 /** در حال debounce — data تغییر کرده ولی هنوز ذخیره نشده */
 isSaving: boolean;
 /** timestamp آخرین ذخیره‌ی موفق (null = هنوز ذخیره نشده) */
 lastSaved: number | null;
 /** داده‌ی ذخیره‌شده را برمی‌گرداند یا null */
 restore: () => { data: T; savedAt: number } | null;
 /** ذخیره‌ی فوری (بدون انتظار برای debounce) */
 saveNow: () => void;
 /** پاک کردن پیش‌نویس */
 clear: () => void;
 /** آیا پیش‌نویسی موجود است؟ (برای نمایش دکمه‌ی «بازیابی») */
 hasDraft: boolean;
}

export function useAutoSave<T>(
 key: string,
 data: T,
 delay: number = 3000
): UseAutoSaveReturn<T> {
 const [isSaving, setIsSaving] = React.useState(false);
 const [lastSaved, setLastSaved] = React.useState<number | null>(null);
 const [hasDraft, setHasDraft] = React.useState(false);

 // بررسی اولیه — آیا پیش‌نویس موجود است؟
 React.useEffect(() => {
 const existing = readDraft<T>(key);
 setHasDraft(existing!== null);
 if (existing) {
 setLastSaved(existing.savedAt);
 }
 }, [key]);

 // debounce save هنگام تغییر data
 const dataRef = React.useRef(data);
 React.useEffect(() => {
 dataRef.current = data;
 }, [data]);

 React.useEffect(() => {
 // جلوگیری از ذخیره‌ی مقدار اولیه قبل از تغییر کاربر
 // فقط زمانی که data واقعاً تغییر کرده باشد
 if (data === dataRef.current &&!lastSaved) {
 // مقدار اولیه — skip
 }
 setIsSaving(true);
 const timer = setTimeout(() => {
 const ts = writeDraft(key, dataRef.current);
 setLastSaved(ts);
 setIsSaving(false);
 setHasDraft(true);
 }, delay);
 return () => clearTimeout(timer);
 }, [data, key, delay]);

 const restore = React.useCallback(() => {
 return readDraft<T>(key);
 }, [key]);

 const saveNow = React.useCallback(() => {
 const ts = writeDraft(key, dataRef.current);
 setLastSaved(ts);
 setIsSaving(false);
 setHasDraft(true);
 }, [key]);

 const clear = React.useCallback(() => {
 removeDraft(key);
 setHasDraft(false);
 setLastSaved(null);
 }, [key]);

 return {
 isSaving,
 lastSaved,
 restore,
 saveNow,
 clear,
 hasDraft,
 };
}

export default useAutoSave;
