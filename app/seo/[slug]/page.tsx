import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { seoPages, getSeoPageBySlug, getAllSeoPageSlugs } from "@/lib/seo-pages-data";
import { generateBreadcrumbSchema, generateFaqSchema, SITE_URL, type FaqItem } from "@/lib/seo";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { ArrowRight, ChevronLeft, Sparkles, FileText } from "lucide-react";

export function generateStaticParams() {
 return getAllSeoPageSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
 const { slug } = await params;
 const page = getSeoPageBySlug(slug);
 if (!page) return { title: "صفحه یافت نشد", description: "صفحه موردنظر پیدا نشد." };
 const url = `${SITE_URL}/seo/${page.slug}`;
 const ogImage = `${SITE_URL}/api/og?title=${encodeURIComponent(page.title)}&type=seo`;
 return {
 title: page.title, description: page.description,
 keywords: page.keywords,
 alternates: { canonical: url },
 openGraph: { title: page.title, description: page.description, url, type: "website", locale: "fa_IR", siteName: "هوش", images: [{ url: ogImage, width: 1200, height: 630, alt: page.title }] },
 twitter: { card: "summary_large_image", title: page.title, description: page.description, images: [ogImage] },
 robots: { index: true, follow: true },
 };
}

export default async function SeoPage({ params }: { params: Promise<{ slug: string }> }) {
 const { slug } = await params;
 const page = getSeoPageBySlug(slug);
 if (!page) notFound();

 const pageUrl = `${SITE_URL}/seo/${page.slug}`;
 const breadcrumbSchema = generateBreadcrumbSchema([{ name: "خانه", url: SITE_URL }, { name: "صفحات تخصصی", url: `${SITE_URL}/seo` }, { name: page.h1, url: pageUrl }]);
 const faqSchema = generateFaqSchema(page.faqs.map((f): FaqItem => ({ question: f.question, answer: f.answer })));

 return (
 <div className="flex min-h-screen flex-col bg-background" dir="rtl">
 <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-xl">
 <div className="mx-auto flex h-16 w-full max-w-4xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
 <Link href="/seo" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground" prefetch={false}><ArrowRight className="h-4 w-4" /> صفحات تخصصی</Link>
 <Link href="/" className="inline-flex items-center gap-2" prefetch={false}>
 <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Sparkles className="h-3.5 w-3.5" /></span>
 <span className="text-sm font-bold">هوش</span>
 </Link>
 </div>
 </header>
 <main className="flex-1">
 <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
 <nav aria-label="مسیر" className="mb-6 flex items-center gap-1 text-xs text-muted-foreground">
 <Link href="/" prefetch={false} className="transition-colors hover:text-foreground">خانه</Link>
 <ChevronLeft className="h-3 w-3" />
 <Link href="/seo" prefetch={false} className="transition-colors hover:text-foreground">صفحات تخصصی</Link>
 <ChevronLeft className="h-3 w-3" />
 <span className="text-foreground">{page.h1}</span>
 </nav>
 <div className="mb-8">
 <div className="mb-4 flex items-center gap-3">
 <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400"><FileText className="h-6 w-6" /></div>
 </div>
 <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl">{page.h1}</h1>
 <p className="mt-3 text-base leading-relaxed text-muted-foreground sm:text-lg">{page.description}</p>
 </div>

 <Card className="mb-8">
 <CardContent className="pt-6">
 <p className="text-sm leading-relaxed text-foreground">{page.content}</p>
 </CardContent>
 </Card>

 {page.faqs.length > 0 && (
 <Card className="mb-8">
 <CardHeader><CardTitle className="text-base font-bold">سوالات متداول</CardTitle></CardHeader>
 <CardContent>
 <Accordion type="single" collapsible className="w-full">
 {page.faqs.map((faq, idx) => (
 <AccordionItem key={idx} value={`faq-${idx}`}>
 <AccordionTrigger className="text-right text-sm font-medium leading-relaxed sm:text-base">{faq.question}</AccordionTrigger>
 <AccordionContent className="text-sm leading-relaxed text-muted-foreground sm:text-base">{faq.answer}</AccordionContent>
 </AccordionItem>
 ))}
 </Accordion>
 </CardContent>
 </Card>
 )}

 {page.relatedPages.length > 0 && (
 <div className="mt-8 border-t border-border pt-8">
 <h2 className="text-lg font-bold text-foreground">صفحات مرتبط</h2>
 <div className="mt-4 flex flex-wrap gap-2">
 {page.relatedPages.map((rp) => (
 <Link key={rp.href} href={rp.href} prefetch={false} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-all hover:border-primary/30 hover:bg-primary/5">
 <FileText className="h-3.5 w-3.5 text-primary" />{rp.title}
 </Link>
 ))}
 </div>
 </div>
 )}
 </div>
 </main>
 <footer className="mt-auto border-t border-border bg-card">
 <div className="mx-auto flex w-full max-w-4xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
 <p>هوش — تمامی حقوق محفوظ است.</p>
 <Link href="/" prefetch={false} className="font-medium text-primary transition-colors hover:text-primary/80">صفحه اصلی</Link>
 </div>
 </footer>
 <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
 <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
 </div>
 );
}
