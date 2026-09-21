"use client";

import * as React from "react";

// ============ use-session-timeout ============
// مدیریت timeout نشست در سمت کلاینت
// - آخرین فعالیت کاربر را پیگیری می‌کند
// - ۵ دقیقه قبل از انقضا، دیالوگ هشدار نمایش می‌دهد
// - در صورت عدم پاسخ، نشست را logout می‌کند

interface SessionTimeoutConfig {
 /** مدت نشست (میلی‌ثانیه) */
 sessionTimeoutMs: number;
 /** دقیقه‌های باقی‌مانده تا نمایش هشدار (پیش‌فرض ۵) */
 warningMinutesBefore?: number;
 /** توکن کاربر برای logout */
 token: string;
 /** callback هنگام logout */
 onTimeout?: () => void;
 /** callback هنگام نیاز به refresh نشست */
 onRefresh?: () => Promise<void> | void;
}

interface SessionTimeoutState {
 showWarning: boolean;
 remainingMs: number;
}

const ACTIVITY_EVENTS = [
 "mousedown",
 "keydown",
 "scroll",
 "touchstart",
 "mousemove",
] as const;

const STORAGE_KEY = "hoshhesab:lastActivity";

export function useSessionTimeout({
 sessionTimeoutMs,
 warningMinutesBefore = 5,
 token,
 onTimeout,
 onRefresh,
}: SessionTimeoutConfig) {
 const [state, setState] = React.useState<SessionTimeoutState>({
 showWarning: false,
 remainingMs: sessionTimeoutMs,
 });

 // ref برای جلوگیری از re-init مداوم
 const lastActivityRef = React.useRef<number>(Date.now());
 const warningShownRef = React.useRef<boolean>(false);
 const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

 // به‌روزرسانی زمان فعالیت
 const updateActivity = React.useCallback(() => {
 // فقط در صورتی که فعالیت قابل توجه باشد (بیش از ۵ ثانیه از آخرین)
 const now = Date.now();
 if (now - lastActivityRef.current > 5000) {
 lastActivityRef.current = now;
 try {
 localStorage.setItem(STORAGE_KEY, String(now));
 } catch {
 // ignore
 }
 } else {
 lastActivityRef.current = now;
 }
 }, []);

 // refresh نشست: ارسال درخواست به API برای تمدید
 const refreshSession = React.useCallback(async () => {
 try {
 // touch session با هر درخواست requireUser/requireAuth انجام می‌شود
 // اما برای تمدید واقعی expiresAt، یک endpoint اختصاصی می‌خواهیم
 // فعلاً فقط touch می‌کنیم با fetch به /api/auth/me
 const res = await fetch("/api/auth/me", {
 headers: { Authorization: `Bearer ${token}` },
 });
 if (res.ok) {
 lastActivityRef.current = Date.now();
 warningShownRef.current = false;
 setState({ showWarning: false, remainingMs: sessionTimeoutMs });
 onRefresh?.();
 } else {
 // نشست نامعتبر است
 onTimeout?.();
 }
 } catch {
 // ignore — شبکه موقتاً قطع شده باشد
 }
 }, [token, sessionTimeoutMs, onRefresh, onTimeout]);

 // logout اجباری
 const forceLogout = React.useCallback(() => {
 try {
 void fetch("/api/auth/me", {
 method: "DELETE",
 headers: { Authorization: `Bearer ${token}` },
 }).catch(() => {
 // ignore
 });
 } catch {
 // ignore
 }
 onTimeout?.();
 }, [token, onTimeout]);

 // راه‌اندازی listener ها
 React.useEffect(() => {
 if (!token ||!sessionTimeoutMs) return;

 // بازیابی آخرین فعالیت از localStorage (برای بازگشت از background)
 try {
 const stored = localStorage.getItem(STORAGE_KEY);
 if (stored) {
 const storedTime = parseInt(stored, 10);
 if (!isNaN(storedTime)) {
 lastActivityRef.current = storedTime;
 }
 }
 } catch {
 // ignore
 }

 // ثبت listener فعالیت
 ACTIVITY_EVENTS.forEach((event) => {
 window.addEventListener(event, updateActivity, { passive: true });
 });

 // بررسی دوره‌ای (هر ۳۰ ثانیه)
 intervalRef.current = setInterval(() => {
 const elapsed = Date.now() - lastActivityRef.current;
 const remaining = sessionTimeoutMs - elapsed;

 if (remaining <= 0) {
 // نشست منقضی شده
 setState({ showWarning: false, remainingMs: 0 });
 forceLogout();
 return;
 }

 const warningMs = warningMinutesBefore * 60 * 1000;
 if (remaining <= warningMs &&!warningShownRef.current) {
 warningShownRef.current = true;
 setState({ showWarning: true, remainingMs: remaining });
 } else if (remaining > warningMs) {
 warningShownRef.current = false;
 setState({ showWarning: false, remainingMs: remaining });
 } else {
 setState({ showWarning: true, remainingMs: remaining });
 }
 }, 30000);

 // listener برای visibilitychange (هنگام بازگشت به tab)
 const handleVisibility = () => {
 if (document.visibilityState === "visible") {
 updateActivity();
 }
 };
 document.addEventListener("visibilitychange", handleVisibility);

 return () => {
 ACTIVITY_EVENTS.forEach((event) => {
 window.removeEventListener(event, updateActivity);
 });
 document.removeEventListener("visibilitychange", handleVisibility);
 if (intervalRef.current) {
 clearInterval(intervalRef.current);
 }
 };
 }, [
 token,
 sessionTimeoutMs,
 warningMinutesBefore,
 updateActivity,
 forceLogout,
 ]);

 // dismiss هشدار (refresh نشست)
 const dismissWarning = React.useCallback(() => {
 void refreshSession();
 }, [refreshSession]);

 return {
 showWarning: state.showWarning,
 remainingMs: state.remainingMs,
 remainingMinutes: Math.max(0, Math.ceil(state.remainingMs / 60000)),
 refreshSession,
 dismissWarning,
 forceLogout,
 };
}
