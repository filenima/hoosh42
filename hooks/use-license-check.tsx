"use client";

import * as React from "react";
import { LicenseLockScreen } from "@/components/views/license-lock-screen";

interface LicenseInfo {
 isValid: boolean;
 isDemo: boolean;
 isTrial: boolean;
 plan: string;
 status: string;
 endDate: string | null;
 daysRemaining: number | null;
}

export function useLicenseCheck(token: string | null) {
 const [license, setLicense] = React.useState<LicenseInfo | null>(null);
 const [loading, setLoading] = React.useState(true);
 const [locked, setLocked] = React.useState(false);

 React.useEffect(() => {
 if (!token) {
 setLoading(false);
 return;
 }

 let cancelled = false;

 const checkLicense = async () => {
 try {
 const res = await fetch("/api/license/status", {
 headers: { Authorization: `Bearer ${token}` },
 });
 const data = await res.json();
 if (cancelled) return;

 if (data.success) {
 setLicense(data.data);
 setLocked(!data.data.isValid);
 }
 } catch {
 // در صورت خطا، قفل نکنیم (ممکن است شبکه باشد)
 } finally {
 if (!cancelled) setLoading(false);
 }
 };

 checkLicense();
 // چک هر ۵ دقیقه
 const interval = setInterval(checkLicense, 5 * 60 * 1000);

 // FIX(L-7): بعد از بازگشت به تب (پرداخت موفق → ریدایرکت به اپ)، بلافاصله
 // مجدداً چک می‌شود — قبلاً کاربر تا ۵ دقیقه روی صفحه قفل می‌ماند
 const onVisible = () => {
 if (document.visibilityState === "visible") {
 checkLicense();
 }
 };
 document.addEventListener("visibilitychange", onVisible);
 window.addEventListener("focus", onVisible);

 return () => {
 cancelled = true;
 clearInterval(interval);
 document.removeEventListener("visibilitychange", onVisible);
 window.removeEventListener("focus", onVisible);
 };
 }, [token]);

 return { license, loading, locked, setLocked, refresh: React.useCallback(() => {
 // دستی: از پاپ‌آپ پرداخت برگشته‌ایم
 const check = async () => {
 try {
 const res = await fetch("/api/license/status", {
 headers: { Authorization: `Bearer ${token}` },
 });
 const data = await res.json();
 if (data.success) {
 setLicense(data.data);
 setLocked(!data.data.isValid);
 }
 } catch {
 /* ignore */
 }
 };
 if (token) void check();
 }, [token]) };
}

// کامپوننت wrapper برای نمایش صفحه قفل
export function LicenseGuard({
 token,
 children,
 onRenew,
 onLogout,
}: {
 token: string | null;
 children: React.ReactNode;
 onRenew: () => void;
 onLogout: () => void;
}) {
 const { license, loading, locked } = useLicenseCheck(token);

 if (loading) {
 return (
 <div className="flex min-h-screen items-center justify-center">
 <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
 </div>
 );
 }

 if (locked && license) {
 return (
 <LicenseLockScreen
 licenseInfo={{
 plan: license.plan,
 endDate: license.endDate,
 status: license.status,
 }}
 onRenew={onRenew}
 onLogout={onLogout}
 />
 );
 }

 return <>{children}</>;
}
