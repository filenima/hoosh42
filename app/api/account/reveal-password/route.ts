import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/user-auth";
import { rateLimitCheck, getClientIp } from "@/lib/rate-limit";
import { decryptPassword } from "@/lib/password-vault";

export const runtime = "nodejs";

/**
 * POST /api/account/reveal-password — نمایش رمز عبور خود کاربر (درخواست مالک:
 * «از اول باید ببینیم و کپی کنیم»)
 *
 * امنیت:
 * - فقط با نشست معتبر خود کاربر (بدون نشست → 401)
 * - rate-limit: ۶ درخواست در دقیقه برای هر IP
 * - AuditLog با اکشن PASSWORD_REVEAL — نمایش‌ها قابل ردیابی‌اند
 * - رمز از کپی AES-256-GCM (User.passwordEnc) رمزگشایی می‌شود؛ اگر کاربر
 *   هنوز بعد از این قابلیت وارد نشده باشد (کپی موجود نیست) پیام راهنما
 *   برمی‌گردد — بعد از یک ورود موفق، همیشه در دسترس است.
 */
export async function POST(req: NextRequest) {
 try {
 const ip = getClientIp(req);
 const rl = rateLimitCheck(`pwd-reveal:${ip}`, 6, 60_000);
 if (!rl.ok) {
 return NextResponse.json(
 { success: false, error: "درخواست‌های زیادی ارسال شده — یک دقیقه صبر کنید." },
 { status: 429 }
 );
 }

 const auth = await requireUser(req);
 if ("error" in auth) return auth.error;
 const { user: authUser } = auth;

 const user = await db.user.findUnique({
 where: { id: authUser.userId },
 select: { id: true, email: true, passwordEnc: true, tenantId: true },
 });
 if (!user) {
 return NextResponse.json(
 { success: false, error: "کاربر یافت نشد" },
 { status: 404 }
 );
 }

 const password = decryptPassword(user.passwordEnc);
 if (!password) {
 return NextResponse.json({
 success: false,
 available: false,
 error:
 "رمز عبور هنوز برای نمایش آماده نیست — یک بار خارج شده و دوباره وارد شوید؛ از آن پس همیشه قابل نمایش و کپی خواهد بود.",
 });
 }

 // AuditLog — نمایش رمز باید قابل ردیابی باشد
 try {
 const { auditLog } = await import("@/lib/auth");
 await auditLog({
 tenantId: user.tenantId,
 action: "PASSWORD_REVEAL",
 entity: "User",
 entityId: user.id,
 changes: { note: "کاربر رمز عبور خود را در حساب کاربری نمایش داد" },
 req,
 });
 } catch {
 /* audit نباید نمایش را بشکند */
 }

 return NextResponse.json({
 success: true,
 available: true,
 password,
 });
 } catch (error) {
 console.error("reveal-password error:", error);
 return NextResponse.json(
 { success: false, error: "خطا در نمایش رمز عبور" },
 { status: 500 }
 );
 }
}
