// lib/ai-actions.ts — پیاده‌سازی مشترک اکشن‌های اجرایی هوش‌یار
// هوش — Shared AI Action Implementations
// ----------------------------------------------------------------------------
// پنج اکشن ثبت (فاکتور/هزینه/مشتری/محصول/پرداخت) که قبلاً داخل
// app/api/ai/execute/route.ts پیاده شده بودند، به این ماژول منتقل شدند تا
// هم /api/ai/execute و هم /api/ai/agent-chat (ایجنت جدید) از یک پیاده‌سازی
// استفاده کنند و drift رخ ندهد. قرارداد API مسیر execute تغییر نکرده است.
//
// ورودی مبالغ: تومان — ذخیره در DB: ریال (×۱۰)
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/auth";
import { getCurrentJalaliYear, toEnglishDigits, jalaliToGregorian } from "@/lib/persian";
// FIX(v12-accounting): فاکتور هوش‌یار باید مثل فاکتور دستی/POS حسابداری کامل بگیرد —
// سند حسابداری (postInvoiceToLedger) + حرکت انبار (moveStockForInvoice) + شماره‌ی
// استاندارد (nextDocumentNumber «1405-000NNN» — قبلاً «INV-1405-0000N» بود و با
// شماره‌گذاری بقیهٔ فاکتورهای سازمان ناسازگار بود).
import { nextDocumentNumber } from "@/lib/document-sequence";
import { postInvoiceToLedger, isAutoPostJournalsEnabled } from "@/lib/accounting";
import { moveStockForInvoice, NegativeStockError } from "@/lib/products";
// Task 21-D: سوییت کامل فاکتور ایجنت — ویرایش (PUT داخلی) + رزرو + قرضی.
// توابع _shared.ts مسیر app/api/invoices (Task 21-B) مستقیماً استفاده می‌شوند
// (بدون HTTP) تا حسابداری/انبار دقیقاً هم‌شکل ویرایش دستی بماند.
import {
  InvalidInputError as InvoiceInvalidInputError,
  computeInvoiceTotals,
  loadOwnedProducts,
  resolvePartyId,
  postInvoiceJournalForce,
  reverseAndClearInvoiceStock,
  writeInvoiceAudit,
} from "@/app/api/invoices/_shared";
import {
  getVatRateFraction,
  isFinalInvoiceStatus,
  invoiceHasPostedLedger,
  postInvoiceSettlementToLedger,
  reverseInvoiceLedger,
} from "@/lib/accounting";
import { Prisma } from "@prisma/client";

// ============ Types ============
export type ActionType =
  | "create_invoice"
  | "create_expense"
  | "add_customer"
  | "add_product"
  | "record_payment"
  | "edit_invoice"
  | "reserve_invoice"
  | "create_credit_invoice"
  | "update_product_price";

export interface ActionOutcome {
  ok: boolean;
  /** کد وضعیت HTTP در حالت خطا (پیش‌فرض 400) */
  status?: number;
  /** پیام خطای فارسی در حالت خطا */
  error?: string;
  /** داده‌های نتیجه در حالت موفق */
  data?: Record<string, unknown>;
}

// ============ Helpers ============
export function toRial(toman: number): bigint {
  // ورودی تومان → ریال
  return BigInt(Math.max(0, Math.round(toman * 10)));
}

export function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,٬ ]/g, ""));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

export function toStr(v: unknown, def = ""): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return def;
}

// ============ Atomic invoice number generator ============
export async function nextInvoiceNumber(
  tenantId: string,
  type: "SALE" | "PURCHASE",
  prefix: string
): Promise<string> {
  const year = getCurrentJalaliYear();
  try {
    // Upsert + increment
    const seq = await db.documentSequence.upsert({
      where: {
        tenantId_entityType_fiscalYear: {
          tenantId,
          entityType: type === "SALE" ? "INVOICE" : "PURCHASE",
          fiscalYear: year,
        },
      },
      update: { lastNumber: { increment: 1 } },
      create: {
        tenantId,
        entityType: type === "SALE" ? "INVOICE" : "PURCHASE",
        fiscalYear: year,
        prefix,
        lastNumber: 1,
      },
    });
    return `${prefix}-${year}-${String(seq.lastNumber).padStart(5, "0")}`;
  } catch {
    // Fallback — timestamp-based
    return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
  }
}

// ============ Lookup: فاکتور با شماره (برای record_payment ایجنت) ============
export async function lookupInvoiceByNumber(
  tenantId: string,
  number: string
): Promise<{
  id: string;
  number: string;
  type: string;
  partyName: string;
  total: bigint;
  paidAmount: bigint;
  status: string;
} | null> {
  // FIX(v11): نرمال‌سازی رقم فارسی/عربی + فاصله‌های صفر-عرض + case —
  // مدل ممکن است «INV-۱۴۰۵-۰۰۰۰۱» بفرستد و exact match می‌شکست
  const normalized = toEnglishDigits(String(number || ""))
    .replace(/[\u200c\u200f\u200e]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
  const invoice = await db.invoice.findFirst({
    where: { tenantId, number: normalized, deletedAt: null },
    include: { party: { select: { name: true } } },
  });
  if (!invoice) return null;
  return {
    id: invoice.id,
    number: invoice.number,
    type: invoice.type,
    partyName: invoice.party?.name || "—",
    total: invoice.total,
    paidAmount: invoice.paidAmount,
    status: invoice.status,
  };
}

// ============ Action: create_invoice ============
export async function createInvoiceAction(
  tenantId: string,
  userId: string | undefined,
  data: Record<string, unknown>,
  req: NextRequest
): Promise<ActionOutcome> {
  const partyName = toStr(data.partyName);
  const partyId = toStr(data.partyId);
  const invoiceType = (toStr(data.type, "SALE").toUpperCase() === "PURCHASE" ? "PURCHASE" : "SALE") as
    | "SALE"
    | "PURCHASE";
  const itemsRaw = Array.isArray(data.items) ? data.items : [];
  const description = toStr(data.description);
  const dueDateStr = toStr(data.dueDate);
  // Task 21-D: سوییت فاکتور ایجنت — وضعیت (SENT پیش‌فرض | RESERVED رزرو) و
  // نوع پرداخت (CASH | CREDIT قرضی/نسیه). مسیرهای قدیمی بدون این فیلدها رفتار
  // قبلی (SENT/CASH) را می‌گیرند.
  const invoiceStatus = toStr(data.status, "SENT").toUpperCase() === "RESERVED" ? "RESERVED" : "SENT";
  const paymentType = toStr(data.paymentType, "CASH").toUpperCase() === "CREDIT" ? "CREDIT" : "CASH";
  const willFinalize = invoiceStatus !== "RESERVED";

  if (!partyName && !partyId) {
    return { ok: false, status: 400, error: "نام یا شناسه طرف‌حساب الزامی است" };
  }

  // یافتن یا ایجاد طرف‌حساب
  let resolvedPartyId = partyId;
  if (!resolvedPartyId && partyName) {
    const existing = await db.party.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        name: { contains: partyName },
      },
      select: { id: true },
    });
    if (existing) {
      resolvedPartyId = existing.id;
    } else {
      const code = `P-${Date.now().toString(36).toUpperCase()}`;
      const newParty = await db.party.create({
        data: {
          tenantId,
          code,
          name: partyName,
          type: invoiceType === "SALE" ? "CUSTOMER" : "SUPPLIER",
        },
      });
      resolvedPartyId = newParty.id;
    }
  }

  if (!resolvedPartyId) {
    return { ok: false, status: 400, error: "طرف‌حساب یافت نشد" };
  }

  // محاسبه مبالغ
  let subtotalRial = 0n;
  let taxRial = 0n;
  // FIX(v11-vat): نرخ قانونی ۱۴۰۴+ = ۱۰٪ (هماهنگ با schema/invoice-form) — قبلاً ۹٪ بود
  const VAT_RATE_AI = 0.1;
  // FIX(v11-zero): اقلام بدون قیمت واحد → حذف؛ اگر همه حذف شدند به amount برگرد
  // (قبلاً آیتم‌های بی‌قیمت از regex چت ساخته می‌شدند و فاکتور صفر ثبتی می‌شد)
  const pricedItems = itemsRaw.filter((it: unknown) => {
    const obj = (it || {}) as Record<string, unknown>;
    return toNum(obj.unitPrice ?? obj.amount ?? 0) > 0;
  });
  const itemsData: Array<{
    description: string;
    quantity: number;
    unitPrice: bigint;
    taxRate: number;
    taxAmount: bigint;
    total: bigint;
    productId: string | null;
  }> = pricedItems.map((it: unknown) => {
    const obj = (it || {}) as Record<string, unknown>;
    const name = toStr(obj.name, "آیتم");
    const qty = Number(obj.quantity ?? 1) || 1;
    const unitPriceToman = toNum(obj.unitPrice ?? obj.amount ?? 0);
    const unitPriceRial = toRial(unitPriceToman);
    const taxRate = Number(obj.taxRate ?? VAT_RATE_AI);
    const itemTaxRial =
      (unitPriceRial * BigInt(Math.round(qty * 1000)) * BigInt(Math.round(taxRate * 1000))) /
      BigInt(1_000_000);
    const itemTotalRial = (unitPriceRial * BigInt(Math.round(qty * 1000))) / BigInt(1000) + itemTaxRial;
    subtotalRial += (unitPriceRial * BigInt(Math.round(qty * 1000))) / BigInt(1000);
    taxRial += itemTaxRial;
    // FIX(v12-stock): productId بعداً با تطبیق نام کالا پر می‌شود
    const pidRaw = toStr(obj.productId);
    return {
      description: name,
      quantity: qty,
      unitPrice: unitPriceRial,
      taxRate,
      taxAmount: itemTaxRial,
      total: itemTotalRial,
      productId: pidRaw || null,
    };
  });

  // اگر آیتم قیمت‌دار نبود و amount داشت — یک آیتم کلی بساز
  if (itemsData.length === 0) {
    const totalToman = toNum(data.amount ?? data.total ?? 0);
    const unitPriceRial = toRial(totalToman);
    // FIX(v11-vat): ۱۰٪ قانونی (قبلاً ۹٪)
    const itemTaxRial = (unitPriceRial * BigInt(10)) / BigInt(100);
    subtotalRial = unitPriceRial;
    taxRial = itemTaxRial;
    itemsData.push({
      description: description || "آیتم فاکتور",
      quantity: 1,
      unitPrice: unitPriceRial,
      taxRate: 0.1,
      taxAmount: itemTaxRial,
      total: unitPriceRial + itemTaxRial,
      productId: null,
    });
  }

  const totalRial = subtotalRial + taxRial;
  const dueDate = dueDateStr ? new Date(dueDateStr) : null;
  const invoiceDate = new Date();

  // FIX(v12-number): شماره‌گذاری استاندارد و هم‌شکل با فاکتورهای دستی/POS —
  // «1405-000NNN» از همان شمارندهٔ INVOICE (قبل: «INV-1405-0000N» جدا و ناسازگار)
  const { number } = await nextDocumentNumber("INVOICE", tenantId);

  // FIX(v12-stock): تطبیق اقلام با کالاهای موجود سازمان (برای حرکت انبار + اتصال productId)
  const productCandidates = await db.product.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true, sku: true },
    take: 500,
  });
  const normalize = (s: string) =>
    toEnglishDigits(s).replace(/[\u200c\u200f\u200e\s]+/g, " ").trim().toLowerCase();
  const productByName = new Map<string, { id: string; name: string }>();
  for (const p of productCandidates) {
    productByName.set(normalize(p.name), { id: p.id, name: p.name });
    if (p.sku) productByName.set(normalize(p.sku), { id: p.id, name: p.name });
  }
  const itemProductIds: (string | null)[] = itemsData.map((it) => {
    if (it.productId) return it.productId;
    const key = normalize(it.description);
    const exact = productByName.get(key);
    if (exact) return exact.id;
    // تطبیق تقریبی: نام کالا در شرح آیتم آمده باشد
    for (const [name, p] of productByName) {
      if (name.length >= 3 && (key.includes(name) || name.includes(key))) return p.id;
    }
    return null;
  });

  // FIX(v12-accounting): سند حسابداری خودکار — مثل فاکتور دستی (فقط غیر DRAFT و
  // وقتی tenant فعال کرده باشد). شماره سند «قبل از tx» تخصیص می‌یابد (الگوی
  // اثبات‌شده در /api/accounting/invoices برای SQLite تک‌نویسنده).
  // Task 21-D: رزرو سند/انبار نمی‌گیرد (هم‌سیاست POST /api/invoices).
  const autoPost = willFinalize ? await isAutoPostJournalsEnabled() : false;
  let journalNumber = 0;
  if (autoPost) {
    journalNumber = (await nextDocumentNumber("JOURNAL", tenantId)).seq;
  }

  const productNames = new Map<string, string>();
  itemProductIds.forEach((pid, idx) => {
    if (pid) {
      const p = productCandidates.find((c) => c.id === pid);
      if (p) productNames.set(pid, p.name);
      itemsData[idx].productId = pid;
    }
  });
  const stockContextItems = itemProductIds
    .map((pid, idx) =>
      pid
        ? {
            productId: pid,
            quantity: itemsData[idx].quantity,
            unitPrice: itemsData[idx].unitPrice,
          }
        : null
    )
    .filter((x): x is { productId: string; quantity: number; unitPrice: bigint } => x !== null);

  let invoice;
  try {
    invoice = await db.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          tenantId,
          number,
          type: invoiceType,
          partyId: resolvedPartyId,
          date: invoiceDate,
          dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate : null,
          subtotal: subtotalRial,
          tax: taxRial,
          total: totalRial,
          paidAmount: 0n,
          // FIX(v11): فاکتور هوش‌یار «واقعی» ثبت می‌شود (SENT = سند + خروج انبار) —
          // قبلاً DRAFT بود و هیچ اثر حسابداری/انباری نمی‌گرفت ولی کاربر فکر می‌کرد
          // ثبت شده (نوعی اجرای غیرواقعی). محافظ فاکتور تکراری در ایجنت فعال است.
          // Task 21-D: RESERVED (رزرو) بدون هیچ اثر انبار/سند تا نهایی‌سازی.
          status: invoiceStatus,
          paymentType,
          modianStatus: "PENDING",
          description:
            description ||
            `فاکتور ${invoiceType === "SALE" ? "فروش" : "خرید"}${
              invoiceStatus === "RESERVED" ? " (رزرو)" : ""
            }${paymentType === "CREDIT" ? " (قرضی/نسیه)" : ""} ایجاد‌شده توسط هوش‌یار`,
          createdBy: userId,
          items: { create: itemsData },
        },
        include: { items: true },
      });

      // FIX(v12-stock): حرکت انبار در همان تراکنش — SALE=خروج (با گارد منفی) /
      // PURCHASE=ورود — فقط برای اقلامی که به کالا وصل شدند
      // Task 21-D: رزرو هیچ حرکت انباری نمی‌گیرد.
      if (willFinalize && stockContextItems.length > 0) {
        await moveStockForInvoice(
          tx,
          tenantId,
          {
            invoiceId: created.id,
            type: invoiceType,
            date: invoiceDate,
            warehouseId: null,
          },
          stockContextItems,
          productNames
        );
      }

      // FIX(v12-accounting): سند حسابداری خودکار در همان تراکنش
      if (autoPost) {
        await postInvoiceToLedger(
          tx,
          tenantId,
          userId,
          {
            invoiceId: created.id,
            number,
            type: invoiceType,
            date: invoiceDate,
            description: description || null,
            subtotal: created.subtotal,
            tax: created.tax,
            discount: created.discount,
            total: created.total,
          },
          { journalNumber }
        );
      }

      return created;
    });
  } catch (err) {
    if (err instanceof NegativeStockError) {
      return {
        ok: false,
        status: 400,
        error: `موجودی کافی نیست — ${err.message}`,
      };
    }
    throw err;
  }

  await auditLog({
    tenantId,
    userId,
    action: "AI_EXECUTE_CREATE_INVOICE",
    entity: "invoice",
    entityId: invoice.id,
    changes: {
      number,
      type: invoiceType,
      status: invoiceStatus,
      paymentType,
      partyId: resolvedPartyId,
      totalToman: Number(totalRial) / 10,
      itemCount: itemsData.length,
      journalPosted: autoPost,
      stockLinkedItems: stockContextItems.length,
    },
    req,
  });

  return {
    ok: true,
    data: {
      invoiceId: invoice.id,
      number,
      type: invoiceType,
      status: invoiceStatus,
      paymentType,
      dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate.toISOString() : null,
      partyId: resolvedPartyId,
      subtotalToman: Number(subtotalRial) / 10,
      taxToman: Number(taxRial) / 10,
      totalToman: Number(totalRial) / 10,
      itemCount: itemsData.length,
      journalPosted: autoPost,
      stockLinkedItems: stockContextItems.length,
      // FIX(v11-404): لینک SPA واقعی — قبلاً /app/invoices?id=... بود و 404 می‌داد
      url: `/?module=invoices&invoice=${invoice.id}`,
    },
  };
}

// ============ Action: create_expense ============
export async function createExpenseAction(
  tenantId: string,
  userId: string | undefined,
  data: Record<string, unknown>,
  req: NextRequest
): Promise<ActionOutcome> {
  const amountToman = toNum(data.amount);
  if (amountToman <= 0) {
    return { ok: false, status: 400, error: "مبلغ هزینه الزامی است" };
  }
  const category = toStr(data.category, "OTHER").toUpperCase();
  const description = toStr(data.description, "هزینه ثبت‌شده توسط هوش‌یار");
  const vendor = toStr(data.vendor);
  const dateStr = toStr(data.date);
  const date = dateStr ? new Date(dateStr) : new Date();

  const amountRial = toRial(amountToman);

  const expense = await db.expenseEntry.create({
    data: {
      tenantId,
      userId,
      type: "EXPENSE",
      amount: amountRial,
      date: date && !isNaN(date.getTime()) ? date : new Date(),
      category: ["MEALS", "TRAVEL", "FUEL", "OFFICE", "CLIENT_MEETING", "SOFTWARE", "OTHER"].includes(
        category
      )
        ? category
        : "OTHER",
      vendor: vendor || null,
      description,
      status: "PENDING",
    },
  });

  await auditLog({
    tenantId,
    userId,
    action: "AI_EXECUTE_CREATE_EXPENSE",
    entity: "expense",
    entityId: expense.id,
    changes: { amountToman, category, description },
    req,
  });

  return {
    ok: true,
    data: {
      expenseId: expense.id,
      amountToman,
      category,
      description,
      url: `/?module=expense-tracker&expense=${expense.id}`,
    },
  };
}

// ============ Action: add_customer ============
export async function addCustomerAction(
  tenantId: string,
  userId: string | undefined,
  data: Record<string, unknown>,
  req: NextRequest
): Promise<ActionOutcome> {
  const name = toStr(data.name);
  if (!name) {
    return { ok: false, status: 400, error: "نام طرف‌حساب الزامی است" };
  }
  const partyType = toStr(data.type, "CUSTOMER").toUpperCase();
  const type = ["CUSTOMER", "SUPPLIER", "BOTH"].includes(partyType) ? partyType : "CUSTOMER";

  // بررسی تکراری نبودن
  const existing = await db.party.findFirst({
    where: { tenantId, name, deletedAt: null },
    select: { id: true, code: true },
  });
  if (existing) {
    return {
      ok: true,
      data: {
        partyId: existing.id,
        code: existing.code,
        name,
        type,
        existing: true,
        url: `/?module=crm&party=${existing.id}`,
      },
    };
  }

  const code = toStr(data.code) || `P-${Date.now().toString(36).toUpperCase()}`;
  const party = await db.party
    .create({
      data: {
        tenantId,
        code,
        name,
        type,
        nationalId: toStr(data.nationalId) || null,
        economicCode: toStr(data.economicCode) || null,
        phone: toStr(data.phone) || null,
        mobile: toStr(data.mobile) || null,
        email: toStr(data.email) || null,
        address: toStr(data.address) || null,
        city: toStr(data.city) || null,
      },
    })
    .catch(async (err: { code?: string; message?: string }) => {
      // اگر code تکراری بود — یک کد جدید تولید کن
      if (err && (err.code === "P2002" || (err.message || "").includes("Unique"))) {
        const newCode = `P-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
        return db.party.create({
          data: {
            tenantId,
            code: newCode,
            name,
            type,
            nationalId: toStr(data.nationalId) || null,
            economicCode: toStr(data.economicCode) || null,
            phone: toStr(data.phone) || null,
            mobile: toStr(data.mobile) || null,
            email: toStr(data.email) || null,
            address: toStr(data.address) || null,
            city: toStr(data.city) || null,
          },
        });
      }
      throw err;
    });

  await auditLog({
    tenantId,
    userId,
    action: "AI_EXECUTE_ADD_CUSTOMER",
    entity: "party",
    entityId: party.id,
    changes: { name, code: party.code, type },
    req,
  });

  return {
    ok: true,
    data: {
      partyId: party.id,
      code: party.code,
      name,
      type,
      url: `/?module=crm&party=${party.id}`,
    },
  };
}

// ============ Action: add_product ============
export async function addProductAction(
  tenantId: string,
  userId: string | undefined,
  data: Record<string, unknown>,
  req: NextRequest
): Promise<ActionOutcome> {
  const name = toStr(data.name);
  if (!name) {
    return { ok: false, status: 400, error: "نام محصول الزامی است" };
  }
  const sku = toStr(data.sku) || `SKU-${Date.now().toString(36).toUpperCase()}`;
  const unit = toStr(data.unit, "عدد");
  const type = toStr(data.type, "GOODS").toUpperCase();
  const productType = ["GOODS", "SERVICE", "ASSEMBLY"].includes(type) ? type : "GOODS";
  const purchasePriceToman = toNum(data.purchasePrice);
  const salePriceToman = toNum(data.salePrice);
  const description = toStr(data.description);

  // بررسی SKU تکراری
  const existing = await db.product.findFirst({
    where: { tenantId, sku, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: true,
      data: {
        productId: existing.id,
        sku,
        name,
        existing: true,
        url: `/?module=inventory&product=${existing.id}`,
      },
    };
  }

  const product = await db.product.create({
    data: {
      tenantId,
      sku,
      name,
      unit,
      type: productType,
      purchasePrice: toRial(purchasePriceToman),
      salePrice: toRial(salePriceToman),
      wholesalePrice: toRial(toNum(data.wholesalePrice)),
      minStock: Number(data.minStock ?? 0) || 0,
      maxStock: Number(data.maxStock ?? 0) || 0,
      taxRate: Number(data.taxRate ?? 0.09) || 0.09,
      description: description || null,
    },
  });

  await auditLog({
    tenantId,
    userId,
    action: "AI_EXECUTE_ADD_PRODUCT",
    entity: "product",
    entityId: product.id,
    changes: { name, sku, unit, salePriceToman, purchasePriceToman },
    req,
  });

  return {
    ok: true,
    data: {
      productId: product.id,
      sku,
      name,
      unit,
      salePriceToman,
      purchasePriceToman,
      url: `/?module=inventory&product=${product.id}`,
    },
  };
}

// ============ Action: record_payment ============
export async function recordPaymentAction(
  tenantId: string,
  userId: string | undefined,
  data: Record<string, unknown>,
  req: NextRequest
): Promise<ActionOutcome> {
  // FIX(v11): پذیرش invoiceNumber (از chips چت/صوتی) در کنار invoiceId —
  // قبلاً مسیر /api/ai/execute فقط invoiceId می‌پذیرفت و همیشه 400 می‌شد
  let invoiceId = toStr(data.invoiceId);
  const invoiceNumber = toStr(data.invoiceNumber);
  const amountToman = toNum(data.amount);
  if (amountToman <= 0) {
    return { ok: false, status: 400, error: "مبلغ پرداخت الزامی است" };
  }
  if (!invoiceId && invoiceNumber) {
    const found = await lookupInvoiceByNumber(tenantId, invoiceNumber);
    if (!found) {
      return { ok: false, status: 404, error: `فاکتوری با شماره ${invoiceNumber} یافت نشد` };
    }
    invoiceId = found.id;
  }
  if (!invoiceId) {
    return { ok: false, status: 400, error: "شناسه یا شماره فاکتور الزامی است" };
  }

  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, tenantId, deletedAt: null },
    select: { id: true, number: true, total: true, paidAmount: true, status: true, type: true },
  });
  if (!invoice) {
    return { ok: false, status: 404, error: "فاکتور یافت نشد" };
  }
  // FIX(v11): فاکتور لغوشده قابل پرداخت نیست
  if (invoice.status === "CANCELLED") {
    return { ok: false, status: 400, error: "فاکتور لغو‌شده قابل پرداخت نیست" };
  }

  const amountRial = toRial(amountToman);
  const total = BigInt(invoice.total ?? 0);
  const currentPaid = BigInt(invoice.paidAmount ?? 0);
  const remainingRial = total - currentPaid;
  // FIX(v11): جلوگیری از پرداخت بیش از مبلغ — قبلاً paidAmount می‌توانست از total بزرگ‌تر شود
  if (remainingRial <= 0n) {
    return { ok: false, status: 400, error: "این فاکتور قبلاً به‌طور کامل پرداخت شده است" };
  }
  const effectiveRial = amountRial > remainingRial ? remainingRial : amountRial;
  const newPaid = currentPaid + effectiveRial;
  let newStatus = invoice.status;
  if (newPaid >= total) {
    newStatus = "PAID";
  } else if (newPaid > 0) {
    newStatus = "PARTIAL";
  }

  const updated = await db.invoice.update({
    where: { id: invoiceId },
    data: {
      paidAmount: newPaid,
      status: newStatus,
    },
  });
  void updated; // نتیجه استفاده نمی‌شود — وضعیت در data برگردانده می‌شود

  await auditLog({
    tenantId,
    userId,
    action: "AI_EXECUTE_RECORD_PAYMENT",
    entity: "invoice",
    entityId: invoiceId,
    changes: {
      number: invoice.number,
      amountToman,
      effectiveToman: Number(effectiveRial) / 10,
      newPaidToman: Number(newPaid) / 10,
      totalToman: Number(total) / 10,
      newStatus,
    },
    req,
  });

  return {
    ok: true,
    data: {
      invoiceId,
      number: invoice.number,
      paymentToman: Number(effectiveRial) / 10,
      totalPaidToman: Number(newPaid) / 10,
      totalToman: Number(total) / 10,
      remainingToman: Math.max(0, Number(total - newPaid)) / 10,
      status: newStatus,
      url: `/?module=invoices&invoice=${invoiceId}`,
    },
  };
}

/* ============================================================
 * Task 21-D — سوییت کامل فاکتور ایجنت (رزرو / قرضی / ویرایش / قیمت کالا)
 * ============================================================ */

// ============ Action: reserve_invoice (رزرو فاکتور) ============
/** فاکتور RESERVED — بدون اثر انبار/سند تا نهایی‌سازی (POST /api/invoices/[id]/finalize) */
export async function reserveInvoiceAction(
  tenantId: string,
  userId: string | undefined,
  data: Record<string, unknown>,
  req: NextRequest
): Promise<ActionOutcome> {
  return createInvoiceAction(tenantId, userId, { ...data, status: "RESERVED" }, req);
}

// ============ Action: create_credit_invoice (فاکتور قرضی/نسیه) ============
/** فاکتور نهایی با paymentType=CREDIT + dueDate — بدهی طرف‌حساب با سررسید */
export async function createCreditInvoiceAction(
  tenantId: string,
  userId: string | undefined,
  data: Record<string, unknown>,
  req: NextRequest
): Promise<ActionOutcome> {
  if (!toStr(data.dueDate)) {
    return {
      ok: false,
      status: 400,
      error: "برای فاکتور قرضی (نسیه) تاریخ سررسید (dueDate) الزامی است — از کاربر بپرس",
    };
  }
  return createInvoiceAction(
    tenantId,
    userId,
    { ...data, paymentType: "CREDIT" },
    req
  );
}

// ============ Helpers: تاریخ شمسی/ISO + تطبیق کالا ============

/** پارس تاریخ ابزار — ISO میلادی یا شمسی ۱۴۰۴/۰۷/۱۵ (با ارقام فارسی) */
function parseFlexibleDate(v: unknown): Date | null {
  const s = toStr(v);
  if (!s) return null;
  const normalized = toEnglishDigits(s).trim();
  const jalali = normalized.replace(/\//g, "-").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (jalali) {
    const jy = Number(jalali[1]);
    const jm = Number(jalali[2]);
    const jd = Number(jalali[3]);
    if (jy >= 1300 && jy <= 1500 && jm >= 1 && jm <= 12 && jd >= 1 && jd <= 31) {
      const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
      return new Date(gy, gm - 1, gd);
    }
    const d = new Date(normalized.replace(/\//g, "-"));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(normalized.replace(/\//g, "-"));
  return isNaN(d.getTime()) ? null : d;
}

/** نرمال‌سازی نام برای تطبیق کالا (رقم فارسی + ZWNJ + case) */
function normalizeName(s: string): string {
  return toEnglishDigits(s).replace(/[\u200c\u200f\u200e\s]+/g, " ").trim().toLowerCase();
}

/** تشخیص وجود فیلد دلخواه روی مدل Product از روی DMMF — دفاعی (مثل usdPrice آینده) */
let _productFieldsCache: Set<string> | null = null;
function productModelFields(): Set<string> {
  if (_productFieldsCache) return _productFieldsCache;
  try {
    const fields = new Set<string>();
    for (const m of Prisma.dmmf.datamodel.models) {
      if (m.name === "Product") {
        for (const f of m.fields) fields.add(f.name);
      }
    }
    _productFieldsCache = fields;
    return fields;
  } catch {
    _productFieldsCache = new Set<string>();
    return _productFieldsCache;
  }
}

// ============ Action: edit_invoice (ویرایش فاکتور) ============
/**
 * ویرایش فاکتور موجود با شماره — همان منطق PUT /api/invoices/[id] (Task 21-B)
 * اما با فراخوانی مستقیم توابع داخلی (بدون HTTP):
 *  - معکوس سند (سند قرینه) + معکوس/حذف حرکت انبار → جایگزینی اقلام → سند جدید
 *  - سند تسویه paidAmount (clamp شده) دوباره ثبت می‌شود
 *  - RESERVED فقط فیلدهایش عوض می‌شود؛ CANCELLED قابل ویرایش نیست
 *
 * args: { invoiceNumber, items?[{name,quantity,unitPrice}], itemPatches?[{name,quantity?,unitPrice?}],
 *         partyName?, date?, dueDate?, paymentType?, description? }
 * مبالغ items/unitPrice به تومان.
 */
export async function editInvoiceAction(
  tenantId: string,
  userId: string | undefined,
  data: Record<string, unknown>,
  req: NextRequest
): Promise<ActionOutcome> {
  const invoiceNumber = toStr(data.invoiceNumber) || toStr(data.number);
  if (!invoiceNumber) {
    return { ok: false, status: 400, error: "شماره فاکتور (invoiceNumber) الزامی است" };
  }

  const lookup = await lookupInvoiceByNumber(tenantId, invoiceNumber);
  if (!lookup) {
    return {
      ok: false,
      status: 404,
      error: `فاکتوری با شماره ${invoiceNumber} یافت نشد`,
    };
  }

  const existing = await db.invoice.findFirst({
    where: { id: lookup.id, tenantId, deletedAt: null },
    include: { items: true },
  });
  if (!existing) {
    return { ok: false, status: 404, error: "فاکتور یافت نشد" };
  }
  if (existing.status === "CANCELLED") {
    return {
      ok: false,
      status: 400,
      error: "فاکتور ابطال‌شده قابل ویرایش نیست — فاکتور جدید ثبت کنید",
    };
  }

  // ── ساخت اقلام جدید ──
  const defaultVatRate = await getVatRateFraction();
  type RawItem = Record<string, unknown>;
  const rawItems = Array.isArray(data.items) ? (data.items as RawItem[]) : null;
  const rawPatches = Array.isArray(data.itemPatches) ? (data.itemPatches as RawItem[]) : null;

  // نرخ تبدیل: ادامهٔ ارز فعلی فاکتور (ایجنت فاکتور ریالی می‌سازد)
  const normCurrency = (existing.currency || "IRR").toUpperCase();
  const finalRate = normCurrency === "TOMAN" ? 10 : normCurrency === "IRR" ? 1 : existing.exchangeRate || 1;

  let itemsInput: RawItem[];
  if (rawItems && rawItems.length > 0) {
    // جایگزینی کامل — مبالغ تومان → ریال (computeInvoiceTotals با finalRate=1 ریال می‌گیرد)
    itemsInput = rawItems.map((it) => ({
      description: toStr(it.name ?? it.description, "آیتم"),
      quantity: Number(it.quantity ?? 1) || 1,
      unitPrice: Number(toRial(toNum(it.unitPrice ?? it.amount ?? 0))),
      taxRate: it.taxRate ?? defaultVatRate,
      discount: Number(it.discount ?? 0) || 0,
      productId: toStr(it.productId) || undefined,
    }));
  } else if (rawPatches && rawPatches.length > 0) {
    // وصلهٔ اقلام موجود (تعداد/قیمت) — تطبیق با شرح آیتم
    itemsInput = existing.items.map((it) => {
      const key = normalizeName(it.description || "");
      const patch =
        rawPatches.find((p) => {
          const pk = normalizeName(toStr(p.name ?? p.description));
          return pk && (key.includes(pk) || pk.includes(key));
        }) ?? null;
      if (!patch) {
        return {
          description: it.description,
          quantity: it.quantity,
          unitPrice: Number(it.unitPrice), // ریال — DB
          taxRate: it.taxRate,
          discount: it.discount,
          productId: it.productId ?? undefined,
        };
      }
      const newQty = patch.quantity !== undefined ? Number(patch.quantity) : it.quantity;
      const newPrice =
        patch.unitPrice !== undefined || patch.amount !== undefined
          ? Number(toRial(toNum(patch.unitPrice ?? patch.amount))) // تومان → ریال
          : Number(it.unitPrice);
      return {
        description: it.description,
        quantity: newQty > 0 ? newQty : it.quantity,
        unitPrice: newPrice,
        taxRate: it.taxRate,
        discount: it.discount,
        productId: it.productId ?? undefined,
      };
    });
  } else {
    // بدون تغییر اقلام — بازسازی ورودی از ردیف‌های فعلی (ریال)
    itemsInput = existing.items.map((it) => ({
      description: it.description,
      quantity: it.quantity,
      unitPrice: Number(it.unitPrice),
      taxRate: it.taxRate,
      discount: it.discount,
      productId: it.productId ?? undefined,
    }));
  }

  // تطبیق نام کالا → productId (برای اقلام جدید بدون productId)
  const productCandidates = await db.product.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true, sku: true },
    take: 500,
  });
  const productByName = new Map<string, { id: string; name: string }>();
  for (const p of productCandidates) {
    productByName.set(normalizeName(p.name), { id: p.id, name: p.name });
    if (p.sku) productByName.set(normalizeName(p.sku), { id: p.id, name: p.name });
  }
  itemsInput = itemsInput.map((it) => {
    if (toStr(it.productId)) return it;
    const key = normalizeName(toStr(it.description));
    const exact = productByName.get(key);
    if (exact) return { ...it, productId: exact.id };
    for (const [name, p] of productByName) {
      if (name.length >= 3 && (key.includes(name) || name.includes(key))) {
        return { ...it, productId: p.id };
      }
    }
    return it;
  });

  // محاسبات
  let totals;
  try {
    totals = computeInvoiceTotals(itemsInput, defaultVatRate, finalRate);
  } catch (err) {
    if (err instanceof InvoiceInvalidInputError) {
      return { ok: false, status: 400, error: err.message };
    }
    throw err;
  }

  // مالکیت productIdها
  let productNames: Map<string, string>;
  try {
    productNames = await loadOwnedProducts(totals.items, tenantId);
  } catch (err) {
    if (err instanceof InvoiceInvalidInputError) {
      return { ok: false, status: 400, error: err.message };
    }
    throw err;
  }

  // طرف‌حساب (فقط اگر نام جدید آمده باشد)
  let resolvedPartyId = existing.partyId;
  const newPartyName = toStr(data.partyName);
  if (newPartyName) {
    try {
      resolvedPartyId = await resolvePartyId(tenantId, undefined, newPartyName);
    } catch (err) {
      if (err instanceof InvoiceInvalidInputError) {
        return { ok: false, status: 400, error: err.message };
      }
      throw err;
    }
  }

  // تاریخ‌ها (ISO یا شمسی)
  const newDate = data.date !== undefined ? parseFlexibleDate(data.date) : null;
  if (data.date !== undefined && !newDate) {
    return { ok: false, status: 400, error: "تاریخ فاکتور نامعتبر است" };
  }
  let newDueDate: Date | null | undefined = undefined;
  if (data.dueDate !== undefined) {
    const rawStr = toStr(data.dueDate);
    newDueDate = rawStr ? parseFlexibleDate(rawStr) : null;
    if (rawStr && !newDueDate) {
      return { ok: false, status: 400, error: "تاریخ سررسید نامعتبر است" };
    }
  }

  const normPaymentType =
    (data.paymentType !== undefined
      ? toStr(data.paymentType).toUpperCase()
      : existing.paymentType ?? "CASH") === "CREDIT"
      ? "CREDIT"
      : "CASH";
  const invoiceDate = newDate ?? existing.date;
  const invoiceDueDate =
    newDueDate !== undefined ? newDueDate : existing.dueDate;
  const description =
    data.description !== undefined
      ? toStr(data.description) || null
      : existing.description;

  // وضعیت/دفاتر
  const wasFinal = isFinalInvoiceStatus(existing.status);
  const hadLedger = wasFinal ? await invoiceHasPostedLedger(tenantId, existing.id) : false;
  const autoPost = wasFinal ? await isAutoPostJournalsEnabled() : false;

  let newPaid = existing.paidAmount;
  if (newPaid > totals.total) newPaid = totals.total;
  if (newPaid < 0n) newPaid = 0n;

  let newStatus = existing.status;
  if (
    existing.status !== "RESERVED" &&
    existing.status !== "DRAFT" &&
    existing.status !== "PENDING"
  ) {
    if (totals.total > 0n && newPaid >= totals.total) newStatus = "PAID";
    else if (newPaid > 0n) newStatus = "PARTIALLY_PAID";
  }

  let reversalNumber = 0;
  if (hadLedger) {
    reversalNumber = (await nextDocumentNumber("JOURNAL", tenantId)).seq;
  }
  let newJournalNumber = 0;
  if (wasFinal && autoPost) {
    newJournalNumber = (await nextDocumentNumber("JOURNAL", tenantId)).seq;
  }
  let settlementNumber = 0;
  if (newPaid > 0n && (existing.type === "SALE" || existing.type === "PURCHASE")) {
    settlementNumber = (await nextDocumentNumber("JOURNAL", tenantId)).seq;
  }

  const stockContextItems = totals.items
    .filter((it) => it.productId)
    .map((it) => ({
      productId: it.productId as string,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
    }));

  let updated;
  try {
    updated = await db.$transaction(async (tx) => {
      if (hadLedger) {
        await reverseInvoiceLedger(tx, tenantId, userId, existing.id, "ویرایش فاکتور (هوش‌یار)", {
          reversalNumber,
        });
      }
      if (wasFinal) {
        await reverseAndClearInvoiceStock(tx, tenantId, existing.id);
      }
      await tx.invoiceItem.deleteMany({ where: { invoiceId: existing.id } });
      await tx.invoiceItem.createMany({
        data: totals.items.map((it) => ({ ...it, invoiceId: existing.id })),
      });
      const saved = await tx.invoice.update({
        where: { id: existing.id },
        data: {
          partyId: resolvedPartyId,
          date: invoiceDate,
          dueDate: invoiceDueDate,
          description,
          paymentType: normPaymentType,
          subtotal: totals.subtotal,
          tax: totals.tax,
          total: totals.total,
          paidAmount: newPaid,
          status: newStatus,
        },
        include: { items: true, party: true },
      });
      if (wasFinal && stockContextItems.length > 0) {
        await moveStockForInvoice(
          tx,
          tenantId,
          {
            invoiceId: existing.id,
            type: existing.type,
            date: invoiceDate,
            warehouseId: saved.warehouseId,
          },
          stockContextItems,
          productNames
        );
      }
      if (wasFinal && autoPost && newJournalNumber > 0) {
        await postInvoiceJournalForce(tx, tenantId, userId, {
          invoiceId: existing.id,
          number: saved.number,
          type: existing.type,
          date: invoiceDate,
          description: saved.description,
          subtotal: saved.subtotal,
          tax: saved.tax,
          discount: saved.discount,
          total: saved.total,
        }, { journalNumber: newJournalNumber });
      }
      if (settlementNumber > 0) {
        await postInvoiceSettlementToLedger(
          tx,
          tenantId,
          userId,
          {
            invoiceId: existing.id,
            number: saved.number,
            type: existing.type,
            date: invoiceDate,
            description: saved.description,
          },
          newPaid,
          { journalNumber: settlementNumber }
        );
      }
      return saved;
    });
  } catch (err) {
    if (err instanceof NegativeStockError) {
      return { ok: false, status: 400, error: `موجودی منفی مجاز نیست — ${err.productName}` };
    }
    throw err;
  }

  await writeInvoiceAudit(tenantId, userId, "UPDATE", existing.id, {
    number: { old: existing.number, new: updated.number },
    paymentType: { old: existing.paymentType ?? "CASH", new: normPaymentType },
    dueDate: {
      old: existing.dueDate ? existing.dueDate.toISOString() : null,
      new: invoiceDueDate ? invoiceDueDate.toISOString() : null,
    },
    subtotal: { old: existing.subtotal, new: updated.subtotal },
    tax: { old: existing.tax, new: updated.tax },
    total: { old: existing.total, new: updated.total },
    status: { old: existing.status, new: updated.status },
    itemsCount: { old: existing.items.length, new: updated.items.length },
  });

  await auditLog({
    tenantId,
    userId,
    action: "AI_EXECUTE_EDIT_INVOICE",
    entity: "invoice",
    entityId: existing.id,
    changes: {
      number: existing.number,
      oldTotalToman: Number(existing.total) / 10,
      newTotalToman: Number(updated.total) / 10,
      itemsChanged: Boolean(rawItems),
      patches: rawPatches ? rawPatches.length : 0,
      partyChanged: resolvedPartyId !== existing.partyId,
      status: updated.status,
    },
    req,
  });

  return {
    ok: true,
    data: {
      invoiceId: existing.id,
      number: updated.number,
      status: updated.status,
      paymentType: normPaymentType,
      oldTotalToman: Number(existing.total) / 10,
      subtotalToman: Number(updated.subtotal) / 10,
      taxToman: Number(updated.tax) / 10,
      newTotalToman: Number(updated.total) / 10,
      itemCount: updated.items.length,
      ledgerReversed: hadLedger,
      url: `/?module=invoices&invoice=${existing.id}`,
    },
  };
}

// ============ Action: update_product_price ============
/**
 * به‌روزرسانی قیمت فروش/خرید کالا (تومان) — با تطبیق نام/SKU.
 * اگر روزی فیلد usdPrice به مدل Product اضافه شود (ایجنت 21-M2)، به‌صورت
 * دفاعی از DMMF تشخیص داده و هم‌زمان به‌روزرسانی می‌شود.
 */
export async function updateProductPriceAction(
  tenantId: string,
  userId: string | undefined,
  data: Record<string, unknown>,
  req: NextRequest
): Promise<ActionOutcome> {
  const search = toStr(data.name ?? data.product ?? data.sku ?? data.search);
  const salePriceToman = data.salePrice !== undefined ? toNum(data.salePrice) : null;
  const purchasePriceToman = data.purchasePrice !== undefined ? toNum(data.purchasePrice) : null;
  const usdPriceToman = data.usdPrice !== undefined ? toNum(data.usdPrice) : null;

  if (!search) {
    return { ok: false, status: 400, error: "نام یا کد کالا الزامی است" };
  }
  if (salePriceToman === null && purchasePriceToman === null && usdPriceToman === null) {
    return {
      ok: false,
      status: 400,
      error: "حداقل یکی از قیمت‌ها (salePrice یا purchasePrice به تومان) الزامی است",
    };
  }
  if (
    (salePriceToman !== null && salePriceToman < 0) ||
    (purchasePriceToman !== null && purchasePriceToman < 0)
  ) {
    return { ok: false, status: 400, error: "قیمت نمی‌تواند منفی باشد" };
  }

  const candidates = await db.product.findMany({
    where: {
      tenantId,
      deletedAt: null,
      OR: [{ name: { contains: search } }, { sku: { contains: search } }],
    },
    select: { id: true, name: true, sku: true, salePrice: true, purchasePrice: true, unit: true },
    take: 5,
  });
  if (candidates.length === 0) {
    return { ok: false, status: 404, error: `کالایی با نام/کد «${search}» یافت نشد` };
  }
  // بهترین تطبیق: exact نام > exact sku > اولین
  const normSearch = normalizeName(search);
  const product =
    candidates.find((c) => normalizeName(c.name) === normSearch) ??
    candidates.find((c) => normalizeName(c.sku) === normSearch) ??
    candidates[0];

  const updateData: Record<string, unknown> = {};
  if (salePriceToman !== null) updateData.salePrice = toRial(salePriceToman);
  if (purchasePriceToman !== null) updateData.purchasePrice = toRial(purchasePriceToman);
  // دفاعی: فقط اگر فیلد usdPrice واقعاً در schema مدل Product باشد
  const hasUsd = productModelFields().has("usdPrice");
  if (usdPriceToman !== null && hasUsd) updateData.usdPrice = toRial(usdPriceToman);

  const updated = await db.product.update({
    where: { id: product.id },
    data: updateData,
    select: { id: true, name: true, sku: true, salePrice: true, purchasePrice: true },
  });

  await auditLog({
    tenantId,
    userId,
    action: "AI_EXECUTE_UPDATE_PRODUCT_PRICE",
    entity: "product",
    entityId: product.id,
    changes: {
      name: product.name,
      sku: product.sku,
      oldSalePriceToman: Number(product.salePrice) / 10,
      newSalePriceToman: Number(updated.salePrice) / 10,
      oldPurchasePriceToman: Number(product.purchasePrice) / 10,
      newPurchasePriceToman: Number(updated.purchasePrice) / 10,
      usdPrice: hasUsd ? (usdPriceToman ?? null) : "field-not-in-schema",
    },
    req,
  });

  return {
    ok: true,
    data: {
      productId: updated.id,
      name: updated.name,
      sku: updated.sku,
      salePriceToman: Number(updated.salePrice) / 10,
      purchasePriceToman: Number(updated.purchasePrice) / 10,
      usdPriceUpdated: hasUsd && usdPriceToman !== null,
      url: `/?module=inventory&product=${updated.id}`,
    },
  };
}
