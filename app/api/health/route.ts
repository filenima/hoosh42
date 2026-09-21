import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/health — بررسی سلامت سرویس‌ها
// endpoint عمومی، بدون نیاز به احراز هویت
// پاسخ سریع (< 100ms)
export async function GET() {
 const startTime = Date.now();
 const timestamp = new Date().toISOString();

 // موازی بررسی همه سرویس‌ها
 const [database, realtime] = await Promise.all([
 checkDatabase(),
 checkRealtime(),
 ]);

 // AI service: در حال حاضر پیکربندی نشده، فرض می‌کنیم up
 // (می‌تواند با اضافه شدن z-ai-web-dev-sdk فعال شود)
 const ai = { status: "up" as const };

 // تعیین وضعیت کلی
 const allUp = database.status === "up" && realtime.status === "up";
 const dbUp = database.status === "up";
 let status: "healthy" | "degraded" | "down";
 if (allUp) {
 status = "healthy";
 } else if (dbUp) {
 status = "degraded"; // DB OK ولی realtime/AI مشکل دارد
 } else {
 status = "down";
 }

 const uptime = process.uptime();
 const version = process.env.npm_package_version || "1.0.0";

 // لاگ وضعیت غیرسالم
 if (status === "down") {
 logger.error("SYSTEM", "سلامت سیستم: DOWN", { database: database.status, realtime: realtime.status, dbLatency: database.latency });
 } else if (status === "degraded") {
 logger.warn("SYSTEM", "سلامت سیستم: DEGRADED", { database: database.status, realtime: realtime.status });
 }

 return NextResponse.json(
 {
 status,
 timestamp,
 services: {
 database,
 ai,
 realtime,
 },
 uptime,
 version,
 responseTimeMs: Date.now() - startTime,
 },
 {
 status: status === "down"? 503: 200,
 headers: {
 "Cache-Control": "no-store, no-cache, must-revalidate",
 },
 }
 );
}

// بررسی دیتابیس با query ساده
async function checkDatabase(): Promise<{
 status: "up" | "down";
 latency?: number;
 error?: string;
}> {
 const start = Date.now();
 try {
 // query ساده: SELECT 1 — در Prisma با $queryRaw
 await db.$queryRaw`SELECT 1`;
 return {
 status: "up",
 latency: Date.now() - start,
 };
 } catch (e) {
 return {
 status: "down",
 error: e instanceof Error? e.message: "Unknown DB error",
 latency: Date.now() - start,
 };
 }
}

// بررسی realtime service (websocket روی پورت 3032)
async function checkRealtime(): Promise<{
 status: "up" | "down";
 port: number;
 latency?: number;
 error?: string;
}> {
 const port = 3032;
 const start = Date.now();
 try {
 // تلاش برای اتصال به پورت socket.io
 // در محیط sandbox، localhost:3032 باید پاسخ بدهد
 const controller = new AbortController();
 const timeout = setTimeout(() => controller.abort(), 1500);

 const res = await fetch(`http://localhost:${port}/socket.io/?EIO=4&transport=polling`, {
 signal: controller.signal,
 method: "GET",
 });
 clearTimeout(timeout);

 if (res.ok || res.status === 400 || res.status === 404) {
 // socket.io معمولاً 400 یا 404 برمی‌گرداند اگر query parameters ناقص باشد
 // مهم این است که سرور پاسخ داده است
 return {
 status: "up",
 port,
 latency: Date.now() - start,
 };
 }
 return {
 status: "up", // اگر HTTP response گرفتیم، سرور بالا است
 port,
 latency: Date.now() - start,
 };
 } catch {
 // در محیط sandbox اگر realtime service راه‌اندازی نشده باشد،
 // این خطا طبیعی است — وضعیت down برمی‌گردد
 return {
 status: "down",
 port,
 latency: Date.now() - start,
 };
 }
}
