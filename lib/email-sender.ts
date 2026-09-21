// ارسال ایمیل از طریق SMTP - هوش
//
// پشتیبانی از پروتکل SMTP استاندارد (Gmail, Outlook, Mailtrap, سازمانی و...)
// در صورت عدم تنظیم SMTP_HOST، در حالت mock به console.log ارسال می‌کند.
//
// متغیرهای محیطی مورد نیاز:
// SMTP_HOST — میزبان SMTP (مثل smtp.gmail.com)
// SMTP_PORT — پورت (587, 465, 25)
// SMTP_USER — نام کاربری
// SMTP_PASS — رمز عبور
// SMTP_FROM — آدرس فرستنده پیش‌فرض (اختیاری)

import nodemailer, { type Transporter } from "nodemailer";
import { db } from "@/lib/db";
import { getBrandingSettings } from "@/lib/system-settings";
import { isValidEmail } from "@/lib/email-validation";

export interface SendEmailParams {
 to: string;
 subject: string;
 html: string;
 from?: string;
 text?: string; // نسخه‌ی متنی ساده (اختیاری)
}

export interface SendEmailResult {
 success: boolean;
 messageId?: string;
 error?: string;
 mock?: boolean;
}

let cachedTransporter: Transporter | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // ۵ دقیقه

function isSmtpConfigured(): boolean {
 return Boolean(
 process.env.SMTP_HOST &&
 process.env.SMTP_PORT &&
 process.env.SMTP_USER &&
 process.env.SMTP_PASS
 );
}

function getTransporter(): Transporter | null {
 if (!isSmtpConfigured()) return null;

 const now = Date.now();
 if (cachedTransporter && now - cachedAt < CACHE_TTL_MS) {
 return cachedTransporter;
 }

 const port = parseInt(process.env.SMTP_PORT || "587", 10);
 cachedTransporter = nodemailer.createTransport({
 host: process.env.SMTP_HOST,
 port,
 secure: port === 465,
 auth: {
 user: process.env.SMTP_USER,
 pass: process.env.SMTP_PASS,
 },
 // برای سرویس‌های با گواهی self-signed
 tls: {
 rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED!== "false",
 },
 });
 cachedAt = now;
 return cachedTransporter;
}

/**
 * ارسال ایمیل با SMTP یا fallback به console.log
 */
export async function sendEmail(
 params: SendEmailParams
): Promise<SendEmailResult> {
 try {
 const transporter = getTransporter();
 let from = params.from || process.env.SMTP_FROM || process.env.SMTP_USER;

 // نام نمایشی برند (وایت‌لیبل) — اگر آدرس بدون نام باشد، نام برند
 // از تنظیمات برندینگ (سوپرادمین) به ابتدای آن اضافه می‌شود.
 if (from && !from.includes("<")) {
 try {
 const branding = await getBrandingSettings();
 from = `"${branding.appName}" <${from}>`;
 } catch {
 // fallback: همان آدرس خالی
 }
 }

 if (!transporter) {
 // حالت mock — وقتی SMTP تنظیم نشده
 const mockId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
 console.log(
 `[EMAIL MOCK] To: ${params.to} | Subject: ${params.subject}\nHTML: ${params.html.slice(0, 200)}...`
 );
 return {
 success: true,
 messageId: mockId,
 mock: true,
 };
 }

 const info = await transporter.sendMail({
 from,
 to: params.to,
 subject: params.subject,
 html: params.html,
 text: params.text,
 });

 return {
 success: true,
 messageId: info.messageId,
 };
 } catch (error) {
 const message = error instanceof Error? error.message: "خطای ناشناخته";
 console.error("Send email error:", message);
 return {
 success: false,
 error: message,
 };
 }
}

/**
 * اعتبارسنجی فرمت ایمیل — از ماژول client-safe (lib/email-validation) برای سازگاری با
 * کلاینت (email-invoice-dialog) و جلوگیری از ورود nodemailer به باندل مرورگر.
 */
export { isValidEmail } from "@/lib/email-validation";

/**
 * بارگذاری قالب ایمیل از دیتابیس و جایگزینی متغیرهای {{name}} با مقادیر
 */
export async function renderTemplate(
 templateId: string,
 variables: Record<string, string | number>,
 tenantId?: string
): Promise<{ subject: string; html: string } | null> {
 try {
 // FIX(SECURITY-M3): قالب باید tenant-scoped باشد — قبلاً هر templateId
 // از هر tenant دیگری قابل خواندن بود (IDOR افشای محتوا)
 const tpl = tenantId
? await db.emailTemplate.findFirst({
 where: { id: templateId, tenantId },
 })
: await db.emailTemplate.findFirst({
 where: { id: templateId, tenantId: null },
 });
 if (!tpl) return null;

 let html = tpl.body;
 let subject = tpl.subject;
 for (const [key, value] of Object.entries(variables)) {
 // FIX(SECURITY): escape کاراکترهای regex در کلید متغیر (ReDoS)
 const safeKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
 const placeholder = new RegExp(`\\{\\{\\s*${safeKey}\\s*\\}\\}`, "g");
 html = html.replace(placeholder, String(value));
 subject = subject.replace(placeholder, String(value));
 }
 // پاک کردن متغیرهای استفاده‌نشده
 html = html.replace(/\{\{[^}]+\}\}/g, "—");
 subject = subject.replace(/\{\{[^}]+\}\}/g, "—");

 return { subject, html };
 } catch {
 return null;
 }
}

/**
 * تست اتصال به SMTP
 */
export async function testSmtpConnection(): Promise<{
 ok: boolean;
 error?: string;
 mock: boolean;
}> {
 if (!isSmtpConfigured()) {
 return { ok: true, mock: true };
 }
 try {
 const transporter = getTransporter();
 if (!transporter) return { ok: false, error: "Transporter null", mock: false };
 await transporter.verify();
 return { ok: true, mock: false };
 } catch (error) {
 const message = error instanceof Error? error.message: "خطا";
 return { ok: false, error: message, mock: false };
 }
}

// ============ Email Queue (PROD-V8) ============

export interface QueueEmailParams {
 to: string;
 subject: string;
 html: string;
 tenantId?: string;
 maxAttempts?: number;
 scheduledAt?: Date;
}

/**
 * افزودن ایمیل به صف برای ارسال بعدی (به‌جای ارسال فوری).
 * این تابع فقط در سمت سرور قابل استفاده است (دسترسی به db).
 */
export async function queueEmail(params: QueueEmailParams): Promise<{
 success: boolean;
 id?: string;
 error?: string;
}> {
 try {
 if (!params.to ||!isValidEmail(params.to)) {
 return { success: false, error: "آدرس ایمیل گیرنده نامعتبر است" };
 }
 if (!params.subject ||!params.html) {
 return { success: false, error: "موضوع و محتوای ایمیل الزامی است" };
 }

 const record = await db.emailQueue.create({
 data: {
 tenantId: params.tenantId || null,
 to: params.to,
 subject: params.subject,
 html: params.html,
 status: "PENDING",
 attempts: 0,
 maxAttempts: params.maxAttempts?? 3,
 scheduledAt: params.scheduledAt?? new Date(),
 },
 });

 return { success: true, id: record.id };
 } catch (error) {
 const message = error instanceof Error? error.message: "خطای ناشناخته";
 console.error("queueEmail error:", message);
 return { success: false, error: message };
 }
}

export interface ProcessQueueResult {
 processed: number;
 sent: number;
 failed: number;
 retried: number;
 details: Array<{ id: string; status: string; error?: string }>;
}

/**
 * پردازش صف ایمیل — حداکثر ۵۰ ایمیل در حالت PENDING یا RETRYING را ارسال می‌کند.
 * در صورت شکست، attempts را افزایش می‌دهد؛ اگر به maxAttempts برسد FAILED می‌شود.
 * در غیر این صورت وضعیت RETRYING با ثبت lastError.
 */
export async function processEmailQueue(limit = 50): Promise<ProcessQueueResult> {
 const result: ProcessQueueResult = {
 processed: 0,
 sent: 0,
 failed: 0,
 retried: 0,
 details: [],
 };

 try {
 // دریافت نامه‌های PENDING یا RETRYING که زمانشان رسیده
 const now = new Date();
 const pending = await db.emailQueue.findMany({
 where: {
 status: { in: ["PENDING", "RETRYING"] },
 scheduledAt: { lte: now },
 },
 orderBy: { scheduledAt: "asc" },
 take: Math.min(Math.max(limit, 1), 50),
 });

 for (const item of pending) {
 result.processed += 1;
 const sendResult = await sendEmail({
 to: item.to,
 subject: item.subject,
 html: item.html,
 });

 if (sendResult.success) {
 await db.emailQueue.update({
 where: { id: item.id },
 data: {
 status: "SENT",
 sentAt: new Date(),
 attempts: item.attempts + 1,
 lastError: null,
 },
 });
 result.sent += 1;
 result.details.push({ id: item.id, status: "SENT" });
 } else {
 const attempts = item.attempts + 1;
 const errorMessage = sendResult.error?? "خطای ناشناخته در ارسال";
 if (attempts >= item.maxAttempts) {
 await db.emailQueue.update({
 where: { id: item.id },
 data: {
 status: "FAILED",
 attempts,
 lastError: errorMessage,
 },
 });
 result.failed += 1;
 result.details.push({ id: item.id, status: "FAILED", error: errorMessage });
 } else {
 // Exponential backoff: 2^attempts دقیقه
 const backoffMs = Math.pow(2, attempts) * 60 * 1000;
 await db.emailQueue.update({
 where: { id: item.id },
 data: {
 status: "RETRYING",
 attempts,
 lastError: errorMessage,
 scheduledAt: new Date(Date.now() + backoffMs),
 },
 });
 result.retried += 1;
 result.details.push({ id: item.id, status: "RETRYING", error: errorMessage });
 }
 }
 }

 return result;
 } catch (error) {
 const message = error instanceof Error? error.message: "خطای ناشناخته";
 console.error("processEmailQueue error:", message);
 return {...result, processed: result.processed };
 }
}
