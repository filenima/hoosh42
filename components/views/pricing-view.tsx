"use client";

import * as React from "react";
import {
 CheckCircle2,
 XCircle,
 ShieldCheck,
 CreditCard,
 Unlock,
 Sparkles,
 HelpCircle,
 Loader2,
 AlertTriangle,
 ExternalLink,
 Mail,
 User,
 Building2,
 Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from "@/components/ui/dialog";
import {
 Accordion,
 AccordionContent,
 AccordionItem,
 AccordionTrigger,
} from "@/components/ui/accordion";
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from "@/components/ui/table";
import { pricingPlanFromPlan } from "@/lib/accounting-data";
// FIX(9-a — ویرایش قیمت پلن‌ها): نوع Plan از plans.ts (مقدار مؤثر از API می‌آید)
import type { Plan, PlanId } from "@/lib/plans";
import { formatNumber, toPersianDigits } from "@/lib/persian";
import { authFetch } from "@/lib/auth-fetch";
// FIX(9-a): پلن‌های مؤثر از /api/plans — fallback استاتیک داخل خود هوک
import { useEffectivePlans } from "@/hooks/use-effective-plans";
import { MarketingHeader, MarketingFooter, type ViewType } from "./_marketing-shell";

interface PricingViewProps {
 onBack: () => void;
 onNavigate: (v: ViewType) => void;
 onOpenAuth: () => void;
 /** FIX(v10-checkout): پلن پیش‌فرض برای باز شدن مستقیم چک‌اوت (از لینک ?buy= در صفحه سئو) */
 presetPlanId?: PlanId | null;
 /** بعد از مصرف presetPlanId صدا زده می‌شود تا state تمیز بماند */
 onPresetConsumed?: () => void;
}

/* داده‌های جدول مقایسه — سطر = قابلیت، ستون = پلن
 ستون‌ها به‌ترتیب: پایه، حرفه‌ای، سازمانی (پلن رایگان از نمایش حذف شده است) */
const COMPARISON_ROWS: { label: string; values: (string | boolean)[] }[] = [
 { label: "تعداد کاربران", values: ["۲", "۴", "نامحدود"] },
 { label: "تعداد انبار", values: ["۴", "۶", "نامحدود"] },
 { label: "فاکتور سالانه", values: ["۲,۴۰۰", "۱۵,۰۰۰", "نامحدود"] },
 { label: "اتصال به سامانه مودیان", values: [true, true, true] },
 { label: "هسته حسابداری + انبار", values: [true, true, true] },
 { label: "خرید و فروش + طرف‌حساب", values: [true, true, true] },
 { label: "خزانه‌داری و چک صیادی", values: [true, true, true] },
 { label: "ارز و نرخ لحظه‌ای طلا و دلار", values: [true, true, true] },
 { label: "ارزش افزوده و مالیات", values: [false, true, true] },
 { label: "حقوق و دستمزد", values: [false, true, true] },
 { label: "CRM و باشگاه مشتریان", values: [true, true, true] },
 { label: "هوش مصنوعی (OCR + چت‌بات)", values: [false, true, true] },
 { label: "هوش مصنوعی پیشرفته (ML + تقلب)", values: [false, false, true] },
 { label: "همگام‌سازی قیمت با نرخ بازار", values: [false, true, true] },
 { label: "اتصال ووکامرس / دیجی‌کالا / باسلام", values: [false, false, true] },
 { label: "اپ موبایل iOS و Android", values: [true, true, true] },
 { label: "مدیریت تولیدی (BOM و حکم تولید)", values: [false, true, true] },
 { label: "مدیریت پیمانکاری و صورت‌وضعیت", values: [false, false, true] },
 { label: "API کامل + GraphQL + Webhook", values: [false, true, true] },
 { label: "چند شرکتی (Multi-company)", values: [false, false, true] },
 { label: "SSO و Audit پیشرفته", values: [false, false, true] },
 { label: "گزارش‌ساز و داشبورد مقایسه‌ای", values: [false, true, true] },
 { label: "پشتیبانی", values: ["ایمیلی", "اولویت‌دار", "اختصاصی ۲۴/۷"] },
];

/* فهرست پلن‌های قابل نمایش در صفحه قیمت‌گذاری — پلن رایگان حذف شده است.
FIX(9-a): از پلن‌های مؤثر (/api/plans) ساخته می‌شود تا ویرایش قیمت/ویژگی
سوپرادمین بدون deploy اعمال شود؛ در صورت خطا fallback استاتیک است. */

const FAQS = [
 {
 q: "آیا آزمایش رایگان دارید؟",
 a: "بله، تمام پلن‌ها به‌جز سازمانی شامل ۱۴ روز آزمایش رایگان با تمام امکانات بدون نیاز به کارت بانکی هستند. در پایان دوره می‌توانید پلن خود را انتخاب کنید یا حساب را غیرفعال کنید.",
 },
 {
 q: "آیا هزینه ارتقا وجود دارد؟",
 a: "خیر. ارتقا هر زمان که بخواهید از پلن فعلی به پلن بالاتر انجام می‌شود و فقط مابه‌التفاوت به‌صورت روزشمار محاسبه می‌گردد. هیچ هزینه مجزا یا جریمه‌ای برای ارتقا وجود ندارد.",
 },
 {
 q: "روش پرداخت چگونه است؟",
 a: "پرداخت به‌صورت سالانه از طریق درگاه بانکی آنلاین (زرین‌پال/شاپرک) انجام می‌شود. همچنین برای سازمان‌ها امکان صدور فاکتور رسمی و پرداخت به‌صورت انتقال بانکی وجود دارد.",
 },
 {
 q: "آیا تخفیف سالانه دارید؟",
 a: "بله. در صورت پرداخت سالانه، معادل دو ماه (حدود ۱۷٪) تخفیف اعمال می‌شود. به‌علاوه، سازمان‌های دارای بیش از ۵۰ کاربر از تخفیف حجمی نیز بهره‌مند می‌شوند.",
 },
 {
 q: "پشتیبانی چگونه ارائه می‌شود؟",
 a: "پلن استارتر: پشتیبانی ایمیلی (پاسخ زیر ۲۴ ساعت). پلن کسب‌وکار: پشتیبانی تلفنی و چت در ساعات اداری. پلن سازمانی: پشتیبانی اختصاصی ۲۴/۷ با مدیر حساب اختصاصی. پلن حسابداران: پشتیبانی اولویت‌دار.",
 },
 {
 q: "آیا انتقال از نرم‌افزار دیگر امکان‌پذیر است؟",
 a: "بله. تیم ما انتقال داده‌ها از هلو، سپیدار، پارسیان و سایر نرم‌افزارها را به‌صورت رایگان برای پلن‌های کسب‌وکار و بالاتر انجام می‌دهد. اطلاعات شما شامل طرف‌حساب‌ها، کالاها، موجودی انبار و اسناد مالی به‌صورت ساختاریافته منتقل می‌شود.",
 },
];

const TRUST_BADGES = [
 { icon: CreditCard, title: "پرداخت امن", desc: "درگاه شاپرک و رمزنگاری SSL" },
 { icon: Unlock, title: "بدون قرارداد", desc: "هر زمان لغو کنید" },
 { icon: ShieldCheck, title: "لغو در هر زمان", desc: "بدون هزینه پنهان" },
];

export function PricingView({ onBack, onNavigate, onOpenAuth, presetPlanId, onPresetConsumed }: PricingViewProps) {
 const [checkoutPlanId, setCheckoutPlanId] = React.useState<PlanId | null>(null);

 // FIX(9-a — ویرایش قیمت پلن‌ها): پلن‌های مؤثر از /api/plans —
 // fallback استاتیک PLANS در هوک (قیمت/ویژگی ویرایش‌شده سوپرادمین)
 const { plans: effectivePlans, getEffectiveById } = useEffectivePlans();

 const displayPlans = React.useMemo(
 () =>
 effectivePlans
 .filter((p) => p.id !== "free" && !p.hidden)
 .map(pricingPlanFromPlan),
 [effectivePlans]
 );

 // FIX(v10-checkout): اگر از صفحه سئو با ?buy=<plan> آمده، مستقیم چک‌اوت باز شود
 React.useEffect(() => {
 // FIX(ENT-1): پلن سازمانی هم آنلاین قابل خرید است (درخواست مالک) — «شروع کنید»
 if (presetPlanId && presetPlanId!== "free") {
 setCheckoutPlanId(presetPlanId);
 onPresetConsumed?.();
 }
 }, [presetPlanId, onPresetConsumed]);

 const onSelectPlan = (planId: string) => {
 if (planId === "free") {
 // پلن رایگان ساخت حساب تریال (در auth flow)
 onOpenAuth();
 return;
 }
 // FIX(ENT-1): پلن سازمانی هم قابل خرید آنلاین است — «شروع کنید» + چک‌اوت.
 // (لینک «تماس با فروش» به‌عنوان گزینه دوم زیر دکمه باقی مانده)
 setCheckoutPlanId(planId as PlanId);
 };

 return (
 <div className="flex min-h-screen flex-col bg-background">
 <MarketingHeader active="pricing" onBack={onBack} onNavigate={onNavigate} onOpenAuth={onOpenAuth} />

 <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pb-24 flex-1">
 {/* Hero */}
 <section className="py-16 sm:py-20 text-center">
 <Badge variant="secondary" className="bg-primary/10 text-primary mb-4">
 <Sparkles className="h-3 w-3 ml-1" />
 قیمت‌گذاری شفاف
 </Badge>
 <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-foreground">
 قیمت‌گذاری شفاف هوش
 </h1>
 <p className="mt-4 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
 هزینه ورود پایین، بدون هزینه پنهان — پلنی متناسب با هر اندازه کسب‌وکار
 </p>
 </section>

 {/* Trust badges */}
 <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
 {TRUST_BADGES.map((b) => {
 const Icon = b.icon;
 return (
 <Card key={b.title} className="p-4 flex items-center gap-3 card-hover">
 <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
 <Icon className="h-5 w-5" />
 </div>
 <div className="min-w-0">
 <p className="text-sm font-semibold text-foreground leading-tight">{b.title}</p>
 <p className="text-xs text-muted-foreground leading-tight mt-0.5">{b.desc}</p>
 </div>
 </Card>
 );
 })}
 </section>

 {/* Plans grid */}
 <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
 {displayPlans.map((plan) => {
 const popular = plan.popular;
 return (
 <Card
 key={plan.id}
 className={`relative flex flex-col p-6 card-hover rounded-xl border-border/50 backdrop-blur-sm bg-card/80 transition-all duration-200 hover:border-primary/30 hover:shadow-lg ${
 popular? "border-primary ring-2 ring-primary/20 shadow-lg shadow-primary/10": ""
 }`}
 >
 {popular && (
 <Badge className="absolute -top-3 right-6 bg-primary text-primary-foreground">
 محبوب‌ترین
 </Badge>
 )}
 <div className="mb-4">
 <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
 <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{plan.target}</p>
 </div>
 <div className="mb-5 pb-5 border-b border-border">
 <div className="flex items-baseline gap-1.5">
 <span className="text-3xl font-bold text-foreground tracking-tight">
 {plan.id === "free"? "رایگان": formatNumber(plan.price)}
 </span>
 <span className="text-sm text-muted-foreground">
 {plan.id === "free"? "۱۴ روز": "تومان"}
 </span>
 </div>
 <p className="text-xs text-muted-foreground mt-1">
 {plan.id === "free"
? "آزمایش ۱۴ روزه — بدون کارت بانکی"
: "سالانه — پرداخت یک‌بار"}
 </p>
 </div>

 <ul className="space-y-2.5 mb-6 flex-1">
 {plan.features.map((f) => (
 <li key={f} className="flex items-start gap-2 text-sm">
 <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
 <span className="text-foreground leading-relaxed">{f}</span>
 </li>
 ))}
 {plan.notIncluded.map((f) => (
 <li key={f} className="flex items-start gap-2 text-sm">
 <XCircle className="h-4 w-4 text-muted-foreground/60 shrink-0 mt-0.5" />
 <span className="text-muted-foreground/80 line-through leading-relaxed">{f}</span>
 </li>
 ))}
 </ul>

 <Button
 className="w-full"
 variant={popular? "default": "outline"}
 onClick={() => onSelectPlan(plan.id)}
 >
 {plan.id === "free"
? "شروع آزمایش ۱۴ روزه"
: plan.id === "enterprise" || plan.popular
? "شروع کنید"
: "انتخاب پلن"}
 </Button>
 {plan.id === "enterprise" && (
 <button
 type="button"
 onClick={() => onNavigate("support")}
 className="mt-1 w-full text-center text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
 >
 یا تماس با فروش برای مشاوره سازمانی
 </button>
 )}
 </Card>
 );
 })}
 </section>

 {/* Comparison table */}
 <section className="mt-20">
 <div className="text-center mb-8">
 <h2 className="text-2xl sm:text-3xl font-bold text-foreground">مقایسه کامل پلن‌ها</h2>
 <p className="text-sm text-muted-foreground mt-2">
 جدول کامل قابلیت‌ها برای انتخاب آگاهانه
 </p>
 </div>
 <Card className="overflow-hidden">
 <Table className="table-zebra">
 <TableHeader>
 <TableRow className="bg-muted/40">
 <TableHead className="w-1/3 font-semibold text-foreground">قابلیت</TableHead>
 {displayPlans.map((p) => (
 <TableHead key={p.id} className="text-center font-semibold text-foreground">
 {p.name}
 {p.popular && (
 <Badge className="mr-1 bg-primary/10 text-primary text-[10px] px-1 py-0 h-4">
 محبوب
 </Badge>
 )}
 </TableHead>
 ))}
 </TableRow>
 </TableHeader>
 <TableBody>
 {COMPARISON_ROWS.map((row, idx) => (
 <TableRow key={idx}>
 <TableCell className="font-medium text-foreground text-sm">{row.label}</TableCell>
 {row.values.map((v, i) => (
 <TableCell key={i} className="text-center text-sm">
 {typeof v === "boolean"? (
 v? (
 <CheckCircle2 className="h-4 w-4 text-primary mx-auto" />
 ): (
 <span className="text-muted-foreground/40">—</span>
 )
 ): (
 <span className="text-foreground">{toPersianDigits(v)}</span>
 )}
 </TableCell>
 ))}
 </TableRow>
 ))}
 </TableBody>
 </Table>
 </Card>
 </section>

 {/* FAQ */}
 <section className="mt-20 max-w-3xl mx-auto">
 <div className="text-center mb-8">
 <Badge variant="secondary" className="mb-3">
 <HelpCircle className="h-3 w-3 ml-1" />
 سوالات متداول
 </Badge>
 <h2 className="text-2xl sm:text-3xl font-bold text-foreground">پرسش‌های شما، پاسخ ما</h2>
 </div>
 <Card className="p-2">
 <Accordion type="single" collapsible defaultValue="faq-0">
 {FAQS.map((faq, i) => (
 <AccordionItem key={i} value={`faq-${i}`}>
 <AccordionTrigger className="px-4 text-right font-medium text-foreground">
 {faq.q}
 </AccordionTrigger>
 <AccordionContent className="px-4 text-muted-foreground leading-relaxed">
 {faq.a}
 </AccordionContent>
 </AccordionItem>
 ))}
 </Accordion>
 </Card>
 </section>

 {/* Final CTA */}
 <section className="mt-20">
 <Card className="p-8 sm:p-12 bg-primary text-primary-foreground text-center">
 <h2 className="text-2xl sm:text-3xl font-bold">آماده شروع هستید؟</h2>
 <p className="mt-3 text-primary-foreground/80 max-w-xl mx-auto">
 همین امروز به +۱۰٬۰۰۰ کسب‌وکار ایرانی بپیوندید. ۱۴ روز رایگان، بدون کارت بانکی.
 </p>
 <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
 <Button
 size="lg"
 variant="secondary"
 className="bg-background text-foreground hover:bg-background/90"
 onClick={onOpenAuth}
 >
 شروع آزمایش ۱۴ روزه
 </Button>
 <Button
 size="lg"
 variant="outline"
 className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
 onClick={() => onNavigate("support")}
 >
 تماس با فروش
 </Button>
 </div>
 </Card>
 </section>
 </main>

 <MarketingFooter onNavigate={onNavigate} />

 {/* مودال پرداخت — checkout */}
 <CheckoutModal
 planId={checkoutPlanId}
 getPlanById={getEffectiveById}
 onClose={() => setCheckoutPlanId(null)}
 onSuccess={(gatewayUrl) => {
 // redirect به درگاه زرین‌پال
 if (typeof window!== "undefined") {
 window.location.href = gatewayUrl;
 }
 }}
 />
 </div>
 );
}

/* ============ Checkout Modal — پرداخت آنلاین از طریق زرین‌پال ============ */
interface CheckoutModalProps {
 planId: PlanId | null;
 /** FIX(9-a): پلن مؤثر (قیمت ویرایش‌شده) — از هوک والد پاس داده می‌شود */
 getPlanById: (id: string) => Plan | undefined;
 onClose: () => void;
 onSuccess: (gatewayUrl: string) => void;
}

function CheckoutModal({ planId, getPlanById, onClose, onSuccess }: CheckoutModalProps) {
 const [loading, setLoading] = React.useState(false);
 const [error, setError] = React.useState<string | null>(null);
 // وضعیت ورود کاربر — اگر توکن در localStorage باشد، یعنی کاربر وارد شده
 const [isLoggedIn, setIsLoggedIn] = React.useState<boolean>(true);
 // فیلدهای کاربر غیر وارد شده
 const [name, setName] = React.useState("");
 const [email, setEmail] = React.useState("");
 const [companyName, setCompanyName] = React.useState("");
 const [phone, setPhone] = React.useState("");
 // FIX(v12.1 — سیستم رفرال): کد دعوت (prefill از لینک ?ref=)
 const [referralCode, setReferralCode] = React.useState("");
 // خطاهای اعتبارسنجی فیلدها
 const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

 const plan = planId? getPlanById(planId): undefined;

 // FIX(v12.1): prefill کد دعوت از localStorage (لینک دعوت دوست)
 React.useEffect(() => {
 if (planId) {
 try {
 const saved = localStorage.getItem("hoshhesab_referral_code");
 if (saved) setReferralCode(saved);
 } catch {
 /* ignore */
 }
 }
 }, [planId]);

 // بررسی وضعیت ورود کاربر هنگام باز شدن مودال
 React.useEffect(() => {
 if (planId) {
 try {
 const token =
 typeof window!== "undefined"
? localStorage.getItem("hoshhesab_user_token")
: null;
 setIsLoggedIn(!!token);
 } catch {
 setIsLoggedIn(false);
 }
 }
 }, [planId]);

 React.useEffect(() => {
 setError(null);
 setFieldErrors({});
 }, [planId]);

 // اعتبارسنجی فیلدها برای کاربر غیر وارد شده
 const validateFields = (): boolean => {
 const errs: Record<string, string> = {};
 const trimmedName = name.trim();
 const trimmedEmail = email.trim();
 const trimmedCompany = companyName.trim();

 if (!trimmedName) errs.name = "نام و نام خانوادگی الزامی است";
 if (!trimmedEmail) {
 errs.email = "ایمیل الزامی است";
 } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
 errs.email = "فرمت ایمیل نامعتبر است";
 }
 if (!trimmedCompany) errs.companyName = "نام سازمان الزامی است";

 setFieldErrors(errs);
 return Object.keys(errs).length === 0;
 };

 const handlePay = async () => {
 if (!plan) return;
 // اگر کاربر وارد نشده، فیلدها را اعتبارسنجی کن
 if (!isLoggedIn) {
 if (!validateFields()) return;
 }

 setLoading(true);
 setError(null);
 try {
 const callbackUrl =
 typeof window!== "undefined"
? `${window.location.origin}/api/integrations/payment/verify`
: "https://hoosh.nobatime.ir/api/integrations/payment/verify";

 // اگر کاربر وارد شده فلو معمولی (API موجود)
 // اگر وارد نشده فلو register-and-pay (API جدید)
 const endpoint = isLoggedIn
? "/api/integrations/payment/create"
: "/api/payment/register-and-pay";

 const payload = isLoggedIn
? {
 planId: plan.id,
 callbackUrl,
 description: `خرید پلن ${plan.name} هوش`,
 }
: {
 planId: plan.id,
 name: name.trim(),
 email: email.trim().toLowerCase(),
 companyName: companyName.trim(),
 phone: phone.trim() || undefined,
 callbackUrl,
 };

 // FIX(v10-checkout): قبلاً fetch خام بدون هدر Authorization بود →
 // /api/integrations/payment/create همیشه 401 «تنانت یافت نشد» می‌داد.
 // حالا authFetch توکن را خودکار از localStorage اضافه می‌کند.
 const res = await authFetch(endpoint, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(payload),
 });
 const data = (await res.json()) as {
 success: boolean;
 gatewayUrl?: string;
 authority?: string;
 error?: string;
 errorCode?: string;
 };

 // FIX(v10-checkout): اگر نشست منقضی شده، کاربر باید وارد شود نه خطای خام
 if (res.status === 401 && isLoggedIn) {
 setError("نشست شما منقضی شده است. لطفاً دوباره وارد شوید و سپس پلن را خریداری کنید.");
 return;
 }

 if (!res.ok ||!data.success ||!data.gatewayUrl) {
 // FIX(v10-checkout): پیام دقیق فارسی بک‌اند (ترجمه کدهای درگاه) اولویت دارد —
 // قبلاً پیام عمومی «خطا در ارتباط با درگاه» جایگزین توضیح واقعی می‌شد
 const friendly =
 data.error && data.errorCode!== "EMAIL_ALREADY_EXISTS"
? data.error
: data.errorCode === "MERCHANT_NOT_CONFIGURED"
? "درگاه پرداخت هنوز توسط مدیر پلتفرم پیکربندی نشده است. لطفاً بعداً تلاش کنید یا با پشتیبانی تماس بگیرید."
: data.errorCode === "ZARINPAL_REQUEST_FAILED"
? "خطا در ارتباط با درگاه زرین‌پال. لطفاً دقایقی بعد تلاش کنید."
: data.errorCode === "EMAIL_ALREADY_EXISTS"
? "این ایمیل قبلاً ثبت شده است. لطفاً وارد شوید و سپس پلن را خریداری کنید."
: data.error || "خطا در ایجاد درخواست پرداخت";
 setError(friendly);
 return;
 }
 onSuccess(data.gatewayUrl);
 } catch (e) {
 console.error(e);
 setError("خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید.");
 } finally {
 setLoading(false);
 }
 };

 if (!plan) return null;

 return (
 <Dialog open={planId!== null} onOpenChange={(open) =>!open && onClose()}>
 <DialogContent className="sm:max-w-md">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2">
 <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
 <CreditCard className="h-4 w-4" />
 </span>
 تکمیل خرید پلن {plan.name}
 </DialogTitle>
 <DialogDescription>
 پرداخت امن از طریق درگاه بانکی زرین‌پال — پرداخت شما با کد رهگیری ثبت می‌شود.
 </DialogDescription>
 </DialogHeader>

 <div className="space-y-4">
 {/* خلاصه سفارش */}
 <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
 <div className="flex items-center justify-between text-sm">
 <span className="text-muted-foreground">پلن انتخابی</span>
 <span className="font-semibold">{plan.name}</span>
 </div>
 <div className="flex items-center justify-between text-sm">
 <span className="text-muted-foreground">دوره</span>
 <span>{plan.period}</span>
 </div>
 <div className="flex items-center justify-between text-sm">
 <span className="text-muted-foreground">تعداد کاربر</span>
 <span>
 {plan.maxUsers === -1? "نامحدود": toPersianDigits(plan.maxUsers)}
 </span>
 </div>
 <div className="flex items-center justify-between text-sm">
 <span className="text-muted-foreground">تعداد انبار</span>
 <span>
 {plan.maxWarehouses === -1? "نامحدود": toPersianDigits(plan.maxWarehouses)}
 </span>
 </div>
 <div className="border-t pt-2 mt-2">
 <div className="flex items-baseline justify-between">
 <span className="text-sm font-medium">مبلغ قابل پرداخت</span>
 <div className="text-left">
 <div className="text-lg font-bold text-primary tnum">
 {formatNumber(plan.priceToman)}
 <span className="text-xs font-normal text-muted-foreground mr-1">تومان</span>
 </div>
 <div className="text-[10px] text-muted-foreground tnum" dir="ltr">
 {formatNumber(plan.priceRial)} IRR
 </div>
 </div>
 </div>
 </div>
 </div>

 {/* فرم اطلاعات کاربر — فقط برای کاربران غیر وارد شده */}
 {!isLoggedIn && (
 <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
 <div className="flex items-center gap-2 text-xs text-primary font-medium">
 <User className="h-3.5 w-3.5" />
 برای خرید پلن، اطلاعات حساب خود را وارد کنید
 </div>
 <p className="text-[11px] text-muted-foreground leading-relaxed -mt-1">
 پس از پرداخت موفق، حساب کاربری شما به‌صورت خودکار ساخته و فعال می‌شود و وارد پنل می‌شوید.
 </p>

 {/* نام و نام خانوادگی */}
 <div className="space-y-1">
 <Label htmlFor="checkout-name" className="text-xs">
 نام و نام خانوادگی
 </Label>
 <div className="relative">
 <User className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
 <Input
 id="checkout-name"
 value={name}
 onChange={(e) => setName(e.target.value)}
 placeholder="مثلاً علی رضایی"
 className="pr-8 text-sm"
 disabled={loading}
 />
 </div>
 {fieldErrors.name && (
 <p className="text-[11px] text-destructive">{fieldErrors.name}</p>
 )}
 </div>

 {/* ایمیل */}
 <div className="space-y-1">
 <Label htmlFor="checkout-email" className="text-xs">
 ایمیل
 </Label>
 <div className="relative">
 <Mail className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
 <Input
 id="checkout-email"
 type="email"
 dir="ltr"
 value={email}
 onChange={(e) => setEmail(e.target.value)}
 placeholder="you@example.com"
 className="pr-8 text-sm"
 disabled={loading}
 />
 </div>
 {fieldErrors.email && (
 <p className="text-[11px] text-destructive">{fieldErrors.email}</p>
 )}
 </div>

 {/* نام سازمان */}
 <div className="space-y-1">
 <Label htmlFor="checkout-company" className="text-xs">
 نام سازمان / شرکت
 </Label>
 <div className="relative">
 <Building2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
 <Input
 id="checkout-company"
 value={companyName}
 onChange={(e) => setCompanyName(e.target.value)}
 placeholder="مثلاً فروشگاه آرمان"
 className="pr-8 text-sm"
 disabled={loading}
 />
 </div>
 {fieldErrors.companyName && (
 <p className="text-[11px] text-destructive">{fieldErrors.companyName}</p>
 )}
 </div>

 {/* تلفن — اختیاری */}
 <div className="space-y-1">
 <Label htmlFor="checkout-phone" className="text-xs">
 تلفن (اختیاری)
 </Label>
 <div className="relative">
 <Phone className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
 <Input
 id="checkout-phone"
 dir="ltr"
 value={phone}
 onChange={(e) => setPhone(e.target.value)}
 placeholder="0912xxxxxxx"
 className="pr-8 text-sm"
 disabled={loading}
 />
 </div>
 </div>

 {/* FIX(v12.1 — سیستم رفرال): کد دعوت (اختیاری) */}
 <div className="space-y-1">
 <Label htmlFor="checkout-referral" className="text-xs">
 کد دعوت (اختیاری — برای دوستتان پاداش ثبت می‌شود)
 </Label>
 <Input
 id="checkout-referral"
 dir="ltr"
 value={referralCode}
 onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
 placeholder="HH-XXXXXXXX"
 className="text-sm font-mono"
 disabled={loading}
 maxLength={16}
 />
 </div>
 </div>
 )}

 {/* ضمانت‌ها */}
 <div className="space-y-1.5 text-xs text-muted-foreground">
 <div className="flex items-center gap-2">
 <ShieldCheck className="h-3.5 w-3.5 text-primary" />
 پرداخت از طریق درگاه امن شاپرک (زرین‌پال)
 </div>
 <div className="flex items-center gap-2">
 <Unlock className="h-3.5 w-3.5 text-primary" />
 {isLoggedIn
? "فعال‌سازی آنی لایسنس پس از پرداخت موفق"
: "ساخت حساب + فعال‌سازی آنی پس از پرداخت موفق"}
 </div>
 <div className="flex items-center gap-2">
 <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
 اعتبار لایسنس: یک سال کامل
 </div>
 </div>

 {error && (
 <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2">
 <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
 <p className="text-xs text-destructive leading-relaxed">{error}</p>
 </div>
 )}
 </div>

 <DialogFooter className="flex-col sm:flex-row gap-2">
 <Button
 variant="outline"
 onClick={onClose}
 disabled={loading}
 className="sm:flex-1"
 >
 انصراف
 </Button>
 <Button
 onClick={handlePay}
 disabled={loading}
 className="sm:flex-1 gap-2"
 >
 {loading? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ): (
 <ExternalLink className="h-4 w-4" />
 )}
 {loading? "در حال اتصال به درگاه...": `پرداخت ${formatNumber(plan.priceToman)} تومان`}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 );
}
