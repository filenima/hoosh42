import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/platform-middleware";
import {
 getSlowQueries,
 clearSlowQueries,
 getSlowQueryStats,
} from "@/lib/slow-query-tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/platform/db/slow-queries
 *?limit=50 (حداکثر ۱۰۰)
 *?thresholdMs=100 (فیلتر روی مدت‌زبان)
 *
 * لاگ کوئری‌های کند (>100ms) را برمی‌گرداند. این لاگ در حافظه نگه‌داری
 * می‌شود (آخرین ۲۰۰ رویداد) و در زمان restart سرور پاک می‌شود.
 *
 * برای فعال‌سازی ردیابی، متغیر محیطی TRACK_SLOW_QUERIES=true را تنظیم کنید.
 */
export async function GET(req: NextRequest) {
 const auth = await requireSuperAdmin(req);
 if ("error" in auth) return auth.error;

 try {
 const { searchParams } = new URL(req.url);
 const limit = parseInt(searchParams.get("limit") || "50", 10) || 50;
 const thresholdMs = parseInt(searchParams.get("thresholdMs") || "100", 10) || 100;

 const { entries, stats } = getSlowQueries({ limit, thresholdMs });
 const bufferStats = getSlowQueryStats();

 return NextResponse.json({
 success: true,
 data: entries,
 stats: {...stats,...bufferStats },
 thresholdMs,
 timestamp: new Date().toISOString(),
 });
 } catch (error) {
 console.error("[slow-queries] error:", error);
 return NextResponse.json(
 { success: false, error: "خطا در دریافت لاگ کوئری‌های کند" },
 { status: 500 }
 );
 }
}

/**
 * DELETE /api/platform/db/slow-queries — پاک‌سازی buffer
 */
export async function DELETE(req: NextRequest) {
 const auth = await requireSuperAdmin(req);
 if ("error" in auth) return auth.error;

 try {
 const cleared = clearSlowQueries();
 return NextResponse.json({
 success: true,
 message: `${cleared} مورد پاک شد`,
 });
 } catch (error) {
 console.error("[slow-queries] DELETE error:", error);
 return NextResponse.json(
 { success: false, error: "خطا در پاک‌سازی" },
 { status: 500 }
 );
 }
}
