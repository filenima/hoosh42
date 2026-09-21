"use client";

/**
 * QuickInvoice — فاکتور سریع برای کسب‌وکارهای کوچک، خرده‌فروشی و رستوران‌ها
 *
 * هدف: سریع‌ترین حالت ثبت فاکتور — کمترین کلیک، پر شدن خودکار اکثر فیلدها:
 *  - مشتری پیش‌فرض «فروش نقدی» (بدون نیاز به انتخاب)
 *  - جستجوی کالا با لمس/کلیک → ردیف اضافه می‌شود (قیمت و مالیات خودکار)
 *  - تاریخ/شماره/ارز خودکار
 *  - ثبت + چاپ رسید حرارتی (۸۰mm) یا A4 — با لوگو، شعار و وب‌سایت کسب‌وکار
 *  - لیست فاکتورهای اخیر با جزئیات کامل
 *
 * طراحی mobile-first با هدفون لمسی بزرگ (۴۴px+)
 */

import * as React from "react";
import {
 Zap,
 Search,
 Plus,
 Minus,
 Trash2,
 Printer,
 Receipt,
 Share2,
 CheckCircle2,
 Loader2,
 User,
 ChevronDown,
 RefreshCw,
 FileText,
 X,
 ShoppingCart,
 Percent,
 Sparkles,
 // Task 21-B:
 Clock,
 Pencil,
 RotateCw,
 // QUICK-INV-MGMT: دکمهٔ ورود به ماژول کامل فاکتورها
 ListOrdered,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
 DialogDescription,
 DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { formatNumber, toPersianDigits, toEnglishDigits, INVOICE_STATUS_FA } from "@/lib/persian";
import { authFetch } from "@/lib/auth-fetch";
import { openInvoicePrint } from "@/components/ux/print-invoice";
// Task 21-B: تاریخ‌گزین جلالی برای سررسید قرضی + فرم ویرایش فاکتور
import { JalaliDatePicker } from "@/components/ui/jalali-date-picker";
const InvoiceFormLazy = React.lazy(() =>
 import("@/components/ux/invoice-form").then((m) => ({ default: m.InvoiceForm }))
);
import type { InvoiceFormInitialInvoice } from "@/components/ux/invoice-form";

/* ============ انواع ============ */

interface QuickProduct {
 id: string;
 name: string;
 sku: string;
 unit: string;
 salePrice: number;
 taxRate: number;
 stock?: number; // ZERO-STOCK: نمایش موجودی + هشدار کالای بدون موجودی
}

interface QuickParty {
 id: string;
 name: string;
}

interface QuickItemRow {
 key: string;
 productId: string | null;
 description: string;
 quantity: number;
 unitPrice: number;
 /** نرخ مالیات روی ارزش افزوده این قلم (کسر — مثل 0.1) */
 taxRate: number;
}

interface RecentInvoice {
 id: string;
 number: string;
 type: string;
 status: string;
 date: string;
 dueDate?: string | null;
 paymentType?: string | null;
 party: { id: string; name: string } | null;
 total: number;
 items: { id: string; description: string; quantity: number; unitPrice: number; total: number }[];
}

/** شمارندهٔ جلسه‌ای/روزانهٔ «چندفاکتور» — Task 21-B */
function todaySessionKey(): string {
 const d = new Date();
 const y = d.getFullYear();
 const m = String(d.getMonth() + 1).padStart(2, "0");
 const day = String(d.getDate()).padStart(2, "0");
 return `hoosh_quick_invoice_count_${y}${m}${day}`;
}

function readSessionCount(): number {
 try {
 const raw = sessionStorage.getItem(todaySessionKey());
 const n = Number(raw);
 return Number.isFinite(n) && n > 0 ? n : 0;
 } catch {
 return 0;
 }
}

function bumpSessionCount(): number {
 const next = readSessionCount() + 1;
 try {
 sessionStorage.setItem(todaySessionKey(), String(next));
 } catch {
 /* ignore quota */
 }
 return next;
}

/* ============ ثابت‌ها ============ */

const CASH_CUSTOMER = "فروش نقدی";
// FIX(مالیات ۱۴۰۴): نرخ مالیات بر ارزش افزوده ایران از ۱۰٪ است (قبلاً ۹٪ بود)
const VAT_RATE = 0.1;
const CACHE_TTL = 3 * 60 * 1000; // ۳ دقیقه

const PRODUCTS_CACHE_KEY = "hoosh_quick_products_v2"; // PERF-1200: v2 — ساختار جدید با stock
const PARTIES_CACHE_KEY = "hoosh_quick_parties";

function uid() {
 return Math.random().toString(36).slice(2, 10);
}

function readCache<T>(key: string): T | null {
 try {
 const raw = sessionStorage.getItem(key);
 if (!raw) return null;
 const parsed = JSON.parse(raw) as { t?: unknown; d?: unknown };
 // FIX(low): JSON فاسد با t نامشخص → Date.now()-undefined = NaN → شرط TTL همیشه false
 if (
 !parsed ||
 typeof parsed.t!== "number" ||
 Number.isNaN(parsed.t) ||
 Date.now() - parsed.t > CACHE_TTL
 ) {
 return null;
 }
 return parsed.d as T;
 } catch {
 return null;
 }
}

function writeCache(key: string, data: unknown) {
 try {
 sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data }));
 } catch {
 /* ignore quota */
 }
}

/* ============ کامپوننت اصلی ============ */

export function QuickInvoice() {
 const { toast } = useToast();

 // داده‌های پایه
 const [products, setProducts] = React.useState<QuickProduct[]>([]);
 const [parties, setParties] = React.useState<QuickParty[]>([]);
 const [dataLoading, setDataLoading] = React.useState(true);

 // فرم
 const [customerName, setCustomerName] = React.useState<string>(CASH_CUSTOMER);
 const [customCustomer, setCustomCustomer] = React.useState(false);
 const [items, setItems] = React.useState<QuickItemRow[]>([]);
 // FIX(TAX-DEFAULT — درخواست مالک): مالیات به‌صورت پیش‌فرض خاموش — فروشگاه
 // خرد اغلب معاف است؛ کاربر خودش با سوییچ روشنش می‌کند (نرخ هر کالا حفظ می‌شود).
 const [withTax, setWithTax] = React.useState(false);
 const [discountPct, setDiscountPct] = React.useState(0);
 const [note, setNote] = React.useState("");
 const [submitting, setSubmitting] = React.useState(false);

 // Task 21-B: قرضی (نسیه) + سررسید + شمارندهٔ چندفاکتور
 const [isCredit, setIsCredit] = React.useState(false);
 const [dueDate, setDueDate] = React.useState("");
 const [sessionCount, setSessionCount] = React.useState(0);
 React.useEffect(() => {
 setSessionCount(readSessionCount());
 }, []);

 // Task 21-B: ویرایش فاکتور اخیر — همان فرم اصلی پیش‌پرشده
 const [editInvoice, setEditInvoice] = React.useState<InvoiceFormInitialInvoice | null>(null);
 const [editOpen, setEditOpen] = React.useState(false);
 const [editLoading, setEditLoading] = React.useState(false);
 const searchInputRef = React.useRef<HTMLInputElement | null>(null);

 // جستجوی کالا
 const [searchOpen, setSearchOpen] = React.useState(false);
 const [searchQuery, setSearchQuery] = React.useState("");
 // PERF-1200: نتایج جستجوی سرور (سراسری در همهٔ کالاها — نه فقط ۵۰۰ کالای اول)
 const [serverResults, setServerResults] = React.useState<QuickProduct[]>([]);
 const [searchFetching, setSearchFetching] = React.useState(false);
 // ZERO-STOCK (درخواست مالک): هشدار یک‌باره + تیک «دیگر نپرس»
 const [zeroStockPending, setZeroStockPending] = React.useState<QuickProduct | null>(null);
 const [zeroStockDontAsk, setZeroStockDontAsk] = React.useState(false);

 // انتخاب مشتری
 const [customerOpen, setCustomerOpen] = React.useState(false);
 const [customerSearch, setCustomerSearch] = React.useState("");
 const [newCustomerName, setNewCustomerName] = React.useState("");

 // نتیجه ثبت
 const [lastSaved, setLastSaved] = React.useState<{ id: string; number: string; total: number } | null>(null);

 // فاکتورهای اخیر
 const [recent, setRecent] = React.useState<RecentInvoice[]>([]);
 const [recentLoading, setRecentLoading] = React.useState(true);
 const [detailInvoice, setDetailInvoice] = React.useState<RecentInvoice | null>(null);

 /* ============ بارگذاری داده‌ها (با کش) ============ */

 const loadBaseData = React.useCallback(async (force = false) => {
 setDataLoading(true);
 try {
 // FIX(WH-6 — stale-while-revalidate): کش فقط برای «نمایش فوری» است؛
 // همیشه یک fetch تازه در پس‌زمینه انجام می‌شود تا لیست هرگز کهنه نماند.
 let prods = force? null: readCache<QuickProduct[]>(PRODUCTS_CACHE_KEY);
 let prts = force? null: readCache<QuickParty[]>(PARTIES_CACHE_KEY);

 // نمایش فوری از کش (اگر موجود بود) — UI بلاک نمی‌شود
 if (prods) setProducts(prods);
 if (prts) setParties(prts);

 const jobs: Promise<void>[] = [];
 jobs.push(
 // PERF-1200: فقط ۱۲ کالای اول برای پیش‌فرض — جستجوی کامل سمت سرور انجام می‌شود
 // (قبلاً limit=500 واکشی می‌شد: با ۱۲۰۰+ کالا، ۷۰۰+ کالا در جستجو «گم» می‌شدند)
 authFetch("/api/products?limit=12&sortBy=name&sortOrder=asc", { cache: "no-store" })
 .then((r) => r.json())
 .then((j) => {
 if (j?.success && Array.isArray(j.data)) {
 prods = j.data.map((p: Record<string, unknown>) => ({
 id: String(p.id),
 name: String(p.name || ""),
 sku: String(p.sku || ""),
 unit: String(p.unit || "عدد"),
 salePrice: Number(p.salePrice) || 0,
 // FIX(M14): نرخ مالیات خودِ کالا — کالای معاف/با نرخ متفاوت دیگر ۱۰٪ سراسری نمی‌گیرد
 taxRate: Number(p.taxRate ?? VAT_RATE) || 0,
 stock: Number((p as { stock?: number }).stock ?? 0) || 0,
 }));
 writeCache(PRODUCTS_CACHE_KEY, prods);
 setProducts(prods as QuickProduct[]);
 }
 })
 .catch(() => {})
 );
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
 setParties(prts as QuickParty[]);
 }
 })
 .catch(() => {})
 );
 await Promise.all(jobs);
 } finally {
 setDataLoading(false);
 }
 }, []);

 const loadRecent = React.useCallback(async () => {
 setRecentLoading(true);
 try {
 // QUICK-INV-MGMT (درخواست مالک): ۸ → ۲۰ فاکتور اخیر + شمار کل برای
 // ناحیهٔ مدیریت فاکتورهای زیر فرم سریع
 const res = await authFetch("/api/v1/invoices?limit=20", { cache: "no-store" });
 const j = await res.json();
 if (j?.success && Array.isArray(j.data)) {
 setRecent(j.data as RecentInvoice[]);
 }
 } catch {
 /* ignore */
 } finally {
 setRecentLoading(false);
 }
 }, []);

 // Task 21-B: ویرایش فاکتور اخیر — واکشی جزئیات کامل و باز کردن فرم پیش‌پرشده
 const handleEditRecent = React.useCallback(
 async (inv: RecentInvoice) => {
 setEditLoading(true);
 try {
 const res = await authFetch(
 `/api/invoices/${encodeURIComponent(inv.id)}?include=items,party`,
 { cache: "no-store" }
 );
 const json = await res.json().catch(() => ({}));
 if (!res.ok || !json?.success) {
 throw new Error(json?.error || "دریافت جزئیات فاکتور ناموفق بود");
 }
 const d = json.data as Record<string, unknown>;
 setEditInvoice({
 id: String(d.id),
 number: String(d.number ?? ""),
 type: d.type ? String(d.type) : undefined,
 partyId: d.partyId ? String(d.partyId) : undefined,
 date: d.date ? String(d.date) : undefined,
 dueDate: d.dueDate ? String(d.dueDate) : null,
 warehouseId: d.warehouseId ? String(d.warehouseId) : null,
 description: d.description ? String(d.description) : null,
 currency: d.currency ? String(d.currency) : undefined,
 exchangeRate: typeof d.exchangeRate === "number" ? d.exchangeRate : null,
 paymentType: d.paymentType ? String(d.paymentType) : null,
 status: d.status ? String(d.status) : undefined,
 items: Array.isArray(d.items)
 ? (d.items as Array<Record<string, unknown>>).map((it) => ({
 productId: it.productId ? String(it.productId) : null,
 description: it.description ? String(it.description) : "",
 quantity: Number(it.quantity ?? 1),
 unitPrice: Number(it.unitPrice ?? 0),
 discount: Number(it.discount ?? 0),
 taxRate: Number(it.taxRate ?? 0.1),
 }))
 : [],
 });
 setDetailInvoice(null);
 setEditOpen(true);
 } catch (err) {
 toast({
 title: "خطا در باز کردن ویرایش",
 description: err instanceof Error? err.message: "خطای ناشناخته",
 variant: "destructive",
 });
 } finally {
 setEditLoading(false);
 }
 },
 [toast]
 );

 React.useEffect(() => {
 loadBaseData();
 loadRecent();
 }, [loadBaseData, loadRecent]);

 // FIX(WH-6): کش کالا/طرف‌ها هنگام تغییر داده در سایر ماژول‌ها (انبار، فاکتور اصلی و...)
 // بی‌درنگ ابطال و بازخوانی می‌شود — قبلاً فاکتور سریع تا ۳ دقیقه لیست قدیمی نشان می‌داد
 // و «کالای تازه ثبت‌شده در فاکتور سریع نمایش داده نمی‌شد».
 React.useEffect(() => {
 const onDataChanged = (e: Event) => {
 const detail = (e as CustomEvent<{ entity?: string }>).detail;
 const entity = detail?.entity;
 if (entity && entity!== "products" && entity!== "parties" && entity!== "all") return;
 // کش مرتبط را مستقیم پاک می‌کنیم (حتی اگر entity فقط یکی باشد، هر دو ارزان است)
 try {
 localStorage.removeItem(PRODUCTS_CACHE_KEY);
 localStorage.removeItem(PARTIES_CACHE_KEY);
 } catch {
 /* ignore */
 }
 loadBaseData(true); // force — دور کش
 };
 window.addEventListener("hoshhesab:data-changed", onDataChanged as EventListener);
 return () =>
 window.removeEventListener("hoshhesab:data-changed", onDataChanged as EventListener);
 }, [loadBaseData]);

 // FIX(WH-6): وقتی ماژول دوباره نمایان می‌شود (سوییچ بین ماژول‌ها بدون unmount)
 // هم‌راستا با چرخه عمر ساده، کش تازه می‌شود
 React.useEffect(() => {
 const onVisible = () => {
 if (document.visibilityState === "visible") loadBaseData(true);
 };
 document.addEventListener("visibilitychange", onVisible);
 return () => document.removeEventListener("visibilitychange", onVisible);
 }, [loadBaseData]);

 /* ============ محاسبات ============ */

 const lineNet = React.useCallback(
 (r: QuickItemRow) => {
 const gross = r.quantity * r.unitPrice;
 return gross * (1 - discountPct / 100);
 },
 [discountPct]
 );

 const subtotal = items.reduce((s, r) => s + r.quantity * r.unitPrice, 0);
 // FIX(M14): مالیات با نرخ خودِ هر قلم (کالای معاف = 0) — نه ۹/۱۰٪ سراسری
 const tax = items.reduce(
 (s, r) => s + (withTax ? lineNet(r) * (r.taxRate ?? VAT_RATE) : 0),
 0
 );
 const discountAmount = items.reduce((s, r) => s + (r.quantity * r.unitPrice) * (discountPct / 100), 0);
 const total = subtotal - discountAmount + tax;

 // برچسب درصد مالیات — اگر همه اقلام نرخ یکسان دارند همان نرخ نشان داده می‌شود
 const taxRateLabel = React.useMemo(() => {
 if (items.length === 0 ||!withTax) return "۱۰٪";
 const rates = new Set(items.map((r) => r.taxRate ?? VAT_RATE));
 if (rates.size!== 1) return "";
 const rate = [...rates][0];
 return rate > 0 ? `${toPersianDigits(Math.round(rate * 100))}٪` : "";
 }, [items, withTax]);

 /* ============ عملیات اقلام ============ */

 // PERF-1200: جستجوی سمت سرور با debounce ۲۵۰ms — در ۱۲۰۰+ کالای tenant
 // جستجو واقعی است و هیچ کالایی «گم» نمی‌شود (نتیجه شامل کالاهای موجودی‌صفر هم هست)
 const serverSearchRid = React.useRef(0);
 React.useEffect(() => {
 const q = searchQuery.trim();
 if (!q) {
 setServerResults([]);
 setSearchFetching(false);
 return;
 }
 const rid = ++serverSearchRid.current;
 setSearchFetching(true);
 const t = setTimeout(async () => {
 try {
 const res = await authFetch(
 `/api/products?search=${encodeURIComponent(q)}&limit=10&sortBy=name&sortOrder=asc`,
 { cache: "no-store" }
 );
 const j = (await res.json().catch(() => ({}))) as {
 success?: boolean;
 data?: Array<Record<string, unknown>>;
 };
 if (rid !== serverSearchRid.current) return;
 if (j?.success && Array.isArray(j.data)) {
 setServerResults(
 j.data.map((p) => ({
 id: String(p.id ?? ""),
 name: String(p.name ?? ""),
 sku: String(p.sku ?? ""),
 unit: String(p.unit ?? "عدد"),
 salePrice: Number(p.salePrice) || 0,
 taxRate: Number(p.taxRate ?? VAT_RATE) || 0,
 stock: Number((p as { stock?: number }).stock ?? 0) || 0,
 }))
 );
 } else {
 setServerResults([]);
 }
 } catch {
 if (rid === serverSearchRid.current) setServerResults([]);
 } finally {
 if (rid === serverSearchRid.current) setSearchFetching(false);
 }
 }, 250);
 return () => clearTimeout(t);
 }, [searchQuery]);

 const filteredProducts = React.useMemo(() => {
 const q = searchQuery.trim();
 if (!q) return products.slice(0, 8);
 // PERF-1200: جستجوی سرور — سراسری در همهٔ کالاها (شامل موجودی صفر)
 return serverResults;
 }, [products, searchQuery, serverResults]);

 const doAddProductRow = React.useCallback(
 (p: QuickProduct) => {
 setItems((prev) => {
 // اگر کالا قبلاً هست، تعدادش را زیاد کن
 const idx = prev.findIndex((r) => r.productId === p.id);
 if (idx >= 0) {
 const copy = [...prev];
 copy[idx] = {...copy[idx], quantity: copy[idx].quantity + 1 };
 return copy;
 }
 return [
 ...prev,
 {
 key: uid(),
 productId: p.id,
 description: p.name,
 quantity: 1,
 unitPrice: p.salePrice,
 taxRate: p.taxRate ?? VAT_RATE,
 },
 ];
 });
 setSearchQuery("");
 setSearchOpen(false);
 },
 []
 );

 // ZERO-STOCK (درخواست مالک): کالای بدون موجودی هم اضافه می‌شود — فقط دفعهٔ اول
 // هشدار می‌دهد؛ با تیک «دیگر نپرس» (localStorage) مستقیم اضافه می‌شود.
 const addProductRow = React.useCallback(
 (p: QuickProduct) => {
 if ((p.stock ?? 0) <= 0) {
 let allowed = false;
 try {
 allowed = localStorage.getItem("hoshhesab_zero_stock_ok") === "1";
 } catch {
 allowed = false;
 }
 if (!allowed) {
 setZeroStockPending(p);
 setZeroStockDontAsk(false);
 return;
 }
 }
 doAddProductRow(p);
 },
 [doAddProductRow]
 );

 const addFreeItem = React.useCallback(() => {
 const name = searchQuery.trim();
 if (!name) return;
 setItems((prev) => [
 ...prev,
 { key: uid(), productId: null, description: name, quantity: 1, unitPrice: 0, taxRate: VAT_RATE },
 ]);
 setSearchQuery("");
 setSearchOpen(false);
 }, [searchQuery]);

 const updateRow = React.useCallback((key: string, patch: Partial<QuickItemRow>) => {
 setItems((prev) => prev.map((r) => (r.key === key? {...r, ...patch}: r)));
 }, []);

 const removeRow = React.useCallback((key: string) => {
 setItems((prev) => prev.filter((r) => r.key !== key));
 }, []);

 /* ============ انتخاب مشتری ============ */

 const filteredParties = React.useMemo(() => {
 const q = customerSearch.trim().toLowerCase();
 if (!q) return parties.slice(0, 8);
 return parties.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 10);
 }, [parties, customerSearch]);

 const pickCustomer = (name: string) => {
 setCustomerName(name);
 setCustomCustomer(name !== CASH_CUSTOMER);
 setCustomerOpen(false);
 setCustomerSearch("");
 setNewCustomerName("");
 };

 /* ============ ثبت فاکتور ============ */

 const submit = React.useCallback(
 async (mode: "none" | "receipt" | "a4" | "reserve") => {
 if (items.length === 0) {
 toast({
 title: "فاکتور خالی است",
 description: "حداقل یک قلم اضافه کنید — کالا را جستجو و انتخاب کنید.",
 variant: "destructive",
 });
 return;
 }
 if (items.some((r) => r.quantity <= 0)) {
 toast({
 title: "تعداد نامعتبر",
 description: "تعداد همه اقلام باید حداقل ۱ باشد.",
 variant: "destructive",
 });
 return;
 }
 // Task 21-B: قرضی بدون سررسید هم مجاز است (سررسید اختیاری)

 setSubmitting(true);
 try {
 const payload = {
 type: "SALE",
 // FIX(v11): SENT نهایی — قبلاً DRAFT ثبت می‌شد و نه سند حسابداری می‌خورد نه خروج انبار؛
 // ولی فیش حرارتی مشتری چاپ می‌شد! (مطابق pos-terminal)
 // Task 21-B: رزرو → RESERVED (بدون اثر انبار/سند تا «ثبت نهایی»)
 status: mode === "reserve" ? "RESERVED" : "SENT",
 // نام مشتری — API خودش طرف‌حساب را پیدا یا می‌سازد
 partyName: customerName.trim() || CASH_CUSTOMER,
 description: note.trim() || undefined,
 currency: "IRR",
 // Task 21-B: قرضی (نسیه) + سررسید
 paymentType: isCredit ? "CREDIT" : "CASH",
 dueDate: isCredit && dueDate ? dueDate : undefined,
 items: items.map((r) => ({
 productId: r.productId || undefined,
 description: r.description,
 quantity: r.quantity,
 unitPrice: r.unitPrice,
 discount: discountPct,
 // FIX(M14): نرخ مالیات واقعی قلم (کالای معاف = 0) — قبلاً ۹٪ سراسری بود
 taxRate: withTax ? (r.taxRate ?? VAT_RATE) : 0,
 })),
 };

 // Task 21-B: مسیر جدید /api/invoices — آینهٔ کامل accounting + رزرو/قرضی
 const res = await authFetch("/api/invoices", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(payload),
 });
 const data = await res.json();
 if (!res.ok ||!data.success) {
 throw new Error(data.error || "خطا در ثبت فاکتور");
 }

 const inv = data.data;
 setLastSaved({
 id: inv.id,
 number: String(inv.number),
 total: Number(inv.total) || 0,
 });

 // Task 21-B: شمارندهٔ چندفاکتور «امروز»
 setSessionCount(bumpSessionCount());

 toast({
 title:
 mode === "reserve"
 ? `فاکتور ${toPersianDigits(String(inv.number))} رزرو شد`
 : `فاکتور ${toPersianDigits(String(inv.number))} ثبت شد`,
 description:
 mode === "reserve"
 ? "بدون اثر انبار/سند — از ماژول «خرید و فروش» ثبت نهایی کنید."
 : `مبلغ: ${formatNumber(Number(inv.total) || 0)} ریال`,
 });

 // FIX(v11): رویداد سراسری — لیست فاکتورها و داشبورد هم‌زمان به‌روز شوند
 if (typeof window !== "undefined") {
 window.dispatchEvent(new CustomEvent("hoshhesab:invoices-changed"));
 }

 // باز کردن چاپ — FIX(C1): با authFetch + Blob (قبلاً window.open مستقیم → 401)
 if (mode !== "none" && mode !== "reserve" && typeof window !== "undefined") {
 void openInvoicePrint(inv.id, {
 mode: mode === "receipt" ? "thermal" : "a4",
 autoprint: mode === "receipt",
 toast,
 });
 }

 // ریست فرم برای فاکتور بعدی
 setItems([]);
 setNote("");
 setDiscountPct(0);
 // Task 21-B (چندفاکتور): مشتری برای فاکتور بعدی «همان» می‌ماند —
 // دکمهٔ «فاکتور بعدی» روی کارت نتیجه، فرم را برای همان مشتری آماده می‌کند.
 // (قبلاً بی‌صدا به «فروش نقدی» برمی‌گشت.)

 // به‌روزرسانی لیست اخیر
 loadRecent();
 // کش طرف‌حساب ممکن است تغییر کرده باشد
 sessionStorage.removeItem(PARTIES_CACHE_KEY);
 } catch (err) {
 toast({
 title: "خطا در ثبت فاکتور",
 description: err instanceof Error? err.message: "خطای ناشناخته",
 variant: "destructive",
 });
 } finally {
 setSubmitting(false);
 }
 },
 [items, customerName, note, withTax, discountPct, isCredit, dueDate, toast, loadRecent]
 );

 /* ============ رندر ============ */

 return (
 <div className="space-y-4 sm:space-y-5 pb-20 lg:pb-0">
 {/* هدر */}
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="flex items-center gap-2.5">
 <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
 <Zap className="h-4.5 w-4.5 text-primary" />
 </div>
 <div>
 <h2 className="text-base font-bold text-foreground">فاکتور سریع</h2>
 <p className="text-[11px] text-muted-foreground">
 مناسب خرده‌فروشی و رستوران — ثبت در چند ثانیه
 </p>
 </div>
 </div>
 <Badge variant="secondary" className="gap-1 text-[10px]">
 <Sparkles className="h-3 w-3" />
 تکمیل خودکار
 </Badge>
 </div>

 <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 sm:gap-5">
 {/* ستون فرم */}
 <div className="xl:col-span-3 space-y-4">
 <Card className="border-primary/20">
 <div className="p-4 sm:p-5 space-y-4">
 {/* مشتری */}
 <div className="relative">
 <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
 مشتری
 </label>
 <button
 type="button"
 onClick={() => setCustomerOpen((v) =>!v)}
 className="w-full flex items-center justify-between gap-2 rounded-lg border border-input bg-background px-3.5 py-3 text-sm hover:bg-accent/50 transition-colors min-h-[44px]"
 aria-haspopup="listbox"
 aria-expanded={customerOpen}
 >
 <span className="flex items-center gap-2 truncate">
 <User className="h-4 w-4 text-muted-foreground shrink-0" />
 <span className={customCustomer? "text-foreground": "text-muted-foreground"}>
 {customCustomer || customerName !== CASH_CUSTOMER? customerName: `${CASH_CUSTOMER} (پیش‌فرض)`}
 </span>
 </span>
 <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${customerOpen? "rotate-180": ""}`} />
 </button>

 {customerOpen && (
 <div className="absolute z-30 mt-1.5 w-full rounded-lg border border-border bg-popover shadow-lg p-2 space-y-2">
 <Input
 autoFocus
 value={customerSearch}
 onChange={(e) => setCustomerSearch(e.target.value)}
 placeholder="جستجوی مشتری..."
 className="h-10"
 onKeyDown={(e) => {
 if (e.key === "Enter" && filteredParties.length > 0) {
 pickCustomer(filteredParties[0].name);
 }
 }}
 />
 <div className="max-h-56 overflow-y-auto">
 {dataLoading? (
 <p className="text-xs text-muted-foreground text-center py-4">در حال بارگذاری...</p>
 ): filteredParties.length === 0? (
 <p className="text-xs text-muted-foreground text-center py-4">مشتری پیدا نشد</p>
 ): (
 filteredParties.map((p) => (
 <button
 key={p.id}
 type="button"
 onClick={() => pickCustomer(p.name)}
 className={`w-full text-right px-3 py-2.5 rounded-md text-sm hover:bg-accent transition-colors min-h-[40px] ${
 p.name === customerName? "bg-accent font-semibold": ""
 }`}
 >
 {p.name}
 {p.name === CASH_CUSTOMER && (
 <span className="text-[10px] text-muted-foreground mr-1">(نقدی)</span>
 )}
 </button>
 ))
 )}
 </div>
 {/* مشتری جدید سریع */}
 <div className="pt-2 border-t border-border">
 <div className="flex gap-2">
 <Input
 value={newCustomerName}
 onChange={(e) => setNewCustomerName(e.target.value)}
 placeholder="مشتری جدید — فقط نام..."
 className="h-10"
 onKeyDown={(e) => {
 if (e.key === "Enter" && newCustomerName.trim()) {
 pickCustomer(newCustomerName.trim());
 }
 }}
 />
 <Button
 type="button"
 size="sm"
 variant="secondary"
 className="h-10 shrink-0 gap-1"
 disabled={!newCustomerName.trim()}
 onClick={() => newCustomerName.trim() && pickCustomer(newCustomerName.trim())}
 >
 <Plus className="h-3.5 w-3.5" />
 افزودن
 </Button>
 </div>
 </div>
 </div>
 )}

 {customerOpen && (
 <div
 className="fixed inset-0 z-20"
 onClick={() => setCustomerOpen(false)}
 aria-hidden="true"
 />
 )}
 </div>

 {/* جستجوی کالا */}
 <div>
 <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
 افزودن کالا یا خدمت
 </label>
 <div className="relative">
 <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
 <input
 ref={searchInputRef}
 value={searchQuery}
 onChange={(e) => {
 setSearchQuery(e.target.value);
 setSearchOpen(true);
 }}
 onFocus={() => setSearchOpen(true)}
 onKeyDown={(e) => {
 if (e.key === "Enter") {
 if (filteredProducts.length > 0) addProductRow(filteredProducts[0]);
 else if (searchQuery.trim()) addFreeItem();
 }
 }}
 placeholder="نام کالا یا کد — بنویس و انتخاب کن..."
 className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pr-9"
 inputMode="search"
 />

 {searchOpen && (searchQuery.trim() || filteredProducts.length > 0) && (
 <div className="absolute z-30 mt-1.5 w-full rounded-lg border border-border bg-popover shadow-lg p-2">
 {searchFetching && searchQuery.trim()? (
 <p className="text-xs text-muted-foreground text-center py-3">
 <Loader2 className="h-4 w-4 animate-spin inline ml-1" />
 جستجوی سراسری در کالاها...
 </p>
 ): dataLoading? (
 <p className="text-xs text-muted-foreground text-center py-3">
 <Loader2 className="h-4 w-4 animate-spin inline ml-1" />
 در حال بارگذاری کالاها...
 </p>
 ): (
 <>
 {filteredProducts.map((p) => (
 <button
 key={p.id}
 type="button"
 onClick={() => addProductRow(p)}
 className="w-full flex items-center justify-between gap-2 text-right px-3 py-2.5 rounded-md hover:bg-accent transition-colors min-h-[44px]"
 >
 <span className="flex min-w-0 flex-col gap-0.5">
 <span className="text-sm font-medium truncate">{p.name}</span>
 <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
 <span className="font-mono" dir="ltr">{p.sku || "—"}</span>
 {(p.stock?? 0) > 0? (
 <span className="text-success tnum">
 موجودی: {toPersianDigits(formatNumber(p.stock?? 0))} {p.unit}
 </span>
 ): (
 <span className="text-warning font-medium">
 موجودی صفر — قابل انتخاب
 </span>
 )}
 </span>
 </span>
 <span className="text-xs text-muted-foreground shrink-0 tnum">
 {formatNumber(p.salePrice)} ریال
 </span>
 </button>
 ))}
 {searchQuery.trim() && !searchFetching && filteredProducts.length === 0 && (
 <p className="text-xs text-muted-foreground text-center py-2">
 کالایی پیدا نشد
 </p>
 )}
 {searchQuery.trim() && (
 <button
 type="button"
 onClick={addFreeItem}
 className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md border border-dashed border-border hover:bg-accent/50 transition-colors text-xs text-primary min-h-[44px]"
 >
 <Plus className="h-3.5 w-3.5" />
 افزودن «{searchQuery.trim()}» به‌عنوان قلم آزاد
 </button>
 )}
 </>
 )}
 </div>
 )}
 </div>

 {products.length === 0 &&!dataLoading && (
 <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
 هنوز کالایی ثبت نشده — می‌توانید قلم آزاد (بدون کالا) بنویسید یا از
 ماژول «انبار و کالا» کالاها را اضافه کنید.
 </p>
 )}
 </div>

 {/* اقلام فاکتور */}
 {items.length > 0 && (
 <div className="rounded-lg border border-border overflow-hidden">
 {/* هدر جدول — فقط دسکتاپ */}
 <div className="hidden sm:grid grid-cols-12 gap-2 bg-muted/50 px-3 py-2 text-[11px] font-medium text-muted-foreground">
 <div className="col-span-5">شرح</div>
 <div className="col-span-3 text-center">تعداد</div>
 <div className="col-span-3 text-center">قیمت واحد (ریال)</div>
 <div className="col-span-1 text-center">حذف</div>
 </div>

 <div className="divide-y divide-border">
 {items.map((r) => (
 <div key={r.key} className="px-3 py-3">
 <div className="sm:grid sm:grid-cols-12 sm:gap-2 sm:items-center space-y-2 sm:space-y-0">
 {/* شرح */}
 <div className="sm:col-span-5 flex items-center justify-between gap-2">
 <span className="text-sm font-medium text-foreground leading-snug break-words">
 {r.description}
 {!r.productId && (
 <Badge variant="outline" className="mr-1.5 text-[9px]">آزاد</Badge>
 )}
 </span>
 <span className="sm:hidden text-xs text-muted-foreground tnum shrink-0">
 {formatNumber(r.quantity * r.unitPrice)} ریال
 </span>
 </div>

 {/* تعداد — استپر لمسی */}
 <div className="sm:col-span-3 flex items-center justify-center gap-1.5">
 <button
 type="button"
 aria-label="کاهش تعداد"
 onClick={() => updateRow(r.key, { quantity: Math.max(1, r.quantity - 1) })}
 className="h-10 w-10 rounded-lg border border-border flex items-center justify-center hover:bg-accent active:scale-95 transition-all"
 >
 <Minus className="h-4 w-4" />
 </button>
 <span className="w-12 text-center text-sm font-bold tnum">{toPersianDigits(r.quantity)}</span>
 <button
 type="button"
 aria-label="افزایش تعداد"
 onClick={() => updateRow(r.key, { quantity: r.quantity + 1 })}
 className="h-10 w-10 rounded-lg border border-border flex items-center justify-center hover:bg-accent active:scale-95 transition-all"
 >
 <Plus className="h-4 w-4" />
 </button>
 </div>

 {/* قیمت */}
 <div className="sm:col-span-3 flex items-center justify-center">
 <Input
 value={r.unitPrice === 0? "": String(r.unitPrice)}
 onChange={(e) => {
 // FIX(M3): ارقام فارسی/عربی قبل از حذف نویسه‌های غیرعددی به لاتین تبدیل می‌شوند
 const v = toEnglishDigits(e.target.value).replace(/[^\d]/g, "");
 updateRow(r.key, { unitPrice: v? Number(v): 0 });
 }}
 inputMode="numeric"
 className="h-10 text-center text-sm tnum max-w-[160px]"
 aria-label="قیمت واحد"
 />
 </div>

 {/* حذف */}
 <div className="sm:col-span-1 flex items-center justify-center">
 <button
 type="button"
 aria-label={`حذف ${r.description}`}
 onClick={() => removeRow(r.key)}
 className="h-10 w-10 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
 >
 <Trash2 className="h-4 w-4" />
 </button>
 </div>
 </div>
 {/* جمع ردیف — موبایل */}
 <div className="sm:hidden flex items-center justify-between pt-2 border-t border-dashed border-border/60 mt-2">
 <span className="text-[10px] text-muted-foreground">جمع ردیف</span>
 <span className="text-sm font-bold tnum">
 {formatNumber(r.quantity * r.unitPrice)} ریال
 </span>
 </div>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* گزینه‌ها */}
 <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-1">
 <div className="flex items-center gap-2">
 <Switch
 id="qi-tax"
 checked={withTax}
 onCheckedChange={setWithTax}
 aria-label="مالیات ارزش افزوده"
 />
 <label htmlFor="qi-tax" className="text-xs text-muted-foreground cursor-pointer select-none">
 مالیات ارزش افزوده (۱۰٪)
 </label>
 </div>
 <div className="flex items-center gap-2">
 <Percent className="h-3.5 w-3.5 text-muted-foreground" />
 <Input
 value={discountPct === 0? "": String(discountPct)}
 onChange={(e) => {
 // FIX(M3): ارقام فارسی/عربی قبل از حذف نویسه‌های غیرعددی به لاتین تبدیل می‌شوند
 const v = toEnglishDigits(e.target.value).replace(/[^\d]/g, "");
 setDiscountPct(v? Math.min(Number(v), 99): 0);
 }}
 inputMode="numeric"
 className="h-9 w-16 text-center text-xs tnum"
 aria-label="درصد تخفیف"
 placeholder="۰"
 />
 <span className="text-xs text-muted-foreground">٪ تخفیف</span>
 </div>

 {/* Task 21-B: فاکتور قرضی (نسیه) + سررسید */}
 <div className="flex items-center gap-2">
 <Switch
 id="qi-credit"
 checked={isCredit}
 onCheckedChange={(v) => {
 setIsCredit(v);
 if (!v) setDueDate("");
 }}
 aria-label="فاکتور قرضی (نسیه)"
 />
 <label
 htmlFor="qi-credit"
 className="text-xs text-muted-foreground cursor-pointer select-none"
 >
 فاکتور قرضی (نسیه)
 </label>
 {isCredit && (
 <div className="flex-1 min-w-[160px]">
 <JalaliDatePicker
 value={dueDate}
 onChange={setDueDate}
 placeholder="سررسید (اختیاری)"
 className="h-9"
 />
 </div>
 )}
 </div>
 </div>

 {/* یادداشت */}
 <Input
 value={note}
 onChange={(e) => setNote(e.target.value)}
 placeholder="یادداشت فاکتور (اختیاری)..."
 className="h-10 text-xs"
 maxLength={200}
 />

 {/* دکمه‌های ثبت */}
 <div className="flex flex-col sm:flex-row gap-2">
 <Button
 type="button"
 size="lg"
 className="flex-1 h-12 gap-2 text-sm font-bold"
 disabled={submitting || items.length === 0}
 onClick={() => submit("receipt")}
 >
 {submitting? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ): (
 <Receipt className="h-4 w-4" />
 )}
 ثبت و چاپ رسید
 </Button>
 <Button
 type="button"
 size="lg"
 variant="secondary"
 className="flex-1 h-12 gap-2 text-sm"
 disabled={submitting || items.length === 0}
 onClick={() => submit("a4")}
 >
 <Printer className="h-4 w-4" />
 ثبت و چاپ A4
 </Button>
 <Button
 type="button"
 size="lg"
 variant="outline"
 className="h-12 gap-2 text-sm"
 disabled={submitting || items.length === 0}
 onClick={() => submit("none")}
 >
 <FileText className="h-4 w-4" />
 فقط ثبت
 </Button>
 {/* Task 21-B: رزرو فاکتور — بدون اثر انبار/سند تا «ثبت نهایی» */}
 <Button
 type="button"
 size="lg"
 variant="secondary"
 className="h-12 gap-2 text-sm"
 disabled={submitting || items.length === 0}
 title="فاکتور ذخیره می‌شود ولی انبار/دفاتر دست نمی‌خورند تا «ثبت نهایی»"
 onClick={() => submit("reserve")}
 >
 {submitting ? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ) : (
 <Clock className="h-4 w-4" />
 )}
 رزرو فاکتور
 </Button>
 </div>
 </div>
 </Card>

 {/* نتیجه ثبت */}
 {lastSaved && (
 <Card className="border-success/30 bg-success/5">
 <div className="p-4 space-y-3">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="flex items-center gap-2.5">
 <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
 <div>
 <p className="text-sm font-bold text-foreground">
 فاکتور {toPersianDigits(lastSaved.number)} ثبت شد
 </p>
 <p className="text-[11px] text-muted-foreground tnum">
 مبلغ: {formatNumber(lastSaved.total)} ریال
 </p>
 </div>
 </div>
 <div className="flex flex-wrap gap-2">
 {/* Task 21-B (چندفاکتور): فاکتور بعدی برای «همان مشتری» با یک کلیک */}
 <Button
 size="sm"
 className="gap-1.5 h-9"
 title={`فرم برای فاکتور بعدیِ «${customerName}» آماده می‌شود`}
 onClick={() => {
 setLastSaved(null);
 setItems([]);
 setNote("");
 setDiscountPct(0);
 // مشتری همان قبلی می‌ماند — فقط جستجوی کالا فوکوس می‌شود
 searchInputRef.current?.focus();
 }}
 >
 <RotateCw className="h-3.5 w-3.5" />
 فاکتور بعدی ({customerName})
 </Button>
 <Button
 size="sm"
 variant="secondary"
 className="gap-1.5 h-9"
 onClick={() =>
 void openInvoicePrint(lastSaved.id, { mode: "thermal", autoprint: true, toast })
 }
 >
 <Receipt className="h-3.5 w-3.5" />
 رسید
 </Button>
 <Button
 size="sm"
 variant="secondary"
 className="gap-1.5 h-9"
 onClick={() => void openInvoicePrint(lastSaved.id, { mode: "a4", toast })}
 >
 <Printer className="h-3.5 w-3.5" />
 A4
 </Button>
 <Button
 size="sm"
 variant="outline"
 className="h-9 gap-1.5"
 onClick={() => setLastSaved(null)}
 >
 <X className="h-3.5 w-3.5" />
 بستن
 </Button>
 </div>
 </div>
 {/* Task 21-B (چندفاکتور): بازخورد جلسه‌ای */}
 {sessionCount > 0 && (
 <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
 <Sparkles className="h-3 w-3 text-success" />
 {toPersianDigits(sessionCount)} فاکتور امروز ثبت شد
 {customCustomer ? ` — مشتری جاری: ${customerName}` : ""}
 </p>
 )}
 </div>
 </Card>
 )}
 </div>

 {/* ستون خلاصه + فاکتورهای اخیر */}
 <div className="xl:col-span-2 space-y-4">
 {/* خلاصه فاکتور جاری */}
 <Card className="xl:sticky xl:top-4 border-primary/20 bg-gradient-to-br from-background to-primary/5">
 <div className="p-4 sm:p-5 space-y-3">
 <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
 <ShoppingCart className="h-4 w-4 text-primary" />
 فاکتور جاری
 </h3>
 <div className="space-y-2 text-sm">
 <div className="flex justify-between text-muted-foreground">
 <span>تعداد اقلام</span>
 <span className="tnum font-medium text-foreground">
 {toPersianDigits(items.reduce((s, r) => s + r.quantity, 0))}
 </span>
 </div>
 <div className="flex justify-between text-muted-foreground">
 <span>جمع اقلام</span>
 <span className="tnum font-medium text-foreground">{formatNumber(subtotal)} ریال</span>
 </div>
 {discountAmount > 0 && (
 <div className="flex justify-between text-muted-foreground">
 <span>تخفیف ({toPersianDigits(discountPct)}٪)</span>
 <span className="tnum font-medium text-foreground">-{formatNumber(discountAmount)} ریال</span>
 </div>
 )}
 {withTax && tax > 0 && (
 <div className="flex justify-between text-muted-foreground">
 <span>مالیات ({taxRateLabel || "ارزش افزوده"})</span>
 <span className="tnum font-medium text-foreground">{formatNumber(tax)} ریال</span>
 </div>
 )}
 <div className="border-t border-border pt-2.5 flex justify-between items-center">
 <span className="font-bold text-foreground">قابل پرداخت</span>
 <span className="text-lg font-extrabold text-primary tnum">
 {formatNumber(total)}
 <span className="text-xs font-medium mr-1">ریال</span>
 </span>
 </div>
 </div>
 {items.length > 0 && (
 <Button
 variant="ghost"
 size="sm"
 className="w-full h-8 text-[11px] text-muted-foreground"
 onClick={() => {
 setItems([]);
 setNote("");
 setDiscountPct(0);
 }}
 >
 پاک کردن اقلام
 </Button>
 )}
 </div>
 </Card>

 {/* ناحیهٔ مدیریت فاکتورها — QUICK-INV-MGMT (درخواست مالک): خلاصهٔ امروز +
 آخرین ۲۰ فاکتور با اقدامات کامل (ویرایش/رسید/A4/اشتراک) + ورود به ماژول کامل */}
 <Card>
 <div className="p-4 sm:p-5">
 <div className="flex items-center justify-between mb-3">
 <h3 className="text-sm font-bold text-foreground">مدیریت فاکتورها</h3>
 <div className="flex items-center gap-1.5">
 <button
 type="button"
 onClick={() => {
 // ناوبری به ماژول کامل فاکتورها — app-shell به hoshhesab:navigate گوش می‌دهد
 window.dispatchEvent(
 new CustomEvent("hoshhesab:navigate", {
 detail: { module: "invoices" },
 })
 );
 }}
 className="h-8 px-2.5 rounded-md border border-border text-[10px] flex items-center gap-1 hover:bg-accent transition-colors"
 >
 <ListOrdered className="h-3 w-3" />
 همهٔ فاکتورها
 </button>
 <button
 type="button"
 aria-label="به‌روزرسانی"
 onClick={() => {
 loadRecent();
 loadBaseData(true);
 }}
 className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
 >
 <RefreshCw className={`h-3.5 w-3.5 ${recentLoading? "animate-spin": ""}`} />
 </button>
 </div>
 </div>

 {/* نوار خلاصهٔ امروز — چند فاکتور امروز و مجموعشان */}
 {(() => {
 const todayStr = new Date().toISOString().slice(0, 10);
 const todays = recent.filter(
 (r) => (r.date?? "").slice(0, 10) === todayStr || (r.date?? "").startsWith(todayStr)
 );
 const todayTotal = todays.reduce((s, r) => s + (Number(r.total) || 0), 0);
 const todayUnpaid = todays.filter(
 (r) => r.status!== "PAID" && r.status!== "CANCELLED"
 ).length;
 return (
 <div className="grid grid-cols-3 gap-2 mb-3">
 <div className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2 text-center">
 <p className="text-[10px] text-muted-foreground">فاکتورهای امروز</p>
 <p className="text-sm font-bold tnum">{toPersianDigits(todays.length)}</p>
 </div>
 <div className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2 text-center">
 <p className="text-[10px] text-muted-foreground">مجموع امروز (ریال)</p>
 <p className="text-sm font-bold tnum">{todays.length? formatNumber(todayTotal): "—"}</p>
 </div>
 <div className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2 text-center">
 <p className="text-[10px] text-muted-foreground">تسویه‌نشدهٔ امروز</p>
 <p className={`text-sm font-bold tnum ${todayUnpaid > 0? "text-warning": ""}`}>{toPersianDigits(todayUnpaid)}</p>
 </div>
 </div>
 );
 })()}

 {recentLoading? (
 <div className="py-8 text-center">
 <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
 </div>
 ): recent.length === 0? (
 <p className="text-xs text-muted-foreground text-center py-6 leading-relaxed">
 هنوز فاکتوری ثبت نشده — اولین فاکتور سریع خود را ثبت کنید
 </p>
 ): (
 <div className="space-y-2 max-h-[420px] overflow-y-auto">
 {recent.map((inv) => (
 <div
 key={inv.id}
 className="rounded-lg border border-border p-3 hover:border-primary/30 transition-colors"
 >
 <button
 type="button"
 onClick={() => setDetailInvoice(inv)}
 className="w-full text-right space-y-1.5"
 >
 <div className="flex items-center justify-between gap-2">
 <span className="text-xs font-bold text-foreground">
 فاکتور {toPersianDigits(inv.number)}
 </span>
 <span className="text-sm font-bold text-foreground tnum">
 {formatNumber(inv.total)} ریال
 </span>
 </div>
 <div className="flex items-center justify-between gap-2">
 <span className="text-[11px] text-muted-foreground truncate">
 {inv.party?.name || "—"}
 </span>
 <span className="text-[10px] text-muted-foreground shrink-0 tnum">
 {new Intl.DateTimeFormat("fa-IR", {
 month: "short",
 day: "numeric",
 hour: "2-digit",
 minute: "2-digit",
 }).format(new Date(inv.date))}
 </span>
 </div>
 </button>
 <div className="flex items-center gap-1.5 pt-2">
 <Badge
 variant={
 inv.status === "PAID"
 ? "default"
 : inv.status === "DRAFT" || inv.status === "RESERVED"
 ? "secondary"
 : "outline"
 }
 className={
 inv.status === "RESERVED"
 ? "text-[9px] bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700"
 : "text-[9px]"
 }
 >
 {inv.status === "PAID"
 ? "پرداخت شده"
 : inv.status === "DRAFT"
 ? "پیش‌نویس"
 : inv.status === "RESERVED"
 ? "رزرو"
 : INVOICE_STATUS_FA[inv.status]?? inv.status}
 </Badge>
 {/* Task 21-B: نشان قرضی */}
 {inv.paymentType === "CREDIT" && inv.status !== "CANCELLED" && (
 <Badge
 variant="outline"
 className="text-[9px] border-rose-300 text-rose-600 dark:border-rose-700 dark:text-rose-300"
 >
 قرضی
 </Badge>
 )}
 <span className="flex-1" />
 {/* Task 21-B: ویرایش فاکتور اخیر */}
 <button
 type="button"
 aria-label="ویرایش فاکتور"
 title="ویرایش فاکتور"
 disabled={editLoading}
 onClick={() => void handleEditRecent(inv)}
 className="h-8 px-2.5 rounded-md border border-border text-[10px] flex items-center gap-1 hover:bg-accent transition-colors disabled:opacity-50"
 >
 {editLoading ? (
 <Loader2 className="h-3 w-3 animate-spin" />
 ) : (
 <Pencil className="h-3 w-3" />
 )}
 ویرایش
 </button>
 <button
 type="button"
 aria-label="چاپ رسید"
 onClick={() =>
 void openInvoicePrint(inv.id, { mode: "thermal", autoprint: true, toast })
 }
 className="h-8 px-2.5 rounded-md border border-border text-[10px] flex items-center gap-1 hover:bg-accent transition-colors"
 >
 <Receipt className="h-3 w-3" />
 رسید
 </button>
 <button
 type="button"
 aria-label="چاپ A4"
 onClick={() => void openInvoicePrint(inv.id, { mode: "a4", toast })}
 className="h-8 px-2.5 rounded-md border border-border text-[10px] flex items-center gap-1 hover:bg-accent transition-colors"
 >
 <Printer className="h-3 w-3" />
 A4
 </button>
 <button
 type="button"
 aria-label="اشتراک‌گذاری فاکتور"
 onClick={async () => {
 const link = `${window.location.origin}/embed/invoice/${inv.id}`;
 try {
 if (navigator.share) {
 await navigator.share({
 title: "فاکتور هوش",
 text: `فاکتور ${inv.number}`,
 url: link,
 });
 return;
 }
 await navigator.clipboard.writeText(`${inv.number}
${link}`);
 toast({
 title: "لینک فاکتور کپی شد",
 description: "در واتساپ/تلگرام پیست کنید.",
 });
 } catch {
 // کاربر لغو کرد
 }
 }}
 className="h-8 px-2.5 rounded-md border border-border text-[10px] flex items-center gap-1 hover:bg-accent transition-colors"
 >
 <Share2 className="h-3 w-3" />
 اشتراک
 </button>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 </Card>
 </div>
 </div>

 {/* دیالوگ جزئیات فاکتور */}
 <Dialog open={!!detailInvoice} onOpenChange={(v) =>!v && setDetailInvoice(null)}>
 <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[92dvh] overflow-y-auto">
 {detailInvoice && (
 <>
 <DialogHeader>
 <DialogTitle className="text-base">
 فاکتور {toPersianDigits(detailInvoice.number)}
 </DialogTitle>
 <DialogDescription className="text-xs">
 {detailInvoice.party?.name || "—"} ·{" "}
 {new Intl.DateTimeFormat("fa-IR", {
 dateStyle: "medium",
 timeStyle: "short",
 }).format(new Date(detailInvoice.date))}
 </DialogDescription>
 </DialogHeader>
 <div className="space-y-3">
 <div className="rounded-lg border border-border overflow-hidden">
 <div className="grid grid-cols-12 gap-1 bg-muted/50 px-3 py-2 text-[10px] font-medium text-muted-foreground">
 <div className="col-span-6">شرح</div>
 <div className="col-span-2 text-center">تعداد</div>
 <div className="col-span-4 text-center">جمع</div>
 </div>
 {detailInvoice.items.map((it) => (
 <div key={it.id} className="grid grid-cols-12 gap-1 px-3 py-2.5 border-t border-border text-xs">
 <div className="col-span-6 break-words leading-snug">{it.description || "—"}</div>
 <div className="col-span-2 text-center tnum">{toPersianDigits(it.quantity)}</div>
 <div className="col-span-4 text-center tnum">{formatNumber(it.total)} ریال</div>
 </div>
 ))}
 </div>
 <div className="flex justify-between items-center rounded-lg bg-primary/5 border border-primary/20 px-3 py-2.5">
 <span className="text-xs font-medium text-muted-foreground">مبلغ کل</span>
 <span className="text-base font-extrabold text-primary tnum">
 {formatNumber(detailInvoice.total)} ریال
 </span>
 </div>
 <div className="flex flex-col sm:flex-row gap-2">
 <Button
 size="sm"
 variant="outline"
 className="flex-1 h-10 gap-1.5"
 disabled={editLoading}
 onClick={() => detailInvoice && void handleEditRecent(detailInvoice)}
 >
 {editLoading ? (
 <Loader2 className="h-3.5 w-3.5 animate-spin" />
 ) : (
 <Pencil className="h-3.5 w-3.5" />
 )}
 ویرایش فاکتور
 </Button>
 <Button
 size="sm"
 className="flex-1 h-10 gap-1.5"
 onClick={() =>
 void openInvoicePrint(detailInvoice.id, { mode: "thermal", autoprint: true, toast })
 }
 >
 <Receipt className="h-3.5 w-3.5" />
 چاپ رسید
 </Button>
 <Button
 size="sm"
 variant="secondary"
 className="flex-1 h-10 gap-1.5"
 onClick={() => void openInvoicePrint(detailInvoice.id, { mode: "a4", toast })}
 >
 <Printer className="h-3.5 w-3.5" />
 چاپ A4
 </Button>
 </div>
 </div>
 </>
 )}
 </DialogContent>
 </Dialog>

 {/* Task 21-B: دیالوگ ویرایش فاکتور — همان فرم اصلی پیش‌پرشده (mobile-friendly تمام‌صفحه در موبایل) */}
 {editOpen && (
 <React.Suspense
 fallback={
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
 <Loader2 className="h-8 w-8 animate-spin text-primary" />
 </div>
 }
 >
 <InvoiceFormLazy
 open={editOpen}
 onOpenChange={(v) => {
 setEditOpen(v);
 if (!v) setEditInvoice(null);
 }}
 initialInvoice={editInvoice}
 onCreated={() => loadRecent()}
 onUpdated={() => {
 loadRecent();
 // فاکتور ویرایش‌شده — لیست ماژول فاکتورها هم تازه شود
 window.dispatchEvent(new CustomEvent("hoshhesab:invoices-changed"));
 }}
 />
 </React.Suspense>
 )}

 {/* ZERO-STOCK (درخواست مالک): تأیید افزودن کالای بدون موجودی + تیک «دیگر نپرس» */}
 <Dialog open={!!zeroStockPending} onOpenChange={(o) => { if (!o) setZeroStockPending(null); }}>
 <DialogContent className="sm:max-w-sm">
 <DialogHeader>
 <DialogTitle className="text-sm flex items-center gap-2">
 ⚠️ موجودی این کالا صفر است
 </DialogTitle>
 <DialogDescription className="text-xs">
 «{zeroStockPending?.name}» موجودی صفر دارد. آیا می‌خواهید آن را در فاکتور درج کنید؟
 </DialogDescription>
 </DialogHeader>
 <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-muted/30 p-3">
 <Checkbox
 checked={zeroStockDontAsk}
 onCheckedChange={(c) => setZeroStockDontAsk(c === true)}
 className="mt-0.5"
 />
 <span className="text-[11px] leading-relaxed text-muted-foreground">
 <span className="font-medium text-foreground">دیگر نپرس</span> — کالاهای بدون موجودی از این پس مستقیم و بدون پرسش اضافه شوند.
 </span>
 </label>
 <DialogFooter className="gap-2">
 <Button variant="outline" size="sm" onClick={() => setZeroStockPending(null)}>
 انصراف
 </Button>
 <Button
 size="sm"
 onClick={() => {
 if (zeroStockDontAsk) {
 try {
 localStorage.setItem("hoshhesab_zero_stock_ok", "1");
 } catch {
 /* ignore */
 }
 }
 const p = zeroStockPending;
 setZeroStockPending(null);
 if (p) doAddProductRow(p);
 }}
 >
 ادامه و افزودن کالا
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </div>
 );
}
