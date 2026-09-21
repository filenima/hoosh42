/**
 * هوش — Sentry Error Boundary
 * React Error Boundary که خطاهای رندر را به Sentry ارسال می‌کند
 *
 * @example
 * <SentryErrorBoundary fallback={<ErrorFallback />}>
 * <YourComponent />
 * </SentryErrorBoundary>
 */

"use client";

import * as React from "react";
import { captureError, addBreadcrumb } from "@/lib/sentry";

interface SentryErrorBoundaryProps {
 children: React.ReactNode;
 fallback?: React.ReactNode | ((error: Error, reset: () => void) => React.ReactNode);
 /** نام کامپوننت برای context بهتر در Sentry */
 componentName?: string;
 /** داده‌ی اضافی برای ارسال به Sentry */
 additionalData?: Record<string, unknown>;
 /** Callback در صورت وقوع خطا */
 onError?: (error: Error, componentStack: string | null) => void;
 /** Callback هنگام reset */
 onReset?: () => void;
}

interface SentryErrorBoundaryState {
 hasError: boolean;
 error: Error | null;
}

export class SentryErrorBoundary extends React.Component<
 SentryErrorBoundaryProps,
 SentryErrorBoundaryState
> {
 constructor(props: SentryErrorBoundaryProps) {
 super(props);
 this.state = { hasError: false, error: null };
 }

 static getDerivedStateFromError(error: Error): SentryErrorBoundaryState {
 return { hasError: true, error };
 }

 componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
 const { componentName, additionalData, onError } = this.props;

 // ثبت breadcrumb برای context بهتر
 addBreadcrumb({
 message: `Error in ${componentName?? "component"}`,
 category: "error-boundary",
 level: "error",
 data: {
 componentStack: errorInfo.componentStack,
...additionalData,
 },
 });

 // ارسال به Sentry با context کامل
 captureError(error, {
 component: componentName?? "unknown",
 componentStack: errorInfo.componentStack,
...additionalData,
 });

 // Callback سفارشی
 if (onError) {
 onError(error, errorInfo.componentStack?? null);
 }
 }

 reset = (): void => {
 this.setState({ hasError: false, error: null });
 if (this.props.onReset) {
 this.props.onReset();
 }
 };

 render(): React.ReactNode {
 const { hasError, error } = this.state;
 const { children, fallback } = this.props;

 if (hasError && error) {
 if (typeof fallback === "function") {
 return (fallback as (e: Error, r: () => void) => React.ReactNode)(
 error,
 this.reset
 );
 }
 if (fallback!== undefined) {
 return fallback;
 }
 // Default fallback UI
 return (
 <div
 role="alert"
 dir="rtl"
 style={{
 padding: "1.5rem",
 border: "1px solid #fecaca",
 borderRadius: "0.5rem",
 backgroundColor: "#fef2f2",
 color: "#991b1b",
 fontFamily: "inherit",
 textAlign: "center",
 }}
 >
 <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.5rem" }}>
 خطایی رخ داد
 </h2>
 <p style={{ fontSize: "0.875rem", marginBottom: "1rem" }}>
 تیم فنی از این مشکل مطلع شده است. لطفاً صفحه را مجدداً بارگذاری کنید.
 </p>
 <button
 onClick={this.reset}
 style={{
 padding: "0.5rem 1rem",
 backgroundColor: "#dc2626",
 color: "white",
 border: "none",
 borderRadius: "0.375rem",
 cursor: "pointer",
 fontSize: "0.875rem",
 }}
 >
 تلاش مجدد
 </button>
 </div>
 );
 }

 return children;
 }
}

/**
 * Hook برای ارسال خطاهای دستی به Sentry از کامپوننت‌های تابعی
 *
 * @example
 * const captureError = useSentryError();
 * try {... } catch (e) { captureError(e, { context: "data" }); }
 */
export function useSentryError() {
 return (error: Error, context?: Record<string, unknown>) => {
 captureError(error, context);
 };
}
