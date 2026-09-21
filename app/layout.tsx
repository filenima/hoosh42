import type { Metadata, Viewport } from "next";
import { Vazirmatn, JetBrainsMono } from "@/lib/fonts";
import "./globals.css";
import { AppProviders } from "@/components/app-providers";
import { StructuredData } from "@/components/seo/structured-data";
import { DEFAULT_BRANDING, getBrandingSettings } from "@/lib/system-settings";

// ============ Metadata ============
// متادیتای داینامیک — نام برند و دامنه از تنظیمات برندینگ (پنل سوپرادمین)
// خوانده می‌شود؛ در نبود تنظیمات، پیش‌فرض «هوش» / hoosh.nobatime.ir برمی‌گردد.
const SITE_DESCRIPTION =
 "نرم‌افزار حسابداری ابری هوشمند — جامع‌ترین سیستم حسابداری ایرانی با اتصال به سامانه مودیان، انبار، فروش، حقوق دستمزد و هوش مصنوعی";
// تصویر OG ایستا (PNG 1200×630) — شبکه‌های اجتماعی SVG را پشتیبانی نمی‌کنند.
// نسخه داینامیک با متن اختصاصی هر صفحه: /api/og (خروجی PNG)
const OG_IMAGE = "/og-image.png";

export async function generateMetadata(): Promise<Metadata> {
 let appName = DEFAULT_BRANDING.appName;
 let domain = DEFAULT_BRANDING.domain;
 try {
 const branding = await getBrandingSettings();
 appName = branding.appName;
 domain = branding.domain;
 } catch {
 // fallback به پیش‌فرض «هوش»
 }
 const siteUrl = `https://${domain}`;
 const siteTitle = `${appName} | نرم‌افزار حسابداری هوشمند`;
 return {
 metadataBase: new URL(siteUrl),
 title: { default: siteTitle, template: `%s | ${appName}` },
 description: SITE_DESCRIPTION,
 applicationName: appName,
 keywords: [
 "نرم افزار حسابداری",
 "حسابداری ابری",
 "سامانه مودیان",
 "صورتحساب الکترونیکی",
 appName,
 "OCR فاکتور",
 "حقوق و دستمزد",
 "ارزش افزوده",
 "حسابداری ایرانی",
 "نرم افزار مالیاتی",
 "مدیریت انبار",
 "فاکتور فروش",
 "باشگاه مشتریان",
 "CRM حسابداری",
 ],
 authors: [{ name: appName, url: siteUrl }],
 creator: appName,
 publisher: appName,
 manifest: "/manifest.webmanifest",
 appleWebApp: { capable: true, title: appName, statusBarStyle: "default" },
 icons: {
 icon: [
 { url: "/icon-32.svg", sizes: "32x32", type: "image/svg+xml" },
 { url: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
 { url: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
 { url: "/logo.svg", sizes: "any", type: "image/svg+xml" },
 ],
 // iOS Safari از SVG برای apple-touch-icon پشتیبانی نمی‌کند — PNG الزامی است
 apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
 shortcut: ["/icon-192.svg"],
 },
 alternates: {
 canonical: "/",
 types: { "application/rss+xml": [{ url: "/rss.xml", title: `بلاگ ${appName}` }] },
 // نکته سئو: سایت تک‌زبانه است — hreflang (alternates.languages) لازم نیست
 // و باعث تولید لینک‌های تکراری در همه صفحات می‌شد؛ حذف شد.
 },
 openGraph: {
 type: "website",
 locale: "fa_IR",
 alternateLocale: ["en_US"],
 url: siteUrl,
 siteName: appName,
 title: siteTitle,
 description: SITE_DESCRIPTION,
 images: [
 {
 url: OG_IMAGE,
 width: 1200,
 height: 630,
 alt: `${appName} — نرم‌افزار حسابداری هوشمند ایرانی`,
 type: "image/png",
 },
 ],
 },
 twitter: {
 card: "summary_large_image",
 title: siteTitle,
 description: SITE_DESCRIPTION,
 images: [OG_IMAGE],
 creator: "@hoosh",
 },
 robots: {
 index: true,
 follow: true,
 nocache: false,
 googleBot: {
 index: true,
 follow: true,
 "max-image-preview": "large",
 "max-snippet": -1,
 "max-video-preview": -1,
 },
 },
 category: "business",
 formatDetection: {
 telephone: false,
 address: false,
 email: false,
 },
 };
}

export const viewport: Viewport = {
 themeColor: [
 { media: "(prefers-color-scheme: light)", color: "#ffffff" },
 { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
 ],
 width: "device-width",
 initialScale: 1,
 maximumScale: 5,
 colorScheme: "light dark",
};

// ============ Root Layout ============
// نکته سئو: لینک‌های hreflang دستی حذف شدند — سایت تک‌زبانه (fa) است و
// تکرار hreflang در تمام صفحات سیگنال منفی داشت.

export default function RootLayout({ children }: { children: React.ReactNode }) {
 return (
 <html lang="fa" dir="rtl" suppressHydrationWarning className="scroll-smooth">
 <head>
 {/* preconnect برای فونت‌ها و منابع خارجی */}
 <link rel="preconnect" href="https://fonts.googleapis.com" />
 <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
 {/*
  * Anti-Flash برای محتوای SEO سرور-رندرشده (SeoHero):
  * این اسکریپت قبل از رندر body اجرا می‌شود و کلاس js-enabled را به <html>
  * اضافه می‌کند؛ CSS مربوطه (#seo-hero gate) بلافاصله محتوای متنی سئو را
  * برای کاربران JS-دار می‌پوشاند تا «متن خام» قبل از mount شدن اپ دیده نشود.
  * اگر ظرف ۱۵ ثانیه محتوای کلاینت mount نشود (خطای JS)، کلاس حذف می‌شود
  * و محتوای سروری به‌عنوان fallback نمایش داده می‌شود.
  */}
 <script
 dangerouslySetInnerHTML={{
 __html: `(function(){try{var d=document.documentElement;d.classList.add('js-enabled');setTimeout(function(){if(!document.querySelector("section#hero, aside[data-tour='sidebar']")){d.classList.remove('js-enabled');}},15000);}catch(e){})();`,
 }}
 />
 {/*
  * ACCENT (درخواست مالک): رنگ تم انتخابی کاربر قبل از اولین رندر اعمال
  * می‌شود تا بدون فلشِ رنگ (FOUC) پنل با رنگ درست بالا بیاید.
  * جزئیات: lib/accent-colors.ts — نگاشت رنگ‌ها با همان ماژول هم‌گام است.
  */}
 <script
 dangerouslySetInnerHTML={{
 __html: `(function(){try{var r=window.localStorage.getItem('hoosh_accent');if(!r)return;var id=(JSON.parse(r)||{}).id;if(!id)return;var M={indigo:['#4f46e5','#818cf8','#ffffff','#0a0a0b'],emerald:['#059669','#34d399','#ffffff','#052e1f'],teal:['#0d9488','#2dd4bf','#ffffff','#04302b'],rose:['#e11d48','#fb7185','#ffffff','#3f0a17'],amber:['#d97706','#fbbf24','#ffffff','#3b2304'],orange:['#ea580c','#fb923c','#ffffff','#3a1804'],violet:['#7c3aed','#a78bfa','#ffffff','#1e1145'],slate:['#475569','#94a3b8','#ffffff','#101826']};var c=M[id];if(!c)return;var d=document.documentElement;var dark=d.classList.contains('dark')||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);d.style.setProperty('--primary',dark?c[1]:c[0]);d.style.setProperty('--primary-foreground',dark?c[3]:c[2]);d.style.setProperty('--ring',dark?c[1]:c[0]);d.setAttribute('data-accent',id);}catch(e){}})();`,
 }}
 />
 </head>
 <body className={`${Vazirmatn.variable} ${JetBrainsMono.variable} font-sans antialiased`}>
 <AppProviders>{children}</AppProviders>
 {/* JSON-LD Structured Data — سراسری */}
 <StructuredData />
 {/* Global ChunkLoadError auto-recovery — هنگام stale cache، یک‌بار خودکار reload می‌کند */}
 <script
 dangerouslySetInnerHTML={{
 __html: `(function(){
 try {
 var KEY = 'hoshhesab_chunk_reload';
 var MAX = 2; // حداکثر دفعات reload خودکار برای جلوگیری از loop
 function isChunkErr(msg){
 if(!msg) return false;
 var m = String(msg);
 return m.indexOf('ChunkLoadError') >= 0
 || m.indexOf('Failed to load chunk') >= 0
 || m.indexOf('Loading chunk') >= 0
 || m.indexOf('Loading CSS chunk') >= 0;
 }
 function count(){
 try { return parseInt(sessionStorage.getItem(KEY) || '0', 10) || 0; } catch(e){ return 0; }
 }
 function bump(){
 try { sessionStorage.setItem(KEY, String(count()+1)); } catch(e){}
 }
 function clearCount(){
 try { sessionStorage.removeItem(KEY); } catch(e){}
 }
 // پس از ۵ ثانیه موفقیت، شمارنده ریست می‌شود
 setTimeout(clearCount, 5000);
 window.addEventListener('error', function(e){
 if(isChunkErr(e.message) || isChunkErr(e.error && e.error.message)){
 if(count() < MAX){
 bump();
 setTimeout(function(){ window.location.reload(); }, 300);
 }
 }
 });
 window.addEventListener('unhandledrejection', function(e){
 var r = e && e.reason;
 var msg = (r && (r.message || r.toString && r.toString())) || '';
 if(isChunkErr(msg)){
 if(count() < MAX){
 bump();
 setTimeout(function(){ window.location.reload(); }, 300);
 }
 }
 });
 } catch(_) {}
 })();`,
 }}
 />
 </body>
 </html>
 );
}
