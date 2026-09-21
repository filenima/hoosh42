import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { verifyToken } from '@/lib/platform-auth';


export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
 try {
 // ─── PRODUCTION GUARD: در محیط production این اندپوینت به‌کلی غیرفعال است ───
 // سورس‌کد محصول تجاری است — فقط برای dev/testing در دسترس است.
 if (process.env.NODE_ENV === "production" && process.env.ENABLE_SOURCE_DOWNLOAD!== "1") {
 return NextResponse.json(
 { success: false, error: "این قابلیت در محیط production غیرفعال است" },
 { status: 404 }
 );
 }

 // ─── SECURITY FIX: فقط سوپرادمین اجازه دانلود سورس را دارد ───
 // قبلاً هر کاربر احراز هویت‌شده (tenant user) می‌توانست کل سورس اپ را
 // دانلود کند — نشت شدید IP برای محصول تجاری.
 let authorized = false;
 const authHeader = req.headers.get('authorization');
 if (authHeader?.startsWith('Bearer ')) {
 const token = authHeader.substring(7);
 const payload = verifyToken(token);
 if (payload?.type === 'superadmin') authorized = true;
 }
 if (!authorized) {
 return NextResponse.json(
 { success: false, error: 'دسترسی فقط برای مدیر پلتفرم مجاز است' },
 { status: 403 }
 );
 }

 const filePath = path.join(process.cwd(), 'download', 'hoshhesab-source-final.zip');

 if (!existsSync(filePath)) {
 return NextResponse.json(
 { error: 'فایل ZIP یافت نشد. لطفاً دوباره تلاش کنید.' },
 { status: 404 }
 );
 }

 const fileBuffer = await readFile(filePath);

 return new NextResponse(fileBuffer, {
 status: 200,
 headers: {
 'Content-Type': 'application/zip',
 'Content-Disposition': 'attachment; filename="hoshhesab-source-final.zip"',
 'Content-Length': fileBuffer.byteLength.toString(),
 'Cache-Control': 'no-store, no-cache, must-revalidate',
 },
 });
 } catch (error) {
 console.error('Download error:', error);
 return NextResponse.json(
 { error: 'خطا در دانلود فایل' },
 { status: 500 }
 );
 }
}
