/**
 * هوش — Sentry Client Provider
 * کامپوننت کلاینت برای مقداردهی اولیه‌ی Sentry در مرورگر
 * در layout.tsx رندر می‌شود
 */

"use client";

import { useEffect } from "react";
import { initSentry } from "@/lib/sentry";

export function SentryProvider({ children }: { children: React.ReactNode }) {
 useEffect(() => {
 const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?? "";
 initSentry(dsn, {
 environment: process.env.NODE_ENV?? "development",
 release: process.env.NEXT_PUBLIC_APP_VERSION,
 tracesSampleRate: process.env.NODE_ENV === "production"? 0.1: 1.0,
 });
 }, []);

 return <>{children}</>;
}
