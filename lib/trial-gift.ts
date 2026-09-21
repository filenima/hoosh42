import { db } from "@/lib/db";
import { trialDaysRemaining } from "@/lib/license-trial";

/**
 * ============ TRIAL-GIFT (قاعدهٔ هدیهٔ روزهای باقی‌ماندهٔ تریال) ============
 *
 * قاعدهٔ کسب‌وکار (درخواست مالک): وقتی کاربرِ در دورهٔ آزمایشی، میان‌ترم پلن
 * خریداری می‌کند، روزهای باقی‌ماندهٔ تریال او «سوزانده» نمی‌شود بلکه به‌عنوان
 * هدیه به انتهای دورهٔ پرداختی اضافه می‌شود:
 *
 *   endDate پلن = امروز + دورهٔ خریداری‌شده + روزهای باقی‌ماندهٔ تریال
 *
 * مثال: کاربری ۹ روز از تریال ۱۴ روزه‌اش مانده و پلن سالانه می‌خرد →
 * لایسنس ۳۶۵ + ۹ = ۳۷۴ روز اعتبار می‌گیرد و پیام «۹ روز هدیه» می‌بیند.
 *
 * اعمال در payment callback (هر دو فلو POST و GET مسیر
 * /api/integrations/payment/verify) — دقیقاً همان‌جایی که لایسنس صادر می‌شود.
 *
 * اثرات جانبی هم‌زمان (درون همان تراکنش تسویه):
 * - لایسنس‌های تریال tenant → status "SUPERSEDED" (دیگر ACTIVE نیستند)
 * - user.isTrial=false برای کاربران تریال tenant (بنر شمارش معکوس خاموش می‌شود
 *   و گزارش‌های churn/تریال دیگر این tenant را تریال-active نمی‌شمارند)
 * - AuditLog با جزئیات هدیه برای ردیابی مالی
 *
 * سقف: حداکثر ۳۶۵ روز هدیه (محافظ در برابر دادهٔ خراب trialEndsAt آیندهٔ دور).
 */

const MAX_GIFT_DAYS = 365;

/** روزهای باقی‌ماندهٔ تریال کاربر (۰ اگر تریال نیست/تمام شده/دادهٔ نامعتبر). */
export function computeTrialGiftDays(user: {
 isTrial: boolean;
 trialEndsAt: Date | string | null;
} | null): number {
 if (!user || !user.isTrial) return 0;
 const remaining = trialDaysRemaining(user);
 if (remaining === null) return 0;
 return Math.min(Math.max(0, remaining), MAX_GIFT_DAYS);
}

/**
 * پیدا کردن کاربرِ تریالِ tenant (برای محاسبهٔ هدیه).
 * فقط کاربران فعال و حذف‌نشده — اولین ADMIN تریال.
 */
export async function findTrialUser(
 tenantId: string
): Promise<{ id: string; isTrial: boolean; trialEndsAt: Date | string | null } | null> {
 const user = await db.user.findFirst({
 where: { tenantId, isTrial: true, deletedAt: null, isActive: true },
 select: { id: true, isTrial: true, trialEndsAt: true },
 orderBy: { createdAt: "asc" },
 });
 return user;
}

/**
 * اعمال اثرات خرید روی وضعیت تریال — باید **درون تراکنش تسویه** صدا شود:
 * - لایسنس‌های تریال tenant → SUPERSEDED
 * - کاربران تریال tenant → isTrial=false
 */
export async function settleTrialOnPurchase(
 tx: typeof db,
 tenantId: string,
 opts: { giftDays: number; authority: string; planId: string }
): Promise<void> {
 // لایسنس‌های تریال این tenant که هنوز ACTIVE اند → SUPERSEDED
 await tx.license.updateMany({
 where: { tenantId, status: "ACTIVE", source: "trial" },
 data: { status: "SUPERSEDED" },
 });
 // کاربران تریال →不再是 تریال
 await tx.user.updateMany({
 where: { tenantId, isTrial: true },
 data: { isTrial: false },
 });
 // ردیف AuditLog برای ردیابی مالی هدیه
 try {
 await tx.auditLog.create({
 data: {
 tenantId,
 action: "TRIAL_GIFT_APPLIED",
 entity: "License",
 entityId: opts.planId,
 changes: JSON.stringify({
 note: "روزهای باقی‌ماندهٔ تریال به انتهای دورهٔ خریداری‌شده اضافه شد",
 giftDays: opts.giftDays,
 planId: opts.planId,
 authority: opts.authority,
 at: new Date().toISOString(),
 }),
 ipAddress: "payment-callback",
 },
 });
 } catch {
 /* audit نباید تسویه را بشکند */
 }
}
