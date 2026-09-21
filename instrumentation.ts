/**
 * instrumentation.ts — Sentry سمت سرور (Next.js 16)
 * ----------------------------------------------------------------------
 * با NEXT_RUNTIME=nodejs اجرا می‌شود (strumentation hook رسمی Next).
 * در نبود SENTRY_DSN کاملاً no-op است — هیچ خطا/هشداری ندارد.
 *
 * کلیدهای موردنیاز در .env:
 *   SENTRY_DSN  یا  NEXT_PUBLIC_SENTRY_DSN
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || "";
  if (!dsn) {
    // بدون DSN → هیچ‌کاری نکن (no-op کامل)
    return;
  }

  try {
    // Barrel import داینامیک — فقط وقتی DSN موجود است
    const Sentry = await import("@sentry/nextjs");

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV === "production" ? "production" : "development",
      // نمونه‌برداری سبک — ۱۰٪ تراکنش در prod
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
      // خطاهای شناخته‌شده و بدون ارزش → حذف
      ignoreErrors: [
        "top-level document data",
        "Hydration charging",
        "AbortError",
        "NEXT_NOT_FOUND",
        "non-Error promise rejection",
        // شبکه/مرورگر کاربر
        "Network request failed",
        "Failed to fetch",
        "Load failed",
        "net::ERR",
        // Lighthouse/ربات‌ها
        "ResizeObserver loop",
      ],
    });
    console.info("[instrumentation] Sentry server-side initialized");
  } catch (e) {
    // Sentry نباید ap را بکشد
    console.warn("[instrumentation] Sentry init skipped:", (e as Error).message);
  }
}
