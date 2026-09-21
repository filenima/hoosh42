"use client";

import * as React from "react";
import { ChevronsUpDown, Package, PackageX, Search, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { authFetch } from "@/lib/auth-fetch";
import { toPersianDigits, formatPriceCompact } from "@/lib/persian";

/**
 * ProductPicker — انتخاب‌گر کالا با جستجوی سمت سرور (PERF-1200)
 *
 * مشکل: با ۱۲۰۰+ کالا، فرم‌های فاکتور قبلاً فقط ۲۰۰–۵۰۰ کالای اول را
 * واکشی می‌کردند (بقیه در جستجو «گم» می‌شدند) و Select با ۱۲۰۰ آیتم
 * کل صفحه را کند می‌کرد.
 *
 * راه‌حل: Combobox با جستجوی debounce سمت سرور (۲۵ نتیجه) +
 * نمایش موجودی هر کالا + (ZERO-STOCK) درخواست مالک: کالای بدون موجودی هم
 * قابل انتخاب است — فقط یک بار هشدار می‌دهد و با تیک «دیگر نپرس» دیگر
 * نمی‌پرسد (ذخیره در localStorage).
 */

export interface PickerProduct {
 id: string;
 name: string;
 sku: string;
 unit: string;
 salePrice: number; // ریال
 purchasePrice: number; // ریال — برای فاکتور خرید
 taxRate: number;
 stock: number;
}

const ZERO_STOCK_OK_KEY = "hoshhesab_zero_stock_ok";

export function isZeroStockAllowed(): boolean {
 try {
 return localStorage.getItem(ZERO_STOCK_OK_KEY) === "1";
 } catch {
 return false;
 }
}

interface ProductPickerProps {
 value: string | null;
 onSelect: (p: PickerProduct) => void;
 placeholder?: string;
 /** برچسب شناخته‌شدهٔ value (مثلاً نام کالا از ردیف فاکتور در حال ویرایش) */
 initialLabel?: string | null;
 /** متن دکمه وقتی کالایی انتخاب نشده */
 triggerClassName?: string;
 /** نمایش قیمت در آیتم‌ها (پیش‌فرض: بله) */
 showPrice?: boolean;
 disabled?: boolean;
 /** برچسب واحد نمایش قیمت (پیش‌فرض تومان) */
 priceUnit?: "toman" | "rial";
 autoFocus?: boolean;
}

export function ProductPicker({
 value,
 onSelect,
 placeholder = "انتخاب کالا...",
 initialLabel,
 triggerClassName,
 showPrice = true,
 disabled = false,
 priceUnit = "toman",
 autoFocus = false,
}: ProductPickerProps) {
 const [open, setOpen] = React.useState(false);
 const [query, setQuery] = React.useState("");
 const [items, setItems] = React.useState<PickerProduct[]>([]);
 const [loading, setLoading] = React.useState(false);
 const [selected, setSelected] = React.useState<PickerProduct | null>(null);
 const [loadedOnce, setLoadedOnce] = React.useState(false);

 // ZERO-STOCK: دیالوگ تأیید + تیک «دیگر نپرس»
 const [pendingZero, setPendingZero] = React.useState<PickerProduct | null>(null);
 const [dontAskAgain, setDontAskAgain] = React.useState(false);

 const requestIdRef = React.useRef(0);

 // جستجوی سرور با debounce ۲۵۰ms — سبک روی دیتابیس (ایندکس‌دار)
 React.useEffect(() => {
 if (!open) return;
 const rid = ++requestIdRef.current;
 const timer = setTimeout(async () => {
 setLoading(true);
 try {
 const q = query.trim();
 const url = q
 ? `/api/products?search=${encodeURIComponent(q)}&limit=25&sortBy=name&sortOrder=asc`
 : `/api/products?limit=25&sortBy=name&sortOrder=asc`;
 const res = await authFetch(url, { cache: "no-store" });
 const json = (await res.json().catch(() => ({}))) as {
 success?: boolean;
 data?: Array<Record<string, unknown>>;
 };
 if (rid !== requestIdRef.current) return; // پاسخ کهنه — دور بریز
 if (json?.success && Array.isArray(json.data)) {
 setItems(
 json.data.map((p) => ({
 id: String(p.id ?? ""),
 name: String(p.name ?? ""),
 sku: String(p.sku ?? ""),
 unit: String(p.unit ?? "عدد"),
 salePrice: Number(p.salePrice ?? 0) || 0,
 purchasePrice: Number((p as { purchasePrice?: number }).purchasePrice ?? 0) || 0,
 taxRate: Number(p.taxRate ?? 0.1) || 0,
 stock: Number((p as { stock?: number }).stock ?? 0) || 0,
 }))
 );
 } else {
 setItems([]);
 }
 } catch {
 if (rid === requestIdRef.current) setItems([]);
 } finally {
 if (rid === requestIdRef.current) {
 setLoading(false);
 setLoadedOnce(true);
 }
 }
 }, query ? 250 : 0);
 return () => clearTimeout(timer);
 }, [open, query]);

 // اگر value از بیرون عوض شد (مثلاً ردیف از پیش پر شده)، نام کالا را نگه می‌داریم —
 // اولویت: کالای انتخاب‌شده در همین نشست، بعد initialLabel فراخوان (حالت ویرایش)
 React.useEffect(() => {
 if (value && selected?.id !== value) {
 const cached = items.find((i) => i.id === value);
 if (cached) setSelected(cached);
 else if (initialLabel) setSelected({ id: value, name: initialLabel, sku: "", unit: "عدد", salePrice: 0, purchasePrice: 0, taxRate: 0.1, stock: 0 });
 }
 if (!value) setSelected(null);
 }, [value, initialLabel]);  

 const acceptProduct = (p: PickerProduct) => {
 setSelected(p);
 onSelect(p);
 setQuery("");
 setOpen(false);
 };

 const trySelect = (p: PickerProduct) => {
 if (p.stock <= 0 && !isZeroStockAllowed()) {
 setPendingZero(p);
 setDontAskAgain(false);
 return;
 }
 acceptProduct(p);
 };

 const confirmZeroStock = () => {
 if (dontAskAgain) {
 try {
 localStorage.setItem(ZERO_STOCK_OK_KEY, "1");
 } catch {
 /* ignore */
 }
 }
 if (pendingZero) acceptProduct(pendingZero);
 setPendingZero(null);
 };

 const displayLabel = selected?.name ?? "";

 return (
 <>
 <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
 <PopoverTrigger asChild>
 <Button
 type="button"
 variant="outline"
 role="combobox"
 aria-expanded={open}
 disabled={disabled}
 className={`h-9 w-full justify-between text-xs font-normal ${triggerClassName ?? ""}`}
 >
 {displayLabel ? (
 <span className="flex min-w-0 items-center gap-1.5 truncate">
 <span className="truncate">{displayLabel}</span>
 {selected && selected.stock <= 0 && (
 <Badge variant="outline" className="shrink-0 bg-warning/10 text-warning border-warning/30 text-[9px] px-1">
 صفر
 </Badge>
 )}
 </span>
 ) : (
 <span className="text-muted-foreground">{placeholder}</span>
 )}
 <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
 </Button>
 </PopoverTrigger>
 <PopoverContent className="w-[min(94vw,26rem)] p-0" align="start">
 <Command shouldFilter={false}>
 <CommandInput
 value={query}
 onValueChange={setQuery}
 placeholder="جستجو در نام، کد کالا یا بارکد..."
 className="h-9 text-xs"
 autoFocus={autoFocus}
 />
 <CommandList className="max-h-64">
 {loading && !loadedOnce ? (
 <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
 <Loader2 className="h-4 w-4 animate-spin" />
 در حال بارگذاری...
 </div>
 ) : loading ? (
 <div className="flex items-center justify-center py-4">
 <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
 </div>
 ) : items.length === 0 ? (
 <CommandEmpty>
 {query.trim()
 ? `کالایی مطابق «${query.trim()}» یافت نشد`
 : "کالایی ثبت نشده است"}
 </CommandEmpty>
 ) : (
 <CommandGroup>
 {items.map((p) => (
 <CommandItem
 key={p.id}
 value={p.id}
 onSelect={() => trySelect(p)}
 className="gap-2 py-2"
 >
 <div className="flex min-w-0 flex-1 flex-col gap-0.5">
 <div className="flex items-center gap-1.5">
 <span className="truncate text-xs font-medium">{p.name}</span>
 {p.stock <= 0 ? (
 <Badge variant="outline" className="shrink-0 bg-warning/10 text-warning border-warning/30 text-[9px] px-1 py-0">
 موجودی صفر
 </Badge>
 ) : (
 <Badge variant="outline" className="shrink-0 bg-success/10 text-success border-success/30 text-[9px] px-1 py-0 tnum">
 {toPersianDigits(String(p.stock))} {p.unit}
 </Badge>
 )}
 </div>
 <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
 <span className="font-mono" dir="ltr">{p.sku || "—"}</span>
 {showPrice && p.salePrice > 0 && (
 <span className="tnum">
 {formatPriceCompact(p.salePrice, priceUnit)}
 </span>
 )}
 </div>
 </div>
 {p.stock <= 0 ? (
 <PackageX className="h-4 w-4 shrink-0 text-warning" />
 ) : (
 <Package className="h-4 w-4 shrink-0 text-success/70" />
 )}
 </CommandItem>
 ))}
 </CommandGroup>
 )}
 </CommandList>
 {items.length >= 25 && (
 <div className="border-t border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground text-center">
 برای نتایج بیشتر، عبارت دقیق‌تری جستجو کنید
 </div>
 )}
 </Command>
 </PopoverContent>
 </Popover>

 {/* ZERO-STOCK: تأیید افزودن کالای بدون موجودی (درخواست مالک) */}
 <Dialog open={!!pendingZero} onOpenChange={(o) => { if (!o) setPendingZero(null); }}>
 <DialogContent className="sm:max-w-sm">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2 text-sm">
 <PackageX className="h-4 w-4 text-warning" />
 موجودی این کالا صفر است
 </DialogTitle>
 <DialogDescription className="text-xs">
 «{pendingZero?.name}» موجودی صفر دارد. آیا می‌خواهید آن را در سند/فاکتور درج کنید؟
 </DialogDescription>
 </DialogHeader>
 <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-muted/30 p-3">
 <Checkbox
 checked={dontAskAgain}
 onCheckedChange={(c) => setDontAskAgain(c === true)}
 className="mt-0.5"
 />
 <span className="text-[11px] leading-relaxed text-muted-foreground">
 <span className="font-medium text-foreground">دیگر نپرس</span> — کالاهای بدون موجودی از این پس بدون
 پرسش مستقیماً اضافه شوند (قابل تغییر از تنظیمات).
 </span>
 </label>
 <DialogFooter className="gap-2">
 <Button variant="outline" size="sm" onClick={() => setPendingZero(null)}>
 انصراف
 </Button>
 <Button size="sm" onClick={confirmZeroStock}>
 ادامه و افزودن کالا
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </>
 );
}
