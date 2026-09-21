import { AppShell } from "@/components/app-shell";
import { SeoHero } from "@/components/seo/seo-hero";
import { SeoHeroGate } from "@/components/seo/seo-hero-gate";
import { JsonLd } from "@/components/seo/structured-data";
import { generateFaqSchema, DEFAULT_FAQ_SCHEMA } from "@/lib/seo";

/**
 * صفحه‌ی اصلی هوش
 * =====================
 * ساختار سئو-محور:
 * 1. JSON-LD پرسش‌های متداول (فقط همین صفحه — در layout تزریق نمی‌شود)
 * 2. SeoHero — محتوای بازاریابی سرور-رندرشده (H1 + متن + لینک داخلی)
 * که پس از mount شدن لندینگ کلاینت، از دید کاربر پنهان می‌شود.
 * 3. AppShell — اپلیکیشن کامل (کامپوننت کلاینت، مستقیم رندر می‌شود؛
 * ماژول‌های سنگین داخلی آن lazy هستند).
 */
export default function Home() {
 return (
 <>
 <JsonLd data={generateFaqSchema(DEFAULT_FAQ_SCHEMA)} />
 <SeoHeroGate>
 <SeoHero />
 </SeoHeroGate>
 <AppShell />
 </>
 );
}
