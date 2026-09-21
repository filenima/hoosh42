// ============ چاپ فاکتور — هوش (v11 بازطراحی کامل) ============
// GET /api/invoices/[id]/print?mode=thermal|a4&autoprint=1
//
// v11 — بازطراحی حرفه‌ای کامل (درخواست صریح کاربر):
//   ✅ رسید حرارتی ۸۰mm جدید: هدر برند‌شده با نوار رنگی، بج وضعیت،
//      جدول اقلام خوانا، جمع کل در باکس تیره پررنگ + QR کنارش،
//      مبلغ به حروف فارسی، بارکد-استایل شماره فیش، فوتر سپاس
//   ✅ فاکتور A4 جدید: سربرگ حرفه‌ای با بند رنگ زمردی، کارت‌های اطلاعات
//      صادرکننده/طرف‌حساب، نوار متا (شماره/تاریخ/سررسید/ارز)، جدول مدرن،
//      پنل جمع‌بندی با مبلغ به حروف، نوار وضعیت پرداخت، امضاها، فوتر برند
//   ✅ QR واقعی (کتابخانه qrcode) — رمز‌گذاری خلاصه فاکتور برای راستی‌آزمایی
//   ✅ لوگو: فایل‌های /uploads به data-URL تبدیل می‌شوند (صفحه blob نمی‌تواند
//      مسیر نسبی را لود کند — قبلاً لوگو در چاپ blob نمایش داده نمی‌شد)
//   ✅ مبلغ به حروف فارسی (num2fa — هماهنگ با صفحه عمومی)
//   ✅ بج وضعیت پرداخت (پرداخت‌شده/جزئی/در انتظار/لغو)
//   ✅ چندارزی: نمایش دو-واحدی برای فاکتورهای ارزی
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import QRCode from "qrcode";
import { getAuthContext } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============ ثابت‌ها ============
const CURRENCY_LABEL: Record<string, string> = {
  IRR: "ریال",
  TOMAN: "تومان",
  USD: "دلار آمریکا",
  EUR: "یورو",
  AED: "درهم",
  GBP: "پوند",
  TRY: "لیر",
  CNY: "یوان",
  SAR: "ریال سعودی",
};
const CURRENCY_SYMBOL: Record<string, string> = {
  IRR: "ریال",
  TOMAN: "تومان",
  USD: "$",
  EUR: "€",
  AED: "AED",
  GBP: "£",
  TRY: "₺",
  CNY: "¥",
  SAR: "SAR",
};

// رنگ برند چاپ — زمردی حرفه‌ای (بدون آبی/نیلی)
const ACCENT = "#047857"; // emerald-700
const ACCENT_DARK = "#065f46"; // emerald-800
const ACCENT_LIGHT = "#ecfdf5"; // emerald-50
const ACCENT_BORDER = "#a7f3d0"; // emerald-200

// ============ Helpers ============
function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** عدد با ارقام فارسی و جداکننده هزارگان */
function formatNumberFa(n: number): string {
  return new Intl.NumberFormat("fa-IR").format(Math.round(n || 0));
}

/** عدد به حروف فارسی — «مبلغ به حروف» (هماهنگ با صفحه عمومی embed) */
function num2fa(n: number): string {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return "صفر";
  const yekan = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه"];
  const dahgan = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
  const dahyek = ["ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده"];
  const sadgan = ["", "یکصد", "دوصد", "سهصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"];
  const scale = ["", "هزار", "میلیون", "میلیارد", "تریلیون"];
  const parts: string[] = [];
  let i = 0;
  while (n > 0 && i < scale.length) {
    const seg = n % 1000;
    if (seg !== 0) {
      const w: string[] = [];
      const s = Math.floor(seg / 100);
      const r = seg % 100;
      if (s) w.push(sadgan[s]);
      if (r >= 10 && r <= 19) {
        w.push(dahyek[r - 10]);
      } else {
        const d10 = Math.floor(r / 10);
        const d1 = r % 10;
        if (d10) w.push(dahgan[d10]);
        if (d1) w.push(yekan[d1]);
      }
      const segWords = w.join(" و ");
      parts.unshift(segWords + (scale[i] ? " " + scale[i] : ""));
    }
    n = Math.floor(n / 1000);
    i++;
  }
  return parts.join(" و ");
}

/** وضعیت فاکتور → {متن، رنگ، پس‌زمینه} */
function statusInfo(status: string, paidRial: number, totalRial: number): { t: string; c: string; bg: string } {
  const remaining = totalRial - paidRial;
  if (status === "CANCELLED") return { t: "لغو‌شده", c: "#6b7280", bg: "#f3f4f6" };
  if (status === "PAID" || (totalRial > 0 && remaining <= 0)) return { t: "پرداخت‌شده ✓", c: "#047857", bg: "#ecfdf5" };
  if (status === "PARTIALLY_PAID" || (paidRial > 0 && remaining > 0)) return { t: "پرداخت جزئی", c: "#b45309", bg: "#fffbeb" };
  if (status === "OVERDUE") return { t: "سررسید گذشته", c: "#b91c1c", bg: "#fef2f2" };
  if (status === "DRAFT") return { t: "پیش‌نویس", c: "#475569", bg: "#f1f5f9" };
  return { t: "در انتظار پرداخت", c: "#b45309", bg: "#fffbeb" };
}

/**
 * لوگوی tenant → data-URL
 * logoUrl ممکن است data-URL باشد (بی‌درنگ برمی‌گردد) یا مسیر /uploads/...
 * (فایل از public خوانده و base64 می‌شود — صفحه blob نمی‌تواند مسیر نسبی لود کند)
 */
async function resolveLogoDataUrl(logoUrl: string | null): Promise<string | null> {
  if (!logoUrl) return null;
  if (logoUrl.startsWith("data:")) return logoUrl;
  if (logoUrl.startsWith("http://") || logoUrl.startsWith("https://")) return logoUrl;
  try {
    const rel = logoUrl.replace(/^\//, "");
    const filePath = path.join(process.cwd(), "public", rel);
    const buf = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase().replace(".", "");
    const mime =
      ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : ext === "webp" ? "image/webp" : "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** تولید QR — خلاصه فاکتور برای راستی‌آزمایی مشتری با اسکن */
async function generateInvoiceQr(text: string, width = 132): Promise<string | null> {
  try {
    return await QRCode.toDataURL(text, {
      margin: 0,
      width,
      errorCorrectionLevel: "M",
      color: { dark: "#111827", light: "#ffffff" },
    });
  } catch {
    return null;
  }
}

/** بارکد-استایل CSS از شماره فاکتور (نمایشی) */
function barcodeCss(number: string): string {
  // از کاراکترهای شماره، عرض میله‌های سیاه/سفید می‌سازیم (نمایشی — قابل اسکن نیست)
  const clean = number.replace(/[^0-9A-Za-z]/g, "") || "000000";
  let bars = "";
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    const w = 1 + (c % 3); // 1..3px
    const gap = 1 + ((c >> 2) % 2); // 1..2px
    bars += `<span style="display:inline-block;width:${w}px;height:100%;background:#111827;"></span><span style="display:inline-block;width:${gap}px;height:100%;"></span>`;
  }
  return `<div style="height:30px;direction:ltr;text-align:center;white-space:nowrap;overflow:hidden;">${bars}</div>`;
}

// ============ Endpoint ============
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: "احراز هویت الزامی است" },
        { status: 401 }
      );
    }

    const { id } = await ctx.params;
    const invoice = await db.invoice.findFirst({
      where: { id, tenantId: auth.tenantId, deletedAt: null },
      include: {
        items: { include: { product: true } },
        party: true,
        tenant: true,
      },
    });

    if (!invoice) {
      return NextResponse.json(
        { success: false, error: "فاکتور یافت نشد" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") === "thermal" ? "thermal" : "a4";
    const autoprint = searchParams.get("autoprint") === "1";

    // ============ داده‌های مشترک ============
    const currency = invoice.currency || "IRR";
    const rate = invoice.exchangeRate ?? 1;
    const isForeign = currency !== "IRR";

    const totalRial = Number(invoice.total);
    const subtotalRial = Number(invoice.subtotal);
    const taxRial = Number(invoice.tax);
    const discountRial = Number(invoice.discount);
    const paidRial = Number(invoice.paidAmount);
    const remainingRial = Math.max(0, totalRial - paidRial);
    const totalForeign = isForeign && rate > 0 ? totalRial / rate : totalRial;

    const tenant = invoice.tenant;
    const tenantName = tenant?.name ?? "شرکت";
    const party = invoice.party;
    const partyName = party?.name ?? "—";
    const partyCode = party?.code ?? "";
    const partyEconomicCode = party?.economicCode ?? "";
    const logoUrl = await resolveLogoDataUrl(tenant?.logoUrl ?? null);
    const slogan = tenant?.invoiceSlogan ?? null;
    const website = tenant?.invoiceWebsite ?? null;
    const phone = tenant?.invoicePhone ?? null;
    const address = tenant?.invoiceAddress ?? null;

    const currencyLabel = CURRENCY_LABEL[currency] ?? currency;
    const currencySymbol = CURRENCY_SYMBOL[currency] ?? currency;

    const dateFa = new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(invoice.date);
    const dateShort = new Intl.DateTimeFormat("fa-IR", {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
    }).format(invoice.date);
    const timeFa = new Intl.DateTimeFormat("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(invoice.createdAt || invoice.date);
    const dueDateFa = invoice.dueDate
      ? new Intl.DateTimeFormat("fa-IR", { year: "numeric", month: "long", day: "numeric" }).format(invoice.dueDate)
      : null;

    const typeLabel =
      invoice.type === "SALE"
        ? "فاکتور فروش"
        : invoice.type === "PURCHASE"
          ? "فاکتور خرید"
          : invoice.type === "PRE_INVOICE"
            ? "پیش‌فاکتور"
            : invoice.type === "RETURN"
              ? "فاکتور برگشت از فروش"
              : "فاکتور";

    const st = statusInfo(invoice.status, paidRial, totalRial);
    const monogram = escapeHtml(tenantName.trim().slice(0, 2));

    // QR — خلاصه فاکتور برای راستی‌آزمایی
    const qrText = [
      `نرم‌افزار حسابداری هوش`,
      `${typeLabel}: ${invoice.number}`,
      `صادرکننده: ${tenantName}`,
      `طرف‌حساب: ${partyName}`,
      `مبلغ: ${new Intl.NumberFormat("fa-IR").format(totalRial)} ریال`,
      `تاریخ: ${dateShort}`,
      website ? `وب‌سایت: ${website}` : "hoosh.nobatime.ir",
    ].join("\n");
    const qrDataUrl = await generateInvoiceQr(qrText, mode === "thermal" ? 110 : 132);

    const amountWords = `${num2fa(totalRial)} ${isForeign ? "ریال" : "ریال"}`;

    // ==================================================================
    //                      حالت حرارتی (۸۰mm)
    // ==================================================================
    if (mode === "thermal") {
      const rows = invoice.items
        .map((it, idx) => {
          const unitPriceRial = Number(it.unitPrice);
          const lineTotalRial = Number(it.total);
          const q = new Intl.NumberFormat("fa-IR").format(it.quantity);
          const t = formatNumberFa(lineTotalRial);
          const desc = escapeHtml((it.description || it.product?.name || "—").slice(0, 42));
          return `<tr class="item-row">
<td class="item-idx">${new Intl.NumberFormat("fa-IR").format(idx + 1)}</td>
<td class="item-name">${desc}<div class="item-sub">${q} × ${formatNumberFa(unitPriceRial)} ریال</div></td>
<td class="num item-total">${t}</td>
</tr>`;
        })
        .join("");

      const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(typeLabel)} ${escapeHtml(invoice.number)}</title>
<style>
 * { box-sizing: border-box; margin: 0; padding: 0; }
 body {
 font-family: 'Vazirmatn', 'Tahoma', sans-serif;
 background: #eef2f0;
 color: #111827;
 font-size: 11px;
 direction: rtl;
 padding: 14px 8px;
 }
 .receipt {
 width: 80mm;
 margin: 0 auto;
 background: white;
 padding: 0 0 12px;
 border-radius: 8px;
 overflow: hidden;
 box-shadow: 0 2px 10px rgba(0,0,0,.10);
 }
 /* نوار برند بالای فیش */
 .brand-bar {
 background: repeating-linear-gradient(45deg, ${ACCENT}, ${ACCENT} 6px, ${ACCENT_DARK} 6px, ${ACCENT_DARK} 12px);
 height: 7px;
 }
 .shop { text-align: center; padding: 12px 10px 10px; }
 .shop-logo { max-width: 40mm; max-height: 20mm; object-fit: contain; margin: 0 auto 6px; display: block; }
 .shop-mono {
 width: 15mm; height: 15mm; margin: 0 auto 6px;
 background: ${ACCENT_LIGHT}; color: ${ACCENT_DARK};
 border: 1.5px solid ${ACCENT_BORDER};
 border-radius: 50%;
 display: flex; align-items: center; justify-content: center;
 font-size: 13px; font-weight: 800;
 }
 .shop-name { font-size: 15px; font-weight: 800; letter-spacing: -0.2px; }
 .shop-sub { font-size: 9px; color: #4b5563; margin-top: 2px; line-height: 1.6; }
 /* بج نوع سند */
 .doc-title {
 text-align: center; margin: 2px 10px 8px;
 background: ${ACCENT_LIGHT}; border: 1px solid ${ACCENT_BORDER}; color: ${ACCENT_DARK};
 font-size: 11px; font-weight: 700; border-radius: 5px; padding: 4px;
 display: flex; align-items: center; justify-content: center; gap: 6px;
 }
 .status-badge { font-size: 9px; font-weight: 700; color: ${st.c}; background: ${st.bg}; border: 1px solid ${st.c}33; border-radius: 99px; padding: 1px 7px; }
 /* ردیف‌های متا */
 .meta { padding: 0 10px; margin-bottom: 6px; }
 .meta-row { display: flex; justify-content: space-between; font-size: 9.5px; padding: 2.5px 0; color: #374151; }
 .meta-row b { color: #111827; font-weight: 600; }
 .sep { border: none; border-top: 1px dashed #9ca3af; margin: 6px 10px; }
 .num { font-feature-settings: 'tnum'; direction: ltr; }
 /* جدول اقلام */
 table { width: calc(100% - 20px); margin: 0 10px 4px; border-collapse: collapse; }
 thead th {
 font-size: 8.5px; color: #6b7280; text-align: right; padding: 3px 2px;
 border-bottom: 1.5px solid ${ACCENT}; font-weight: 700;
 }
 tbody td { font-size: 10px; padding: 4px 2px; vertical-align: top; border-bottom: 1px dotted #e5e7eb; }
 .item-row:last-child td { border-bottom: none; }
 .item-idx { width: 7mm; color: #9ca3af; font-size: 8.5px; }
 .item-name { font-weight: 600; max-width: 42mm; word-wrap: break-word; }
 .item-sub { font-size: 8px; color: #9ca3af; font-weight: 400; margin-top: 1px; }
 .item-total { font-weight: 700; white-space: nowrap; }
 /* جمع‌بندی */
 .totals { padding: 2px 10px 0; }
 .totals .row { display: flex; justify-content: space-between; font-size: 10px; padding: 2.5px 0; color: #374151; }
 .grand-box {
 margin: 8px 10px;
 background: #111827; color: white;
 border-radius: 7px; padding: 8px 10px;
 display: flex; justify-content: space-between; align-items: center; gap: 8px;
 }
 .grand-box .lbl { font-size: 10.5px; font-weight: 600; opacity: .92; }
 .grand-box .val { font-size: 15px; font-weight: 800; direction: ltr; font-feature-settings: 'tnum'; white-space: nowrap; }
 .grand-box .cur { font-size: 8.5px; opacity: .75; font-weight: 500; margin-left: 2px; }
 .grand-qr { width: 17mm; height: 17mm; border-radius: 4px; background: white; padding: 1.5px; flex-shrink: 0; }
 /* مبلغ به حروف */
 .words { margin: 0 10px; font-size: 8.5px; color: #4b5563; line-height: 1.7; background: #f9fafb; border-radius: 5px; padding: 5px 7px; border: 1px solid #f3f4f6; }
 .words b { color: #111827; }
 /* بارکد نمایشی */
 .barcode-wrap { text-align: center; margin: 8px 10px 0; }
 .barcode-num { font-size: 9px; letter-spacing: 2px; color: #374151; direction: ltr; margin-top: 2px; font-family: 'Courier New', monospace; }
 /* فوتر */
 .thanks {
 text-align: center; margin: 10px 10px 0; padding-top: 8px;
 border-top: 1px dashed #9ca3af; font-size: 9px; color: #4b5563; line-height: 1.8;
 }
 .thanks .slogan { font-weight: 800; color: #111827; font-size: 10px; }
 .thanks .site { direction: ltr; unicode-bidi: embed; font-weight: 700; color: ${ACCENT_DARK}; }
 .print-btn {
 position: fixed; top: 12px; left: 12px;
 background: ${ACCENT}; color: white; border: none;
 padding: 10px 18px; border-radius: 6px; cursor: pointer;
 font-size: 13px; font-family: inherit; z-index: 100;
 box-shadow: 0 2px 8px rgba(0,0,0,.18);
 }
 @media print {
 body { background: white; padding: 0; }
 .receipt { width: 100%; border-radius: 0; box-shadow: none; }
 .no-print { display: none!important; }
 @page { size: 80mm auto; margin: 2mm; }
 }
</style>
</head>
<body>
 <button class="print-btn no-print" onclick="window.print()">چاپ رسید</button>
 <div class="receipt">
 <div class="brand-bar"></div>
 <div class="shop">
 ${logoUrl ? `<img class="shop-logo" src="${escapeHtml(logoUrl)}" alt="لوگو" />` : `<div class="shop-mono">${monogram}</div>`}
 <div class="shop-name">${escapeHtml(tenantName)}</div>
 ${address ? `<div class="shop-sub">${escapeHtml(address)}</div>` : ""}
 ${phone ? `<div class="shop-sub">تلفن: <span class="num">${escapeHtml(phone)}</span></div>` : ""}
 </div>
 <div class="doc-title">
 <span>${escapeHtml(typeLabel)}</span>
 <span class="status-badge">${escapeHtml(st.t)}</span>
 </div>
 <div class="meta">
 <div class="meta-row"><span>شماره سند:</span><b class="num">${escapeHtml(invoice.number)}</b></div>
 <div class="meta-row"><span>تاریخ:</span><b>${dateFa} — ساعت <span class="num">${timeFa}</span></b></div>
 <div class="meta-row"><span>مشتری:</span><b>${escapeHtml(partyName)}</b></div>
 ${partyCode ? `<div class="meta-row"><span>کد طرف‌حساب:</span><b class="num">${escapeHtml(partyCode)}</b></div>` : ""}
 ${dueDateFa ? `<div class="meta-row"><span>سررسید:</span><b>${dueDateFa}</b></div>` : ""}
 </div>
 <hr class="sep" />
 <table>
 <thead>
 <tr><th>#</th><th style="text-align:right;">شرح کالا / خدمات</th><th style="text-align:left;">جمع (ریال)</th></tr>
 </thead>
 <tbody>
 ${rows || `<tr><td colspan="3" style="text-align:center;padding:12px;color:#9ca3af;">بدون قلم</td></tr>`}
 </tbody>
 </table>
 <div class="totals">
 <div class="row"><span>جمع اقلام:</span><span class="num">${formatNumberFa(subtotalRial)} ریال</span></div>
 ${discountRial > 0 ? `<div class="row"><span>تخفیف:</span><span class="num">−${formatNumberFa(discountRial)} ریال</span></div>` : ""}
 ${taxRial > 0 ? `<div class="row"><span>مالیات بر ارزش افزوده:</span><span class="num">${formatNumberFa(taxRial)} ریال</span></div>` : ""}
 ${isForeign ? `<div class="row"><span>مبلغ (${escapeHtml(currencyLabel)}):</span><span class="num">${formatNumberFa(totalForeign)} ${escapeHtml(currencySymbol)}</span></div>` : ""}
 ${paidRial > 0 && remainingRial > 0 ? `<div class="row"><span>پرداخت‌شده:</span><span class="num">${formatNumberFa(paidRial)} ریال</span></div>` : ""}
 </div>
 <div class="grand-box">
 <div>
 <div class="lbl">مبلغ قابل پرداخت</div>
 <div class="val">${formatNumberFa(remainingRial > 0 ? remainingRial : totalRial)}<span class="cur">ریال</span></div>
 </div>
 ${qrDataUrl ? `<img class="grand-qr" src="${qrDataUrl}" alt="QR راستی‌آزمایی" />` : ""}
 </div>
 <div class="words">مبلغ به حروف: <b>${escapeHtml(amountWords)}</b></div>
 <div class="barcode-wrap">
 ${barcodeCss(invoice.number)}
 <div class="barcode-num">${escapeHtml(invoice.number)}</div>
 </div>
 <div class="thanks">
 ${slogan ? `<div class="slogan">${escapeHtml(slogan)}</div>` : ""}
 <div>از اعتماد و خرید شما سپاسگزاریم</div>
 ${website ? `<div class="site">${escapeHtml(website)}</div>` : ""}
 <div style="font-size:8px;color:#9ca3af;margin-top:3px;">صادرشده توسط نرم‌افزار حسابداری هوش</div>
 </div>
 </div>
 ${autoprint ? `<script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 350); });</script>` : ""}
</body>
</html>`;

      return new NextResponse(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    // ==================================================================
    //                      حالت A4 (پیش‌فرض)
    // ==================================================================
    const itemsRows = invoice.items
      .map((it, idx) => {
        const unitPriceRial = Number(it.unitPrice);
        const lineTotalRial = Number(it.total);
        const unitPriceForeign = isForeign && rate > 0 ? unitPriceRial / rate : unitPriceRial;
        const lineTotalForeign = isForeign && rate > 0 ? lineTotalRial / rate : lineTotalRial;
        return `
 <tr>
 <td class="center idx-cell"><span class="idx-chip">${new Intl.NumberFormat("fa-IR").format(idx + 1)}</span></td>
 <td class="desc-cell">${escapeHtml(it.description || it.product?.name || "—")}</td>
 <td class="center tnum">${new Intl.NumberFormat("fa-IR").format(it.quantity)}</td>
 <td class="tnum">${formatNumberFa(unitPriceForeign)} ${isForeign ? currencySymbol : ""}</td>
 ${isForeign ? `<td class="tnum">${formatNumberFa(unitPriceRial)} ریال</td>` : ""}
 <td class="center tnum">${new Intl.NumberFormat("fa-IR").format(it.discount || 0)}٪</td>
 <td class="tnum total-cell">${formatNumberFa(lineTotalForeign)} ${isForeign ? currencySymbol : ""}</td>
 ${isForeign ? `<td class="tnum">${formatNumberFa(lineTotalRial)} ریال</td>` : ""}
 </tr>`;
      })
      .join("");

    const summaryBlock = isForeign
      ? `
 <div class="summary-row"><span>جمع کل (${escapeHtml(currencyLabel)}):</span><span class="tnum">${formatNumberFa(totalForeign)} ${currencySymbol}</span></div>
 <div class="summary-row"><span>معادل ریالی:</span><span class="tnum">${formatNumberFa(totalRial)} ریال</span></div>
 <div class="summary-row"><span>نرخ تبدیل:</span><span class="tnum">${new Intl.NumberFormat("fa-IR").format(rate)} ریال</span></div>`
      : `
 <div class="summary-row"><span>جمع اقلام:</span><span class="tnum">${formatNumberFa(subtotalRial)} ریال</span></div>
 ${discountRial > 0 ? `<div class="summary-row"><span>تخفیف:</span><span class="tnum">−${formatNumberFa(discountRial)} ریال</span></div>` : ""}
 ${taxRial > 0 ? `<div class="summary-row"><span>مالیات بر ارزش افزوده:</span><span class="tnum">${formatNumberFa(taxRial)} ریال</span></div>` : ""}
 <div class="summary-row grand"><span>جمع کل:</span><span class="tnum">${formatNumberFa(totalRial)} ریال</span></div>`;

    const paymentStrip = `
 <div class="pay-strip">
 <div class="pay-chip ${remainingRial <= 0 ? "ok" : paidRial > 0 ? "part" : "wait"}">
 <span class="pay-dot"></span>
 ${remainingRial <= 0
        ? "این فاکتور به‌طور کامل تسویه شده است"
        : paidRial > 0
          ? `پرداخت‌شده: ${formatNumberFa(paidRial)} ریال — مانده: ${formatNumberFa(remainingRial)} ریال`
          : `مانده قابل پرداخت: ${formatNumberFa(remainingRial)} ریال`}
 </div>
 ${dueDateFa ? `<div class="pay-due">سررسید: ${dueDateFa}</div>` : ""}
 </div>`;

    const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(typeLabel)} ${escapeHtml(invoice.number)}</title>
<style>
 * { box-sizing: border-box; }
 body {
 font-family: 'Vazirmatn', 'Tahoma', 'Segoe UI', sans-serif;
 background: #eef2f0;
 margin: 0;
 padding: 24px 12px;
 color: #1f2937;
 font-size: 13px;
 }
 .page {
 background: white;
 max-width: 820px;
 margin: 0 auto;
 box-shadow: 0 6px 24px rgba(0,0,0,.09);
 border-radius: 10px;
 overflow: hidden;
 }
 /* ── سربرگ ── */
 .header {
 display: flex;
 justify-content: space-between;
 align-items: stretch;
 background: linear-gradient(135deg, ${ACCENT_DARK} 0%, ${ACCENT} 100%);
 color: white;
 padding: 26px 32px 22px;
 }
 .logo-area { display: flex; align-items: center; gap: 14px; min-width: 0; }
 .logo-img { width: 58px; height: 58px; object-fit: contain; border-radius: 12px; background: rgba(255,255,255,.92); padding: 4px; }
 .logo-circle {
 width: 56px; height: 56px; flex-shrink: 0;
 background: rgba(255,255,255,.16);
 border: 1.5px solid rgba(255,255,255,.45);
 color: white; border-radius: 14px;
 display: flex; align-items: center; justify-content: center;
 font-weight: 800; font-size: 19px;
 }
 .company-name { font-size: 19px; font-weight: 800; letter-spacing: -0.2px; }
 .company-sub { font-size: 10.5px; opacity: .88; margin-top: 4px; max-width: 340px; line-height: 1.7; }
 .company-sub .sep-dot { margin: 0 4px; opacity: .6; }
 .doc-box { text-align: left; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 6px; flex-shrink: 0; }
 .invoice-title { font-size: 21px; font-weight: 800; }
 .invoice-number {
 font-size: 11.5px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.3);
 padding: 3px 12px; border-radius: 99px; direction: ltr; font-feature-settings: 'tnum';
 }
 .status-badge { font-size: 10.5px; font-weight: 700; color: ${st.c}; background: white; border-radius: 99px; padding: 3px 12px; }
 /* ── نوار متا ── */
 .meta-strip {
 display: grid; grid-template-columns: repeat(4, 1fr); gap: 0;
 background: ${ACCENT_LIGHT}; border-bottom: 1px solid ${ACCENT_BORDER};
 }
 .meta-cell { padding: 10px 18px; border-inline-start: 1px solid ${ACCENT_BORDER}; }
 .meta-cell:first-child { border-inline-start: none; }
 .meta-label { font-size: 9px; color: ${ACCENT_DARK}; font-weight: 700; margin-bottom: 3px; letter-spacing: .3px; }
 .meta-value { font-size: 12.5px; font-weight: 700; color: #111827; }
 /* ── کارت‌های اطلاعات ── */
 .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 22px 32px 6px; }
 .info-card {
 background: #fafcfb; border: 1px solid #e5ece8; border-radius: 10px;
 padding: 14px 16px; position: relative; overflow: hidden;
 }
 .info-card::before { content: ""; position: absolute; inset-inline-start: 0; top: 0; bottom: 0; width: 3px; background: ${ACCENT}; border-radius: 0 3px 3px 0; }
 .info-card.buyer::before { background: #b45309; }
 .info-label { font-size: 9.5px; color: #6b7280; font-weight: 700; margin-bottom: 6px; display: flex; align-items: center; gap: 5px; }
 .info-label .tag { width: 6px; height: 6px; border-radius: 50%; background: ${ACCENT}; }
 .info-card.buyer .info-label .tag { background: #b45309; }
 .info-value { font-size: 15px; font-weight: 700; color: #111827; }
 .info-line { font-size: 11px; color: #6b7280; margin-top: 3px; line-height: 1.7; }
 /* ── جدول ── */
 .table-wrap { padding: 16px 32px 0; }
 table { width: 100%; border-collapse: separate; border-spacing: 0; }
 thead th {
 background: linear-gradient(180deg, ${ACCENT_DARK}, ${ACCENT});
 color: white; padding: 11px 10px; text-align: right;
 font-size: 11px; font-weight: 600;
 }
 thead th:first-child { border-start-start-radius: 8px; }
 thead th:last-child { border-start-end-radius: 8px; }
 tbody td { padding: 11px 10px; border-bottom: 1px solid #eef2f0; font-size: 12.5px; }
 tbody tr:nth-child(even) td { background: #fafcfb; }
 tbody tr:last-child td { border-bottom: 1.5px solid ${ACCENT_BORDER}; }
 .center { text-align: center; }
 .tnum { font-feature-settings: 'tnum'; direction: ltr; text-align: right; }
 .idx-chip {
 display: inline-flex; align-items: center; justify-content: center;
 width: 22px; height: 22px; border-radius: 50%;
 background: ${ACCENT_LIGHT}; color: ${ACCENT_DARK}; border: 1px solid ${ACCENT_BORDER};
 font-size: 10px; font-weight: 700;
 }
 .desc-cell { font-weight: 600; }
 .total-cell { font-weight: 700; }
 /* ── جمع‌بندی ── */
 .bottom-grid { display: grid; grid-template-columns: 1fr 300px; gap: 20px; padding: 18px 32px 0; align-items: start; }
 .words-box {
 background: #fafcfb; border: 1px solid #e5ece8; border-radius: 10px;
 padding: 14px 16px; font-size: 11.5px; color: #374151; line-height: 2;
 }
 .words-box .t { font-weight: 800; color: ${ACCENT_DARK}; font-size: 10.5px; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
 .qr-note { font-size: 9.5px; color: #9ca3af; margin-top: 8px; display: flex; align-items: center; gap: 6px; }
 .summary-block {
 background: ${ACCENT_LIGHT}; border: 1.5px solid ${ACCENT_BORDER};
 border-radius: 12px; padding: 16px 18px;
 }
 .summary-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12.5px; color: #374151; }
 .summary-row.grand {
 border-top: 1.5px dashed ${ACCENT}; margin-top: 8px; padding-top: 12px;
 font-weight: 800; font-size: 14.5px; color: ${ACCENT_DARK};
 }
 .qr-a4 { width: 74px; height: 74px; border-radius: 8px; border: 1px solid ${ACCENT_BORDER}; background: white; padding: 4px; margin-top: 10px; }
 /* ── نوار پرداخت ── */
 .pay-strip { padding: 14px 32px 0; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
 .pay-chip {
 display: inline-flex; align-items: center; gap: 8px;
 font-size: 11.5px; font-weight: 700; border-radius: 99px; padding: 6px 16px;
 }
 .pay-chip.ok { color: ${ACCENT_DARK}; background: ${ACCENT_LIGHT}; border: 1px solid ${ACCENT_BORDER}; }
 .pay-chip.part { color: #b45309; background: #fffbeb; border: 1px solid #fde68a; }
 .pay-chip.wait { color: #b45309; background: #fffbeb; border: 1px solid #fde68a; }
 .pay-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
 .pay-due { font-size: 11px; color: #6b7280; }
 /* ── امضاها ── */
 .signature { display: flex; justify-content: space-between; margin: 34px 32px 0; gap: 24px; }
 .signature-box { flex: 1; text-align: center; }
 .signature-line { border-top: 1.5px dashed #9ca3af; margin-bottom: 7px; padding-top: 34px; }
 .signature-label { font-size: 10.5px; color: #6b7280; font-weight: 600; }
 /* ── فوتر ── */
 .footer {
 margin-top: 30px;
 background: #fafcfb; border-top: 1px solid #e5ece8;
 padding: 13px 32px; display: flex; justify-content: space-between; align-items: center; gap: 12px;
 }
 .footer-right { font-size: 10px; color: #6b7280; line-height: 1.8; text-align: right; }
 .footer-right .site { direction: ltr; unicode-bidi: embed; font-weight: 700; color: ${ACCENT_DARK}; }
 .footer-left { text-align: left; flex-shrink: 0; }
 .hoosh-badge {
 display: inline-flex; align-items: center; gap: 6px;
 font-size: 9.5px; color: ${ACCENT_DARK}; font-weight: 700;
 background: white; border: 1px solid ${ACCENT_BORDER}; border-radius: 99px; padding: 4px 12px;
 }
 .hoosh-badge .h-logo {
 width: 16px; height: 16px; border-radius: 5px;
 background: linear-gradient(135deg, ${ACCENT_DARK}, ${ACCENT});
 color: white; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 800;
 }
 .currency-badge {
 display: inline-block; background: rgba(255,255,255,.16); color: white;
 padding: 2px 10px; border-radius: 4px; font-size: 10px; font-weight: 600;
 border: 1px solid rgba(255,255,255,.3);
 }
 @media print {
 body { background: white; padding: 0; }
 .page { box-shadow: none; max-width: none; border-radius: 0; }
 @page { size: A4; margin: 0; }
 .no-print { display: none!important; }
 }
 .print-btn {
 position: fixed; top: 20px; left: 20px;
 background: ${ACCENT}; color: white; border: none;
 padding: 11px 22px; border-radius: 8px; cursor: pointer;
 font-size: 13px; font-family: inherit; z-index: 100;
 box-shadow: 0 3px 10px rgba(0,0,0,.2);
 }
 .print-btn:hover { background: ${ACCENT_DARK}; }
</style>
</head>
<body>
 <button class="print-btn no-print" onclick="window.print()">چاپ فاکتور</button>
 <div class="page">
 <div class="header">
 <div class="logo-area">
 ${logoUrl
        ? `<img class="logo-img" src="${escapeHtml(logoUrl)}" alt="لوگو" />`
        : `<div class="logo-circle">${monogram}</div>`}
 <div style="min-width:0;">
 <div class="company-name">${escapeHtml(tenantName)}</div>
 ${[slogan, address, phone ? `تلفن: ${phone}` : null].filter(Boolean).length > 0
          ? `<div class="company-sub">${[slogan ? escapeHtml(slogan) : null, address ? escapeHtml(address) : null, phone ? `تلفن: <span dir="ltr">${escapeHtml(phone)}</span>` : null].filter(Boolean).join('<span class="sep-dot">•</span>')}</div>`
          : `<div class="company-sub">نرم‌افزار حسابداری هوش</div>`}
 </div>
 </div>
 <div class="doc-box">
 <div class="invoice-title">${escapeHtml(typeLabel)}</div>
 <div class="invoice-number">${escapeHtml(invoice.number)}</div>
 ${isForeign ? `<span class="currency-badge">${escapeHtml(currencyLabel)}</span>` : ""}
 <span class="status-badge">${escapeHtml(st.t)}</span>
 </div>
 </div>

 <div class="meta-strip">
 <div class="meta-cell"><div class="meta-label">شماره فاکتور</div><div class="meta-value" dir="ltr" style="text-align:right;">${escapeHtml(invoice.number)}</div></div>
 <div class="meta-cell"><div class="meta-label">تاریخ صدور</div><div class="meta-value">${dateFa}</div></div>
 <div class="meta-cell"><div class="meta-label">سررسید</div><div class="meta-value">${dueDateFa ?? "—"}</div></div>
 <div class="meta-cell"><div class="meta-label">وضعیت</div><div class="meta-value" style="color:${st.c};">${escapeHtml(st.t)}</div></div>
 </div>

 <div class="info-grid">
 <div class="info-card">
 <div class="info-label"><span class="tag"></span>صادرکننده</div>
 <div class="info-value">${escapeHtml(tenantName)}</div>
 ${phone ? `<div class="info-line">تلفن: <span dir="ltr">${escapeHtml(phone)}</span></div>` : `<div class="info-line">واحد فروش</div>`}
 ${address ? `<div class="info-line">${escapeHtml(address)}</div>` : ""}
 ${website ? `<div class="info-line" dir="ltr" style="text-align:right;">${escapeHtml(website)}</div>` : ""}
 </div>
 <div class="info-card buyer">
 <div class="info-label"><span class="tag"></span>طرف‌حساب</div>
 <div class="info-value">${escapeHtml(partyName)}</div>
 ${partyCode ? `<div class="info-line">کد: <span dir="ltr">${escapeHtml(partyCode)}</span></div>` : ""}
 ${partyEconomicCode ? `<div class="info-line">کد اقتصادی: <span dir="ltr">${escapeHtml(partyEconomicCode)}</span></div>` : ""}
 ${invoice.description ? `<div class="info-line">توضیحات: ${escapeHtml(invoice.description.slice(0, 120))}</div>` : ""}
 </div>
 </div>

 <div class="table-wrap">
 <table>
 <thead>
 <tr>
 <th style="width: 44px;">#</th>
 <th>شرح کالا / خدمات</th>
 <th style="width: 58px;">تعداد</th>
 <th style="width: 105px;">قیمت واحد</th>
 ${isForeign ? `<th style="width: 110px;">قیمت واحد (ریال)</th>` : ""}
 <th style="width: 58px;">تخفیف</th>
 <th style="width: 110px;">مبلغ کل</th>
 ${isForeign ? `<th style="width: 110px;">مبلغ کل (ریال)</th>` : ""}
 </tr>
 </thead>
 <tbody>
 ${itemsRows || `<tr><td colspan="${isForeign ? 8 : 6}" class="center" style="padding: 28px; color: #9ca3af;">بدون قلم کالا</td></tr>`}
 </tbody>
 </table>
 </div>

 <div class="bottom-grid">
 <div>
 <div class="words-box">
 <div class="t">◇ مبلغ به حروف</div>
 ${escapeHtml(amountWords)}
 <div class="qr-note">
 ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR" style="width:17px;height:17px;" />` : "◈"}
 برای راستی‌آزمایی این فاکتور، کد کنار جمع کل را اسکن کنید.
 </div>
 </div>
 </div>
 <div class="summary-block">
 <div class="summary-row" style="padding-top:0;"><span>جمع اقلام:</span><span class="tnum">${formatNumberFa(subtotalRial)} ریال</span></div>
 ${isForeign ? "" : discountRial > 0 ? `<div class="summary-row"><span>تخفیف:</span><span class="tnum">−${formatNumberFa(discountRial)} ریال</span></div>` : ""}
 ${isForeign ? "" : taxRial > 0 ? `<div class="summary-row"><span>مالیات ارزش افزوده:</span><span class="tnum">${formatNumberFa(taxRial)} ریال</span></div>` : ""}
 ${isForeign ? `<div class="summary-row"><span>جمع (${escapeHtml(currencyLabel)}):</span><span class="tnum">${formatNumberFa(totalForeign)} ${currencySymbol}</span></div><div class="summary-row"><span>نرخ تبدیل:</span><span class="tnum">${new Intl.NumberFormat("fa-IR").format(rate)}</span></div>` : ""}
 <div class="summary-row grand"><span>جمع کل:</span><span class="tnum">${formatNumberFa(totalRial)} ریال</span></div>
 ${qrDataUrl ? `<img class="qr-a4" src="${qrDataUrl}" alt="QR راستی‌آزمایی فاکتور" />` : ""}
 </div>
 </div>

 ${paymentStrip}

 <div class="signature">
 <div class="signature-box">
 <div class="signature-line"></div>
 <div class="signature-label">مهر و امضای صادرکننده</div>
 </div>
 <div class="signature-box">
 <div class="signature-line"></div>
 <div class="signature-label">امضای طرف‌حساب</div>
 </div>
 </div>

 <div class="footer">
 <div class="footer-right">
 ${slogan ? `<div>${escapeHtml(slogan)}</div>` : ""}
 ${website ? `<div class="site">${escapeHtml(website)}</div>` : ""}
 <div>این فاکتور پس از امضا و مهر، برای وصول معتبر است.</div>
 </div>
 <div class="footer-left">
 <span class="hoosh-badge"><span class="h-logo">ه</span> صادرشده با نرم‌افزار حسابداری هوش</span>
 </div>
 </div>
 </div>
 ${autoprint ? `<script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 350); });</script>` : ""}
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Print invoice error:", error);
    return NextResponse.json(
      { success: false, error: "خطا در تولید فاکتور قابل چاپ" },
      { status: 500 }
    );
  }
}
