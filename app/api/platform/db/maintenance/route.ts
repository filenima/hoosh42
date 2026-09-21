import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/platform-middleware";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/platform/db/maintenance — نگهداشت دیتابیس SQLite (فقط سوپرادمین)
// body: { action: "vacuum" | "integrity_check" }
export async function POST(req: NextRequest) {
 const auth = await requireSuperAdmin(req);
 if ("error" in auth) return auth.error;

 try {
 const body = await req.json().catch(() => ({}));
 const { action } = body as { action?: string };

 if (action!== "vacuum" && action!== "integrity_check") {
 return NextResponse.json(
 { success: false, error: "action باید vacuum یا integrity_check باشد" },
 { status: 400 }
 );
 }

 let result: unknown;
 if (action === "integrity_check") {
 // PRAGMA integrity_check — نتیجه معمولاً [{ integrity_check: "ok" }]
 const rows = await db.$queryRawUnsafe("PRAGMA integrity_check");
 result = rows;
 } else {
 // VACUUM — فشرده‌سازی فایل دیتابیس SQLite
 await db.$executeRawUnsafe("VACUUM");
 result = { vacuum: "ok" };
 }

 await db.platformAuditLog.create({
 data: {
 superAdminId: auth.admin.id,
 action: `DB_MAINTENANCE_${action.toUpperCase()}`,
 entity: "Database",
 details: JSON.stringify({ action }),
 ipAddress: req.headers.get("x-forwarded-for") || null,
 },
 }).catch(() => {
 // ignore audit log failure
 });

 return NextResponse.json({
 success: true,
 data: { action, result },
 message:
 action === "vacuum"
? "عملیات VACUUM با موفقیت اجرا شد — دیتابیس فشرده شد"
: "بررسی یکپارچگی دیتابیس انجام شد",
 });
 } catch (error) {
 console.error("DB maintenance error:", error);
 return NextResponse.json(
 {
 success: false,
 error: `خطا در عملیات نگهداشت دیتابیس: ${error instanceof Error? error.message: "نامشخص"}`,
 },
 { status: 500 }
 );
 }
}
