"use client";

// ============ Partner Program Module — هوش ============
// پورتال همکاران — فرم درخواست، مستندات، داشبورد درآمد

import * as React from "react";
import {
 Handshake,
 Building2,
 Mail,
 Phone,
 Globe,
 Loader2,
 CheckCircle2,
 ExternalLink,
 Users,
 TrendingUp,
 Wallet,
 Key,
 Copy,
 Award,
 Star,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toPersianDigits, formatToman } from "@/lib/persian";

interface Partner {
 id: string;
 companyName: string;
 partnerType: string;
 website: string;
 description: string;
 tier: string;
 since: string;
 revenueShare: number;
}

const TIER_LABELS: Record<string, { label: string; color: string }> = {
 bronze: { label: "برنزی", color: "bg-amber-700" },
 silver: { label: "نقره‌ای", color: "bg-slate-400" },
 gold: { label: "طلایی", color: "bg-amber-500" },
 platinum: { label: "پلاتین", color: "bg-primary" },
};

const TYPE_LABELS: Record<string, string> = {
 referral: "معرفی",
 reseller: "نماینده‌ی فروش",
 technology: "فناوری",
 integration: "اتصال",
};

export function PartnerProgram({ token }: { token?: string }) {
 return (
 <div className="space-y-6 p-4">
 <div>
 <h2 className="flex items-center gap-2 text-2xl font-bold">
 <Handshake className="h-6 w-6 text-primary" />
 برنامه‌ی همکاران
 </h2>
 <p className="text-sm text-muted-foreground">
 با هوش همکار شوید و از درآمد پایدار بهره‌مند شوید
 </p>
 </div>

 <Tabs defaultValue="apply">
 <TabsList>
 <TabsTrigger value="apply">درخواست همکاری</TabsTrigger>
 <TabsTrigger value="partners">همکاران فعلی</TabsTrigger>
 <TabsTrigger value="dashboard">داشبورد درآمد</TabsTrigger>
 <TabsTrigger value="docs">مستندات</TabsTrigger>
 </TabsList>

 <TabsContent value="apply">
 <ApplicationForm token={token} />
 </TabsContent>

 <TabsContent value="partners">
 <PartnersList />
 </TabsContent>

 <TabsContent value="dashboard">
 <RevenueDashboard token={token} />
 </TabsContent>

 <TabsContent value="docs">
 <IntegrationDocs />
 </TabsContent>
 </Tabs>
 </div>
 );
}

function ApplicationForm({ token }: { token?: string }) {
 const [form, setForm] = React.useState({
 companyName: "",
 contactName: "",
 email: "",
 phone: "",
 partnerType: "referral",
 website: "",
 description: "",
 });
 const [submitting, setSubmitting] = React.useState(false);
 const [result, setResult] = React.useState<string | null>(null);
 const [error, setError] = React.useState<string | null>(null);

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 setSubmitting(true);
 setError(null);
 setResult(null);
 try {
 const res = await fetch("/api/partners", {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
...(token? { Authorization: `Bearer ${token}` }: {}),
 },
 body: JSON.stringify(form),
 });
 const data = await res.json();
 if (!res.ok) throw new Error(data.error?? "خطا در ثبت درخواست");
 setResult(data.message);
 setForm({
 companyName: "",
 contactName: "",
 email: "",
 phone: "",
 partnerType: "referral",
 website: "",
 description: "",
 });
 } catch (err) {
 setError(err instanceof Error? err.message: "خطا");
 } finally {
 setSubmitting(false);
 }
 };

 return (
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center gap-2 text-base">
 <Building2 className="h-5 w-5 text-primary" />
 فرم درخواست همکاری
 </CardTitle>
 </CardHeader>
 <CardContent>
 <form onSubmit={handleSubmit} className="space-y-4">
 <div className="grid gap-4 sm:grid-cols-2">
 <div className="space-y-2">
 <Label htmlFor="companyName">نام شرکت</Label>
 <Input
 id="companyName"
 value={form.companyName}
 onChange={(e) => setForm({...form, companyName: e.target.value })}
 required
 />
 </div>
 <div className="space-y-2">
 <Label htmlFor="contactName">نام فرد مسئول</Label>
 <Input
 id="contactName"
 value={form.contactName}
 onChange={(e) => setForm({...form, contactName: e.target.value })}
 required
 />
 </div>
 <div className="space-y-2">
 <Label htmlFor="email">ایمیل</Label>
 <Input
 id="email"
 type="email"
 value={form.email}
 onChange={(e) => setForm({...form, email: e.target.value })}
 required
 />
 </div>
 <div className="space-y-2">
 <Label htmlFor="phone">تلفن تماس</Label>
 <Input
 id="phone"
 type="tel"
 value={form.phone}
 onChange={(e) => setForm({...form, phone: e.target.value })}
 required
 />
 </div>
 <div className="space-y-2">
 <Label htmlFor="partnerType">نوع همکاری</Label>
 <select
 id="partnerType"
 value={form.partnerType}
 onChange={(e) => setForm({...form, partnerType: e.target.value })}
 className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
 >
 <option value="referral">معرفی (Referral)</option>
 <option value="reseller">نماینده‌ی فروش (Reseller)</option>
 <option value="technology">فناوری (Technology)</option>
 <option value="integration">اتصال (Integration)</option>
 </select>
 </div>
 <div className="space-y-2">
 <Label htmlFor="website">وب‌سایت</Label>
 <Input
 id="website"
 type="url"
 value={form.website}
 onChange={(e) => setForm({...form, website: e.target.value })}
 />
 </div>
 </div>

 <div className="space-y-2">
 <Label htmlFor="description">توضیحات</Label>
 <Textarea
 id="description"
 rows={4}
 placeholder="درباره‌ی شرکت، تجربه و دلیل همکاری توضیح دهید..."
 value={form.description}
 onChange={(e) => setForm({...form, description: e.target.value })}
 />
 </div>

 {error && (
 <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
 {error}
 </div>
 )}
 {result && (
 <div className="flex items-center gap-2 rounded-md border border-primary/50 bg-primary/5 p-3 text-sm text-primary">
 <CheckCircle2 className="h-4 w-4" />
 {result}
 </div>
 )}

 <Button type="submit" disabled={submitting}>
 {submitting? <Loader2 className="h-4 w-4 animate-spin" />: <Handshake className="h-4 w-4" />}
 <span className="mr-2">ثبت درخواست</span>
 </Button>
 </form>
 </CardContent>
 </Card>
 );
}

function PartnersList() {
 const [partners, setPartners] = React.useState<Partner[]>([]);
 const [loading, setLoading] = React.useState(true);

 React.useEffect(() => {
 const token = typeof window!== "undefined"? localStorage.getItem("hoshhesab_user_token"): null;
 fetch("/api/partners", {
 headers: token? { Authorization: `Bearer ${token}` }: {},
 })
.then((r) => r.json())
.then((data) => setPartners(data.partners?? []))
.finally(() => setLoading(false));
 }, []);

 if (loading) {
 return (
 <div className="flex h-40 items-center justify-center text-muted-foreground">
 <Loader2 className="h-6 w-6 animate-spin" />
 </div>
 );
 }

 return (
 <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
 {partners.map((p) => {
 const tier = TIER_LABELS[p.tier]?? TIER_LABELS.bronze;
 return (
 <Card key={p.id}>
 <CardContent className="space-y-3 p-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <div className="rounded-md bg-primary/10 p-2 text-primary">
 <Building2 className="h-5 w-5" />
 </div>
 <div>
 <div className="font-medium">{p.companyName}</div>
 <div className="text-xs text-muted-foreground">
 {TYPE_LABELS[p.partnerType]?? p.partnerType}
 </div>
 </div>
 </div>
 <Badge className={tier.color}>{tier.label}</Badge>
 </div>
 <p className="text-sm text-muted-foreground">{p.description}</p>
 <div className="flex items-center justify-between text-xs text-muted-foreground">
 <span>سهم درآمد: {toPersianDigits(p.revenueShare)}٪</span>
 <span>از {toPersianDigits(p.since.slice(0, 4))}</span>
 </div>
 <Button size="sm" variant="outline" asChild className="w-full">
 <a href={p.website} target="_blank" rel="noopener noreferrer">
 <ExternalLink className="h-3 w-3" />
 <span className="mr-1">وب‌سایت</span>
 </a>
 </Button>
 </CardContent>
 </Card>
 );
 })}
 </div>
 );
}

function RevenueDashboard({ token }: { token?: string }) {
 const [stats] = React.useState({
 totalRevenue: 12_400_000,
 thisMonth: 1_850_000,
 pendingPayout: 320_000,
 referrals: 47,
 conversionRate: 18.5,
 });

 const [apiKey, setApiKey] = React.useState<string>("");
 const [copied, setCopied] = React.useState(false);

 React.useEffect(() => {
 // در پیاده‌سازی واقعی: فراخوانی API برای دریافت API key
 setApiKey("hh_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0");
 }, []);

 const copyKey = () => {
 navigator.clipboard.writeText(apiKey);
 setCopied(true);
 setTimeout(() => setCopied(false), 2000);
 };

 return (
 <div className="space-y-4">
 <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <div className="text-xs text-muted-foreground">درآمد کل</div>
 <div className="text-xl font-bold text-primary">
 {formatToman(stats.totalRevenue)}
 </div>
 </div>
 <Wallet className="h-8 w-8 text-primary/30" />
 </div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <div className="text-xs text-muted-foreground">این ماه</div>
 <div className="text-xl font-bold">{formatToman(stats.thisMonth)}</div>
 </div>
 <TrendingUp className="h-8 w-8 text-primary/30" />
 </div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <div className="text-xs text-muted-foreground">معرفی‌ها</div>
 <div className="text-xl font-bold">{toPersianDigits(stats.referrals)}</div>
 </div>
 <Users className="h-8 w-8 text-primary/30" />
 </div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <div className="text-xs text-muted-foreground">نرخ تبدیل</div>
 <div className="text-xl font-bold">{toPersianDigits(stats.conversionRate)}٪</div>
 </div>
 <Award className="h-8 w-8 text-primary/30" />
 </div>
 </CardContent>
 </Card>
 </div>

 <Card>
 <CardHeader>
 <CardTitle className="flex items-center gap-2 text-base">
 <Key className="h-5 w-5 text-primary" />
 API Key
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="flex items-center gap-2">
 <Input value={apiKey} readOnly className="font-mono text-sm" dir="ltr" />
 <Button size="sm" variant="outline" onClick={copyKey}>
 {copied? <CheckCircle2 className="h-4 w-4" />: <Copy className="h-4 w-4" />}
 </Button>
 </div>
 <p className="mt-2 text-xs text-muted-foreground">
 این کلید را محرمانه نگه دارید. برای احراز هویت در هدر Authorization استفاده کنید.
 </p>
 </CardContent>
 </Card>

 <Card>
 <CardHeader>
 <CardTitle className="flex items-center gap-2 text-base">
 <Star className="h-5 w-5 text-primary" />
 سطح همکاری شما
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="flex items-center justify-between">
 <Badge className="bg-primary">طلایی</Badge>
 <span className="text-sm text-muted-foreground">
 برای ارتقا به پلاتین، {toPersianDigits(3)} معرفی دیگر لازم است
 </span>
 </div>
 </CardContent>
 </Card>
 </div>
 );
}

function IntegrationDocs() {
 return (
 <Card>
 <CardHeader>
 <CardTitle className="text-base">مستندات فنی همکاری</CardTitle>
 </CardHeader>
 <CardContent className="space-y-4 text-sm">
 <div>
 <h4 className="mb-2 font-medium">۱. دریافت API Key</h4>
 <p className="text-muted-foreground">
 پس از تأیید درخواست همکاری، API Key اختصاصی برای شما صادر می‌شود. این کلید را در
 هدر <code className="rounded bg-muted px-1">Authorization: Bearer hh_...</code> ارسال کنید.
 </p>
 </div>
 <div>
 <h4 className="mb-2 font-medium">۲. ثبت معرفی (Referral)</h4>
 <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs" dir="ltr">
{`POST /api/v1/referrals
{
 "referredEmail": "customer@example.com",
 "campaignId": "summer2025"
}`}
 </pre>
 </div>
 <div>
 <h4 className="mb-2 font-medium">۳. پیگیری درآمد</h4>
 <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs" dir="ltr">
{`GET /api/v1/partner/revenue
?from=2025-01-01&to=2025-12-31`}
 </pre>
 </div>
 <div>
 <h4 className="mb-2 font-medium">۴. Webhook رویدادها</h4>
 <p className="text-muted-foreground">
 برای دریافت خودکار رویدادهای referral.created، referral.converted و payout.processed،
 یک webhook در پورتال ثبت کنید.
 </p>
 </div>
 <Button variant="outline" asChild>
 <a href="/api-docs" target="_blank" rel="noopener noreferrer">
 <ExternalLink className="h-4 w-4" />
 <span className="mr-1">مشاهده‌ی مستندات کامل API</span>
 </a>
 </Button>
 </CardContent>
 </Card>
 );
}
