import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext } from "@/lib/auth";

export const runtime = "nodejs";

// GET /api/accounting/form-data — داده‌های لازم برای فرم فاکتور (طرف‌حساب‌ها، کالاها، انبارها)
// توجه: مبالغ BigInt به Number تبدیل می‌شوند تا قابل JSON serialization باشند.
// SECURITY (C1): احراز هویت اجباری + فیلتر tenant — قبلاً هیچ فیلتری وجود نداشت و
// داده‌های طرف‌حساب/کالای تمام tenantها نشت می‌کرد.
export async function GET(req: NextRequest) {
 try {
 const ctx = await getAuthContext(req);
 if (!ctx) {
 return NextResponse.json(
 { success: false, error: "احراز هویت الزامی است" },
 { status: 401 }
 );
 }
 const tenantId = ctx.tenantId;
 const [parties, products, warehouses] = await Promise.all([
 db.party.findMany({
 where: { tenantId },
 select: {
 id: true,
 name: true,
 code: true,
 type: true,
 nationalId: true,
 },
 orderBy: { name: "asc" },
 take: 200,
 }),
 db.product.findMany({
 where: { tenantId },
 select: {
 id: true,
 name: true,
 sku: true,
 unit: true,
 salePrice: true,
 purchasePrice: true,
 taxRate: true,
 },
 orderBy: { name: "asc" },
 take: 200,
 }),
 db.warehouse.findMany({
 where: { tenantId },
 select: {
 id: true,
 name: true,
 code: true,
 },
 orderBy: { name: "asc" },
 take: 50,
 }),
 ]);

 // تبدیل BigInt به Number (BigInt-safe)
 const safeProducts = products.map((p) => ({
 id: p.id,
 name: p.name,
 sku: p.sku,
 unit: p.unit,
 salePrice: Number(p.salePrice),
 purchasePrice: Number(p.purchasePrice),
 taxRate: p.taxRate,
 }));

 return NextResponse.json({
 success: true,
 data: { parties, products: safeProducts, warehouses },
 });
 } catch (error) {
 console.error("form-data error:", error);
 return NextResponse.json(
 {
 success: false,
 error: "خطا در دریافت داده‌های فرم",
 data: { parties: [], products: [], warehouses: [] },
 },
 { status: 200 }
 );
 }
}
