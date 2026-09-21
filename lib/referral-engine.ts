// ============ هوش — موتور رفرال (FIX v12.1 — سیستم رفرال سرتاسری) ============
// -----------------------------------------------------------------------------
// مشکل قبلی (گزارش شکار باگ): قیف رفرال ۱۰۰٪ کد مرده بود —
//   ۱) هیچ مسیر ثبت‌نامی referral/track را صدا نمی‌زد
//   ۲) ویجت رفرال هیچ‌جا رندر نمی‌شد
//   ۳) لینک ?ref= در landing پیدا نمی‌شد
//   ۴) هیچ چیز REWARDED را ست نمی‌کرد
// این ماژول منطق مشترک را یک‌جا دارد تا register / trial / register-and-pay
// همگی از آن استفاده کنند.
// -----------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";

export interface ApplyReferralResult {
  applied: boolean;
  reason?: string;
  referralId?: string;
  referrerId?: string;
  loyaltyAwarded?: boolean;
  loyaltyMessage?: string;
}

/**
 * اعمال کد رفرال هنگام ثبت‌نام کاربر جدید.
 *
 * FIX(v12.1.2 — رفرال دقیق): کد رفرال «کد شخصی دعوت‌کننده» است — یک کد
 * می‌تواند چند دعوت را پوشش دهد. دو مسیر ورودی:
 *  A) دعوت مستقیم (فرم ویجت): رکورد PENDING با refereeEmail ازپیش‌تعیین‌شده →
 *     ثبت‌نام با همان ایمیل، همان رکورد را SIGNED_UP می‌کند.
 *  B) لینک عمومی ?ref=CODE: دوست با ایمیل خودش ثبت‌نام می‌کند → رکورد جدید
 *     SIGNED_UP با همان کد شخصی ساخته می‌شود (قبلاً EMAIL_MISMATCH می‌شد و
 *     رفرال گم می‌شد).
 *
 * امنیت:
 *  - self-referral ممنوع (referee !== referrer)
 *  - idempotent — کاربر دعوت‌شده قبلاً با این کد track شده باشد، دوباره track نمی‌شود
 *  - اعطای ۱۰۰ امتیاز وفاداری به دعوت‌کننده (best-effort)
 */
export async function applyReferralOnSignup(
  db: PrismaClient | any,
  params: {
    code: string;
    refereeUserId: string;
    refereeEmail?: string | null;
    refereeTenantId?: string | null;
  }
): Promise<ApplyReferralResult> {
  const code = String(params.code || "").trim().toUpperCase();
  if (!code) return { applied: false, reason: "NO_CODE" };

  // همه رکوردهای این کد — کد متعلق به یک دعوت‌کننده (صاحب کد)
  const refs = await (db as PrismaClient).referral.findMany({
    where: { code },
    orderBy: { createdAt: "asc" },
  });
  if (!refs || refs.length === 0) return { applied: false, reason: "INVALID_CODE" };

  const ownerReferrerId = refs[0].referrerId;
  const defaultReward = refs.reduce((m: number, r: { reward: number }) => Math.max(m, r.reward), 0);

  // self-referral ممنوع — کد خودش را وارد کرده
  if (ownerReferrerId === params.refereeUserId) {
    return { applied: false, reason: "SELF_REFERRAL", referralId: refs[0].id };
  }

  // idempotent — این کاربر قبلاً با این کد track شده است
  const alreadyTracked = refs.find(
    (r: { refereeUserId: string | null }) => r.refereeUserId === params.refereeUserId
  );
  if (alreadyTracked) {
    return { applied: false, reason: "ALREADY_TRACKED", referralId: alreadyTracked.id };
  }

  // دعوت‌کننده باید هنوز کاربر فعال باشد
  const referrer = await (db as PrismaClient).user.findUnique({
    where: { id: ownerReferrerId },
    select: { id: true, tenantId: true, isActive: true, deletedAt: true },
  });
  if (!referrer || !referrer.isActive || referrer.deletedAt) {
    return { applied: false, reason: "REFERRER_INACTIVE", referralId: refs[0].id };
  }

  // ─── مسیر A: دعوت مستقیم — رکورد PENDING با همین ایمیل → همان رکورد ───
  const refereeEmailNorm = params.refereeEmail
    ? String(params.refereeEmail).toLowerCase().trim()
    : "";
  const directInvite = refs.find(
    (r: { status: string; refereeEmail: string }) =>
      r.status === "PENDING" &&
      refereeEmailNorm &&
      r.refereeEmail &&
      r.refereeEmail.toLowerCase() === refereeEmailNorm
  );

  let referralId: string;
  if (directInvite) {
    await (db as PrismaClient).referral.update({
      where: { id: directInvite.id },
      data: {
        status: "SIGNED_UP",
        refereeUserId: params.refereeUserId,
        updatedAt: new Date(),
      },
    });
    referralId = directInvite.id;
  } else {
    // ─── مسیر B: لینک عمومی — رکورد جدید SIGNED_UP با کد شخصی ───
    // ایمیل دعوت‌شده اگر با رکورد PENDING دیگری بخورد ولی آن رکورد مال ایمیل
    // دیگری است (ایمیل match نشد)، رکورد جدید می‌سازیم — قیف رفرال گم نمی‌شود.
    const created = await (db as PrismaClient).referral.create({
      data: {
        referrerId: ownerReferrerId,
        refereeEmail: refereeEmailNorm || "(ثبت‌نام با لینک دعوت)",
        code,
        status: "SIGNED_UP",
        reward: defaultReward,
        refereeUserId: params.refereeUserId,
      },
    });
    referralId = created.id;
  }

  // ۱۰۰ امتیاز وفاداری (best-effort — نباید ثبت‌نام را بترکاند)
  let loyaltyAwarded = false;
  let loyaltyMessage = "";
  try {
    const { awardAuto } = await import("@/lib/loyalty-engine");
    const result = await awardAuto(referrer.tenantId, referrer.id, "REFERRAL", referralId);
    loyaltyAwarded = result.awarded;
    loyaltyMessage = result.message;
  } catch (e) {
    console.warn("[referral] loyalty award failed:", e);
  }

  // audit log (best-effort)
  try {
    await (db as PrismaClient).auditLog.create({
      data: {
        tenantId: params.refereeTenantId ?? referrer.tenantId,
        userId: params.refereeUserId,
        action: "REFERRAL_TRACKED",
        entity: "Referral",
        entityId: referralId,
        changes: JSON.stringify({
          code,
          referrerId: ownerReferrerId,
          refereeUserId: params.refereeUserId,
          loyaltyAwarded,
          path: directInvite ? "DIRECT" : "PUBLIC_LINK",
        }),
      },
    });
  } catch {
    /* ignore */
  }

  return {
    applied: true,
    referralId,
    referrerId: ownerReferrerId,
    loyaltyAwarded,
    loyaltyMessage,
  };
}

/**
 * تبدیل رفرال به REWARDED — فقط از مسیر مدیریتی (سوپرادمین) یا تبدیل پرداختی.
 * state-machine یک‌طرفه: PENDING → SIGNED_UP → REWARDED
 */
export async function markReferralRewarded(
  db: PrismaClient | any,
  referralId: string
): Promise<{ ok: boolean; reason?: string }> {
  const referral = await (db as PrismaClient).referral.findUnique({
    where: { id: referralId },
  });
  if (!referral) return { ok: false, reason: "NOT_FOUND" };
  if (referral.status !== "SIGNED_UP") {
    return { ok: false, reason: "NOT_SIGNED_UP" };
  }
  await (db as PrismaClient).referral.update({
    where: { id: referralId },
    data: { status: "REWARDED", updatedAt: new Date() },
  });
  return { ok: true };
}
