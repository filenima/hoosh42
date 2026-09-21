"use client";

/**
 * InvoiceBrandingCard — کارت برندینگ فاکتور کسب‌وکار
 *
 * برای کسب‌وکارهای کوچک: لوگو، شعار/متن دلخواه، وب‌سایت، تلفن و آدرس —
 * این اطلاعات روی فاکتورهای چاپی (A4 و رسید حرارتی) نمایش داده می‌شود.
 */

import * as React from "react";
import { Receipt, Loader2, Save, Upload, Trash2, ImageIcon, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth-fetch";

interface Branding {
 name: string;
 logoUrl: string | null;
 invoiceSlogan: string | null;
 invoiceWebsite: string | null;
 invoicePhone: string | null;
 invoiceAddress: string | null;
}

export function InvoiceBrandingCard() {
 const { toast } = useToast();
 const fileInputRef = React.useRef<HTMLInputElement>(null);

 const [loading, setLoading] = React.useState(true);
 const [saving, setSaving] = React.useState(false);
 const [uploading, setUploading] = React.useState(false);
 const [logoPreview, setLogoPreview] = React.useState<string | null>(null);
 const [slogan, setSlogan] = React.useState("");
 const [website, setWebsite] = React.useState("");
 const [phone, setPhone] = React.useState("");
 const [address, setAddress] = React.useState("");

 React.useEffect(() => {
 let mounted = true;
 (async () => {
 try {
 const res = await authFetch("/api/accounting/tenant-branding", { cache: "no-store" });
 const j = await res.json();
 if (mounted && j?.success && j.data) {
 setLogoPreview(j.data.logoUrl || null);
 setSlogan(j.data.invoiceSlogan || "");
 setWebsite(j.data.invoiceWebsite || "");
 setPhone(j.data.invoicePhone || "");
 setAddress(j.data.invoiceAddress || "");
 }
 } catch {
 /* ignore */
 } finally {
 if (mounted) setLoading(false);
 }
 })();
 return () => {
 mounted = false;
 };
 }, []);

 const save = async () => {
 setSaving(true);
 try {
 const res = await authFetch("/api/accounting/tenant-branding", {
 method: "PUT",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 invoiceSlogan: slogan || null,
 invoiceWebsite: website || null,
 invoicePhone: phone || null,
 invoiceAddress: address || null,
 }),
 });
 const j = await res.json();
 if (!res.ok ||!j?.success) throw new Error(j?.error || "خطا در ذخیره");
 toast({
 title: "برندینگ فاکتور ذخیره شد",
 description: "این اطلاعات روی فاکتورهای چاپی نمایش داده می‌شود.",
 });
 } catch (e) {
 toast({
 title: "خطا در ذخیره",
 description: e instanceof Error? e.message: "خطای ناشناخته",
 variant: "destructive",
 });
 } finally {
 setSaving(false);
 }
 };

 const uploadLogo = async (file: File) => {
 setUploading(true);
 try {
 const fd = new FormData();
 fd.append("logo", file);
 const res = await authFetch("/api/accounting/tenant-branding", {
 method: "POST",
 body: fd,
 });
 const j = await res.json();
 if (!res.ok ||!j?.success) throw new Error(j?.error || "خطا در آپلود");
 setLogoPreview(j.data.logoUrl || null);
 toast({ title: "لوگو ذخیره شد", description: "لوگوی شما روی فاکتورها نمایش داده می‌شود." });
 } catch (e) {
 toast({
 title: "خطا در آپلود لوگو",
 description: e instanceof Error? e.message: "خطای ناشناخته",
 variant: "destructive",
 });
 } finally {
 setUploading(false);
 }
 };

 const removeLogo = async () => {
 setUploading(true);
 try {
 const res = await authFetch("/api/accounting/tenant-branding", { method: "DELETE" });
 const j = await res.json();
 if (!res.ok ||!j?.success) throw new Error(j?.error || "خطا در حذف");
 setLogoPreview(null);
 toast({ title: "لوگو حذف شد" });
 } catch (e) {
 toast({
 title: "خطا در حذف لوگو",
 description: e instanceof Error? e.message: "خطای ناشناخته",
 variant: "destructive",
 });
 } finally {
 setUploading(false);
 }
 };

 if (loading) {
 return (
 <Card>
 <CardContent className="py-8 flex items-center justify-center">
 <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
 </CardContent>
 </Card>
 );
 }

 return (
 <Card className="border-primary/20">
 <CardHeader className="pb-3">
 <CardTitle className="text-sm flex items-center gap-2">
 <Receipt className="h-4 w-4 text-primary" />
 برندینگ فاکتور
 </CardTitle>
 <CardDescription className="text-xs">
 لوگو، شعار، وب‌سایت و اطلاعات تماس شما — روی فاکتورهای چاپی (A4 و رسید
 حرارتی) نمایش داده می‌شود
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 {/* لوگو */}
 <div className="flex items-center gap-3">
 <div className="h-16 w-16 shrink-0 rounded-xl border border-border bg-muted/30 flex items-center justify-center overflow-hidden">
 {logoPreview? (
 <img src={logoPreview} alt="لوگوی کسب‌وکار" className="h-full w-full object-contain" />
 ): (
 <ImageIcon className="h-6 w-6 text-muted-foreground" />
 )}
 </div>
 <div className="flex flex-col gap-1.5">
 <div className="flex gap-1.5">
 <Button
 type="button"
 size="sm"
 variant="outline"
 className="h-8 text-[11px] gap-1"
 disabled={uploading}
 onClick={() => fileInputRef.current?.click()}
 >
 {uploading? (
 <Loader2 className="h-3 w-3 animate-spin" />
 ): (
 <Upload className="h-3 w-3" />
 )}
 {logoPreview? "تغییر لوگو": "آپلود لوگو"}
 </Button>
 {logoPreview && (
 <Button
 type="button"
 size="sm"
 variant="outline"
 className="h-8 text-[11px] gap-1 text-destructive border-destructive/30 hover:bg-destructive/5"
 disabled={uploading}
 onClick={removeLogo}
 >
 <Trash2 className="h-3 w-3" />
 حذف
 </Button>
 )}
 </div>
 <p className="text-[10px] text-muted-foreground">
 PNG، JPG، WebP یا SVG — حداکثر ۴ مگابایت
 </p>
 </div>
 <input
 ref={fileInputRef}
 type="file"
 accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
 className="hidden"
 onChange={(e) => {
 const f = e.target.files?.[0];
 if (f) uploadLogo(f);
 e.target.value = "";
 }}
 aria-label="انتخاب فایل لوگو"
 />
 </div>

 {/* شعار */}
 <div className="space-y-1.5">
 <Label htmlFor="inv-slogan" className="text-xs">
 شعار یا متن دلخواه روی فاکتور
 </Label>
 <Input
 id="inv-slogan"
 value={slogan}
 onChange={(e) => setSlogan(e.target.value)}
 className="h-9"
 placeholder="مثلاً: کیفیت، اعتماد، تضمین رضایت مشتری"
 maxLength={160}
 />
 </div>

 {/* وب‌سایت */}
 <div className="space-y-1.5">
 <Label htmlFor="inv-website" className="text-xs">
 وب‌سایت کسب‌وکار
 </Label>
 <Input
 id="inv-website"
 value={website}
 onChange={(e) => setWebsite(e.target.value)}
 className="h-9"
 dir="ltr"
 placeholder="example.ir"
 maxLength={120}
 />
 </div>

 {/* تلفن و آدرس */}
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
 <div className="space-y-1.5">
 <Label htmlFor="inv-phone" className="text-xs">تلفن روی فاکتور</Label>
 <Input
 id="inv-phone"
 value={phone}
 onChange={(e) => setPhone(e.target.value)}
 className="h-9"
 dir="ltr"
 placeholder="۰۲۱-۱۲۳۴۵۶۷۸"
 maxLength={40}
 />
 </div>
 <div className="space-y-1.5">
 <Label htmlFor="inv-address" className="text-xs">آدرس روی فاکتور</Label>
 <Input
 id="inv-address"
 value={address}
 onChange={(e) => setAddress(e.target.value)}
 className="h-9"
 placeholder="مثلاً: تهران، خیابان ولیعصر..."
 maxLength={240}
 />
 </div>
 </div>

 <Button size="sm" onClick={save} disabled={saving} className="w-full gap-1.5">
 {saving? (
 <><Loader2 className="h-4 w-4 animate-spin" /> در حال ذخیره...</>
 ): (
 <><Save className="h-4 w-4" /> ذخیره برندینگ فاکتور</>
 )}
 </Button>

 <p className="text-[10px] text-muted-foreground flex items-center gap-1">
 <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
 برای دیدن نتیجه، فاکتوری ثبت کنید و روی «چاپ» بزنید.
 </p>
 </CardContent>
 </Card>
 );
}
