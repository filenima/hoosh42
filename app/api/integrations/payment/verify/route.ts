import { NextRequest, NextResponse } from "next/server";
import { getTenant, auditLog } from "@/lib/auth";
import { db } from "@/lib/db";
import { getZarinpalMerchant, getPaymentSettings } from "@/lib/system-settings";
// FIX(PAY-6): تأیید پرداخت باید به همان محیطی برود که پرداخت در آن ساخته شده (سندباکس/تولیدی)
import { zarinpalUrls } from "@/lib/zarinpal";
// FIX(9-a): پلن/قیمت مؤثر — ویرایش‌های سوپرادمین در تسویه اعمال می‌شود
import { getEffectivePlan, getEffectiveLicenseDefaults, getPlanByPriceCheckEffective, type PlanId } from "@/lib/plans";
import { createUserSession } from "@/lib/session";
import { nextDocumentNumber } from "@/lib/document-sequence";

export const runtime = "nodejs";

// POST /api/integrations/payment/verify — تأیید پرداخت از طریق API واقعی زرین‌پال
// body: { authority, status?, planId?, amount? }
// - authority: کد بازگشتی از زرین‌پال (الزامی)
// - status: "OK" یا "NOK" — اگر NOK باشد، کاربر لغو کرده
// - planId/amount: اختیاری — اگر ارسال شوند اولویت دارند؛ در غیر این‌صورت از Integration.lookup می‌خوانیم
export async function POST(req: NextRequest) {
 try {
 const tenant = await getTenant(req);
 if (!tenant) {
 return NextResponse.json(
 { success: false, error: "تنانت یافت نشد" },
 { status: 401 }
 );
 }

 const body = await req.json().catch(() => ({}));
 const { authority, status } = body as {
 authority?: string;
 status?: string;
 };

 if (!authority) {
 return NextResponse.json(
 { success: false, error: "کد authority الزامی است" },
 { status: 400 }
 );
 }

 // جستجوی رکورد پرداخت ذخیره‌شده در Integration برای بازیابی metadata
 // FIX(SECURITY-C1): نوع SUBSCRIPTION هم جستجو می‌شود تا اشتراک‌ها تسویه شوند
 const integrationRecord = await db.integration.findFirst({
 where: {
 tenantId: tenant.id,
 type: { in: ["PAYMENT", "SUBSCRIPTION"] },
 config: { contains: authority },
 },
 orderBy: { createdAt: "desc" },
 });

 // FIX(SECURITY-C1 — بحرانی): رکورد ذخیره‌شده منبع یگانه حقیقت است.
 // قبلاً planId/amount از body قابل بازنویسی بود → هرکسی با پرداخت ۱۰هزار تومانی
 // می‌توانست لایسنس enterprise یک‌ساله صادر کند. اکنون:
 // ۱) بدون رکورد Integration → فعال‌سازی لایسنس مطلقاً ممنوع
 // ۲) planId فقط از رکورد ذخیره‌شده خوانده می‌شود
 // ۳) amount فقط از رکورد ذخیره‌شده (بدون بازنویسی body)
 if (!integrationRecord) {
 return NextResponse.json(
 {
 success: false,
 error:
 "تراکنش یافت نشد — فعال‌سازی پلن فقط از طریق رکورد پرداخت معتبر انجام می‌شود",
 },
 { status: 404 }
 );
 }

 let storedAmountRial = 0;
 let storedAmountToman = 0;
 let storedPlanId: string | null = null;
 let storedDescription = "";
 let storedPeriod: "monthly" | "yearly" = "yearly";
 try {
 const cfg = JSON.parse(integrationRecord.config) as {
 amountRial?: number;
 amountToman?: number;
 planId?: string | null;
 description?: string;
 period?: "monthly" | "yearly";
 };
 storedAmountRial = cfg.amountRial?? 0;
 storedAmountToman = cfg.amountToman?? 0;
 storedPlanId = cfg.planId?? null;
 storedDescription = cfg.description?? "";
 storedPeriod = cfg.period?? "yearly";
 } catch {
 // ignore JSON parse error
 }

 const planId = storedPlanId || undefined;
 const amountToman = storedAmountToman || 0;
 const amountRial =
 storedAmountRial > 0
? storedAmountRial
: amountToman > 0
? amountToman * 10
: 0;

 if (amountRial <= 0) {
 return NextResponse.json(
 {
 success: false,
 error: "مبلغ تراکنش در رکورد پرداخت ذخیره نشده است — با پشتیبانی تماس بگیرید",
 },
 { status: 400 }
 );
 }

 // اگر status از سمت زرین‌پال NOK باشد کاربر لغو کرده
 if (status && status!== "OK" && status!== "SUCCESS") {
 await auditLog({
 tenantId: tenant.id,
 action: "PAYMENT_VERIFY_FAILED",
 entity: "Payment",
 changes: { authority, reason: `USER_STATUS_${status}` },
 req,
 });
 return NextResponse.json({
 success: true,
 verified: false,
 refId: null,
 message: "پرداخت توسط کاربر لغو شد",
 });
 }

 // دریافت کد پذیرنده
 const merchantId = await getZarinpalMerchant();
 if (!merchantId) {
 return NextResponse.json(
 {
 success: false,
 error:
 "درگاه پرداخت در حال حاضر پیکربندی نشده است. لطفاً با مدیر پلتفرم تماس بگیرید.",
 errorCode: "MERCHANT_NOT_CONFIGURED",
 },
 { status: 503 }
 );
 }

 // فراخوانی API تأیید زرین‌پال — FIX(PAY-6): URL از تنظیم سندباکس
 const verifyUrls = zarinpalUrls((await getPaymentSettings()).zarinpal.sandbox === true);
 const verifyRes = await fetch(
 verifyUrls.verify,
 {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 Accept: "application/json",
 },
 body: JSON.stringify({
 merchant_id: merchantId,
 authority,
 amount: amountRial,
 }),
 }
 );

 const vpData = (await verifyRes.json().catch(() => null)) as {
 data?: {
 code?: number;
 ref_id?: number;
 fee_type?: string;
 card_pan?: string;
 card_hash?: string;
 message?: string;
 };
 errors?: { code?: number; message?: string } | null;
 } | null;

 // code 100 = تأیید موفق، code 101 = قبلاً تأیید شده
 const code = vpData?.data?.code;
 const verified = code === 100 || code === 101;
 const refId = verified
? String(vpData?.data?.ref_id?? `IR${Date.now()}`)
: null;

 if (!verified) {
 const errCode = vpData?.errors?.code?? verifyRes.status;
 const errMsg =
 vpData?.errors?.message || vpData?.data?.message || `HTTP ${verifyRes.status}`;
 console.error("Zarinpal verify failed:", errCode, errMsg);

 await auditLog({
 tenantId: tenant.id,
 action: "PAYMENT_VERIFY_FAILED",
 entity: "Payment",
 changes: { authority, code, errCode, errMsg },
 req,
 });

 // به‌روزرسانی رکورد Integration به ERROR
 if (integrationRecord) {
 try {
 await db.integration.update({
 where: { id: integrationRecord.id },
 data: { status: "ERROR" },
 });
 } catch {
 // ignore
 }
 }

 return NextResponse.json({
 success: true,
 verified: false,
 refId: null,
 message: `تأیید پرداخت ناموفق بود (${errCode}). در صورت کسر مبلغ، حداکثر پس از ۷۲ ساعت بازمی‌گردد.`,
 });
 }

 // ============ فعال‌سازی لایسنس برای پلن خریداری‌شده (تسویه خودکار) ============
 // IDEMPOTENT (۲۱-e): اگر رکورد Integration قبلاً CONNECTED شده باشد، یعنی این
 // تراکنش قبلاً تسویه شده (callback دوباره آمده) — دوباره اعمال نمی‌شود تا
 // لایسنس تکراری ساخته نشود و مبلغی دوبار ثبت نشود.
 let licenseKey: string | null = null;
 let activatedPlanId: string | null = null;
 // TRIAL-GIFT: روزهای هدیه‌شده به انتهای دوره (برای پاسخ JSON)
 let postTrialGiftDays = 0;

 const alreadySettled =
 integrationRecord?.status === "CONNECTED" ||
 integrationRecord?.status === "ACTIVE"? true: false;

 if (planId &&!alreadySettled) {
 const plan = await getEffectivePlan(planId as PlanId);
 if (plan) {
 // FIX(SECURITY-C1 + 9-a): تطبیق مبلغ پرداختی با قیمت مؤثر پلن —
 // اگر مبلغ رکورد با قیمت پلن هم‌خوانی نداشته باشد، لایسنس صادر نمی‌شود
 const priceCheck = await getPlanByPriceCheckEffective(plan.id, amountRial, storedPeriod);
 if (!priceCheck.ok) {
 await auditLog({
 tenantId: tenant.id,
 action: "PAYMENT_VERIFY_AMOUNT_MISMATCH",
 entity: "Payment",
 changes: { authority, planId: plan.id, amountRial, expected: priceCheck.expectedRial },
 req,
 });
 return NextResponse.json(
 {
 success: false,
 verified: false,
 error:
 "مبلغ پرداخت با قیمت پلن انتخابی مطابقت ندارد — لایسنس صادر نشد. با پشتیبانی تماس بگیرید.",
 },
 { status: 400 }
 );
 }
 activatedPlanId = plan.id;
 const { generateLicenseKey, hashLicenseKey } = await import(
 "@/lib/license-security"
 );
 // FIX(v18-لایسنس): سهمیه‌ها و features ماشینی از منبع واحد plans.ts —
 // قبلاً maxInvoices:-1 هاردکد و features = متن فارسی (با توکن‌های بقیه سیستم ناسازگار) بود.
 const defaults = await getEffectiveLicenseDefaults(plan.id);
 licenseKey = generateLicenseKey();
 const endDate = new Date();
 // FIX(A2-1): دوره اشتراک از رکورد ذخیره‌شده — ماهانه = ۱ ماه، سالانه = ۱ سال
 if (storedPeriod === "monthly") {
 endDate.setMonth(endDate.getMonth() + 1);
 } else {
 endDate.setFullYear(endDate.getFullYear() + 1);
 }

 // ============ TRIAL-GIFT: هدیهٔ روزهای باقی‌ماندهٔ تریال ============
 // قاعدهٔ مالک: خرید میان‌ترم تریال را نمی‌سوزاند — روزهای باقی‌مانده به
 // انتهای دورهٔ خریداری‌شده اضافه می‌شود (endDate += giftDays).
 let trialGiftDays = 0;
 try {
 const { computeTrialGiftDays, findTrialUser } = await import("@/lib/trial-gift");
 const trialUser = await findTrialUser(tenant.id);
 trialGiftDays = computeTrialGiftDays(trialUser);
 } catch {
 trialGiftDays = 0;
 }
 if (trialGiftDays > 0) {
 endDate.setDate(endDate.getDate() + trialGiftDays);
 }
 postTrialGiftDays = trialGiftDays;

 // تسویه اتمیک: ساخت لایسنس + فعال‌سازی tenant در یک تراکنش —
 // اگر هر کدام شکست بخورد هیچ‌کدام اعمال نمی‌شود
 await db.$transaction(async (tx) => {
 await tx.license.create({
 data: {
 key: licenseKey!,
 keyHash: hashLicenseKey(licenseKey!),
 tenantId: tenant.id,
 plan: plan.id,
 maxUsers: defaults.maxUsers,
 maxInvoices: defaults.maxInvoices,
 maxWarehouses: defaults.maxWarehouses,
 features: JSON.stringify(defaults.features),
 source: "purchase",
 status: "ACTIVE",
 startDate: new Date(),
 endDate,
 },
 });

 // TRIAL-GIFT: بستن وضعیت تریال + AuditLog هدیه — در همان تراکنش
 if (trialGiftDays > 0) {
 try {
 const { settleTrialOnPurchase } = await import("@/lib/trial-gift");
 await settleTrialOnPurchase(tx as unknown as typeof db, tenant.id, {
 giftDays: trialGiftDays,
 authority,
 planId: plan.id,
 });
 } catch {
 /* خطای تسویهٔ تریال نباید صدور لایسنس را بشکند */
 }
 }

 // به‌روزرسانی پلن تنانت
 await tx.tenant.update({
 where: { id: tenant.id },
 data: { plan: plan.id },
 });
 });
 }

 // FUNNEL-AB (درخواست مالک — «subscribe conversion tracking»): صدور لایسنس
 // یعنی تبدیل پولی — رویدادهای first_payment + paid در قیف A/B ثبت می‌شوند
 // (fire-and-forget؛ کاربر ادمین tenant به‌عنوانSubject قیف).
 if (licenseKey) {
 try {
 const { trackFunnelStep } = await import("@/lib/funnel-ab");
 const adminUser = await db.user.findFirst({
 where: { tenantId: tenant.id, deletedAt: null },
 select: { id: true },
 orderBy: { createdAt: "asc" },
 });
 if (adminUser) {
 void trackFunnelStep(adminUser.id, "first_payment").catch(() => undefined);
 void trackFunnelStep(adminUser.id, "paid").catch(() => undefined);
 }
 } catch {
 /* ignore */
 }
 }
 }

 // به‌روزرسانی رکورد Integration به CONNECTED / ACTIVE
 if (integrationRecord) {
 try {
 await db.integration.update({
 where: { id: integrationRecord.id },
 data: {
 status: integrationRecord.type === "SUBSCRIPTION"? "ACTIVE": "CONNECTED",
 },
 });
 } catch {
 // ignore
 }
 }

 await auditLog({
 tenantId: tenant.id,
 action: alreadySettled? "PAYMENT_VERIFY": "PAYMENT_VERIFY_SUCCESS",
 entity: "Payment",
 changes: {
 authority,
 verified,
 refId,
 planId: activatedPlanId,
 amountRial,
 licenseKey: licenseKey? "REDACTED": null,
 alreadySettled,
 ...(postTrialGiftDays > 0? { trialGiftDays: postTrialGiftDays }: {}),
 },
 req,
 });

 return NextResponse.json({
 success: true,
 verified,
 refId,
 planId: activatedPlanId,
 licenseKey,
 ...(postTrialGiftDays > 0? { trialGiftDays: postTrialGiftDays }: {}),
 message: alreadySettled
? "این تراکنش قبلاً تأیید و تسویه شده است"
: verified
? `پرداخت با موفقیت تأیید شد و لایسنس پلن فعال گردید${postTrialGiftDays > 0? ` — ${postTrialGiftDays} روز باقی‌ماندهٔ تریال به‌عنوان هدیه به انتهای دوره اضافه شد`: ""}`
: "تراکنش یافت نشد یا قبلاً تأیید شده",
 });
 } catch (error) {
 console.error("Payment verify error:", error);
 return NextResponse.json(
 { success: false, error: "خطا در تأیید پرداخت" },
 { status: 500 }
 );
 }
}

// GET /api/integrations/payment/verify — هندلر redirect بازگشتی زرین‌پال
// زرین‌پال کاربر را با query string:?Authority=xxx&Status=OK به callback_url برمی‌گرداند
// این هندلر تراکنش را تأیید کرده، لایسنس را فعال می‌کند و یک صفحه HTML نمایش می‌دهد
export async function GET(req: NextRequest) {
 const url = new URL(req.url);
 const authority = url.searchParams.get("Authority");
 const status = url.searchParams.get("Status");

 if (!authority) {
 return new NextResponse(
 renderHtmlPage("خطا", "کد Authority یافت نشد. لطفاً با پشتیبانی تماس بگیرید.", false),
 { headers: { "Content-Type": "text/html; charset=utf-8" } }
 );
 }

 if (status!== "OK") {
 return new NextResponse(
 renderHtmlPage(
 "پرداخت لغو شد",
 "پرداخت توسط شما لغو شد یا ناموفق بود. در صورت کسر مبلغ، حداکثر پس از ۷۲ ساعت بازمی‌گردد.",
 false
 ),
 { headers: { "Content-Type": "text/html; charset=utf-8" } }
 );
 }

 // جستجوی رکورد پرداخت ذخیره‌شده در Integration برای بازیابی tenant و metadata
 // FIX(A2-1): اشتراک‌های SUBSCRIPTION هم پیدا و تسویه می‌شوند
 const integrationRecord = await db.integration
.findFirst({
 where: { type: { in: ["PAYMENT", "SUBSCRIPTION"] }, config: { contains: authority } },
 orderBy: { createdAt: "desc" },
 })
.catch(() => null);

 if (!integrationRecord) {
 return new NextResponse(
 renderHtmlPage("تراکنش یافت نشد", "رکوردی برای این Authority یافت نشد.", false),
 { headers: { "Content-Type": "text/html; charset=utf-8" } }
 );
 }

 let cfg: {
 amountRial?: number;
 amountToman?: number;
 planId?: string | null;
 description?: string;
 flow?: string;
 userId?: string;
 email?: string;
 companyName?: string;
 invoiceId?: string;
 invoiceNumber?: string;
 portalAccessId?: string;
 partyId?: string;
 period?: "monthly" | "yearly";
 referralCode?: string | null;
 } = {};
 try {
 cfg = JSON.parse(integrationRecord.config) as typeof cfg;
 } catch {
 // ignore
 }

 const amountRial = cfg.amountRial?? 0;
 if (amountRial <= 0) {
 return new NextResponse(
 renderHtmlPage("خطا", "مبلغ تراکنش قابل بازیابی نیست.", false),
 { headers: { "Content-Type": "text/html; charset=utf-8" } }
 );
 }

 const merchantId = await getZarinpalMerchant();
 if (!merchantId) {
 return new NextResponse(
 renderHtmlPage(
 "خطای پیکربندی",
 "درگاه پرداخت در حال حاضر پیکربندی نشده است. لطفاً با مدیر پلتفرم تماس بگیرید.",
 false
 ),
 { headers: { "Content-Type": "text/html; charset=utf-8" } }
 );
 }

 // فراخوانی API تأیید زرین‌پال — FIX(PAY-6): URL از تنظیم سندباکس
 const verifyUrls2 = zarinpalUrls((await getPaymentSettings()).zarinpal.sandbox === true);
 let verified = false;
 let refId: string | null = null;
 try {
 const verifyRes = await fetch(
 verifyUrls2.verify,
 {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 Accept: "application/json",
 },
 body: JSON.stringify({
 merchant_id: merchantId,
 authority,
 amount: amountRial,
 }),
 }
 );
 const vpData = (await verifyRes.json().catch(() => null)) as {
 data?: { code?: number; ref_id?: number; message?: string };
 errors?: { code?: number; message?: string } | null;
 } | null;
 const code = vpData?.data?.code;
 verified = code === 100 || code === 101;
 refId = verified
? String(vpData?.data?.ref_id?? `IR${Date.now()}`)
: null;
 } catch (e) {
 console.error("Zarinpal verify GET failed:", e);
 }

 if (!verified) {
 try {
 await db.integration.update({
 where: { id: integrationRecord.id },
 data: { status: "ERROR" },
 });
 } catch {
 // ignore
 }
 return new NextResponse(
 renderHtmlPage(
 "تأیید ناموفق",
 "تأیید پرداخت ناموفق بود. در صورت کسر مبلغ، حداکثر پس از ۷۲ ساعت بازمی‌گردد. در صورت تکرار، با پشتیبانی تماس بگیرید.",
 false
 ),
 { headers: { "Content-Type": "text/html; charset=utf-8" } }
 );
 }

 // ============ تشخیص فلو ============
 // اگر flow === "register-and-pay" باشد، این پرداخت برای ساخت حساب جدید است
 // و باید کاربر و tenant را فعال کرده و توکن نشست تولید کنیم.
 const isRegisterAndPayFlow = cfg.flow === "register-and-pay" &&!!cfg.userId;

 // IDEMPOTENT (۲۱-e — تسویه خودکار): اگر رکورد Integration قبلاً CONNECTED
 // شده باشد، یعنی callback دوباره رسیده و تسویه قبلاً انجام شده —
 // دوباره اعمال نمی‌شود (لایسنس تکراری/افزایش دوباره paidAmount نداریم).
 // زرین‌پال در این حالت کد 101 (قبلاً تأیید شده) برمی‌گرداند و صفحه موفق نمایش داده می‌شود.
 // FIX(A2-1): رکوردهای SUBSCRIPTION با status ACTIVE هم تسویه‌شده حساب می‌شوند
 const alreadySettled =
 integrationRecord.status === "CONNECTED" ||
 integrationRecord.status === "ACTIVE";

 // ============ فعال‌سازی لایسنس ============
 let licenseKey: string | null = null;
 let activatedPlanName: string | null = null;
 // TRIAL-GIFT: روزهای هدیه‌شده به انتهای دوره (برای پیام موفقیت)
 let getTrialGiftDays = 0;
 // تسویه خودکار پلن: لایسنس ACTIVE + سهمیه‌ها از getLicenseDefaults +
 // endDate یک‌ساله + پلن tenant — همه در یک تراکنش اتمیک
 if (cfg.planId &&!alreadySettled) {
 const plan = await getEffectivePlan(cfg.planId);
 if (plan) {
 // FIX(SECURITY-C1 + 9-a): تطبیق مبلغ با قیمت مؤثر پلن قبل از صدور لایسنس
 const period = cfg.period?? "yearly";
 const priceCheck = await getPlanByPriceCheckEffective(plan.id, amountRial, period);
 if (!priceCheck.ok) {
 try {
 await auditLog({
 tenantId: integrationRecord.tenantId,
 action: "PAYMENT_VERIFY_AMOUNT_MISMATCH",
 entity: "Payment",
 changes: { authority, planId: plan.id, amountRial, expected: priceCheck.expectedRial },
 req,
 });
 } catch {
 // audit failure نباید جلوی پاسخ را بگیرد
 }
 return new NextResponse(
 renderHtmlPage(
 "خطای مبلغ",
 "مبلغ پرداخت با قیمت پلن انتخابی مطابقت ندارد. لایسنس صادر نشد — لطفاً با پشتیبانی تماس بگیرید.",
 false
 ),
 { headers: { "Content-Type": "text/html; charset=utf-8" } }
 );
 }
 activatedPlanName = plan.name;
 const { generateLicenseKey, hashLicenseKey } = await import(
 "@/lib/license-security"
 );
 // FIX(v18-لایسنس): سهمیه‌ها و features ماشینی از منبع واحد plans.ts
 const defaults = await getEffectiveLicenseDefaults(plan.id);
 licenseKey = generateLicenseKey();
 const endDate = new Date();
 // FIX(A2-1): دوره اشتراک از رکورد — ماهانه = ۱ ماه، سالانه = ۱ سال
 if (period === "monthly") {
 endDate.setMonth(endDate.getMonth() + 1);
 } else {
 endDate.setFullYear(endDate.getFullYear() + 1);
 }

 // ============ TRIAL-GIFT: هدیهٔ روزهای باقی‌ماندهٔ تریال ============
 // کاربرِ در تریال که از داخل اپ پلن می‌خرد، روزهای باقی‌مانده‌اش به انتهای
 // دورهٔ خریداری‌شده اضافه می‌شود (register-and-pay کاربر تازه است → ۰).
 let trialGiftDays = 0;
 try {
 const { computeTrialGiftDays, findTrialUser } = await import("@/lib/trial-gift");
 const trialUser = await findTrialUser(integrationRecord.tenantId);
 trialGiftDays = computeTrialGiftDays(trialUser);
 } catch {
 trialGiftDays = 0;
 }
 if (trialGiftDays > 0) {
 endDate.setDate(endDate.getDate() + trialGiftDays);
 }
 getTrialGiftDays = trialGiftDays;

 await db.$transaction(async (tx) => {
 await tx.license.create({
 data: {
 key: licenseKey!,
 keyHash: hashLicenseKey(licenseKey!),
 tenantId: integrationRecord.tenantId,
 plan: plan.id,
 maxUsers: defaults.maxUsers,
 maxInvoices: defaults.maxInvoices,
 maxWarehouses: defaults.maxWarehouses,
 features: JSON.stringify(defaults.features),
 source: "purchase",
 status: "ACTIVE",
 startDate: new Date(),
 endDate,
 },
 });

 // TRIAL-GIFT: بستن وضعیت تریال + AuditLog هدیه — در همان تراکنش
 if (trialGiftDays > 0) {
 try {
 const { settleTrialOnPurchase } = await import("@/lib/trial-gift");
 await settleTrialOnPurchase(tx as unknown as typeof db, integrationRecord.tenantId, {
 giftDays: trialGiftDays,
 authority,
 planId: plan.id,
 });
 } catch {
 /* خطای تسویهٔ تریال نباید صدور لایسنس را بشکند */
 }
 }

 await tx.tenant.update({
 where: { id: integrationRecord.tenantId },
 data: { plan: plan.id, status: "active" },
 });
 });
 }

 // FUNNEL-AB (درخواست مالک — «subscribe conversion tracking»): صدور لایسنس
 // = تبدیل پولی — first_payment + paid ثبت می‌شود (register-and-pay کاربرِ
 // همین فلو را دارد؛ خریدِ کاربر واردشده با ادمین tenant).
 if (licenseKey) {
 try {
 const { trackFunnelStep } = await import("@/lib/funnel-ab");
 const funnelUserId =
 cfg.userId ||
 (
 await db.user.findFirst({
 where: { tenantId: integrationRecord.tenantId, deletedAt: null },
 select: { id: true },
 orderBy: { createdAt: "asc" },
 })
 )?.id;
 if (funnelUserId) {
 void trackFunnelStep(funnelUserId, "first_payment").catch(() => undefined);
 void trackFunnelStep(funnelUserId, "paid").catch(() => undefined);
 }
 } catch {
 /* ignore */
 }
 }
 }

 // ============ فلو register-and-pay: فعال‌سازی کاربر + ساخت نشست ============
 let autoLoginToken: string | null = null;
 if (isRegisterAndPayFlow &&!alreadySettled) {
 try {
 // فعال‌سازی کاربر
 await db.user.update({
 where: { id: cfg.userId! },
 data: {
 isActive: true,
 lastLogin: new Date(),
 lastLoginIp: req.headers.get("x-forwarded-for") || null,
 },
 });

 // ساخت نشست (JWT + UserSession)
 const session = await createUserSession(
 req,
 cfg.userId!,
 integrationRecord.tenantId,
 "ADMIN"
 );
 autoLoginToken = session.token;

 // FIX(v12.1 — سیستم رفرال): اعمال کد دعوت ذخیره‌شده + پاداش نهایی.
 // تبدیل «پرداختی» مستقیماً رفرال را REWARDED می‌کند (دعوت‌کننده
 // پاداش ۵۰,۰۰۰ تومانی + امتیازات را می‌گیرد).
 if (cfg.referralCode) {
 try {
 const { applyReferralOnSignup, markReferralRewarded } = await import(
 "@/lib/referral-engine"
 );
 const refResult = await applyReferralOnSignup(db, {
 code: String(cfg.referralCode),
 refereeUserId: cfg.userId!,
 refereeEmail: cfg.email || null,
 });
 if (refResult.applied || refResult.reason === "ALREADY_TRACKED") {
 await markReferralRewarded(db, refResult.referralId!);
 console.info("[referral] تبدیل پرداختی رفرال پاداش گرفت:", refResult.referralId);
 }
 } catch (e) {
 console.warn("[referral] reward on paid conversion failed:", e);
 }
 }
 } catch (e) {
 console.error("Failed to activate register-and-pay user:", e);
 }
 }

 // ============ فلو portal-invoice-pay: علامت‌گذاری فاکتور به‌عنوان PAID =====
 // این فلو زمانی فعال می‌شود که مشتری از پورتال مشتریان برای پرداخت فاکتور
 // استفاده کرده باشد. در این حالت باید فاکتور به‌صورت PAID علامت‌گذاری شود
 // و paidAmount افزایش یابد.
 const isPortalInvoicePayFlow = cfg.flow === "portal-invoice-pay" &&!!cfg.invoiceId;
 // تسویه خودکار فاکتور (۲۱-e): فقط بار اول — با alreadySettled جلوی اعمال
 // دوباره در callback تکراری گرفته می‌شود.
 if (isPortalInvoicePayFlow &&!alreadySettled) {
 try {
 const invoice = await db.invoice.findFirst({
 where: {
 id: cfg.invoiceId!,
 tenantId: integrationRecord.tenantId,
 deletedAt: null,
 },
 select: { id: true, total: true, paidAmount: true, status: true, number: true, type: true, date: true, description: true },
 });
 if (invoice) {
 // IDEMPOTENT دومی: اگر فاکتور از قبل PAID است و paidAmount ≥ total،
 // دوباره افزایش نمی‌دهیم (محافظ اضافی در برابر callback تکراری)
 const isAlreadyPaid =
 invoice.status === "PAID" &&
 Number(invoice.paidAmount) >= Number(invoice.total);
 if (!isAlreadyPaid) {
 // FIX(v11): سقف پرداخت — قبلاً paidAmount می‌توانست از total بزرگ‌تر شود
 const cappedPaid = Math.min(
 Number(invoice.paidAmount) + amountRial,
 Number(invoice.total)
 );
 const newPaidAmount = cappedPaid;
 const newStatus =
 newPaidAmount >= Number(invoice.total)? "PAID": "PARTIALLY_PAID";

 // FIX(v11-تداخل): شماره سند از شمارنده «JOURNAL» مشترک — قبلاً RECEIPT
 // جدا بود و با @@unique([tenantId, number]) روی شماره‌های سند عادی برخورد
 // می‌کرد → کل تراکنش (حتی PAID شدن فاکتور) ساکت rollback می‌شد و به
 // مشتری «پرداخت موفق» نشان داده می‌شد!
 const { seq: receiptNumber } = await nextDocumentNumber(
 "JOURNAL",
 integrationRecord.tenantId
 );

 // تسویه اتمیک: فاکتور PAID + سند دریافت دوطرفه + اعلان — یکجا
 // FIX(v11-دفاتر): قبلاً سند RECEIPT «بدون قلم» ثبت می‌شد — فروش اولیه
 // دریافتنی را بدهکار کرده بود ولی این پرداخت هیچ‌وقت «صندوق Dr / دریافتنی Cr»
 // نمی‌زد → مطالبات و صندوق در دفاتر غلط می‌ماند. حالا از همان
 // postInvoiceSettlementToLedger ماژول فاکتورها استفاده می‌کنیم.
 await db.$transaction(async (tx) => {
 await tx.invoice.update({
 where: { id: invoice.id },
 data: {
 paidAmount: newPaidAmount,
 status: newStatus,
 },
 });

 try {
 const { postInvoiceSettlementToLedger } = await import("@/lib/accounting");
 await postInvoiceSettlementToLedger(
 tx,
 integrationRecord.tenantId,
 null,
 {
 invoiceId: invoice.id,
 number: invoice.number,
 type: invoice.type,
 date: invoice.date,
 description: `پرداخت آنلاین پورتال — کد پیگیری ${refId?? "—"}`,
 },
 BigInt(Math.round(amountRial)),
 { journalNumber: receiptNumber }
 );
 } catch (ledgerErr) {
 // خطای سند تسویه نباید کل تراکنش را قطع کند — paidAmount مهم‌تر است
 console.error("Portal payment settlement ledger failed:", ledgerErr);
 }

 // اعلان برای صاحب کسب‌وکار: «پرداخت دریافت شد»
 await tx.notification.create({
 data: {
 tenantId: integrationRecord.tenantId,
 title: "پرداخت دریافت شد",
 message: `پرداخت فاکتور ${invoice.number} به مبلغ ${amountRial.toLocaleString("fa-IR")} ریال از پورتال مشتریان دریافت شد. کد پیگیری: ${refId?? "—"}`,
 type: "SUCCESS",
 },
 });
 });

 // audit log برای ثبت موفقیت پرداخت فاکتور
 await db.auditLog.create({
 data: {
 tenantId: integrationRecord.tenantId,
 userId: null,
 action: "PORTAL_PAYMENT_SUCCESS",
 entity: "Invoice",
 entityId: invoice.id,
 changes: JSON.stringify({
 invoiceId: invoice.id,
 invoiceNumber: invoice.number,
 amount: amountRial,
 refId,
 authority,
 newStatus,
 paidAmount: newPaidAmount,
 }),
 ipAddress: req.headers.get("x-forwarded-for") || null,
 },
 });
 }
 }
 } catch (e) {
 console.error("Portal-invoice-pay invoice update failed:", e);
 }
 }

 // به‌روزرسانی Integration به CONNECTED — FIX(v11): شرطی و اتمیک تا
 // دو callback هم‌زمان هر دو تسویه نکنند
 try {
 const upd = await db.integration.updateMany({
 where: { id: integrationRecord.id, status: { not: "CONNECTED" } },
 data: { status: "CONNECTED" },
 });
 void upd;
 } catch {
 // ignore
 }

 // لاگ ممیزی
 try {
 await db.auditLog.create({
 data: {
 tenantId: integrationRecord.tenantId,
 userId: cfg.userId || null,
 action: alreadySettled? "PAYMENT_VERIFY": "PAYMENT_VERIFY_SUCCESS",
 entity: "Payment",
 entityId: authority,
 changes: JSON.stringify({
 authority,
 verified,
 refId,
 planId: cfg.planId,
 amountRial,
 flow: cfg.flow || "checkout",
 alreadySettled,
 }),
 ipAddress: req.headers.get("x-forwarded-for") || null,
 },
 });
 } catch {
 // ignore
 }

 // ============ هدایت کاربر ============
 // اگر فلو register-and-pay باشد و توکن ساخته شده باشد،
 // کاربر را به /?paid=1&token=<token> هدایت می‌کنیم تا فرانت‌اند آن را ذخیره کرده
 // و وارد پنل شود. در غیر این‌صورت، صفحه‌ی HTML نتیجه نمایش داده می‌شود.
 if (isRegisterAndPayFlow && autoLoginToken) {
 const redirectUrl = `/?paid=1&token=${encodeURIComponent(autoLoginToken)}`;
 const successMsg = licenseKey
? `پرداخت شما با موفقیت تأیید شد. حساب کاربری شما ساخته و پلن «${activatedPlanName?? cfg.planId}» فعال شد. در حال انتقال به پنل...`
: `پرداخت شما با موفقیت تأیید شد. حساب کاربری شما فعال شد. در حال انتقال به پنل...`;
 return new NextResponse(
 renderRedirectPage(successMsg, redirectUrl),
 { headers: { "Content-Type": "text/html; charset=utf-8" } }
 );
 }

 // فلو portal-invoice-pay: فاکتور با موفقیت پرداخت شد
 if (isPortalInvoicePayFlow) {
 const portalMsg = alreadySettled
 ? `این تراکنش قبلاً تأیید و تسویه شده است. کد پیگیری: ${refId?? "—"}`
 : `پرداخت فاکتور ${cfg.invoiceNumber?? ""} با موفقیت تأیید شد. فاکتور به‌عنوان «پرداخت‌شده» ثبت گردید. کد پیگیری: ${refId?? "—"}`;
 return new NextResponse(
 renderHtmlPage("پرداخت فاکتور موفق بود", portalMsg, true),
 { headers: { "Content-Type": "text/html; charset=utf-8" } }
 );
 }

 const successMsg = licenseKey
? `پرداخت شما با موفقیت تأیید شد. لایسنس پلن «${activatedPlanName?? cfg.planId}» فعال شد${getTrialGiftDays > 0? ` — ${getTrialGiftDays} روز باقی‌ماندهٔ تریال شما به‌عنوان هدیه به انتهای دوره اضافه شد`: ""}. کد پیگیری: ${refId?? "—"}`
: `پرداخت شما با موفقیت تأیید شد. کد پیگیری: ${refId?? "—"}`;

 return new NextResponse(
 renderHtmlPage("پرداخت موفق", successMsg, true, licenseKey?? undefined),
 { headers: { "Content-Type": "text/html; charset=utf-8" } }
 );
}

// ============ صفحه HTML برای نمایش نتیجه پرداخت ============
function renderHtmlPage(
 title: string,
 message: string,
 success: boolean,
 licenseKey?: string
): string {
 const accent = success? "#16a34a": "#dc2626";
 const icon = success? "": "";
 const licenseBlock = licenseKey
? `<div style="margin-top:1rem;padding:0.75rem;border:1px dashed #94a3b8;border-radius:0.5rem;direction:ltr;font-family:monospace;font-size:0.8rem;background:#f8fafc;color:#0f172a;word-break:break-all">${escapeHtml(
 licenseKey
 )}</div>
 <p style="margin-top:0.5rem;font-size:0.75rem;color:#64748b">این کلید لایسنس را در جای امن نگه دارید.</p>`
: "";
 return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} — هوش</title>
<meta http-equiv="refresh" content="8; url=/" />
<style>
 body { font-family: -apple-system, system-ui, "Segoe UI", Tahoma, sans-serif; background: #f1f5f9; margin: 0; padding: 1rem; display: flex; min-height: 100vh; align-items: center; justify-content: center; color: #0f172a; }
.card { background: #fff; border-radius: 1rem; padding: 2rem; max-width: 480px; width: 100%; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.1); text-align: center; }
.icon { width: 64px; height: 64px; border-radius: 50%; background: ${accent}; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 1rem; font-weight: bold; }
 h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
 p { color: #475569; line-height: 1.6; margin: 0.5rem 0; font-size: 0.9rem; }
.btn { display: inline-block; margin-top: 1.5rem; padding: 0.6rem 1.5rem; background: #4f46e5; color: #fff; text-decoration: none; border-radius: 0.5rem; font-weight: 500; }
.footer { margin-top: 1.5rem; font-size: 0.7rem; color: #94a3b8; }
</style>
</head>
<body>
 <div class="card">
 <div class="icon">${icon}</div>
 <h1>${escapeHtml(title)}</h1>
 <p>${escapeHtml(message)}</p>
 ${licenseBlock}
 <a class="btn" href="/">بازگشت به هوش</a>
 <p class="footer">به‌صورت خودکار پس از ۸ ثانیه به صفحه اصلی منتقل می‌شوید.</p>
 </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
 return s
.replace(/&/g, "&amp;")
.replace(/</g, "&lt;")
.replace(/>/g, "&gt;")
.replace(/"/g, "&quot;")
.replace(/'/g, "&#039;");
}

// ============ صفحه HTML برای فلو register-and-pay ============
// این صفحه به‌جای refresh ساده، کاربر را با JavaScript به /?paid=1&token=... هدایت می‌کند.
// این کار باعث می‌شود URL params در فرانت‌اند خوانده شوند و توکن در localStorage ذخیره شود.
function renderRedirectPage(message: string, redirectUrl: string): string {
 const safeRedirect = escapeHtml(redirectUrl);
 // FIX(4-a): آدرس هدایت داخل <script> نباید HTML-escape شود — entityها در context
 // اسکریپت decode نمی‌شوند، پس مرورگر به /?paid=1&amp;token=... می‌رفت و فرانت‌اند
 // (URLSearchParams.get("token")) توکن را نمی‌دید → ورود خودکار پس از پرداخت خراب بود.
 // href تگ <a> همچنان escape می‌شود (سمت HTML درست است)؛ برای اسکریپت از
 // JSON.stringify استفاده می‌کنیم + گِرد < برای جلوگیری از خروج از تگ script.
 const jsRedirect = JSON.stringify(redirectUrl).replace(/</g, "\\u003c");
 return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>پرداخت موفق — هوش</title>
<style>
 body { font-family: -apple-system, system-ui, "Segoe UI", Tahoma, sans-serif; background: #f1f5f9; margin: 0; padding: 1rem; display: flex; min-height: 100vh; align-items: center; justify-content: center; color: #0f172a; }
.card { background: #fff; border-radius: 1rem; padding: 2rem; max-width: 480px; width: 100%; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.1); text-align: center; }
.icon { width: 64px; height: 64px; border-radius: 50%; background: #16a34a; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 1rem; font-weight: bold; }
 h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
 p { color: #475569; line-height: 1.6; margin: 0.5rem 0; font-size: 0.9rem; }
.spinner { display: inline-block; width: 18px; height: 18px; border: 2px solid #4f46e5; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-left: 0.5rem; }
 @keyframes spin { to { transform: rotate(360deg); } }
.footer { margin-top: 1.5rem; font-size: 0.7rem; color: #94a3b8; }
</style>
</head>
<body>
 <div class="card">
 <div class="icon"></div>
 <h1>پرداخت موفق</h1>
 <p>${escapeHtml(message)}</p>
 <p><span class="spinner"></span> در حال انتقال به پنل...</p>
 <p class="footer">در صورت عدم انتقال خودکار، <a href="${safeRedirect}">اینجا کلیک کنید</a>.</p>
 </div>
 <script>
 // هدایت فوری به URL با query params
 window.location.replace(${jsRedirect});
 </script>
</body>
</html>`;
}
