import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/platform-middleware";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/platform/db/inspect
 *?table=Invoice برای دریافت اطلاعات یک جدول خاص
 *?query=SELECT... برای اجرای کوئری read-only (فقط SELECT) — حداکثر ۱۰۰ ردیف
 *
 * بازرس پایگاه داده — آمار حجم، تعداد رکورد، جداول برتر.
 * مخصوص GOD panel برای مشاهده‌ی سلامت دیتابیس.
 */
export async function GET(req: NextRequest) {
 const auth = await requireSuperAdmin(req);
 if ("error" in auth) return auth.error;

 try {
 const { searchParams } = new URL(req.url);
 const table = searchParams.get("table");
 const query = searchParams.get("query");

 // ────── شاخه‌ی Query Explorer ──────
 // اجرای کوئری read-only (فقط SELECT) با محدودیت ۱۰۰ ردیف.
 if (query!== null) {
 return await runQueryExplorer(query.trim());
 }

 // آمار حجم دیتابیس از sqlite_master (SQLite) یا pg_catalog (Postgres)
 const isPostgres = process.env.DATABASE_URL?.startsWith("postgres");
 let tableStats: any[] = [];
 let totalSize = 0;

 if (isPostgres) {
 // pg_catalog
 const pgStats = await db.$queryRaw<any[]>`
 SELECT
 relname AS name,
 n_live_tup AS rowCount,
 pg_size_pretty(pg_total_relation_size(relid)) AS sizePretty,
 pg_total_relation_size(relid) AS sizeBytes
 FROM pg_stat_user_tables
 ORDER BY pg_total_relation_size(relid) DESC
 LIMIT 50;
 `;
 tableStats = pgStats;
 totalSize = pgStats.reduce((s, r) => s + Number(r.sizebytes || 0), 0);
 } else {
 // SQLite — پرامیشا مدل‌ها را برای شمارش رکوردها استفاده می‌کنیم
 const tables = [
 "tenant", "user", "invoice", "product", "party", "employee",
 "check", "budget", "auditLog", "errorLog", "userSession",
 "notification", "payment", "aiConversation", "cmsPage", "blogPost",
 ];
 const counts = await Promise.all(
 tables.map(async (t) => {
 try {
 // @ts-ignore — dynamic
 const c = await (db as any)[t]?.count?.();
 return { name: t, rowCount: c?? 0, sizeBytes: 0, sizePretty: "—" };
 } catch {
 return { name: t, rowCount: 0, sizeBytes: 0, sizePretty: "—" };
 }
 })
 );
 tableStats = counts.filter((r) => r.rowCount > 0).sort((a, b) => b.rowCount - a.rowCount);
 totalSize = 0;
 }

 // اگر جدول خاصی خواسته شده، نمونه‌ای از رکوردها
 let sample: any = null;
 if (table) {
 try {
 // @ts-ignore
 sample = await (db as any)[table]?.findMany?.({ take: 5, orderBy: { id: "desc" } });
 } catch {
 sample = null;
 }
 }

 // تعداد کل migrationها
 let migrations: any[] = [];
 try {
 migrations = await db.$queryRaw<any[]>`
 SELECT migration_name, finished_at
 FROM _prisma_migrations
 ORDER BY finished_at DESC
 LIMIT 20;
 `;
 } catch {
 migrations = [];
 }

 return NextResponse.json({
 success: true,
 data: {
 dialect: isPostgres? "postgres": "sqlite",
 tables: tableStats,
 totalSize,
 totalSizePretty: isPostgres
? `${(totalSize / 1024 / 1024).toFixed(2)} MB`
: "—",
 tableCount: tableStats.length,
 migrations,
 sample: table? { table, records: sample?? [] }: null,
 },
 });
 } catch (error) {
 console.error("platform/db/inspect error:", error);
 return NextResponse.json(
 { success: false, error: "خطا در بازرسی دیتابیس" },
 { status: 500 }
 );
 }
}

// ============ Query Explorer — اجرای SELECT فقط‌خواندنی ============
const FORBIDDEN_KEYWORDS = [
 "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE",
 "GRANT", "REVOKE", "REPLACE", "ATTACH", "DETACH", "PRAGMA", "VACUUM",
 "BEGIN", "COMMIT", "ROLLBACK", "MERGE", "EXPLAIN",
];

async function runQueryExplorer(rawQuery: string) {
 // 1. اعتبارسنجی ورودی
 if (!rawQuery) {
 return NextResponse.json(
 { success: false, error: "کوئری خالی است" },
 { status: 400 }
 );
 }

 // 2. بررسی فقط SELECT (با اسکیپ کامنت‌ها)
 const cleaned = rawQuery
.replace(/--[^\n]*/g, "") // SQL line comments
.replace(/\/\*[\s\S]*?\*\//g, "") // SQL block comments
.trim();

 // اولین کلمه باید SELECT باشد
 const firstWord = cleaned.split(/\s+/)[0]?.toUpperCase();
 if (firstWord!== "SELECT") {
 return NextResponse.json(
 {
 success: false,
 error: "فقط کوئری SELECT مجاز است",
 },
 { status: 400 }
 );
 }

 // 3. جلوگیری از کلمات خطرناک (حتی داخل زیرکوئری)
 const upper = cleaned.toUpperCase();
 for (const kw of FORBIDDEN_KEYWORDS) {
 // \b برای تطبیق کلمه کامل
 const regex = new RegExp(`\\b${kw}\\b`, "i");
 if (regex.test(cleaned)) {
 return NextResponse.json(
 {
 success: false,
 error: `کلمه‌ی کلیدی ${kw} مجاز نیست — فقط SELECT فقط‌خواندنی`,
 },
 { status: 403 }
 );
 }
 }
 void upper;

 // 4. جلوگیری از کاراکترهای خطرناک
 if (/;/.test(cleaned)) {
 return NextResponse.json(
 { success: false, error: "سمی‌کالن (;) مجاز نیست — فقط یک کوئری" },
 { status: 400 }
 );
 }

 // 5. اعمال LIMIT اگر کاربر نگذاشته
 // اگر LIMIT در کوئری نبود، اضافه می‌کنیم. اگر بود، مطمئن می‌شویم <= 100.
 let finalQuery = cleaned;
 const hasLimit = /\bLIMIT\b/i.test(cleaned);
 if (!hasLimit) {
 finalQuery = `${cleaned} LIMIT 100`;
 } else {
 // استخراج عدد LIMIT
 const m = cleaned.match(/LIMIT\s+(\d+)/i);
 if (m && parseInt(m[1], 10) > 100) {
 // اگر LIMIT بزرگ‌تر از ۱۰۰ بود، به ۱۰۰ کاهش بده
 finalQuery = cleaned.replace(/LIMIT\s+\d+/i, "LIMIT 100");
 }
 }

 const startedAt = Date.now();
 try {
 const isPostgres = process.env.DATABASE_URL?.startsWith("postgres");
 // @ts-ignore — Prisma $queryRawUnsafe با template string امن است
 const rows: any[] = await db.$queryRawUnsafe(finalQuery);
 const duration = Date.now() - startedAt;

 // سریال‌سازی BigInt (در SQLite ممکن است برگردد)
 const safeRows = rows.map((row: any) => {
 const out: Record<string, unknown> = {};
 for (const k of Object.keys(row)) {
 const v = row[k];
 if (typeof v === "bigint") out[k] = v.toString();
 else if (v instanceof Date) out[k] = v.toISOString();
 else out[k] = v;
 }
 return out;
 });

 return NextResponse.json({
 success: true,
 data: {
 rows: safeRows.slice(0, 100),
 rowCount: safeRows.length,
 truncated: safeRows.length === 100,
 durationMs: duration,
 executedQuery: finalQuery,
 dialect: isPostgres? "postgres": "sqlite",
 },
 });
 } catch (err) {
 const duration = Date.now() - startedAt;
 const msg = err instanceof Error? err.message: String(err);
 return NextResponse.json(
 {
 success: false,
 error: "خطا در اجرای کوئری",
 details: msg,
 durationMs: duration,
 },
 { status: 500 }
 );
 }
}
