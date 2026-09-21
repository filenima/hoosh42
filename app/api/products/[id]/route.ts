import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext } from "@/lib/auth";
import { rateLimit } from "@/lib/auth";
import { rateLimitCheck, getClientIp } from "@/lib/rate-limit";
import { applyStockChange, resolveDefaultWarehouse } from "@/lib/stock-movements";
import { parseAmount, normalizeNationalIdDigits } from "@/lib/validators";

export const runtime = "nodejs";

const isDev = process.env.NODE_ENV !== "production";

/**
 * PUT /api/products/[id] — ویرایش کامل یک کالا (درخواست مالک: «همه قسمت‌هاش
 * باید بشه ادیتش زد»)
 *
 * برخلاف PATCH دسته‌ای /api/products (که فقط فیلدهای محدود یعنی
 * name/unit/prices/minStock را می‌پذیرد)، این مسیر **همهٔ فیلدهای** کالا را
 * به‌روزرسانی می‌کند:
 *   sku (با چک یکتایی در tenant) · barcode · name · unit · type ·
 *   purchasePrice · salePrice · wholesalePrice · minStock · maxStock ·
 *   taxRate · goodsCode · description · usdPrice · usdSynced ·
 *   stock (از طریق StockItem + StockMovement با تعدیل ADJUSTMENT)
 *
 * ملاحظات:
 * - category در این پروژه به‌صورت پیشوندِ description («دسته‌بندی: X») ذخیره
 *   می‌شود؛ کلاینت آن را جدا می‌فرستد و اینجا در description ادغم می‌شود.
 * - تغییر sku فقط با چک تصادم (tenant-scoped) مجاز است.
 * - تغییر stock = ثبت تعدیل (ADJUSTMENT) در گردش انبار + بازمحاسبه بهای
 *   تمام‌شده میانگین متحرک — همان مسیر امن موجود.
 * - AuditLog با old/new برای ردیابی کامل.
 */

function toBigInt(value: number | string | undefined | null): bigint | null {
  if (value === undefined || value === null || value === "") return null;
  try {
    const n = typeof value === "number" ? value : parseAmount(value);
    if (n === null || !Number.isFinite(n)) return null;
    return BigInt(Math.trunc(n));
  } catch {
    return null;
  }
}

function serializeProduct(p: Record<string, unknown>) {
  const purchasePrice = Number(p.purchasePrice ?? 0);
  const salePrice = Number(p.salePrice ?? 0);
  const wholesalePrice = Number(p.wholesalePrice ?? 0);
  return {
    ...p,
    purchasePrice,
    salePrice,
    wholesalePrice,
    purchasePriceToman: Math.trunc(purchasePrice / 10),
    salePriceToman: Math.trunc(salePrice / 10),
    wholesalePriceToman: Math.trunc(wholesalePrice / 10),
  };
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const ip = getClientIp(req);
    const rl = rateLimitCheck(`product-edit:${ip}`, 40, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: "درخواست بیش از حد. کمی بعد تلاش کنید." },
        { status: 429 }
      );
    }
    if (!rateLimit(`product-edit:${ip}`, 40, 60000)) {
      return NextResponse.json(
        { success: false, error: "درخواست بیش از حد. کمی بعد تلاش کنید." },
        { status: 429 }
      );
    }

    const ctx = await getAuthContext(req);
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "احراز هویت الزامی است" },
        { status: 401 }
      );
    }
    const tenantId = ctx.tenantId;

    // مالکیت: کالا باید متعلق به tenant فعلی و حذف‌نشده باشد
    const existing = await db.product.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "کالا یافت نشد" },
        { status: 404 }
      );
    }

    const body = (await req.json()) as Record<string, unknown>;
    const b: Record<string, unknown> = { ...body };

    // نرمال‌سازی ارقام فارسی/جداکننده در فیلدهای عددی رشته‌ای
    for (const key of [
      "purchasePrice",
      "salePrice",
      "wholesalePrice",
      "minStock",
      "maxStock",
      "taxRate",
      "usdPrice",
    ]) {
      if (typeof b[key] === "string") {
        const parsedNum = parseAmount(b[key] as string);
        if (parsedNum !== null) b[key] = parsedNum;
      }
    }
    if (typeof b.barcode === "string") {
      b.barcode = normalizeNationalIdDigits(b.barcode) ?? b.barcode;
    }

    // ── فیلدهای متنی ──
    const update: Record<string, unknown> = {};

    if (typeof b.name === "string" && b.name.trim()) {
      update.name = b.name.trim().slice(0, 200);
    }
    if (typeof b.unit === "string" && b.unit.trim()) {
      update.unit = b.unit.trim().slice(0, 20);
    }
    if (
      typeof b.type === "string" &&
      ["GOODS", "SERVICE", "ASSEMBLY"].includes(b.type)
    ) {
      update.type = b.type;
    }
    if (typeof b.barcode === "string") {
      update.barcode = b.barcode.trim() ? b.barcode.trim().slice(0, 64) : null;
    }
    if (typeof b.goodsCode === "string") {
      update.goodsCode = b.goodsCode.trim()
        ? b.goodsCode.trim().slice(0, 40)
        : null;
    }

    // SKU — با چک یکتایی tenant-scoped (شامل کالاهای حذف‌شدهٔ نرم)
    if (
      typeof b.sku === "string" &&
      b.sku.trim() &&
      b.sku.trim() !== existing.sku
    ) {
      const newSku = b.sku.trim().slice(0, 64);
      const clash = await db.product.findFirst({
        where: { tenantId, sku: newSku, id: { not: existing.id } },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(
          {
            success: false,
            error: `کد کالا «${newSku}» تکراری است. لطفاً کد دیگری وارد کنید.`,
          },
          { status: 409 }
        );
      }
      update.sku = newSku;
    }

    // ── دسته‌بندی + شرح ──
    // قرارداد پروژه: category = پیشوند description («دسته‌بندی: X»)
    const incomingDesc =
      typeof b.description === "string" ? b.description.trim() : undefined;
    const incomingCat =
      typeof b.category === "string" ? b.category.trim().slice(0, 60) : undefined;
    if (incomingCat !== undefined || incomingDesc !== undefined) {
      // شرح فعلی را تجزیه می‌کنیم تا بخش غیر-دسته را حفظ کنیم
      let restDesc = existing.description ?? "";
      const CAT_PREFIX = "دسته‌بندی:";
      if (restDesc.startsWith(CAT_PREFIX)) {
        const nl = restDesc.indexOf("\n");
        restDesc = nl >= 0 ? restDesc.slice(nl + 1).trim() : "";
      }
      const cat = incomingCat !== undefined ? incomingCat : "";
      const desc = incomingDesc !== undefined ? incomingDesc : restDesc;
      update.description =
        [cat ? `${CAT_PREFIX} ${cat}` : "", desc]
          .filter(Boolean)
          .join("\n")
          .slice(0, 600) || null;
    }

    // ── قیمت‌ها (ریال) ──
    if (b.purchasePrice !== undefined) {
      const v = toBigInt(b.purchasePrice as string | number);
      update.purchasePrice = v ?? BigInt(0);
    }
    if (b.salePrice !== undefined) {
      const v = toBigInt(b.salePrice as string | number);
      update.salePrice = v ?? BigInt(0);
    }
    if (b.wholesalePrice !== undefined) {
      const v = toBigInt(b.wholesalePrice as string | number);
      update.wholesalePrice = v ?? BigInt(0);
    }

    // ── سقف/کف موجودی و مالیات ──
    if (b.minStock !== undefined) update.minStock = Number(b.minStock) || 0;
    if (b.maxStock !== undefined) update.maxStock = Number(b.maxStock) || 0;
    if (b.taxRate !== undefined) {
      const tr = Number(b.taxRate);
      update.taxRate = Number.isFinite(tr) && tr >= 0 && tr <= 1 ? tr : 0;
    }

    // ── قیمت دلاری ──
    if (b.usdPrice !== undefined) {
      const u = Number(b.usdPrice);
      update.usdPrice = Number.isFinite(u) && u > 0 ? u : null;
    }
    if (b.usdSynced !== undefined) update.usdSynced = b.usdSynced === true;

    // ── موجودی (تعدیل انبار) ──
    let stockApplied: number | null = null;
    if (b.stock !== undefined && b.stock !== null && b.stock !== "") {
      const stockValue = Number(b.stock);
      if (!Number.isFinite(stockValue) || stockValue < 0) {
        return NextResponse.json(
          { success: false, error: "مقدار موجودی نامعتبر است" },
          { status: 400 }
        );
      }
      // موجودی فعلی (جمع StockItem ها) — اگر برابر مقدار جدید بود، کاری نکن
      const agg = await db.stockItem.aggregate({
        where: { tenantId, productId: existing.id },
        _sum: { quantity: true },
      });
      const currentStock = agg._sum.quantity ?? 0;
      if (currentStock !== stockValue) {
        const warehouseId = await resolveDefaultWarehouse(tenantId);
        await applyStockChange({
          tenantId,
          productId: existing.id,
          warehouseId,
          newQuantity: stockValue,
          unitCost:
            (update.purchasePrice as bigint | undefined) ??
            existing.purchasePrice ??
            null,
          referenceType: "ADJUSTMENT",
          referenceId: null,
        });
        stockApplied = stockValue;
      }
    }

    if (Object.keys(update).length > 0) {
      update.updatedAt = new Date();
      await db.product.update({
        where: { id: existing.id },
        data: update,
      });
    }

    // نسخهٔ نهایی + موجودی تازه برای پاسخ
    const fresh = await db.product.findUnique({ where: { id: existing.id } });
    const agg2 = await db.stockItem.aggregate({
      where: { tenantId, productId: existing.id },
      _sum: { quantity: true },
    });

    // AuditLog با old/new
    try {
      const { auditLog } = await import("@/lib/auth");
      await auditLog({
        tenantId,
        action: "UPDATE",
        entity: "Product",
        entityId: existing.id,
        changes: {
          old: {
            sku: existing.sku,
            name: existing.name,
            barcode: existing.barcode,
            salePrice: existing.salePrice?.toString(),
            purchasePrice: existing.purchasePrice?.toString(),
            wholesalePrice: existing.wholesalePrice?.toString(),
            minStock: existing.minStock,
            maxStock: existing.maxStock,
            taxRate: existing.taxRate,
            unit: existing.unit,
          },
          new: {
            sku: (update.sku as string) ?? existing.sku,
            name: (update.name as string) ?? existing.name,
            barcode: (update.barcode as string) ?? existing.barcode,
            salePrice:
              (update.salePrice as bigint)?.toString() ??
              existing.salePrice?.toString(),
            purchasePrice:
              (update.purchasePrice as bigint)?.toString() ??
              existing.purchasePrice?.toString(),
            wholesalePrice:
              (update.wholesalePrice as bigint)?.toString() ??
              existing.wholesalePrice?.toString(),
            minStock: (update.minStock as number) ?? existing.minStock,
            maxStock: (update.maxStock as number) ?? existing.maxStock,
            taxRate: (update.taxRate as number) ?? existing.taxRate,
            unit: (update.unit as string) ?? existing.unit,
          },
          stockApplied,
        },
        req,
      });
    } catch {
      /* audit نباید ویرایش را شکست دهد */
    }

    return NextResponse.json({
      success: true,
      data: {
        ...serializeProduct(fresh as unknown as Record<string, unknown>),
        stock: agg2._sum.quantity ?? 0,
        stockApplied,
      },
      message: "کالا با موفقیت به‌روزرسانی شد",
    });
  } catch (error) {
    console.error("Update product error:", error);
    let prismaCode: string | undefined;
    if (error && typeof error === "object" && "code" in error) {
      prismaCode = String((error as { code: unknown }).code);
    }
    let userMessage = "خطا در به‌روزرسانی کالا";
    let statusCode = 500;
    if (prismaCode === "P2002") {
      userMessage = "کد کالا (SKU) تکراری است. لطفاً کد دیگری وارد کنید.";
      statusCode = 409;
    }
    return NextResponse.json(
      {
        success: false,
        error: userMessage,
        ...(isDev && {
          devMessage: error instanceof Error ? error.message : String(error),
          prismaCode,
        }),
      },
      { status: statusCode }
    );
  }
}

// GET /api/products/[id] — جزئیات یک کالا (با موجودی کل)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(req);
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "احراز هویت الزامی است" },
        { status: 401 }
      );
    }
    const product = await db.product.findFirst({
      where: { id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!product) {
      return NextResponse.json(
        { success: false, error: "کالا یافت نشد" },
        { status: 404 }
      );
    }
    const agg = await db.stockItem.aggregate({
      where: { tenantId: ctx.tenantId, productId: id },
      _sum: { quantity: true },
    });
    return NextResponse.json({
      success: true,
      data: {
        ...serializeProduct(product as unknown as Record<string, unknown>),
        stock: agg._sum.quantity ?? 0,
      },
    });
  } catch (error) {
    console.error("Get product error:", error);
    return NextResponse.json(
      { success: false, error: "خطا در دریافت کالا" },
      { status: 500 }
    );
  }
}
