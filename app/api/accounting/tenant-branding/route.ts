import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { getAuthContext } from "@/lib/auth";
import { rateLimitCheck, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 4 * 1024 * 1024; // ۴ مگابایت
const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "webp", "svg", "gif"]);

function cleanStr(v: unknown, maxLen: number): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

/**
 * GET /api/accounting/tenant-branding
 * برندینگ فاکتور کسب‌وکار: لوگو، شعار، وب‌سایت، تلفن، آدرس
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext(req);
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "احراز هویت الزامی است" },
        { status: 401 }
      );
    }
    const tenant = await db.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: {
        name: true,
        logoUrl: true,
        invoiceSlogan: true,
        invoiceWebsite: true,
        invoicePhone: true,
        invoiceAddress: true,
      },
    });
    if (!tenant) {
      return NextResponse.json(
        { success: false, error: "سازمان یافت نشد" },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: tenant });
  } catch (error) {
    console.error("Get tenant branding error:", error);
    return NextResponse.json(
      { success: false, error: "خطا در دریافت اطلاعات فاکتور" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/accounting/tenant-branding
 * به‌روزرسانی برندینگ فاکتور (متن‌ها) — بدنه JSON
 */
export async function PUT(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = rateLimitCheck(`tenant-branding:${ip}`, 20, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: "درخواست بیش از حد" },
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

    const body = await req.json();
    const data = {
      invoiceSlogan: cleanStr(body.invoiceSlogan, 160),
      invoiceWebsite: cleanStr(body.invoiceWebsite, 120),
      invoicePhone: cleanStr(body.invoicePhone, 40),
      invoiceAddress: cleanStr(body.invoiceAddress, 240),
    };

    const tenant = await db.tenant.update({
      where: { id: ctx.tenantId },
      data,
      select: {
        name: true,
        logoUrl: true,
        invoiceSlogan: true,
        invoiceWebsite: true,
        invoicePhone: true,
        invoiceAddress: true,
      },
    });

    return NextResponse.json({ success: true, data: tenant });
  } catch (error) {
    console.error("Update tenant branding error:", error);
    return NextResponse.json(
      { success: false, error: "خطا در ذخیره اطلاعات فاکتور" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/accounting/tenant-branding — آپلود لوگوی فاکتور (multipart/form-data)
 * فیلد: logo (png/jpg/webp/svg/gif — حداکثر ۴MB)
 */
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = rateLimitCheck(`tenant-branding-logo:${ip}`, 10, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: "درخواست بیش از حد" },
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

    const formData = await req.formData();
    const file = formData.get("logo") as File | null;
    if (!file) {
      return NextResponse.json(
        { success: false, error: "فایل الزامی است" },
        { status: 400 }
      );
    }

    const ext = (file.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json(
        { success: false, error: "فقط تصویر (PNG، JPG، WebP، SVG، GIF) مجاز است" },
        { status: 400 }
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: "حجم فایل نباید بیش از ۴ مگابایت باشد" },
        { status: 400 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        { success: false, error: "فایل خالی است" },
        { status: 400 }
      );
    }

    const fileName = `tenant-logo-${ctx.tenantId}-${Date.now()}.${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadDir, fileName), buffer);

    const logoUrl = `/uploads/${fileName}`;
    const tenant = await db.tenant.update({
      where: { id: ctx.tenantId },
      data: { logoUrl },
      select: {
        name: true,
        logoUrl: true,
        invoiceSlogan: true,
        invoiceWebsite: true,
        invoicePhone: true,
        invoiceAddress: true,
      },
    });

    return NextResponse.json({ success: true, data: tenant });
  } catch (error) {
    console.error("Upload tenant logo error:", error);
    return NextResponse.json(
      { success: false, error: "خطا در آپلود لوگو" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/accounting/tenant-branding — حذف لوگو
 */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getAuthContext(req);
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "احراز هویت الزامی است" },
        { status: 401 }
      );
    }
    const tenant = await db.tenant.update({
      where: { id: ctx.tenantId },
      data: { logoUrl: null },
      select: { name: true, logoUrl: true, invoiceSlogan: true, invoiceWebsite: true, invoicePhone: true, invoiceAddress: true },
    });
    return NextResponse.json({ success: true, data: tenant });
  } catch (error) {
    console.error("Delete tenant logo error:", error);
    return NextResponse.json(
      { success: false, error: "خطا در حذف لوگو" },
      { status: 500 }
    );
  }
}
