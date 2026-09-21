"use client";

import * as React from "react";
import {
 Gift,
 Copy,
 Check,
 Users2,
 TrendingUp,
 Clock,
 Award,
 Mail,
 Share2,
 Trash2,
 Plus,
 Send,
 MessageCircle,
 Link as LinkIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
 AlertDialog,
 AlertDialogAction,
 AlertDialogCancel,
 AlertDialogContent,
 AlertDialogDescription,
 AlertDialogFooter,
 AlertDialogHeader,
 AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { toPersianDigits, formatNumber } from "@/lib/persian";

// ============ types ============
interface Referral {
 id: string;
 referrerId: string;
 refereeEmail: string;
 code: string;
 status: "PENDING" | "SIGNED_UP" | "REWARDED";
 reward: number;
 refereeUserId?: string | null;
 createdAt: string;
 updatedAt: string;
}

interface Stats {
 total: number;
 pending: number;
 signedUp: number;
 rewarded: number;
 totalReward: number;
}

interface ReferralResponse {
 success: boolean;
 data: Referral[];
 stats: Stats;
}

const STATUS_META: Record<
 Referral["status"],
 { label: string; color: string; icon: React.ComponentType<{ className?: string }> }
> = {
 PENDING: {
 label: "در انتظار",
 color: "bg-amber-500/10 text-amber-600 border-amber-500/30",
 icon: Clock,
 },
 SIGNED_UP: {
 label: "ثبت‌نام کرد",
 color: "bg-primary/10 text-primary border-primary/30",
 icon: Users2,
 },
 REWARDED: {
 label: "پاداش داده شد",
 color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
 icon: Award,
 },
};

export function ReferralWidget({ className }: { className?: string }) {
 const { toast } = useToast();
 const [data, setData] = React.useState<Referral[]>([]);
 const [stats, setStats] = React.useState<Stats>({
 total: 0,
 pending: 0,
 signedUp: 0,
 rewarded: 0,
 totalReward: 0,
 });
 const [loading, setLoading] = React.useState(true);
 const [newEmail, setNewEmail] = React.useState("");
 const [creating, setCreating] = React.useState(false);
 const [copiedCode, setCopiedCode] = React.useState<string | null>(null);
 const [deleteId, setDeleteId] = React.useState<string | null>(null);

 const fetchReferrals = React.useCallback(async () => {
 const token = localStorage.getItem("hoshhesab_user_token") || "";
 if (!token) {
 setLoading(false);
 return;
 }
 try {
 const res = await fetch("/api/marketing/referral", {
 headers: { Authorization: `Bearer ${token}` },
 });
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const json: ReferralResponse = await res.json();
 setData(json.data);
 setStats(json.stats);
 } catch (err) {
 console.error("Referral fetch failed:", err);
 } finally {
 setLoading(false);
 }
 }, []);

 React.useEffect(() => {
 fetchReferrals();
 }, [fetchReferrals]);

 const handleCreate = React.useCallback(async () => {
 const email = newEmail.trim().toLowerCase();
 if (!email ||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
 toast({
 title: "ایمیل نامعتبر",
 description: "یک ایمیل معتبر وارد کنید.",
 variant: "destructive",
 });
 return;
 }
 setCreating(true);
 try {
 const token = localStorage.getItem("hoshhesab_user_token") || "";
 const res = await fetch("/api/marketing/referral", {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 Authorization: `Bearer ${token}`,
 },
 body: JSON.stringify({ refereeEmail: email }),
 });
 const json = await res.json();
 if (!res.ok ||!json.success) {
 throw new Error(json?.error || "خطا در ایجاد کد دعوت");
 }
 toast({
 title: "کد دعوت ایجاد شد",
 description: `کد ${json.data.code} برای ${email} ساخته شد.`,
 });
 setNewEmail("");
 fetchReferrals();
 } catch (err) {
 toast({
 title: "خطا",
 description: err instanceof Error? err.message: "خطای ناشناخته",
 variant: "destructive",
 });
 } finally {
 setCreating(false);
 }
 }, [newEmail, fetchReferrals, toast]);

 const handleCopy = React.useCallback(
 async (code: string) => {
 try {
 await navigator.clipboard.writeText(code);
 setCopiedCode(code);
 toast({ title: "کپی شد", description: `کد ${code} در کلیپ‌بورد کپی شد.` });
 setTimeout(() => setCopiedCode(null), 2000);
 } catch {
 toast({
 title: "خطا در کپی",
 description: "لطفاً کد را دستی کپی کنید.",
 variant: "destructive",
 });
 }
 },
 [toast]
 );

 const handleShare = React.useCallback(
 async (ref: Referral) => {
 const shareUrl = `${window.location.origin}/?ref=${ref.code}`;
 const shareText = `با هوش، حسابداری کسب‌وکارم رو خودکار کردم. با کد دعوت من ثبت‌نام کن و پاداش بگیر: ${shareUrl}`;
 try {
 if (navigator.share) {
 await navigator.share({
 title: "دعوت به هوش",
 text: shareText,
 url: shareUrl,
 });
 } else {
 await navigator.clipboard.writeText(shareText);
 toast({
 title: "لینک دعوت کپی شد",
 description: "می‌توانید آن را برای دوستانتان بفرستید.",
 });
 }
 } catch {
 /* user cancelled — ignore */
 }
 },
 [toast]
 );

 const handleShareTelegram = React.useCallback(
 (ref: Referral) => {
 const shareUrl = `${window.location.origin}/?ref=${ref.code}`;
 const text = encodeURIComponent(
 `با هوش، حسابداری کسب‌وکارم رو خودکار کردم. با کد دعوت من ثبت‌نام کن و پاداش بگیر:`
 );
 const url = encodeURIComponent(shareUrl);
 window.open(
 `https://t.me/share/url?url=${url}&text=${text}`,
 "_blank",
 "noopener,noreferrer"
 );
 },
 []
 );

 const handleShareWhatsApp = React.useCallback(
 (ref: Referral) => {
 const shareUrl = `${window.location.origin}/?ref=${ref.code}`;
 const text = encodeURIComponent(
 `با هوش، حسابداری کسب‌وکارم رو خودکار کردم. با کد دعوت من ثبت‌نام کن و پاداش بگیر: ${shareUrl}`
 );
 window.open(
 `https://wa.me/?text=${text}`,
 "_blank",
 "noopener,noreferrer"
 );
 },
 []
 );

 const handleCopyLink = React.useCallback(
 async (ref: Referral) => {
 const shareUrl = `${window.location.origin}/?ref=${ref.code}`;
 try {
 await navigator.clipboard.writeText(shareUrl);
 toast({
 title: "لینک کپی شد",
 description: "لینک دعوت در کلیپ‌بورد کپی شد.",
 });
 } catch {
 toast({
 title: "خطا در کپی",
 description: "لطفاً لینک را دستی کپی کنید.",
 variant: "destructive",
 });
 }
 },
 [toast]
 );

 const handleDelete = React.useCallback(async () => {
 if (!deleteId) return;
 try {
 const token = localStorage.getItem("hoshhesab_user_token") || "";
 const res = await fetch(`/api/marketing/referral?id=${deleteId}`, {
 method: "DELETE",
 headers: { Authorization: `Bearer ${token}` },
 });
 const json = await res.json();
 if (!res.ok ||!json.success) {
 throw new Error(json?.error || "خطا در حذف");
 }
 toast({ title: "حذف شد", description: "کد دعوت حذف شد." });
 fetchReferrals();
 } catch (err) {
 toast({
 title: "خطا",
 description: err instanceof Error? err.message: "خطای ناشناخته",
 variant: "destructive",
 });
 } finally {
 setDeleteId(null);
 }
 }, [deleteId, fetchReferrals, toast]);

 return (
 <Card className={`overflow-hidden ${className || ""}`}>
 {/* هدر */}
 <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-gradient-to-l from-primary/5 to-transparent">
 <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
 <Gift className="h-5 w-5" />
 </div>
 <div className="flex-1">
 <h2 className="text-base font-semibold text-foreground">برنامه معرفی دوستان</h2>
 <p className="text-xs text-muted-foreground mt-0.5">
 با دعوت هر دوست، بعد از ثبت‌نام او پاداش دریافت کنید.
 </p>
 </div>
 </div>

 {/* آمار */}
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border-b border-border">
 <StatTile label="کل دعوت‌ها" value={stats.total} icon={Users2} />
 <StatTile label="در انتظار" value={stats.pending} icon={Clock} accent="amber" />
 <StatTile label="ثبت‌نام کرده" value={stats.signedUp} icon={TrendingUp} accent="primary" />
 <StatTile
 label="پاداش کل (تومان)"
 value={formatNumber(stats.totalReward)}
 icon={Award}
 accent="emerald"
 />
 </div>

 {/* فرم ایجاد کد جدید */}
 <div className="p-4 border-b border-border bg-muted/20">
 <label className="text-xs font-medium text-foreground mb-1.5 block">
 دعوت دوست با ایمیل
 </label>
 <div className="flex gap-2">
 <div className="relative flex-1">
 <Mail className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input
 type="email"
 dir="ltr"
 placeholder="friend@example.com"
 value={newEmail}
 onChange={(e) => setNewEmail(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === "Enter") handleCreate();
 }}
 className="pr-9"
 disabled={creating}
 />
 </div>
 <Button onClick={handleCreate} disabled={creating ||!newEmail.trim()} className="gap-1.5">
 {creating? (
 <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
 ): (
 <Plus className="h-4 w-4" />
 )}
 ایجاد کد
 </Button>
 </div>
 </div>

 {/* لیست معرفی‌ها */}
 <div className="p-3">
 {loading? (
 <div className="space-y-2">
 {Array.from({ length: 3 }).map((_, i) => (
 <div key={i} className="flex items-center gap-3 p-3">
 <Skeleton className="h-10 w-10 rounded-full" />
 <div className="flex-1 space-y-1.5">
 <Skeleton className="h-3.5 w-40 rounded" />
 <Skeleton className="h-2.5 w-24 rounded" />
 </div>
 <Skeleton className="h-8 w-20 rounded" />
 </div>
 ))}
 </div>
 ): data.length === 0? (
 <div className="py-10 text-center">
 <Gift className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
 <p className="text-sm text-muted-foreground">
 هنوز کسی را دعوت نکرده‌اید.
 </p>
 <p className="text-xs text-muted-foreground/70 mt-1">
 اولین دعوت را با ایمیل دوستتان شروع کنید.
 </p>
 </div>
 ): (
 <ScrollArea className="max-h-96">
 <div className="space-y-1.5">
 {data.map((ref) => {
 const meta = STATUS_META[ref.status];
 const StatusIcon = meta.icon;
 return (
 <div
 key={ref.id}
 className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:border-primary/30 hover:bg-primary/5 transition-colors"
 >
 {/* avatar */}
 <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
 {ref.refereeEmail.charAt(0).toUpperCase()}
 </div>

 {/* اطلاعات */}
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <p className="text-sm font-medium text-foreground truncate" dir="ltr">
 {ref.refereeEmail}
 </p>
 </div>
 <div className="flex items-center gap-2 mt-1">
 <code
 className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
 dir="ltr"
 >
 {ref.code}
 </code>
 <button
 onClick={() => handleCopy(ref.code)}
 className="text-muted-foreground hover:text-primary transition-colors"
 aria-label="کپی کد"
 >
 {copiedCode === ref.code? (
 <Check className="h-3 w-3 text-emerald-600" />
 ): (
 <Copy className="h-3 w-3" />
 )}
 </button>
 <Badge variant="outline" className={`text-[9px] gap-0.5 ${meta.color}`}>
 <StatusIcon className="h-2.5 w-2.5" />
 {meta.label}
 </Badge>
 </div>
 </div>

 {/* پاداش */}
 {ref.reward > 0 && (
 <div className="text-end shrink-0">
 <p className="text-xs font-bold text-emerald-600 tnum">
 {toPersianDigits(formatNumber(ref.reward))}
 </p>
 <p className="text-[9px] text-muted-foreground">تومان</p>
 </div>
 )}

 {/* اقدامات */}
 <div className="flex items-center gap-1 shrink-0">
 <Button
 size="icon"
 variant="ghost"
 className="h-7 w-7 text-sky-600 hover:bg-sky-500/10"
 onClick={() => handleShareTelegram(ref)}
 aria-label="اشتراک در تلگرام"
 title="تلگرام"
 >
 <Send className="h-3.5 w-3.5" />
 </Button>
 <Button
 size="icon"
 variant="ghost"
 className="h-7 w-7 text-emerald-600 hover:bg-emerald-500/10"
 onClick={() => handleShareWhatsApp(ref)}
 aria-label="اشتراک در واتساپ"
 title="واتساپ"
 >
 <MessageCircle className="h-3.5 w-3.5" />
 </Button>
 <Button
 size="icon"
 variant="ghost"
 className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10"
 onClick={() => handleCopyLink(ref)}
 aria-label="کپی لینک"
 title="کپی لینک"
 >
 <LinkIcon className="h-3.5 w-3.5" />
 </Button>
 <Button
 size="icon"
 variant="ghost"
 className="h-7 w-7 text-primary hover:bg-primary/10"
 onClick={() => handleShare(ref)}
 aria-label="اشتراک‌گذاری"
 title="اشتراک‌گذاری"
 >
 <Share2 className="h-3.5 w-3.5" />
 </Button>
 {ref.status === "PENDING" && (
 <Button
 size="icon"
 variant="ghost"
 className="h-7 w-7 text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10"
 onClick={() => setDeleteId(ref.id)}
 aria-label="حذف"
 >
 <Trash2 className="h-3.5 w-3.5" />
 </Button>
 )}
 </div>
 </div>
 );
 })}
 </div>
 </ScrollArea>
 )}
 </div>

 {/* دیالوگ تأیید حذف */}
 <AlertDialog open={!!deleteId} onOpenChange={(open) =>!open && setDeleteId(null)}>
 <AlertDialogContent>
 <AlertDialogHeader>
 <AlertDialogTitle>حذف کد دعوت؟</AlertDialogTitle>
 <AlertDialogDescription>
 این کد دعوت برای همیشه حذف می‌شود و قابل بازگردانی نیست.
 </AlertDialogDescription>
 </AlertDialogHeader>
 <AlertDialogFooter>
 <AlertDialogCancel>انصراف</AlertDialogCancel>
 <AlertDialogAction
 onClick={handleDelete}
 className="bg-rose-600 hover:bg-rose-700 text-white"
 >
 حذف
 </AlertDialogAction>
 </AlertDialogFooter>
 </AlertDialogContent>
 </AlertDialog>
 </Card>
 );
}

// ============ stat tile ============
function StatTile({
 label,
 value,
 icon: Icon,
 accent,
}: {
 label: string;
 value: string | number;
 icon: React.ComponentType<{ className?: string }>;
 accent?: "primary" | "emerald" | "amber";
}) {
 const accentClass =
 accent === "emerald"
? "text-emerald-600"
: accent === "amber"
? "text-amber-600"
: "text-primary";
 return (
 <div className="bg-card px-4 py-3 flex items-center gap-2.5">
 <Icon className={`h-4 w-4 ${accentClass} shrink-0`} />
 <div className="min-w-0">
 <p className={`text-base font-bold leading-tight tnum truncate ${accentClass}`}>
 {typeof value === "number"? toPersianDigits(value): value}
 </p>
 <p className="text-[10px] text-muted-foreground leading-tight truncate">{label}</p>
 </div>
 </div>
 );
}

export default ReferralWidget;
