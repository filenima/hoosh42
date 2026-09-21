import crypto from "crypto";

/**
 * PASSWORD-VIEW (درخواست مالک): «رمز عبور از اول باید قابل دیدن و کپی باشد»
 *
 * رمز عبور همچنان bcrypt-hashed برای احراز هویت باقی می‌ماند؛ علاوه بر آن یک
 * کپی AES-256-GCM رمز‌شده (passwordEnc) نگه داشته می‌شود تا خودِ کاربر بتواند
 * رمزش را در «حساب کاربری» ببیند و کپی کند.
 *
 * امنیت:
 * - کلید با scrypt از env (PASSWORD_VAULT_KEY یا JWT_SECRET) مشتق می‌شود —
 *   کلید خام هرگز ذخیره نمی‌شود.
 * - فرمت: base64(iv(12) + tag(16) + ciphertext)
 * - تازه‌سازی در هر ورود موفق (login route) — همهٔ مسیرهای ساخت/تغییر رمز
 *   (ثبت‌نام، ریست، تریال، تغییر رمز) به‌طور طبیعی پوشش داده می‌شوند چون
 *   کاربر برای استفاده باید وارد شود.
 * - نمایش فقط با نشست معتبر + rate-limit + AuditLog (مسیر reveal API).
 */

const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

function deriveKey(): Buffer {
 const secret =
 process.env.PASSWORD_VAULT_KEY ||
 process.env.JWT_SECRET ||
 "hoosh-dev-vault-secret-not-for-production";
 // salt ثابتِ کاربرد-محور — امنیت بر عهدهٔ secret env است
 return crypto.scryptSync(secret, "hoosh-password-vault-v1", KEY_LEN);
}

/** رمزگذاری رمز عبور برای ذخیره در User.passwordEnc */
export function encryptPassword(password: string): string {
 const iv = crypto.randomBytes(IV_LEN);
 const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
 const enc = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
 const tag = cipher.getAuthTag();
 return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** رمزگشایی — null اگر داده خراب/نامعتبر بود */
export function decryptPassword(payload: string | null | undefined): string | null {
 if (!payload) return null;
 try {
 const raw = Buffer.from(payload, "base64");
 if (raw.length <= IV_LEN + TAG_LEN) return null;
 const iv = raw.subarray(0, IV_LEN);
 const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
 const enc = raw.subarray(IV_LEN + TAG_LEN);
 const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), iv);
 decipher.setAuthTag(tag);
 const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
 return dec.toString("utf8");
 } catch {
 return null;
 }
}

/** تازه‌سازی کپی رمز شده — fire-and-forget (نباید ورود را کند یا بشکند) */
export async function refreshPasswordVault(
 userId: string,
 password: string
): Promise<void> {
 try {
 const { db } = await import("@/lib/db");
 await db.user.update({
 where: { id: userId },
 data: { passwordEnc: encryptPassword(password) },
 });
 } catch {
 /* خاموش — نمایش رمز اختیاری است، ورود نباید خراب شود */
 }
}
