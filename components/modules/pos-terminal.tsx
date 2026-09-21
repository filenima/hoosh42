"use client";

/**
 * PosTerminal — صندوق فروش (POS) هوش
 *
 * نسخه‌ی صندوق فروشگاهی برای رستوران‌ها، کافه‌ها و هایپرمارکت‌ها:
 *  - گرید کالای لمسی با دسته‌بندی + جستجو + ورودی بارکد (اسکنر)
 *  - سبد خرید با کنترل تعداد (۴۴px+ هدف لمسی)
 *  - مشتری نقدی پیش‌فرض یا انتخاب طرف‌حساب
 *  - دیالوگ پرداخت: نقدی/کارت/آنلاین + مبلغ دریافتی + محاسبه باقی‌مانده
 *  - ثبت فاکتور SALE نهایی (سند حسابداری + خروج انبار خودکار) + چاپ فیش حرارتی ۸۰mm
 *  - سبد معلق: نگه‌داشتن سفارش مشتری و ادامه بعدی
 *  - گزارش شیفت: تعداد و جمع فروش‌های این شیفت (امروز)
 *  - تمام‌صفحه برای سخت‌افزار POS + ریسپانسیو کامل (موبایل: سبد به‌صورت شیت پایین)
 *
 * معماری: همان APIهای اصلی هوش (/api/accounting/invoices) — یعنی هر فروش POS
 * واقعاً در دفاتر، انبار، مالیات و گزارش‌ها ثبت می‌شود (نه شبیه‌سازی).
 */

import * as React from "react";
import {
 MonitorSmartphone,
 Search,
 Barcode,
 Plus,
 Minus,
 Trash2,
 Printer,
 Loader2,
 User,
 ChevronDown,
 RefreshCw,
 X,
 ShoppingCart,
 Banknote,
 CreditCard,
 Globe,
 Pause,
 Play,
 Maximize2,
 Minimize2,
 Receipt,
 ShoppingBasket,
 Keyboard,
 CheckCircle2,
 CircleDollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatNumber, toPersianDigits, toEnglishDigits } from "@/lib/persian";
import { authFetch } from "@/lib/auth-fetch";
import { openInvoicePrint } from "@/components/ux/print-invoice";

/* ============ انواع ============ */

interface PosProduct {
 id: string;
 name: string;
 sku: string;
 barcode: string | null;
 unit: string;
 salePrice: number; // ریال
 taxRate: number; // کسر
 categoryId: string | null;
 stock: number;
}

interface PosCategory {
 id: string;
 name: string;
}

interface PosParty {
 id: string;
 name: string;
}

interface CartLine {
 key: string;
 productId: string;
 name: string;
 unit: string;
 unitPrice: number; // ریال
 quantity: number;
 taxRate: number;
}

interface HeldOrder {
 id: string;
 at: number;
 customer: string;
 lines: CartLine[];
}

interface ShiftStats {
 date: string; // yyyy-mm-dd
 count: number;
 total: number; // ریال
}

/* ============ ثابت‌ها ============ */

const CASH_CUSTOMER = "فروش نقدی";
const VAT_RATE = 0.1;
const CACHE_TTL = 3 * 60 * 1000;

const PRODUCTS_CACHE_KEY = "hoosh_pos_products";
const CATEGORIES_CACHE_KEY = "hoosh_pos_categories";
const PARTIES_CACHE_KEY = "hoosh_pos_parties";
const HELD_KEY = "hoosh_pos_held";
const SHIFT_KEY = "hoosh_pos_shift";

function todayKey(): string {
 // FIX(v11): تاریخ محلی (ایران +03:30) — قبلاً UTC بود و فروش بعد از نیمه‌شب
 // با تاریخ دیروز ثبت می‌شد و شمارنده شیفت ساعت ۳:۳۰ صبح ریست می‌شد
 const d = new Date();
 const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
 return local.toISOString().slice(0, 10);
}

function readCache<T>(key: string): T | null {
 try {
 const raw = sessionStorage.getItem(key);
 if (!raw) return null;
 const parsed = JSON.parse(raw) as { at: number; data: T };
 if (Date.now() - parsed.at > CACHE_TTL) return null;
 return parsed.data;
 } catch {
 return null;
 }
}

function writeCache<T>(key: string, data: T): void {
 try {
 sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
 } catch {
 /* ignore */
 }
}

/* ============ کامپوننت اصلی ============ */

export function PosTerminal() {
 const { toast } = useToast();

 // داده‌ها
 const [products, setProducts] = React.useState<PosProduct[]>([]);
 const [categories, setCategories] = React.useState<PosCategory[]>([]);
 const [parties, setParties] = React.useState<PosParty[]>([]);
 const [dataLoading, setDataLoading] = React.useState(true);

 // وضعیت UI
 const [activeCategory, setActiveCategory] = React.useState<string>("ALL");
 const [search, setSearch] = React.useState("");
 const [barcode, setBarcode] = React.useState("");
 const searchRef = React.useRef<HTMLInputElement>(null);
 const barcodeRef = React.useRef<HTMLInputElement>(null);

 // سبد
 const [cart, setCart] = React.useState<CartLine[]>([]);
 const [customer, setCustomer] = React.useState(CASH_CUSTOMER);

 // دیالوگ‌ها
 const [payOpen, setPayOpen] = React.useState(false);
 const [customerOpen, setCustomerOpen] = React.useState(false);
 const [customerSearch, setCustomerSearch] = React.useState("");
 const [heldOpen, setHeldOpen] = React.useState(false);

 // پرداخت
 const [payMethod, setPayMethod] = React.useState<"CASH" | "CARD" | "ONLINE">("CASH");
 const [received, setReceived] = React.useState("");
 const [submitting, setSubmitting] = React.useState(false);

 // سبد معلق + شیفت + تمام‌صفحه
 const [heldOrders, setHeldOrders] = React.useState<HeldOrder[]>([]);
 const [shift, setShift] = React.useState<ShiftStats>({ date: todayKey(), count: 0, total: 0 });
 const [isFullscreen, setIsFullscreen] = React.useState(false);

 // مودال موبایل سبد
 const [mobileCartOpen, setMobileCartOpen] = React.useState(false);

 /* ============ بارگذاری داده‌ها ============ */

 const loadData = React.useCallback(async (force = false) => {
 setDataLoading(true);
 try {
 let prods = force ? null : readCache<PosProduct[]>(PRODUCTS_CACHE_KEY);
 let cats = force ? null : readCache<PosCategory[]>(CATEGORIES_CACHE_KEY);
 let prts = force ? null : readCache<PosParty[]>(PARTIES_CACHE_KEY);
 // FIX: آرایهٔ خالی معتبر نیست (کش خراب/قدیمی) — مثل نبودِ کش رفتار کن
 if (prods && prods.length === 0) prods = null;
 if (cats && cats.length === 0) cats = null;
 if (prts && prts.length === 0) prts = null;

 const jobs: Promise<void>[] = [];
 if (!prods) {
 jobs.push(
 authFetch("/api/products?limit=500&sortBy=name&sortOrder=asc", { cache: "no-store" })
 .then((r) => r.json())
 .then((j) => {
 if (j?.success && Array.isArray(j.data)) {
 prods = j.data.map((p: Record<string, unknown>) => ({
 id: String(p.id),
 name: String(p.name || ""),
 sku: String(p.sku || ""),
 barcode: p.barcode ? String(p.barcode) : null,
 unit: String(p.unit || "عدد"),
 salePrice: Number(p.salePrice) || 0,
 taxRate: Number(p.taxRate ?? VAT_RATE) || 0,
 categoryId: p.categoryId ? String(p.categoryId) : null,
 stock: Number(p.stock ?? 0),
 }));
 writeCache(PRODUCTS_CACHE_KEY, prods);
 }
 })
 .catch(() => {})
 );
 }
 if (!cats) {
 jobs.push(
 authFetch("/api/products/categories", { cache: "no-store" })
 .then((r) => r.json())
 .then((j) => {
 if (j?.success && Array.isArray(j.data)) {
 cats = j.data.map((c: Record<string, unknown>) => ({
 id: String(c.id),
 name: String(c.name || ""),
 }));
 writeCache(CATEGORIES_CACHE_KEY, cats);
 }
 })
 .catch(() => {})
 );
 }
 if (!prts) {
 jobs.push(
 authFetch("/api/parties?limit=300&sortBy=name&sortOrder=asc", { cache: "no-store" })
 .then((r) => r.json())
 .then((j) => {
 if (j?.success && Array.isArray(j.data)) {
 prts = j.data.map((p: Record<string, unknown>) => ({
 id: String(p.id),
 name: String(p.name || ""),
 }));
 writeCache(PARTIES_CACHE_KEY, prts);
 }
 })
 .catch(() => {})
 );
 }
 await Promise.all(jobs);
 setProducts(prods || []);
 setCategories(cats || []);
 setParties(prts || []);
 } finally {
 setDataLoading(false);
 }
 }, []);

 // FIX: بارگذاری داده‌ها هنگام mount — قبلاً فراموش شده بود و POS همیشه
 // در حالت skeleton گیر می‌کرد!
 React.useEffect(() => {
 void loadData();
 }, [loadData]);

 // بازیابی سبد معلق و شیفت از localStorage
 React.useEffect(() => {
 try {
 const held = localStorage.getItem(HELD_KEY);
 if (held) setHeldOrders(JSON.parse(held) as HeldOrder[]);
 const sh = localStorage.getItem(SHIFT_KEY);
 if (sh) {
 const parsed = JSON.parse(sh) as ShiftStats;
 // شیفت جدید در روز جدید
 setShift(parsed.date === todayKey() ? parsed : { date: todayKey(), count: 0, total: 0 });
 }
 } catch {
 /* ignore */
 }
 }, []);

 const persistShift = React.useCallback((s: ShiftStats) => {
 setShift(s);
 try {
 localStorage.setItem(SHIFT_KEY, JSON.stringify(s));
 } catch {
 /* ignore */
 }
 }, []);

 /* ============ محاسبات سبد ============ */

 const totals = React.useMemo(() => {
 let subtotal = 0;
 let tax = 0;
 for (const l of cart) {
 const lineNet = l.unitPrice * l.quantity;
 subtotal += lineNet;
 tax += lineNet * l.taxRate;
 }
 return { subtotal, tax, total: subtotal + tax, count: cart.reduce((s, l) => s + l.quantity, 0) };
 }, [cart]);

 const receivedNum = React.useMemo(() => {
 const n = Number(toEnglishDigits(received).replace(/[^\d.]/g, ""));
 return Number.isFinite(n) && n > 0 ? n : 0;
 }, [received]);

 const changeDue = Math.max(0, receivedNum - totals.total);

 /* ============ عملیات سبد ============ */

 const addProduct = React.useCallback(
 (p: PosProduct) => {
 // FIX(v12): کالای بدون قیمت فروش نمی‌تواند به سبد برود — فیش صفر معنا ندارد
 if (!p.salePrice || p.salePrice <= 0) {
 toast({
 title: `«${p.name}» قیمت فروش ندارد`,
 description: "ابتدا قیمت فروش را در ماژول «انبار و کالا» تعیین کنید.",
 variant: "destructive",
 });
 return;
 }
 setCart((prev) => {
 const idx = prev.findIndex((l) => l.productId === p.id);
 if (idx >= 0) {
 const next = [...prev];
 next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
 return next;
 }
 return [
 ...prev,
 {
 key: `${p.id}-${Date.now()}`,
 productId: p.id,
 name: p.name,
 unit: p.unit,
 unitPrice: p.salePrice,
 quantity: 1,
 taxRate: p.taxRate,
 },
 ];
 });
 },
 []
 );

 const changeQty = React.useCallback((key: string, delta: number) => {
 setCart((prev) =>
 prev
 .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
 .filter((l) => l.quantity > 0)
 );
 }, []);

 const removeLine = React.useCallback((key: string) => {
 setCart((prev) => prev.filter((l) => l.key !== key));
 }, []);

 const clearCart = React.useCallback(() => {
 setCart([]);
 setCustomer(CASH_CUSTOMER);
 setReceived("");
 }, []);

 /* ============ بارکد ============ */

 const handleBarcode = React.useCallback(() => {
 const code = toEnglishDigits(barcode.trim());
 if (!code) return;
 const found = products.find(
 (p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase()
 );
 if (found) {
 addProduct(found);
 setBarcode("");
 toast({
 title: `افزوده شد: ${found.name}`,
 description: `${formatNumber(found.salePrice)} ریال × ۱`,
 });
 } else {
 toast({
 title: "کالا یافت نشد",
 description: `بارکد/SKU «${code}» در بانک کالا نیست — از جستجو استفاده کنید.`,
 variant: "destructive",
 });
 }
 }, [barcode, products, addProduct, toast]);

 /* ============ سبد معلق ============ */

 const persistHeld = React.useCallback((list: HeldOrder[]) => {
 setHeldOrders(list);
 try {
 localStorage.setItem(HELD_KEY, JSON.stringify(list.slice(0, 10)));
 } catch {
 /* ignore */
 }
 }, []);

 const holdCart = React.useCallback(() => {
 if (cart.length === 0) return;
 const order: HeldOrder = {
 id: `H-${Date.now()}`,
 at: Date.now(),
 customer,
 lines: cart,
 };
 persistHeld([order, ...heldOrders]);
 clearCart();
 toast({
 title: "سفارش نگه داشته شد",
 description: "سبد خالی شد — از دکمه «سبدهای معلق» ادامه دهید.",
 });
 }, [cart, customer, heldOrders, persistHeld, clearCart, toast]);

 const resumeHeld = React.useCallback(
 (id: string) => {
 const order = heldOrders.find((h) => h.id === id);
 if (!order) return;
 if (cart.length > 0) {
 toast({
 title: "سبد فعلی پر است",
 description: "اول سبد فعلی را تسویه یا نگه دارید.",
 variant: "destructive",
 });
 return;
 }
 setCart(order.lines);
 setCustomer(order.customer);
 persistHeld(heldOrders.filter((h) => h.id !== id));
 setHeldOpen(false);
 },
 [cart, heldOrders, persistHeld, toast]
 );

 /* ============ تمام‌صفحه ============ */

 const toggleFullscreen = React.useCallback(() => {
 try {
 if (!document.fullscreenElement) {
 void document.documentElement.requestFullscreen();
 setIsFullscreen(true);
 } else {
 void document.exitFullscreen();
 setIsFullscreen(false);
 }
 } catch {
 /* ignore */
 }
 }, []);

 /* ============ ثبت فروش ============ */

 const submitSale = React.useCallback(async () => {
 if (cart.length === 0) {
 toast({ title: "سبد خالی است", variant: "destructive" });
 return;
 }
 if (payMethod === "CASH" && receivedNum > 0 && receivedNum < totals.total) {
 toast({
 title: "مبلغ دریافتی کمتر از جمع فاکتور است",
 variant: "destructive",
 });
 return;
 }
 // FIX(v12): جلوگیری از صدور فیش صفر — کالای بی‌قیمت یا سبد اشتباه نباید
 // فاکتور ۰ ریالی بسازد (فاکتورهای صفر در دفاتر و گزارش‌ها نویز می‌سازند)
 if (totals.total <= 0) {
 toast({
 title: "جمع فاکتور صفر است",
 description: "قیمت کالاها را در ماژول «انبار و کالا» تنظیم کنید یا کالای معتبر به سبد اضافه کنید.",
 variant: "destructive",
 });
 return;
 }

 setSubmitting(true);
 try {
 const methodFa = payMethod === "CASH" ? "نقدی" : payMethod === "CARD" ? "کارت‌خوان" : "آنلاین";
 const res = await authFetch("/api/accounting/invoices", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 type: "SALE",
 status: "SENT",
 partyName: customer.trim() || CASH_CUSTOMER,
 description: `فروش صندوق (POS) — پرداخت ${methodFa}`,
 currency: "IRR",
 items: cart.map((l) => ({
 productId: l.productId,
 description: l.name,
 quantity: l.quantity,
 unitPrice: l.unitPrice,
 taxRate: l.taxRate,
 })),
 }),
 });
 const data = await res.json();
 if (!res.ok || !data.success) {
 throw new Error(data.error || "خطا در ثبت فروش");
 }

 const inv = data.data;

 // FIX(حسابداری POS): فروش نقدی/کارتخوان باید «تسویه‌شده» ثبت شود —
 // قبلاً status=SENT و paidAmount=0 می‌ماند → فروش نقدی جزو مطالبات می‌رفت.
 // PATCH markPaid هم paidAmount/status را درست می‌کند و هم سند دریافت
 // (صندوق بدهکار / دریافتنی بستانکار) را در دفاتر ثبت می‌کند.
 // FIX(v11): پرداخت آنلاین PAID نمی‌شود تا وقتی پول واقعاً دریافت نشده —
 // لینک پرداخت بعداً ارسال می‌شود و verify درگاه خودش تسویه می‌کند.
 if (payMethod !== "ONLINE") {
  try {
  const payRes = await authFetch("/api/accounting/invoices", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [inv.id], action: "markPaid" }),
  });
  const payData = await payRes.json().catch(() => null);
  if (payRes.ok && payData?.success) {
    // شیفت با وضعیت نهایی به‌روز شود
    inv.status = "PAID";
    inv.paidAmount = inv.total;
  } else if (payRes.status === 429) {
    // FIX(v11): rate-limit سخت‌گیرانه bulk — به صندو‌دار هشدار بده که تسویه ثبت نشد
    toast({
      title: "تسویه فاکتور به تعویق افتاد",
      description: "سقف درخواست‌های سریع پر شد — از ماژول فاکتورها فاکتور را تسویه کنید.",
      variant: "destructive",
    });
  }
 } catch {
  /* غیرِمهلک — فاکتور ساخته شده؛ تسویه بعداً هم قابل ثبت است */
 }
 }

 // آمار شیفت
 persistShift({
 date: todayKey(),
 count: shift.count + 1,
 total: shift.total + (Number(inv.total) || 0),
 });

 toast({
 title: `فیش ${toPersianDigits(String(inv.number))} صادر شد`,
 description: `مبلغ: ${formatNumber(Number(inv.total) || 0)} ریال — پرداخت ${methodFa}`,
 });

 // FIX(v11): رویداد سراسری — لیست فاکتورها/داشبورد هم‌زمان به‌روز شوند
 if (typeof window !== "undefined") {
 window.dispatchEvent(new CustomEvent("hoshhesab:invoices-changed"));
 }

 // چاپ فیش حرارتی
 if (typeof window !== "undefined") {
 void openInvoicePrint(inv.id, {
 mode: "thermal",
 autoprint: true,
 toast,
 });
 }

 clearCart();
 setPayOpen(false);
 // شارژ مجدد موجودی‌ها (کش ۳ دقیقه‌ای را بی‌اعتبار کن)
 try {
 sessionStorage.removeItem(PRODUCTS_CACHE_KEY);
 } catch {
 /* ignore */
 }
 void loadData(true);
 } catch (err) {
 toast({
 title: "خطا در ثبت فروش",
 description: err instanceof Error ? err.message : "خطای ناشناخته",
 variant: "destructive",
 });
 } finally {
 setSubmitting(false);
 }
 }, [cart, customer, payMethod, receivedNum, totals.total, shift, persistShift, clearCart, loadData, toast]);

 /* ============ فیلتر محصولات ============ */

 const filteredProducts = React.useMemo(() => {
 const q = search.trim().toLowerCase();
 return products.filter((p) => {
 if (activeCategory !== "ALL" && p.categoryId !== activeCategory) return false;
 if (!q) return true;
 return (
 p.name.toLowerCase().includes(q) ||
 p.sku.toLowerCase().includes(q) ||
 (p.barcode ?? "").includes(q)
 );
 });
 }, [products, activeCategory, search]);

 const categoryName = React.useCallback(
 (id: string | null) => categories.find((c) => c.id === id)?.name ?? "بدون دسته",
 [categories]
 );

 const filteredParties = React.useMemo(() => {
 const q = customerSearch.trim().toLowerCase();
 if (!q) return parties.slice(0, 10);
 return parties.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 12);
 }, [parties, customerSearch]);

 /* ============ شورتکات‌های کیبورد ============ */

 React.useEffect(() => {
 const handler = (e: KeyboardEvent) => {
 // F2 → دیالوگ پرداخت
 if (e.key === "F2") {
 e.preventDefault();
 if (cart.length > 0) setPayOpen(true);
 }
 // F3 → فوکوس جستجو
 if (e.key === "F3") {
 e.preventDefault();
 searchRef.current?.focus();
 }
 };
 window.addEventListener("keydown", handler);
 return () => window.removeEventListener("keydown", handler);
 }, [cart.length]);

 /* ============ رندر ============ */

 const categoriesWithCount = React.useMemo(() => {
 const counts = new Map<string, number>();
 for (const p of products) {
 if (p.categoryId) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
 }
 return categories.filter((c) => (counts.get(c.id) ?? 0) > 0);
 }, [products, categories]);

 const productGrid = (
 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 sm:gap-3">
 {dataLoading ? (
 Array.from({ length: 12 }).map((_, i) => (
 <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
 ))
 ) : filteredProducts.length === 0 ? (
 <div className="col-span-full text-center py-16 text-muted-foreground">
 <ShoppingBasket className="h-10 w-10 mx-auto mb-3 opacity-40" />
 <p className="font-medium">کالایی یافت نشد</p>
 <p className="text-xs mt-1">عبارت جستجو را تغییر دهید یا از ماژول «انبار و کالا» کالا اضافه کنید.</p>
 </div>
 ) : (
 filteredProducts.map((p) => (
 <button
 key={p.id}
 onClick={() => addProduct(p)}
 className="group relative flex flex-col justify-between h-24 sm:h-28 rounded-xl border-2 border-border bg-card p-2.5 text-start transition-all hover:border-primary/50 hover:bg-primary/5 hover:shadow-md hover:-translate-y-0.5 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
 aria-label={`افزودن ${p.name} به سبد`}
 >
 <span className="text-[13px] font-bold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
 {p.name}
 </span>
 <span className="flex items-end justify-between gap-1 mt-1">
 <span className="text-[11px] text-muted-foreground">
 {p.stock > 0 ? `موجودی: ${toPersianDigits(String(Math.floor(p.stock)))}` : "ناموجود"}
 </span>
 <span className="text-[11px] font-bold text-teal-600 dark:text-teal-400 whitespace-nowrap">
 {formatCompactRialForPos(p.salePrice)}
 </span>
 </span>
 <span className="absolute top-1.5 end-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 group-hover:opacity-100 transition-opacity">
 <Plus className="h-3 w-3" />
 </span>
 </button>
 ))
 )}
 </div>
 );

 const cartPanel = (
 <div className="flex flex-col h-full">
 {/* مشتری */}
 <button
 onClick={() => setCustomerOpen(true)}
 className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-start hover:bg-muted/70 transition-colors min-h-[44px]"
 aria-label="تغییر مشتری"
 >
 <span className="flex items-center gap-2 min-w-0">
 <User className="h-4 w-4 shrink-0 text-muted-foreground" />
 <span className="text-[13px] font-medium truncate">{customer}</span>
 </span>
 <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
 </button>

 {/* اقلام سبد */}
 <div className="flex-1 overflow-y-auto mt-2.5 space-y-1.5 min-h-0 max-h-[46vh] lg:max-h-none">
 {cart.length === 0 ? (
 <div className="text-center py-10 text-muted-foreground">
 <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-40" />
 <p className="text-xs">سبد خالی است — کالا را لمس کنید یا بارکد بزنید</p>
 </div>
 ) : (
 cart.map((l) => (
 <div
 key={l.key}
 className="flex items-center gap-2 rounded-lg border border-border/70 bg-background px-2 py-1.5"
 >
 <div className="flex-1 min-w-0">
 <p className="text-[12px] font-bold truncate">{l.name}</p>
 <p className="text-[10px] text-muted-foreground">
 {formatNumber(l.unitPrice)} ریال / {l.unit}
 </p>
 </div>
 <div className="flex items-center gap-1">
 <button
 onClick={() => changeQty(l.key, 1)}
 className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 active:scale-90 transition-all"
 aria-label="افزایش"
 >
 <Plus className="h-4 w-4" />
 </button>
 <span className="w-8 text-center text-[13px] font-bold">
 {toPersianDigits(String(l.quantity))}
 </span>
 <button
 onClick={() => changeQty(l.key, -1)}
 className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-foreground hover:bg-muted/70 active:scale-90 transition-all"
 aria-label="کاهش"
 >
 <Minus className="h-4 w-4" />
 </button>
 <button
 onClick={() => removeLine(l.key)}
 className="flex h-8 w-8 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-500/10 active:scale-90 transition-all"
 aria-label="حذف"
 >
 <Trash2 className="h-4 w-4" />
 </button>
 </div>
 </div>
 ))
 )}
 </div>

 {/* جمع‌بندی */}
 <div className="mt-2.5 space-y-1.5 rounded-xl border border-border bg-muted/40 p-3 text-[12px]">
 <div className="flex justify-between text-muted-foreground">
 <span>جمع اقلام ({toPersianDigits(String(totals.count))})</span>
 <span>{formatNumber(totals.subtotal)} ریال</span>
 </div>
 <div className="flex justify-between text-muted-foreground">
 <span>مالیات بر ارزش افزوده</span>
 <span>{formatNumber(totals.tax)} ریال</span>
 </div>
 <Separator className="my-1" />
 <div className="flex justify-between items-center">
 <span className="font-bold text-[13px]">قابل پرداخت</span>
 <span className="font-black text-[15px] text-teal-600 dark:text-teal-400">
 {formatNumber(totals.total)} ریال
 </span>
 </div>
 </div>

 {/* اکشن‌ها */}
 <div className="mt-2.5 grid grid-cols-3 gap-1.5">
 <Button
 variant="outline"
 size="sm"
 className="h-10 text-[11px]"
 onClick={holdCart}
 disabled={cart.length === 0}
 aria-label="نگه داشتن سفارش"
 >
 <Pause className="h-4 w-4" />
 معلق
 </Button>
 <Button
 variant="outline"
 size="sm"
 className="h-10 text-[11px] text-rose-600 hover:text-rose-700 border-rose-500/30"
 onClick={clearCart}
 disabled={cart.length === 0}
 aria-label="خالی کردن سبد"
 >
 <Trash2 className="h-4 w-4" />
 لغو
 </Button>
 <Button
 variant="outline"
 size="sm"
 className="h-10 text-[11px] relative"
 onClick={() => setHeldOpen(true)}
 aria-label="سبدهای معلق"
 >
 <Play className="h-4 w-4" />
 ادامه
 {heldOrders.length > 0 && (
 <Badge className="absolute -top-1.5 -end-1.5 h-4 min-w-4 px-1 text-[9px] p-0">
 {toPersianDigits(String(heldOrders.length))}
 </Badge>
 )}
 </Button>
 </div>
 <Button
 className="mt-1.5 w-full h-14 text-[15px] font-black rounded-xl"
 onClick={() => setPayOpen(true)}
 disabled={cart.length === 0}
 aria-label="پرداخت و صدور فیش"
 >
 <Receipt className="h-5 w-5" />
 پرداخت و صدور فیش
 <kbd className="hidden sm:inline-block ms-2 rounded bg-primary-foreground/20 px-1.5 py-0.5 text-[9px]">F2</kbd>
 </Button>
 </div>
 );

 return (
 <div className="space-y-4 pb-24 lg:pb-0">
 {/* هدر */}
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="flex items-center gap-2.5">
 <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
 <MonitorSmartphone className="h-4.5 w-4.5 text-primary" />
 </div>
 <div>
 <h2 className="text-base font-bold text-foreground">صندوق فروش (POS)</h2>
 <p className="text-[11px] text-muted-foreground">
 فروش سریع رستوران و هایپرمارکت — فیش و فاکتور با یک لمس
 </p>
 </div>
 </div>
 <div className="flex items-center gap-1.5">
 {/* آمار شیفت */}
 <div className="hidden sm:flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-1.5">
 <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
 <CircleDollarSign className="h-3.5 w-3.5" />
 شیفت امروز: {toPersianDigits(String(shift.count))} فروش
 </span>
 <Separator orientation="vertical" className="h-4" />
 <span className="text-[11px] font-bold text-teal-600 dark:text-teal-400">
 {formatNumber(shift.total)} ریال
 </span>
 <button
 className="text-muted-foreground hover:text-foreground transition-colors"
 onClick={() => persistShift({ date: todayKey(), count: 0, total: 0 })}
 aria-label="بستن شیفت"
 title="بستن شیفت (صفر کردن آمار روز)"
 >
 <RefreshCw className="h-3.5 w-3.5" />
 </button>
 </div>
 <Button
 variant="outline"
 size="icon"
 className="h-9 w-9"
 onClick={toggleFullscreen}
 aria-label={isFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
 title={isFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه (برای سخت‌افزار POS)"}
 >
 {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
 </Button>
 </div>
 </div>

 {/* نوار جستجو + بارکد + دسته‌بندی */}
 <div className="space-y-2.5">
 <div className="flex gap-2">
 <div className="relative flex-1">
 <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input
 ref={searchRef}
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder="جستجوی کالا (نام / SKU / بارکد)… F3"
 className="h-11 ps-9 text-[13px] rounded-xl"
 aria-label="جستجوی کالا"
 />
 {search && (
 <button
 onClick={() => setSearch("")}
 className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
 aria-label="پاک کردن جستجو"
 >
 <X className="h-4 w-4" />
 </button>
 )}
 </div>
 <div className="relative w-40 sm:w-52 shrink-0">
 <Barcode className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input
 ref={barcodeRef}
 value={barcode}
 onChange={(e) => setBarcode(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === "Enter") {
 e.preventDefault();
 handleBarcode();
 }
 }}
 placeholder="بارکد + Enter"
 className="h-11 ps-9 font-mono text-[13px] rounded-xl"
 aria-label="ورودی بارکد اسکنر"
 />
 </div>
 </div>

 {/* چیپ‌های دسته‌بندی */}
 <div className="flex gap-1.5 overflow-x-auto pb-1 pos-categories" role="tablist" aria-label="دسته‌بندی کالاها">
 <button
 role="tab"
 aria-selected={activeCategory === "ALL"}
 onClick={() => setActiveCategory("ALL")}
 className={`shrink-0 rounded-full border px-3.5 h-9 text-[12px] font-medium transition-all ${
 activeCategory === "ALL"
 ? "border-primary bg-primary text-primary-foreground shadow"
 : "border-border bg-card text-foreground hover:bg-muted"
 }`}
 >
 همه ({toPersianDigits(String(products.length))})
 </button>
 {categoriesWithCount.map((c) => (
 <button
 key={c.id}
 role="tab"
 aria-selected={activeCategory === c.id}
 onClick={() => setActiveCategory(c.id)}
 className={`shrink-0 rounded-full border px-3.5 h-9 text-[12px] font-medium transition-all ${
 activeCategory === c.id
 ? "border-primary bg-primary text-primary-foreground shadow"
 : "border-border bg-card text-foreground hover:bg-muted"
 }`}
 >
 {c.name}
 </button>
 ))}
 </div>
 </div>

 {/* گرید محصولات + سبد (دسکتاپ) */}
 <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] xl:grid-cols-[1fr_360px] gap-4 items-start">
 <div className="min-h-[300px]">{productGrid}</div>
 <Card className="hidden lg:flex sticky top-20 max-h-[calc(100vh-6rem)] flex-col p-3.5 !rounded-2xl">
 {cartPanel}
 </Card>
 </div>

 {/* نوار سبد موبایل */}
 <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur-xl p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
 <Button
 className="w-full h-14 rounded-xl text-[14px] font-black justify-between"
 onClick={() => setMobileCartOpen(true)}
 disabled={cart.length === 0}
 aria-label="مشاهده سبد خرید"
 >
 <span className="flex items-center gap-2">
 <ShoppingCart className="h-5 w-5" />
 سبد ({toPersianDigits(String(totals.count))} قلم)
 </span>
 <span>{formatNumber(totals.total)} ریال</span>
 </Button>
 </div>

 {/* دیالوگ سبد موبایل */}
 <Dialog open={mobileCartOpen} onOpenChange={setMobileCartOpen}>
 <DialogContent className="max-w-lg w-[95vw] max-h-[90vh] overflow-hidden flex flex-col" dir="rtl">
 <DialogHeader className="text-start">
 <DialogTitle className="flex items-center gap-2">
 <ShoppingCart className="h-4.5 w-4.5 text-primary" />
 سبد خرید
 </DialogTitle>
 </DialogHeader>
 <div className="flex-1 overflow-y-auto -mx-1 px-1">{cartPanel}</div>
 </DialogContent>
 </Dialog>

 {/* دیالوگ پرداخت */}
 <Dialog open={payOpen} onOpenChange={(o) => {
 setPayOpen(o);
 if (!o) setReceived("");
 }}>
 <DialogContent className="max-w-md w-[95vw]" dir="rtl">
 <DialogHeader className="text-start">
 <DialogTitle className="flex items-center gap-2">
 <Banknote className="h-5 w-5 text-teal-600" />
 دریافت پرداخت
 </DialogTitle>
 <DialogDescription>
 جمع قابل پرداخت: {formatNumber(totals.total)} ریال
 ({formatNumber(Math.round(totals.total / 10))} تومان)
 </DialogDescription>
 </DialogHeader>

 {/* روش پرداخت */}
 <div className="grid grid-cols-3 gap-2">
 {(
 [
 { key: "CASH", label: "نقدی", icon: Banknote },
 { key: "CARD", label: "کارت‌خوان", icon: CreditCard },
 { key: "ONLINE", label: "آنلاین", icon: Globe },
 ] as const
 ).map((m) => (
 <button
 key={m.key}
 onClick={() => setPayMethod(m.key)}
 className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 transition-all min-h-[64px] justify-center ${
 payMethod === m.key
 ? "border-primary bg-primary/10 text-primary shadow-sm"
 : "border-border hover:bg-muted"
 }`}
 aria-pressed={payMethod === m.key}
 >
 <m.icon className="h-5 w-5" />
 <span className="text-[12px] font-bold">{m.label}</span>
 </button>
 ))}
 </div>

 {/* مبلغ دریافتی (نقدی) */}
 {payMethod === "CASH" && (
 <div className="space-y-2.5">
 <div>
 <label htmlFor="pos-received" className="text-[12px] font-medium text-muted-foreground mb-1.5 block">
 مبلغ دریافتی از مشتری (ریال)
 </label>
 <Input
 id="pos-received"
 value={received}
 onChange={(e) => setReceived(e.target.value)}
 inputMode="numeric"
 placeholder={String(totals.total)}
 className="h-12 text-[15px] font-bold rounded-xl"
 dir="ltr"
 />
 </div>
 {/* دکمه‌های سریع */}
 <div className="grid grid-cols-4 gap-1.5">
 <button
 onClick={() => setReceived(String(totals.total))}
 className="h-9 rounded-lg border border-border text-[11px] font-bold hover:bg-muted transition-colors"
 >
 دقیق
 </button>
 {[100, 200, 500, 1000].map((t) => (
 <button
 key={t}
 onClick={() => setReceived(String(t * 10000))}
 className="h-9 rounded-lg border border-border text-[11px] font-bold hover:bg-muted transition-colors"
 >
 {toPersianDigits(String(t))}ه‌ت
 </button>
 ))}
 </div>
 {/* باقی‌مانده */}
 <div
 className={`rounded-xl p-3 flex items-center justify-between ${
 changeDue > 0
 ? "bg-amber-500/10 border border-amber-500/30"
 : "bg-teal-500/10 border border-teal-500/30"
 }`}
 >
 <span className="text-[12px] font-medium flex items-center gap-1.5">
 {changeDue > 0 ? (
 <>
 <CircleDollarSign className="h-4 w-4 text-amber-600" />
 باقی‌مانده مشتری
 </>
 ) : (
 <>
 <CheckCircle2 className="h-4 w-4 text-teal-600" />
 تسویه کامل
 </>
 )}
 </span>
 <span className="text-[15px] font-black">
 {formatNumber(receivedNum > 0 ? changeDue : totals.total)} ریال
 </span>
 </div>
 </div>
 )}

 {payMethod === "CARD" && (
 <p className="text-[12px] text-muted-foreground rounded-xl bg-muted/50 p-3 leading-relaxed">
 مبلغ را روی کارت‌خوان دریافت و تأیید کنید، سپس «صدور فیش» را بزنید. شماره مرجع تراکنش را می‌توانید در توضیحات فاکتور ثبت کنید.
 </p>
 )}
 {payMethod === "ONLINE" && (
 <p className="text-[12px] text-muted-foreground rounded-xl bg-muted/50 p-3 leading-relaxed">
 لینک پرداخت آنلاین برای مشتری پیامک/واتساپ می‌شود — پس از صدور فیش، از ماژول «فاکتورها» دکمه «پرداخت آنلاین» را بزنید.
 </p>
 )}

 <DialogFooter className="gap-2 sm:gap-0">
 <Button variant="outline" onClick={() => setPayOpen(false)} disabled={submitting} className="h-11">
 انصراف
 </Button>
 <Button onClick={submitSale} disabled={submitting} className="h-11 font-bold flex-1 sm:flex-none">
 {submitting ? (
 <>
 <Loader2 className="h-4 w-4 animate-spin" />
 در حال ثبت…
 </>
 ) : (
 <>
 <Printer className="h-4 w-4" />
 صدور فیش و ثبت فروش
 </>
 )}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* دیالوگ انتخاب مشتری */}
 <Dialog open={customerOpen} onOpenChange={setCustomerOpen}>
 <DialogContent className="max-w-md w-[95vw]" dir="rtl">
 <DialogHeader className="text-start">
 <DialogTitle>انتخاب مشتری</DialogTitle>
 <DialogDescription>مشتری نقدی یا طرف‌حساب ثبت‌شده</DialogDescription>
 </DialogHeader>
 <div className="relative">
 <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input
 value={customerSearch}
 onChange={(e) => setCustomerSearch(e.target.value)}
 placeholder="جستجوی نام مشتری…"
 className="h-11 ps-9 rounded-xl"
 autoFocus
 />
 </div>
 <div className="max-h-72 overflow-y-auto space-y-1.5">
 <button
 onClick={() => {
 setCustomer(CASH_CUSTOMER);
 setCustomerOpen(false);
 setCustomerSearch("");
 }}
 className="w-full flex items-center justify-between rounded-xl border-2 border-teal-500/40 bg-teal-500/5 hover:bg-teal-500/10 p-3 transition-colors text-start"
 >
 <span className="font-bold text-[13px] flex items-center gap-2">
 <Banknote className="h-4 w-4 text-teal-600" />
 {CASH_CUSTOMER}
 </span>
 <Badge variant="secondary" className="text-[10px]">پیش‌فرض</Badge>
 </button>
 {filteredParties.map((p) => (
 <button
 key={p.id}
 onClick={() => {
 setCustomer(p.name);
 setCustomerOpen(false);
 setCustomerSearch("");
 }}
 className="w-full flex items-center gap-2 rounded-xl border border-border hover:bg-muted p-3 transition-colors text-start"
 >
 <User className="h-4 w-4 text-muted-foreground shrink-0" />
 <span className="text-[13px] font-medium truncate">{p.name}</span>
 </button>
 ))}
 {filteredParties.length === 0 && (
 <p className="text-center text-xs text-muted-foreground py-6">طرف‌حسابی یافت نشد</p>
 )}
 </div>
 </DialogContent>
 </Dialog>

 {/* دیالوگ سبدهای معلق */}
 <Dialog open={heldOpen} onOpenChange={setHeldOpen}>
 <DialogContent className="max-w-md w-[95vw]" dir="rtl">
 <DialogHeader className="text-start">
 <DialogTitle className="flex items-center gap-2">
 <Pause className="h-4.5 w-4.5 text-amber-500" />
 سبدهای معلق ({toPersianDigits(String(heldOrders.length))})
 </DialogTitle>
 <DialogDescription>سفارش‌های نگه‌داشته‌شده — برای ادامه لمس کنید</DialogDescription>
 </DialogHeader>
 <div className="max-h-80 overflow-y-auto space-y-2">
 {heldOrders.length === 0 ? (
 <p className="text-center text-xs text-muted-foreground py-8">
 سفارش معلقی نیست — با دکمه «معلق» سبد فعلی را نگه دارید
 </p>
 ) : (
 heldOrders.map((h) => {
 const hTotal = h.lines.reduce(
 (s, l) => s + l.unitPrice * l.quantity * (1 + l.taxRate),
 0
 );
 return (
 <div key={h.id} className="rounded-xl border border-border p-3 space-y-2">
 <div className="flex items-center justify-between gap-2">
 <div className="min-w-0">
 <p className="font-bold text-[13px] truncate">{h.customer}</p>
 <p className="text-[11px] text-muted-foreground">
 {toPersianDigits(new Date(h.at).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }))} •{" "}
 {toPersianDigits(String(h.lines.length))} قلم
 </p>
 </div>
 <span className="text-[12px] font-bold text-teal-600 whitespace-nowrap">
 {formatNumber(hTotal)} ریال
 </span>
 </div>
 <div className="flex gap-1.5">
 <Button size="sm" className="h-9 flex-1 text-[12px]" onClick={() => resumeHeld(h.id)}>
 <Play className="h-3.5 w-3.5" />
 ادامه سفارش
 </Button>
 <Button
 size="sm"
 variant="outline"
 className="h-9 text-rose-600 border-rose-500/30 hover:text-rose-700 text-[12px]"
 onClick={() => persistHeld(heldOrders.filter((x) => x.id !== h.id))}
 >
 <Trash2 className="h-3.5 w-3.5" />
 حذف
 </Button>
 </div>
 </div>
 );
 })
 )}
 </div>
 </DialogContent>
 </Dialog>

 {/* راهنمای شورتکات */}
 <div className="hidden xl:flex items-center gap-4 text-[11px] text-muted-foreground border-t border-border pt-3">
 <span className="flex items-center gap-1.5">
 <Keyboard className="h-3.5 w-3.5" />
 شورتکات‌ها:
 </span>
 <kbd className="rounded border border-border bg-muted px-1.5 py-0.5">F2</kbd>
 <span>پرداخت</span>
 <kbd className="rounded border border-border bg-muted px-1.5 py-0.5">F3</kbd>
 <span>جستجو</span>
 <span className="ms-auto">هر فروش POS به‌صورت خودکار در دفاتر، انبار و مالیات ثبت می‌شود</span>
 </div>
 </div>
 );
}

/** نمایش فشرده قیمت برای کاشی کالا (ریال → خوانا) */
function formatCompactRialForPos(rial: number): string {
 const toman = Math.round(rial / 10);
 if (toman >= 1_000_000) return `${formatNumber(Math.round(toman / 1000))}ه‌ت`;
 if (toman >= 1000) return `${formatNumber(toman)} ت`;
 return `${formatNumber(toman)} ت`;
}

export default PosTerminal;
