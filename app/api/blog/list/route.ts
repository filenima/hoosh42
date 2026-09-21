import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cacheGetOrSet, cacheDeleteByPrefix, CACHE_TTL } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/blog/list — لیست پست‌های منتشرشده
export async function GET(req: NextRequest) {
 try {
 const { searchParams } = new URL(req.url);
 const category = searchParams.get("category");
 // FIX: clamp/NaN — limit نامعتبر باعث 500 (take: NaN) می‌شد
 let limit = Number(searchParams.get("limit") || 20);
 if (!Number.isFinite(limit) || limit <= 0) limit = 20;
 if (limit > 100) limit = 100;

 const where: Record<string, unknown> = { status: "PUBLISHED" };
 if (category) where.category = category;

 // پست‌های بلاگ به‌ندرت تغییر می‌کنند — کش ۱۰ دقیقه‌ای مناسب است.
 // کلید کش شامل category و limit می‌شود تا کوئری‌های مختلف تداخل نداشته باشند.
 const cacheKey = `blog:list:${category || "all"}:${limit}`;
 const posts = await cacheGetOrSet(
 cacheKey,
 () =>
 db.blogPost.findMany({
 where,
 orderBy: { publishedAt: "desc" },
 take: limit,
 select: {
 id: true,
 slug: true,
 title: true,
 excerpt: true,
 coverImage: true,
 category: true,
 publishedAt: true,
 readingTime: true,
 metaTitle: true,
 metaDescription: true,
 },
 }),
 CACHE_TTL.LONG
 );

 return NextResponse.json(
 { success: true, data: posts },
 { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } }
 );
 } catch (error) {
 console.error("Blog list error:", error);
 return NextResponse.json(
 { success: false, error: "خطا در دریافت مقالات" },
 { status: 500 }
 );
 }
}

// Invalidates the blog cache when a post is created/updated/deleted.
// Other API routes (e.g. /api/platform/cms/posts) call this helper.
export function invalidateBlogCache(): void {
 cacheDeleteByPrefix("blog:list:");
 cacheDeleteByPrefix("blog:post:");
}
