import { NextRequest, NextResponse } from "next/server";
import { getTenant, auditLog } from "@/lib/auth";
import { db } from "@/lib/db";
import { getZarinpalMerchant } from "@/lib/system-settings";
// FIX(9-a): قیمت مؤثر (ویرایش‌شده توسط سوپرادمین) — نه قیمت استاتیک
import { getEffectivePlan, type Plan } from "@/lib/plans";
// FIX(v10-checkout): پیام خطای فارسی و شفاف برای کدهای درگاه (مثلاً -14 دامنه)
import { zarinpalErrorFa, enforcePaymentCallbackOrigin, zarinpalUrls } from "@/lib/zarinpal";

export const runtime = "nodejs";

// POST /api/integrations/payment/create — ایجاد درخواست پرداخت واقعی از طریق زرین‌پال
// body: { amount?, planId?, invoiceId?, callbackUrl?, description? }
// - planId (اختیاری): اگر ارسال شود، مبلغ از lib/plans.ts خوانده می‌شود
// - amount (تومان): اگر planId نباشد، مبلغ مستقیم (تومان) — به ریال ضرب می‌شود
// - callbackUrl: آدرس بازگشت (الزامی)
// - description: توضیح تراکنش (اختیاری)
export async function POST(req: NextRequest) {
 try {
 const tenant = await getTenant(req);
 if (!tenant) {
 return NextResponse.json(
 { success: false, error: "تنانت یافت نشد" },
 { status: 401 }
 );
 }

 const body = await req.json();
 const { amount, planId, invoiceId, callbackUrl, description } = body as {
 amount?: number;
 planId?: string;
 invoiceId?: string;
 callbackUrl?: string;
 description?: string;
 };

 // تعیین مبلغ به تومان — اولویت با planId
 let amountToman = 0;
 let plan: Plan | undefined;
 if (planId) {
 // FIX(9-a): پلن مؤثر از SystemSettings (plan_overrides_v2) — قیمت ویرایش‌شده
 // سوپرادمین در چک‌اوت اعمال می‌شود
 plan = await getEffectivePlan(planId);
 if (!plan) {
 return NextResponse.json(
 { success: false, error: "پلن نامعتبر است" },
 { status: 400 }
 );
 }
 amountToman = plan.priceToman;
 } else if (typeof amount === "number" && amount > 0) {
 amountToman = amount;
 } else {
 return NextResponse.json(
 { success: false, error: "مبلغ یا planId معتبر نیست" },
 { status: 400 }
 );
 }

 if (!callbackUrl) {
 return NextResponse.json(
 { success: false, error: "آدرس بازگشت (callback) الزامی است" },
 { status: 400 }
 );
 }

 // دریافت کد پذیرنده از تنظیمات سیستم
 const merchantId = await getZarinpalMerchant();
 if (!merchantId) {
 return NextResponse.json(
 {
 success: false,
 error:
 "درگاه پرداخت پیکربندی نشده است. لطفاً با مدیر پلتفرم تماس بگیرید تا کد پذیرنده زرین‌پال را در پنل سوپرادمین تنظیم کند.",
 errorCode: "MERCHANT_NOT_CONFIGURED",
 },
 { status: 503 }
 );
 }

 // مبلغ به ریال (زرین‌پال فقط ریال می‌پذیرد)
 const amountRial = amountToman * 10;
 // FIX(PAY-2): اعمال آدرس پایه‌ی کال‌بک تنظیم‌شده در پنل سوپرادمین
 const effectiveCallbackUrl = await enforcePaymentCallbackOrigin(callbackUrl);
 const finalDescription =
 description?.trim() ||
 (plan
? `خرید پلن ${plan.name} هوش`
: `پرداخت هوش - ${amountToman.toLocaleString("fa-IR")} تومان`);

 // فراخوانی API زرین‌پال
 // FIX(PAY-2): احترام به تنظیم sandbox سوپرادمین — قبلاً endpoint تولید هاردکد بود
 const { getPaymentSettings } = await import("@/lib/system-settings");
 const paySettings = await getPaymentSettings();
 const zpUrls = zarinpalUrls(paySettings.zarinpal.sandbox === true);
 const zarinpalRes = await fetch(
 zpUrls.request,
 {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 Accept: "application/json",
 },
 body: JSON.stringify({
 merchant_id: merchantId,
 amount: amountRial,
 description: finalDescription,
 callback_url: effectiveCallbackUrl,
 }),
 }
 );

 const zpData = (await zarinpalRes.json().catch(() => null)) as {
 data?: { authority?: string; code?: number; fee_type?: string; message?: string };
 errors?: { code?: number; message?: string; validations?: unknown } | null;
 } | null;

 // بررسی پاسخ زرین‌پال
 if (!zarinpalRes.ok ||!zpData?.data?.authority) {
 const errCode = zpData?.errors?.code?? zarinpalRes.status;
 const errMsg =
 zpData?.errors?.message ||
 zpData?.data?.message ||
 `HTTP ${zarinpalRes.status}`;
 console.error("Zarinpal create failed:", errCode, errMsg);
 // FIX(v10-checkout): پیام فارسی و شفاف — قبلاً «خطا در ارتباط با درگاه (کد -14)»
 // بدون توضیح بود؛ کاربر نمی‌فهمید مشکل دامنه است
 const faErr = zarinpalErrorFa(errCode);
 return NextResponse.json(
 {
 success: false,
 error: `${faErr}. لطفاً دقایقی بعد تلاش کنید یا با پشتیبانی تماس بگیرید.`,
 errorCode: "ZARINPAL_REQUEST_FAILED",
 gatewayCode: errCode,
 details: errMsg,
 },
 { status: 502 }
 );
 }

 const authority = zpData.data.authority;
 // FIX(PAY-2): StartPay مطابق تنظیم sandbox
 const gatewayUrl = `${zpUrls.startPay}${authority}`;
 const paymentId = `PAY-${Date.now().toString(36).toUpperCase()}`;

 // ذخیره تراکنش در Integration (type=PAYMENT) برای بازیابی در verify
 try {
 await db.integration.create({
 data: {
 tenantId: tenant.id,
 type: "PAYMENT",
 name: `Checkout - ${planId || "manual"} - ${paymentId}`,
 status: "PENDING",
 config: JSON.stringify({
 authority,
 paymentId,
 amountToman,
 amountRial,
 planId: planId || null,
 invoiceId: invoiceId || null,
 description: finalDescription,
 gateway: "zarinpal",
 createdAt: new Date().toISOString(),
 }),
 },
 });
 } catch (e) {
 console.error("Failed to persist payment integration record:", e);
 // ادامه می‌دهیم — authority از سمت زرین‌پال معتبر است
 }

 await auditLog({
 tenantId: tenant.id,
 action: "PAYMENT_CREATE",
 entity: "Payment",
 entityId: paymentId,
 changes: {
 amountToman,
 amountRial,
 planId: planId || null,
 invoiceId: invoiceId || null,
 authority,
 callbackUrl,
 description: finalDescription,
 },
 req,
 });

 return NextResponse.json({
 success: true,
 authority,
 gatewayUrl,
 paymentId,
 amount: amountToman,
 planId: planId || null,
 message: "درخواست پرداخت با موفقیت ایجاد شد",
 });
 } catch (error) {
 console.error("Payment create error:", error);
 return NextResponse.json(
 { success: false, error: "خطا در ایجاد درخواست پرداخت" },
 { status: 500 }
 );
 }
}

// نگه داشتن تابع کمکی قدیمی برای سازگاری با import های احتمالی
export function generateAuthority(length: number): string {
 const chars =
 "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
 let result = "";
 for (let i = 0; i < length; i++) {
 result += chars[Math.floor(Math.random() * chars.length)];
 }
 return result;
}
