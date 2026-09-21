"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/persian";
import type { Plan } from "@/lib/plans";

/**
 * PricingPlans — گرید پلن‌های قیمت‌گذاری با کلید ماهانه/سالانه
 * (کامپوننت کلاینت — رندر اولیه روی سرور انجام می‌شود؛
 * حالت پیش‌فرض «سالانه» در HTML اولیه موجود است)
 */
export function PricingPlans({ plans }: { plans: Plan[] }) {
 const [monthly, setMonthly] = React.useState(false);

 return (
 <section aria-label="پلن‌های قیمت‌گذاری هوش">
 {/* کلید نمایش ماهانه/سالانه */}
 <div className="mb-10 flex items-center justify-center gap-3">
 <div
 className="inline-flex items-center rounded-full border border-border bg-card p-1"
 role="group"
 aria-label="دوره صورتحساب"
 >
 <button
 type="button"
 onClick={() => setMonthly(false)}
 aria-pressed={!monthly}
 className={`rounded-full px-5 py-1.5 text-sm font-semibold transition-colors ${
!monthly? "bg-primary text-primary-foreground": "text-muted-foreground"
 }`}
 >
 پرداخت سالانه
 </button>
 <button
 type="button"
 onClick={() => setMonthly(true)}
 aria-pressed={monthly}
 className={`rounded-full px-5 py-1.5 text-sm font-semibold transition-colors ${
 monthly? "bg-primary text-primary-foreground": "text-muted-foreground"
 }`}
 >
 پرداخت ماهانه
 </button>
 </div>
 {!monthly && (
 <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
 ۲ ماه تخفیف سالانه
 </Badge>
 )}
 </div>

 {/* کارت پلن‌ها */}
 <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-3">
 {plans.map((plan) => {
 // ماهانه = سالانه ÷ ۱۰ (پرداخت سالانه معادل دو ماه تخفیف دارد)
 const monthlyToman = Math.round(plan.priceToman / 10);
 const popular = plan.popular;
 return (
 <Card
 key={plan.id}
 className={`relative flex flex-col p-6 card-hover rounded-xl border-border/50 bg-card/80 transition-all duration-200 hover:border-primary/30 hover:shadow-lg ${
 popular? "border-primary ring-2 ring-primary/20 shadow-lg shadow-primary/10": ""
 }`}
 >
 {popular && (
 <Badge className="absolute -top-3 right-6 bg-primary text-primary-foreground">
 محبوب‌ترین
 </Badge>
 )}
 <div className="mb-4">
 <h3 className="text-lg font-bold text-foreground">پلن {plan.name}</h3>
 <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
 {plan.description}
 </p>
 </div>
 <div className="mb-5 border-b border-border pb-5">
 <div className="flex items-baseline gap-1.5">
 <span className="text-3xl font-bold tracking-tight text-foreground">
 {formatNumber(monthly? monthlyToman: plan.priceToman)}
 </span>
 <span className="text-sm text-muted-foreground">تومان</span>
 </div>
 <p className="mt-1 text-xs text-muted-foreground">
 {monthly? "ماهانه — قابل لغو در هر زمان": "سالانه — پرداخت یک‌بار"}
 </p>
 {!monthly && (
 <p className="mt-1 text-xs text-muted-foreground">
 معادل {formatNumber(plan.priceRial)} ریال
 </p>
 )}
 </div>

 <ul className="mb-6 flex-1 space-y-2.5">
 {plan.features.map((f) => (
 <li key={f} className="flex items-start gap-2 text-sm">
 <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
 <span className="leading-relaxed text-foreground">{f}</span>
 </li>
 ))}
 {plan.id === "basic" &&
 ["هوش مصنوعی", "CRM و باشگاه مشتریان", "حقوق و دستمزد", "API"].map((f) => (
 <li key={f} className="flex items-start gap-2 text-sm">
 <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
 <span className="leading-relaxed text-muted-foreground/80 line-through">
 {f}
 </span>
 </li>
 ))}
 </ul>

 {plan.id === "enterprise"? (
 <a
 href="tel:07132622493"
 className="inline-flex w-full items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
 >
 تماس با فروش — ۰۷۱-۳۲۶۲۲۴۹۳
 </a>
 ): (
 <Button
 asChild
 className="w-full"
 variant={popular? "default": "outline"}
 >
 {/* FIX(v10-checkout): قبلاً فقط به / لینک می‌شد و خرید اتفاق نمی‌افتاد —
 حالا به صفحه قیمت‌گذاری اپ با چک‌اوت باز می‌رود (؟buy=<planId>) */}
 <Link href={`/?buy=${plan.id}`}>{plan.cta}</Link>
 </Button>
 )}
 </Card>
 );
 })}
 </div>

 <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
 تمام پلن‌ها شامل ۱۴ روز آزمایش رایگان با تمام امکانات هستند — بدون نیاز به کارت
 بانکی. ارتقا در هر زمان فقط با پرداخت مابه‌التفاوت روزشمار انجام می‌شود.
 </p>
 </section>
 );
}
