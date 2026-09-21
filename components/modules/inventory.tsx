"use client";

import * as React from "react";
import {
 Plus,
 Search,
 Package,
 AlertTriangle,
 Boxes,
 Barcode,
 QrCode,
 PackageCheck,
 ArrowRightLeft,
 UploadCloud,
 Loader2,
 Pencil,
 Trash2,
 Coins,
 Download,
 ClipboardCheck,
 ClipboardList,
 TrendingUp,
 TrendingDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ux/empty-state";
import { BulkImport } from "@/components/ux/bulk-import";
import { useConfirmAction } from "@/components/ux/confirm-action";
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from "@/components/ui/dialog";
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { exportToCSV } from "@/lib/export-utils";
import { QRCodeSVG } from "qrcode.react";
import {
 formatNumber,
 toPersianDigits,
 toEnglishDigits,
 formatPrice,
 formatPriceCompact,
 toJalali,
 type PriceUnit,
} from "@/lib/persian";
import { handleApiError, parseApiResponse } from "@/lib/api-error-handler";
import { authFetch } from "@/lib/auth-fetch";
import { MarketPriceSync } from "@/components/ux/market-price-sync";
import { JalaliDatePicker } from "@/components/ui/jalali-date-picker";

/**
 * FIX(M3): نرمال‌سازی ارقام فارسی/عربی (۰-۹ و ٠-٩) به لاتین قبل از حذف
 * نویسه‌های غیرعددی — با کیبورد فارسی «۱۲۳» دیگر بی‌صدا حذف نمی‌شود
 */
function digitsOnly(s: string): string {
 return toEnglishDigits(s).replace(/[^\d]/g, "");
}

interface ProductRow {
 id: string;
 sku: string;
 barcode: string | null;
 name: string;
 category: string;
 stock: number;
 min: number;
 max: number;
 unit: string;
 type: string;
 price: number; // ریال
 priceToman: number; // تومان = ریال / ۱۰
 wholesalePrice: number; // ⑪ قیمت عمده (ریال)
 avgCost: number; // ⑩ بهای تمام‌شده میانگین متحرک = purchasePrice (ریال)
 taxRate: number;
 goodsCode: string | null;
 value: number; // ریال
 valueToman: number; // تومان
 status: "ok" | "low" | "critical" | "out";
 usdPrice?: number | null; // USD-PRICE: قیمت پایه دلاری
 usdSynced?: boolean; // USD-PRICE: همگام‌سازی با نرخ دلار
}

// ⑩ نوع‌های گردش انبار — از /api/inventory/movements
interface MovementRow {
 id: string;
 date: string;
 type: string;
 quantity: number;
 unitCost: number | null;
 referenceType: string | null;
 referenceId: string | null;
 fromWarehouse: string | null;
 toWarehouse: string | null;
 productId: string;
 productName: string;
 productSku: string;
 productUnit: string;
}

interface MovementsSummary {
 productId: string;
 productName: string;
 productSku: string;
 productUnit: string;
 avgCost: number; // ریال
 avgCostToman: number;
 currentStock: number;
 totalIn: number;
 totalOut: number;
}

const MOVEMENT_TYPE_FA: Record<string, { label: string; color: string }> = {
 IN: { label: "ورود", color: "bg-success/10 text-success" },
 OUT: { label: "خروج", color: "bg-destructive/10 text-destructive" },
 TRANSFER: { label: "انتقال", color: "bg-primary/10 text-primary" },
};

const MOVEMENT_REFERENCE_FA: Record<string, string> = {
 ADJUSTMENT: "تنظیم دستی",
 RECEIPT: "رسید ورود",
 ISSUE: "حواله خروج",
 INVOICE: "فاکتور",
 TRANSFER: "انتقال انبار",
 PRODUCTION: "تولید",
};

const STATUS_MAP: Record<
 string,
 { label: string; color: string }
> = {
 ok: { label: "موجود", color: "bg-success/10 text-success" },
 low: { label: "در حال اتمام", color: "bg-warning/10 text-warning" },
 critical: { label: "بحرانی", color: "bg-destructive/10 text-destructive" },
 out: { label: "ناموجود", color: "bg-destructive/10 text-destructive" },
};

function computeStatus(stock: number, min: number): ProductRow["status"] {
 if (stock <= 0) return "out";
 if (stock <= min) return "critical";
 if (stock <= min * 2) return "low";
 return "ok";
}

const UNITS = ["عدد", "کیلوگرم", "گرم", "لیتر", "متر", "بسته", "جعبه", "رول", "ساعت"];

interface ProductFormState {
 sku: string;
 barcode: string;
 name: string;
 unit: string;
 type: string; // GOODS | SERVICE | ASSEMBLY
 salePrice: string;
 purchasePrice: string;
 wholesalePrice: string; // ⑪ قیمت عمده — قابل ویرایش (درخواست مالک)
 taxRate: string; // درصد مالیات (۰-۱۰۰)
 minStock: string;
 maxStock: string;
 goodsCode: string; // شناسه کالا/خدمت مودیان
 description: string;
 openingStock: string; // FIX(WH-5): موجودی اولیه هنگام ایجاد کالا — قبلاً کالا همیشه با ۰ ثبت می‌شد
 stockEdit: string; // ویرایش موجودی کالای موجود (تعدیل انبار)
 category: string;
 priceUnit: PriceUnit; // واحد ورود قیمت‌ها در فرم
 usdPrice: string; // USD-PRICE: قیمت پایه دلاری (مثلاً 1.74)
 usdSynced: boolean; // USD-PRICE: همگام‌سازی خودکار با نرخ دلار
}

const EMPTY_FORM: ProductFormState = {
 sku: "",
 barcode: "",
 name: "",
 unit: "عدد",
 type: "GOODS",
 salePrice: "",
 purchasePrice: "",
 wholesalePrice: "",
 taxRate: "",
 minStock: "",
 maxStock: "",
 goodsCode: "",
 description: "",
 openingStock: "",
 stockEdit: "",
 category: "",
 priceUnit: "toman",
 usdPrice: "",
 usdSynced: false,
};

// PERF-1200: اندازه صفحه — رندر فقط همین تعداد ردیف در هر بار (قبلاً ۵۰۰ ردیف = لگ)
const PAGE_SIZE = 50;

export function Inventory() {
 const { toast } = useToast();
 const { confirm, ConfirmDialogComponent } = useConfirmAction();
 const [bulkImportOpen, setBulkImportOpen] = React.useState(false);
 const [dialogOpen, setDialogOpen] = React.useState(false);
 const [editingId, setEditingId] = React.useState<string | null>(null);
 const [submitting, setSubmitting] = React.useState(false);
 const [form, setForm] = React.useState<ProductFormState>(EMPTY_FORM);
 const [errors, setErrors] = React.useState<Record<string, string>>({});
 const [products, setProducts] = React.useState<ProductRow[]>([]);
 const [search, setSearch] = React.useState("");
 // PERF-1200: جستجوی سمت سرور با debounce — قبلاً ۵۰۰ کالا واکشی و سمت کلاینت فیلتر می‌شد
 const [serverSearch, setServerSearch] = React.useState("");
 // PERF-1200: صفحه‌بندی سمت سرور — فقط PAGE_SIZE ردیف رندر می‌شود
 const [page, setPage] = React.useState(0);
 const [loading, setLoading] = React.useState(true);
 // خلاصهٔ آماری کل انبار (KPI) — از API با withSummary=1
 const [summary, setSummary] = React.useState<{
 totalProducts: number;
 productsInStock: number;
 zeroStockProducts: number;
 lowStockProducts: number;
 totalStockValueRial: number;
 totalStockValueToman: number;
 } | null>(null);
 // واحد نمایش قیمت‌ها در جدول (پیش‌فرض تومان)
 const [displayUnit, setDisplayUnit] = React.useState<PriceUnit>("toman");
 // FIX(M7): تعداد کل کالاها از API — برای بج «نمایش N از M»
 const [productsTotal, setProductsTotal] = React.useState<number | null>(null);
 // FIX(H4): تعداد انبارهای فعال — قبلاً «۰ فعال» هاردکد بود
 const [warehouseCount, setWarehouseCount] = React.useState<number>(0);
 const [fetchError, setFetchError] = React.useState<string | null>(null);
 // Issue 1: refresh pattern — تغییر refreshKey باعث re-fetch می‌شود.
 const [refreshKey, setRefreshKey] = React.useState(0);

 // QR Code و انبارگردانی
 const [qrDialogOpen, setQrDialogOpen] = React.useState(false);
 const [qrProduct, setQrProduct] = React.useState<ProductRow | null>(null);
 // FIX(M1): ref برای انتخاب SVG خود QR در دانلود
 const qrSvgRef = React.useRef<HTMLDivElement>(null);
 const [stockTakeOpen, setStockTakeOpen] = React.useState(false);
 const [stockTakeData, setStockTakeData] = React.useState<Array<{ id: string; name: string; sku: string; systemStock: number; countedStock: number; diff: number }>>([]);
 const [stockTakeLoading, setStockTakeLoading] = React.useState(false);
 const [stockTakeSubmitting, setStockTakeSubmitting] = React.useState(false);

 // H9: دیالوگ اسکن بارکد
 const [barcodeDialogOpen, setBarcodeDialogOpen] = React.useState(false);
 const [barcodeInput, setBarcodeInput] = React.useState("");
 const [barcodeSearching, setBarcodeSearching] = React.useState(false);
 const [barcodeResult, setBarcodeResult] = React.useState<ProductRow | null>(null);
 const [barcodeNotFound, setBarcodeNotFound] = React.useState(false);
 const [cameraActive, setCameraActive] = React.useState(false);
 const [cameraError, setCameraError] = React.useState<string | null>(null);
 const videoRef = React.useRef<HTMLVideoElement>(null);
 const streamRef = React.useRef<MediaStream | null>(null);

 // ⑩ دیالوگ گردش انبار (حرکات + بهای تمام‌شده میانگین)
 const [movementsOpen, setMovementsOpen] = React.useState(false);
 const [movementsProduct, setMovementsProduct] = React.useState<ProductRow | null>(null);

 const refresh = React.useCallback(() => setRefreshKey((k) => k + 1), []);

 // PERF-1200: debounce جستجو (۳۰۰ms) — تایپ سریع کاربر بار سرور نمی‌سازد
 React.useEffect(() => {
 const t = setTimeout(() => {
 setServerSearch(search.trim());
 setPage(0); // جستجوی جدید → صفحهٔ اول
 }, 300);
 return () => clearTimeout(t);
 }, [search]);

 const fetchProducts = React.useCallback(async () => {
 try {
 setLoading(true);
 // PERF-1200: واکشی فقط یک صفحه (۵۰ ردیف) + جستجوی سرور + خلاصهٔ KPI
 // قبلاً limit=500 واکشی و در مرورگر فیلتر می‌شد — با ۱۲۰۰+ کالا صفحه هنگ می‌کرد.
 const offset = page * PAGE_SIZE;
 const params = new URLSearchParams({
 limit: String(PAGE_SIZE),
 offset: String(offset),
 sortBy: "name",
 sortOrder: "asc",
 withSummary: "1",
 });
 if (serverSearch) params.set("search", serverSearch);
 const res = await authFetch(`/api/products?${params.toString()}`, { cache: "no-store" });
 const json = await res.json();
 if (json.success && Array.isArray(json.data)) {
 const rows: ProductRow[] = json.data.map(
 (p: Record<string, unknown>) => {
 const stockValue = Number((p as { stock?: number }).stock?? 0) || 0;
 const min = Number((p as { minStock?: number }).minStock?? 0);
 const max = Number((p as { maxStock?: number }).maxStock?? 0) || 0;
 const salePrice = Number((p as { salePrice?: number }).salePrice?? 0); // ریال
 // سمت API فیلدهای salePriceToman نیز ارسال می‌شود؛ در نبود آن محاسبه محلی.
 const salePriceToman = Number(
 (p as { salePriceToman?: number }).salePriceToman?? Math.trunc(salePrice / 10)
 );
 // ⑪ قیمت عمده و ⑩ بهای تمام‌شده میانگین (purchasePrice) — هر دو به ریال
 const wholesalePrice = Number((p as { wholesalePrice?: number }).wholesalePrice?? 0) || 0;
 const avgCost = Number((p as { purchasePrice?: number }).purchasePrice?? 0) || 0;
 // FIX(M12): ارزش موجودی به «بهای تمام‌شده» محاسبه می‌شود (حسابداری)،
 // نه قیمت فروش — قبلاً موجودی با حاشیه سود بزرگ‌نمایی می‌شد.
 // اگر بهای تمام‌شده ثبت نشده باشد به قیمت فروش برمی‌گردیم.
 const valueRial = stockValue * (avgCost > 0? avgCost: salePrice);
 return {
 id: String(p.id?? ""),
 sku: String(p.sku?? ""),
 barcode: (p as { barcode?: string | null }).barcode ?? null,
 name: String(p.name?? ""),
 category: String((p as { category?: string }).category?? "—"),
 stock: stockValue,
 min,
 max,
 unit: String(p.unit?? "عدد"),
 type: String((p as { type?: string }).type?? "GOODS"),
 price: salePrice,
 priceToman: salePriceToman,
 wholesalePrice,
 avgCost,
 taxRate: Number((p as { taxRate?: number }).taxRate?? 0.1) || 0,
 goodsCode: (p as { goodsCode?: string | null }).goodsCode ?? null,
 value: valueRial,
 valueToman: Math.trunc(valueRial / 10),
 status: computeStatus(stockValue, min),
 // USD-PRICE: از API سریالایز می‌شود (serializeProduct همه فیلدها را پاس می‌دهد)
 usdPrice: (p as { usdPrice?: number | null }).usdPrice ?? null,
 usdSynced: (p as { usdSynced?: boolean }).usdSynced === true,
 } satisfies ProductRow;
 }
 );
 setProducts(rows);
 // FIX(M7): تعداد کل کالاها از API — برای بج «نمایش N از M»
 setProductsTotal(typeof json.total === "number" ? json.total : rows.length);
 if (json.summary) setSummary(json.summary);
 setFetchError(null);
 } else {
 setProducts([]);
 setProductsTotal(null);
 }
 } catch {
 // FIX(M1): به‌جای بلعیدن بی‌صدا خطا، حالت خطا نشان بده
 setProducts([]);
 setProductsTotal(null);
 setFetchError("خطا در دریافت کالاها — اتصال اینترنت یا سرور را بررسی کنید");
 }
 // FIX(H4): تعداد انبارهای فعال از form-data
 try {
 const whRes = await authFetch("/api/accounting/form-data", { cache: "no-store" });
 const whJson = await whRes.json().catch(() => ({}));
 if (whJson?.success && Array.isArray(whJson.data?.warehouses)) {
 setWarehouseCount(whJson.data.warehouses.filter((w: { isActive?: boolean }) => w.isActive !== false).length);
 }
 } catch {
 // انبار شمارش نشد — مهم نیست
 } finally {
 setLoading(false);
 }
 }, [page, serverSearch]);

 // Issue 1: re-fetch هنگام تغییر refreshKey / صفحه / جستجوی سرور
 React.useEffect(() => {
 void fetchProducts();
 }, [fetchProducts, refreshKey]);

 // PERF-1200: KPI ها از summary سرور — نه از ۵۰۰ ردیف واکشی‌شده
 const totalValue = summary? (displayUnit === "toman"? summary.totalStockValueToman: summary.totalStockValueRial): products.reduce((s, p) => s + p.value, 0);
 const lowStock = summary? summary.lowStockProducts: products.filter(
 (p) => p.status === "low" || p.status === "critical" || p.status === "out"
 ).length;

 // PERF-1200: فیلتر سمت کلاینت حذف شد — جستجو روی سرور انجام می‌شود
 const filtered = products;

 const openAddProduct = () => {
 setEditingId(null);
 setForm(EMPTY_FORM);
 setErrors({});
 setDialogOpen(true);
 // WH-1: پیش‌پر کردن کد کالا با SKU ترتیبی بعدی — کاربر می‌تواند آن را ویرایش کند
 // (fire-and-forget؛ اگر خطا شد با مقدار پیش‌فرض SKU-1001 پر می‌شود)
 authFetch("/api/products/next-sku", { cache: "no-store" })
 .then((r) => r.json())
 .then((j: { success?: boolean; data?: { sku?: unknown } }) => {
 const next = j?.data?.sku;
 if (j?.success && typeof next === "string" && next) {
 // فقط وقتی پر می‌کنیم که کاربر هنوز چیزی تایپ نکرده باشد
 setForm((prev) => (prev.sku ? prev : {...prev, sku: next }));
 } else {
 setForm((prev) => (prev.sku ? prev : {...prev, sku: "SKU-1001" }));
 }
 })
 .catch(() => {
 setForm((prev) => (prev.sku ? prev : {...prev, sku: "SKU-1001" }));
 });
 };

 // گوش دادن به رویداد hoshhesab:module-action برای باز کردن دیالوگ کالای جدید
 // از Quick Access در داشبورد (detail.action = "new-product")
 React.useEffect(() => {
 const onAction = (e: Event) => {
 const detail = (e as CustomEvent<{ module: string; action: string }>).detail;
 if (detail?.module === "inventory" && detail.action === "new-product") {
 openAddProduct();
 }
 };
 window.addEventListener("hoshhesab:module-action", onAction as EventListener);
 return () =>
 window.removeEventListener("hoshhesab:module-action", onAction as EventListener);
 }, []);

 // WH-3: رفرش خودکار لیست کالاها وقتی از جای دیگر (مثلاً فاکتور یا فرم سریع)
 // کالای جدیدی ساخته شد — قبلاً لیست ماژول انبار stale می‌ماند.
 React.useEffect(() => {
 const onDataChanged = (e: Event) => {
 const detail = (e as CustomEvent<{ entity?: string }>).detail;
 if (detail?.entity === "products") {
 refresh();
 }
 };
 window.addEventListener("hoshhesab:data-changed", onDataChanged as EventListener);
 return () =>
 window.removeEventListener("hoshhesab:data-changed", onDataChanged as EventListener);
 }, [refresh]);

 // FIX(v11-deeplink): باز کردن مستقیم کارت کالا از لینک هوش‌یار
 React.useEffect(() => {
 const tryOpen = (id: string) => {
 const found = products.find((p) => p.id === id);
 if (found) openEditProduct(found);
 };
 const onOpenEntity = (e: Event) => {
 const detail = (e as CustomEvent<{ module?: string; type?: string; id?: string }>).detail;
 if (detail?.module === "inventory" && detail.type === "product" && detail.id) {
 tryOpen(detail.id);
 }
 };
 window.addEventListener("hoshhesab:open-entity", onOpenEntity as EventListener);
 try {
 const raw = sessionStorage.getItem("hoshhesab_pending_open");
 if (raw) {
 const p = JSON.parse(raw) as { module?: string; type?: string; id?: string };
 if (p.module === "inventory" && p.type === "product" && p.id) {
 tryOpen(p.id);
 sessionStorage.removeItem("hoshhesab_pending_open");
 }
 }
 } catch {
 /* ignore */
 }
 return () => window.removeEventListener("hoshhesab:open-entity", onOpenEntity as EventListener);
 }, [products]);

 const openEditProduct = (p: ProductRow) => {
 setEditingId(p.id);
 // هنگام ویرایش، مقدار را به‌صورت تومان نمایش می‌دهیم تا با واحد پیش‌فرض فرم هم‌خوان باشد.
 // FIX(H6): قیمت خرید فعلی هم پیش‌پر می‌شود (قبلاً "" بود و با ذخیره، صفر می‌شد)
 // EDIT-ALL (درخواست مالک): همهٔ فیلدها — SKU، بارکد، نوع، قیمت عمده، مالیات،
 // حداکثر موجودی، شناسه مودیان، شرح و موجودی فعلی — قابل ویرایش هستند.
 setForm({
 sku: p.sku,
 barcode: p.barcode?? "",
 name: p.name,
 unit: p.unit,
 type: p.type || "GOODS",
 salePrice: String(p.priceToman?? Math.trunc(p.price / 10)),
 purchasePrice: p.avgCost > 0? String(Math.trunc(p.avgCost / 10)): "",
 wholesalePrice: p.wholesalePrice > 0? String(Math.trunc(p.wholesalePrice / 10)): "",
 taxRate: p.taxRate > 0? String(Math.round(p.taxRate * 100)): "",
 minStock: String(p.min),
 maxStock: p.max > 0? String(p.max): "",
 goodsCode: p.goodsCode?? "",
 description: "",
 stockEdit: String(p.stock),
 usdPrice: p.usdPrice != null ? String(p.usdPrice) : "",
 usdSynced: !!p.usdSynced,
 // FIX(WH-5): فیلد جدید موجودی اولیه — در ویرایش خالی (تغییر موجودی از مسیر گردش انبار)
 openingStock: "",
 category: p.category === "—"? "": p.category,
 priceUnit: "toman",
 });
 setErrors({});
 setDialogOpen(true);
 };

 // Issue 2: اعتبارسنجی real-time فرم کالا
 const validateForm = (): boolean => {
 const e: Record<string, string> = {};
 if (!form.sku.trim()) e.sku = "کد کالا (SKU) الزامی است";
 if (!form.name.trim()) e.name = "نام کالا الزامی است";
 // FIX(M3): digitsOnly ارقام فارسی را هم می‌فهمد
 if (form.salePrice && Number(digitsOnly(form.salePrice)) <= 0)
 e.salePrice = "قیمت فروش باید عدد مثبت باشد";
 setErrors(e);
 return Object.keys(e).length === 0;
 };

 const isFormValid = React.useMemo(() => {
 return Boolean(form.sku.trim() && form.name.trim());
 }, [form.sku, form.name]);

 const handleSubmit = async () => {
 if (!validateForm()) {
 toast({
 title: "اطلاعات ناقص",
 description: "لطفاً فیلدهای الزامی را تکمیل کنید.",
 variant: "destructive",
 });
 return;
 }
 setSubmitting(true);
 try {
 // قیمت‌ها در دیتابیس به‌صورت «ریال» ذخیره می‌شوند.
 // اگر کاربر در فرم «تومان» وارد کرده باشد، باید ×۱۰ شود تا به ریال تبدیل شود.
 const rialFactor = form.priceUnit === "toman"? 10: 1;
 // FIX(M3): ارقام فارسی/عربی قبل از strip نرمال می‌شوند
 const salePriceToman = Number(digitsOnly(form.salePrice)) || 0;
 const purchasePriceToman = Number(digitsOnly(form.purchasePrice)) || 0;
 const wholesalePriceToman = Number(digitsOnly(form.wholesalePrice)) || 0;
 const minStockValue = Number(digitsOnly(form.minStock)) || 0;
 const maxStockValue = Number(digitsOnly(form.maxStock)) || 0;
 const taxRateValue = Number(digitsOnly(form.taxRate));
 // FIX(WH-5): موجودی اولیه — فقط هنگام «ایجاد» کالا معنا دارد (ویرایش موجودی از مسیر شمارش/گردش انبار)
 const openingStockValue = Number(digitsOnly(form.openingStock)) || 0;
 // EDIT-ALL: موجودی ویرایش کالای موجود — ثبت تعدیل انبار
 const stockEditValue = Number(digitsOnly(form.stockEdit));
 // USD-PRICE: قیمت دلاری با اعشار (مثلاً 1.74) — ارقام فارسی هم پشتیبانی می‌شوند
 const usdPriceValue = Number(toEnglishDigits(form.usdPrice).replace(/[،٬,]/g, ".")) || 0;
 if (editingId) {
 // EDIT-ALL (درخواست مالک): ویرایش کامل از طریق PUT /api/products/[id]
 // — همهٔ فیلدها از جمله SKU، بارکد و موجودی قابل تغییر هستند.
 const res = await authFetch(`/api/products/${encodeURIComponent(editingId)}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
   sku: form.sku.trim(),
   barcode: form.barcode.trim(),
   name: form.name.trim(),
   unit: form.unit,
   type: form.type || "GOODS",
   salePrice: salePriceToman * rialFactor,
   purchasePrice: purchasePriceToman * rialFactor,
   wholesalePrice: wholesalePriceToman * rialFactor,
   ...(form.taxRate !== ""? { taxRate: (Number.isFinite(taxRateValue)? taxRateValue: 0) / 100 }: {}),
   minStock: minStockValue,
   maxStock: maxStockValue,
   goodsCode: form.goodsCode.trim(),
   category: form.category.trim(),
   description: form.description.trim(),
   ...(usdPriceValue > 0 || form.usdPrice === "" ? { usdPrice: usdPriceValue > 0 ? usdPriceValue : null } : {}),
   usdSynced: form.usdSynced,
   ...(form.stockEdit !== "" && Number.isFinite(stockEditValue) && stockEditValue >= 0 ? { stock: stockEditValue } : {}),
  }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok ||!json?.success) {
   throw new Error(json?.error || "به‌روزرسانی ناموفق بود");
  }
  toast({
   title: "کالا به‌روزرسانی شد",
   description: `اطلاعات «${form.name}» ذخیره شد${json?.data?.stockApplied != null? " — موجودی در انبار به‌روزرسانی و در گردش انبار ثبت شد": ""}.`,
  });
  // WH-3: اطلاع‌رسانی به سایر بخش‌ها (داشبورد/فاکتور) از تغییر کالا
  window.dispatchEvent(
   new CustomEvent("hoshhesab:data-changed", { detail: { entity: "products" } })
  );
 } else {
  const payload = {
   sku: form.sku.trim(),
   barcode: form.barcode.trim() || undefined,
   name: form.name.trim(),
   unit: form.unit,
   salePrice: salePriceToman * rialFactor,
   purchasePrice: purchasePriceToman * rialFactor,
   wholesalePrice: wholesalePriceToman * rialFactor,
   minStock: minStockValue,
   maxStock: maxStockValue,
   type: (form.type || "GOODS") as "GOODS" | "SERVICE" | "ASSEMBLY",
   ...(form.taxRate !== ""? { taxRate: (Number.isFinite(taxRateValue)? taxRateValue: 10) / 100 }: { taxRate: 0.1 }),
   ...(form.goodsCode.trim()? { goodsCode: form.goodsCode.trim() }: {}),
   // FIX(WH-5): موجودی اولیه کالا — API آن را در انبار پیش‌فرض + گردش انبار (ADJUSTMENT) ثبت می‌کند
   ...(openingStockValue > 0? { stock: openingStockValue }: {}),
   description: form.category? `دسته‌بندی: ${form.category}`: undefined,
   ...(usdPriceValue > 0 ? { usdPrice: usdPriceValue, usdSynced: form.usdSynced } : {}),
  };

  const res = await authFetch("/api/products", {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify(payload),
  });
  let json: { success?: boolean; error?: string; data?: unknown } | null = null;
  try {
   json = await res.json();
  } catch {
   json = null;
  }
  // Issue 4: مدیریت خطای یکپارچه
  parseApiResponse(res, json);

  toast({
   title: "کالا ایجاد شد",
   description: `«${form.name}» با موفقیت ثبت شد.`,
  });
  // WH-3: اطلاع‌رسانی به سایر بخش‌ها (داشبورد/فاکتور) از ایجاد کالای جدید
  window.dispatchEvent(
   new CustomEvent("hoshhesab:data-changed", { detail: { entity: "products" } })
  );
 }
 setDialogOpen(false);
 setForm(EMPTY_FORM);
 setErrors({});
 setEditingId(null);
 refresh(); // Issue 1: refresh list after create
 } catch (err) {
  toast({
   title: editingId? "خطا در ویرایش کالا": "خطا در ایجاد کالا",
   description: handleApiError(err, editingId? "ویرایش ناموفق بود": "ایجاد کالا ناموفق بود"),
   variant: "destructive",
  });
 } finally {
 setSubmitting(false);
 }
 };

 const handleDelete = (p: ProductRow) => {
 confirm({
 title: "حذف کالا؟",
 description: `کالای «${p.name}» حذف خواهد شد. این عمل قابل بازگشت نیست.`,
 variant: "destructive",
 confirmText: "حذف",
 onConfirm: async () => {
 try {
 const res = await authFetch(`/api/products?id=${encodeURIComponent(p.id)}`, {
 method: "DELETE",
 });
 const json = await res.json().catch(() => ({}));
 if (!res.ok ||!json?.success) {
 toast({
 title: "خطا در حذف کالا",
 description: json?.error || "حذف ناموفق بود.",
 variant: "destructive",
 });
 return;
 }
 setProducts((prev) => prev.filter((x) => x.id!== p.id));
 toast({
 title: "کالا حذف شد",
 description: `«${p.name}» از لیست کالاها حذف شد.`,
 });
 } catch (err) {
 toast({
 title: "خطا در حذف کالا",
 description: handleApiError(err, "حذف کالا ناموفق بود"),
 variant: "destructive",
 });
 }
 },
 });
 };

 // H9: اسکن بارکد — دیالوگ با ورودی دستی + تلاش برای فعال‌سازی دوربین
 const stopCamera = React.useCallback(() => {
 if (streamRef.current) {
 streamRef.current.getTracks().forEach((t) => t.stop());
 streamRef.current = null;
 }
 setCameraActive(false);
 }, []);

 const startCamera = React.useCallback(async () => {
 setCameraError(null);
 if (typeof navigator === "undefined" ||!navigator.mediaDevices?.getUserMedia) {
 setCameraError("مرورگر شما از دوربین پشتیبانی نمی‌کند. لطفاً بارکد را دستی وارد کنید.");
 return;
 }
 try {
 const stream = await navigator.mediaDevices.getUserMedia({
 video: { facingMode: "environment" },
 audio: false,
 });
 streamRef.current = stream;
 setCameraActive(true);
 // اتصال stream به video element بعد از render
 setTimeout(() => {
 if (videoRef.current) {
 videoRef.current.srcObject = stream;
 void videoRef.current.play().catch(() => {});
 }
 }, 50);
 } catch (err) {
 const msg = err instanceof Error? err.message: "خطا در دسترسی به دوربین";
 setCameraError(`${msg}. می‌توانید بارکد را دستی وارد کنید.`);
 }
 }, []);

 // توقف دوربین هنگام بستن دیالوگ
 React.useEffect(() => {
 if (!barcodeDialogOpen && cameraActive) {
 stopCamera();
 }
 }, [barcodeDialogOpen, cameraActive, stopCamera]);

 React.useEffect(() => {
 return () => {
 // پاکسازی دوربین هنگام unmount
 if (streamRef.current) {
 streamRef.current.getTracks().forEach((t) => t.stop());
 streamRef.current = null;
 }
 };
 }, []);

 const searchByBarcode = React.useCallback(async (code: string) => {
 const trimmed = code.trim();
 if (!trimmed) return;
 setBarcodeSearching(true);
 setBarcodeNotFound(false);
 setBarcodeResult(null);
 try {
 const res = await authFetch(
 `/api/products?barcode=${encodeURIComponent(trimmed)}&limit=10`,
 { cache: "no-store" }
 );
 const json = await res.json().catch(() => ({}));
 if (json?.success && Array.isArray(json.data) && json.data.length > 0) {
 const p = json.data[0] as Record<string, unknown>;
 const stockValue = Number(p.stock?? 0) || 0;
 const min = Number((p as { minStock?: number }).minStock?? 0);
 const salePrice = Number((p as { salePrice?: number }).salePrice?? 0);
 const salePriceToman = Number(
 (p as { salePriceToman?: number }).salePriceToman?? Math.trunc(salePrice / 10)
 );
 const wholesalePrice = Number((p as { wholesalePrice?: number }).wholesalePrice?? 0) || 0;
 const avgCost = Number((p as { purchasePrice?: number }).purchasePrice?? 0) || 0;
 const valueRial = stockValue * salePrice;
 setBarcodeResult({
 id: String(p.id?? ""),
 sku: String(p.sku?? ""),
 barcode: (p as { barcode?: string | null }).barcode ?? null,
 name: String(p.name?? ""),
 category: String((p as { category?: string }).category?? "—"),
 stock: stockValue,
 min,
 max: Number((p as { maxStock?: number }).maxStock?? 0) || 0,
 unit: String(p.unit?? "عدد"),
 type: String((p as { type?: string }).type?? "GOODS"),
 price: salePrice,
 priceToman: salePriceToman,
 wholesalePrice,
 avgCost,
 taxRate: Number((p as { taxRate?: number }).taxRate?? 0.1) || 0,
 goodsCode: (p as { goodsCode?: string | null }).goodsCode ?? null,
 value: valueRial,
 valueToman: Math.trunc(valueRial / 10),
 status: computeStatus(stockValue, min),
 });
 } else {
 setBarcodeNotFound(true);
 }
 } catch {
 setBarcodeNotFound(true);
 } finally {
 setBarcodeSearching(false);
 }
 }, []);

 const openBarcodeDialog = () => {
 setBarcodeInput("");
 setBarcodeResult(null);
 setBarcodeNotFound(false);
 setCameraError(null);
 setBarcodeDialogOpen(true);
 };

 const handleBarcodeScan = () => {
 openBarcodeDialog();
 };

 // ثبت افزایش موجودی کالای یافته‌شده با بارکد (یا بستن و رفتن به لیست)
 const handleBarcodeQuickAdjust = async (delta: number) => {
 if (!barcodeResult) return;
 try {
 // FIX(C3): قرارداد صحیح — {ids, data:{stock}}
 const res = await authFetch("/api/products", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ ids: [barcodeResult.id], data: { stock: barcodeResult.stock + delta } }),
 });
 const json = await res.json().catch(() => ({}));
 if (!res.ok ||!json?.success) {
 toast({
 title: "خطا در به‌روزرسانی موجودی",
 description: json?.error || "عملیات ناموفق بود.",
 variant: "destructive",
 });
 return;
 }
 toast({
 title: "موجودی به‌روزرسانی شد",
 description: `${delta > 0? "+": ""}${toPersianDigits(delta)} ${barcodeResult.unit} به «${barcodeResult.name}» اضافه شد.`,
 });
 setBarcodeResult((prev) =>
 prev? {...prev, stock: prev.stock + delta, status: computeStatus(prev.stock + delta, prev.min) }: prev
 );
 refresh();
 } catch (err) {
 toast({
 title: "خطا در به‌روزرسانی موجودی",
 description: handleApiError(err, "خطا در ارتباط با سرور"),
 variant: "destructive",
 });
 }
 };

 const handleQR = (product?: ProductRow) => {
 if (product) {
 setQrProduct(product);
 } else if (products.length > 0) {
 setQrProduct(products[0]);
 } else {
 toast({
 title: "کالایی موجود نیست",
 description: "ابتدا یک کالا ثبت کنید تا QR آن تولید شود.",
 variant: "destructive",
 });
 return;
 }
 setQrDialogOpen(true);
 };

 const handleStockTake = async () => {
 setStockTakeOpen(true);
 setStockTakeLoading(true);
 try {
 // FIX(M7): انبارگردانی باید «همه» کالاها را پوشش دهد — قبلاً فقط ۱۰۰ (حالا ۵۰۰)
 // کالای اولِ لیست مبنای شمارش بود و مغایرت کالاهای بعدی دیده نمی‌شد.
 // همه‌ی صفحات API (تا سقف ۲۰ صفحه × ۵۰۰ = ۱۰٬۰۰۰ کالا) واکشی می‌شود.
 const all: Array<{ id: string; name: string; sku: string; stock: number }> = [];
 const pageSize = 500;
 let offset = 0;
 for (let page = 0; page < 20; page++) {
 const res = await authFetch(
 `/api/products?limit=${pageSize}&offset=${offset}&sortBy=name&sortOrder=asc`,
 { cache: "no-store" }
 );
 const json = await res.json().catch(() => ({}));
 if (!json?.success || !Array.isArray(json.data) || json.data.length === 0) break;
 for (const p of json.data as Record<string, unknown>[]) {
 all.push({
 id: String(p.id?? ""),
 name: String(p.name?? ""),
 sku: String(p.sku?? ""),
 stock: Number(p.stock?? 0) || 0,
 });
 }
 const total = Number(json.total?? all.length);
 offset += pageSize;
 if (offset >= total) break;
 }
 if (all.length === 0) {
 toast({
 title: "کالایی برای انبارگردانی نیست",
 variant: "destructive",
 });
 setStockTakeData([]);
 } else {
 setStockTakeData(
 all.map((p) => ({
 id: p.id,
 name: p.name,
 sku: p.sku,
 systemStock: p.stock,
 countedStock: p.stock,
 diff: 0,
 }))
 );
 }
 } catch {
 toast({
 title: "خطا در آماده‌سازی انبارگردانی",
 description: "دریافت لیست کالاها ناموفق بود — دوباره تلاش کنید.",
 variant: "destructive",
 });
 setStockTakeData([]);
 } finally {
 setStockTakeLoading(false);
 }
 };

 const updateCountedStock = (id: string, counted: number) => {
 setStockTakeData((prev) =>
 prev.map((row) =>
 row.id === id
? {...row, countedStock: counted, diff: counted - row.systemStock }
: row
 )
 );
 };

 const finalizeStockTake = async () => {
 const discrepancies = stockTakeData.filter((r) => r.diff!== 0);
 if (discrepancies.length === 0) {
 toast({
 title: "انبارگردانی تکمیل شد",
 description: "هیچ مغایرتی یافت نشد — موجودی سیستم با فیزیکی مطابقت دارد.",
 });
 setStockTakeOpen(false);
 return;
 }
 setStockTakeSubmitting(true);
 try {
 // FIX(C2): قرارداد صحیح PATCH + بررسی پاسخ هر درخواست — قبلاً همه ۴۰۰ می‌شدند
 // و پیام موفقیت قلابی نمایش داده می‌شد
 let okCount = 0;
 let failCount = 0;
 let lastErr = "";
 for (const r of discrepancies) {
 try {
 const res = await authFetch("/api/products", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ ids: [r.id], data: { stock: r.countedStock } }),
 });
 const json = await res.json().catch(() => ({}));
 if (res.ok && json?.success) okCount++;
 else {
 failCount++;
 lastErr = json?.error || `HTTP ${res.status}`;
 }
 } catch {
 failCount++;
 lastErr = "خطای شبکه";
 }
 }
 if (okCount > 0 && failCount === 0) {
 toast({
 title: "انبارگردانی ثبت شد",
 description: `${toPersianDigits(okCount)} کالا با مغایرت به‌روزرسانی شد.`,
 });
 setStockTakeOpen(false);
 refresh();
 } else if (okCount > 0) {
 toast({
 title: "ثبت ناقص انجام شد",
 description: `${toPersianDigits(okCount)} موفق، ${toPersianDigits(failCount)} ناموفق — ${lastErr}`,
 variant: "destructive",
 });
 refresh();
 } else {
 toast({
 title: "خطا در ثبت انبارگردانی",
 description: lastErr || "هیچ کالایی به‌روزرسانی نشد.",
 variant: "destructive",
 });
 }
 } finally {
 setStockTakeSubmitting(false);
 }
 };

 const handleRowAction = (p: ProductRow, action: string) => {
 // اکشن‌های اضافی هر ردیف — در حال حاضر فقط QR کد
 if (action === "qr") {
 handleQR(p);
 }
 };

 // ⑩ باز کردن دیالوگ گردش انبار برای یک کالا
 const openMovements = (p: ProductRow) => {
 setMovementsProduct(p);
 setMovementsOpen(true);
 };

 // ⑪ ذخیره قیمت عمده — ویرایش درون‌خطی جدول (PATCH /api/products با wholesalePrice)
 const handleWholesaleSave = React.useCallback(
 async (productId: string, wholesaleToman: number): Promise<boolean> => {
 const prev = products.find((p) => p.id === productId);
 const rial = wholesaleToman * 10; // تومان → ریال
 // به‌روزرسانی خوش‌بینانه (optimistic)
 setProducts((list) =>
 list.map((p) => (p.id === productId? {...p, wholesalePrice: rial }: p))
 );
 try {
 const res = await authFetch("/api/products", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ ids: [productId], data: { wholesalePrice: rial } }),
 });
 const json = await res.json().catch(() => ({}));
 if (!res.ok ||!json?.success) {
 throw new Error(json?.error || "به‌روزرسانی ناموفق بود");
 }
 toast({
 title: "قیمت عمده به‌روزرسانی شد",
 description: `قیمت عمده «${prev?.name?? "کالا"}» به ${formatPrice(rial, "toman")} تغییر کرد.`,
 });
 return true;
 } catch (err) {
 // بازگشت مقدار قبلی در صورت خطا
 if (prev) {
 setProducts((list) =>
 list.map((p) =>
 p.id === productId? {...p, wholesalePrice: prev.wholesalePrice }: p
 )
 );
 }
 toast({
 title: "خطا در به‌روزرسانی قیمت عمده",
 description: handleApiError(err, "ذخیره قیمت عمده ناموفق بود"),
 variant: "destructive",
 });
 return false;
 }
 },
 [products, toast]
 );

 return (
 <div className="space-y-5 animate-fade-in-up">
 {/* FIX(M1): بنر خطا به‌جای بلعیدن بی‌صدا */}
 {fetchError && (
 <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
 <span>{fetchError}</span>
 <Button variant="outline" size="sm" className="h-7" onClick={() => refresh()}>
 تلاش مجدد
 </Button>
 </div>
 )}
 {/* آمار */}
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
 <Card className="card-hover">
 <CardContent className="p-4 flex items-center gap-3">
 <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
 <Boxes className="h-5 w-5" />
 </div>
 <div>
 <p className="text-xs text-muted-foreground">کل کالاها</p>
 <p className="font-bold text-lg tnum">{toPersianDigits(productsTotal?? products.length)}</p>
 {productsTotal !== null && productsTotal > products.length && (
 <p className="text-[10px] text-muted-foreground tnum">
 نمایش {toPersianDigits(products.length)} از {toPersianDigits(productsTotal)}
 </p>
 )}
 </div>
 </CardContent>
 </Card>
 <Card className="card-hover">
 <CardContent className="p-4 flex items-center gap-3">
 <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
 <Package className="h-5 w-5" />
 </div>
 <div>
 <p className="text-xs text-muted-foreground">ارزش انبار (بهای تمام‌شده)</p>
 <p className="font-bold text-lg tnum">
 {totalValue > 0? formatPriceCompact(totalValue, displayUnit): "—"}
 </p>
 </div>
 </CardContent>
 </Card>
 <Card className="card-hover">
 <CardContent className="p-4 flex items-center gap-3">
 <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10 text-warning">
 <AlertTriangle className="h-5 w-5" />
 </div>
 <div>
 <p className="text-xs text-muted-foreground">کسری موجودی</p>
 <p className="font-bold text-lg tnum">{toPersianDigits(lowStock)} کالا</p>
 {summary && summary.zeroStockProducts > 0 && (
 <p className="text-[10px] text-muted-foreground tnum">
 {toPersianDigits(summary.zeroStockProducts)} کالای بدون موجودی
 </p>
 )}
 </div>
 </CardContent>
 </Card>
 <Card className="card-hover">
 <CardContent className="p-4 flex items-center gap-3">
 <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
 <ArrowRightLeft className="h-5 w-5" />
 </div>
 <div>
 <p className="text-xs text-muted-foreground">انبارها</p>
 <p className="font-bold text-lg tnum">{toPersianDigits(warehouseCount)} فعال</p>
 </div>
 </CardContent>
 </Card>
 </div>

 {/* همگام‌سازی قیمت با نرخ بازار — پلن حرفه‌ای/سازمانی */}
 <MarketPriceSync onPricesChanged={refresh} />

 {/* نوار ابزار */}
 <Card className="card-hover">
 <CardContent className="p-4">
 <div className="flex flex-col md:flex-row gap-3">
 <div className="relative flex-1">
 <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input
 placeholder="جستجوی نام کالا، SKU یا بارکد... (سراسری در همهٔ کالاها)"
 className="ps-9"
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 />
 {search !== serverSearch && (
 <span className="absolute end-3 top-1/2 -translate-y-1/2">
 <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
 </span>
 )}
 </div>
 <Button variant="outline" className="gap-1.5" onClick={() => setBulkImportOpen(true)}>
 <UploadCloud className="h-4 w-4" />
 وارد کردن
 </Button>
 <Button variant="outline" className="gap-1.5" onClick={() => {
 if (products.length === 0) {
 toast({ title: "محصولی برای خروجی وجود ندارد", variant: "destructive" });
 return;
 }
 const rows = products.map((p) => ({
 name: p.name,
 sku: p.sku,
 category: p.category,
 stock: p.stock,
 price: p.price,
 unit: p.unit,
 }));
 exportToCSV(rows, `انبار-${new Date().toISOString().slice(0, 10)}`);
 toast({ title: "خروجی گرفته شد", description: `${toPersianDigits(rows.length)} محصول ذخیره شد.` });
 }}>
 <Download className="h-4 w-4" />
 خروجی
 </Button>
 <Button variant="outline" className="gap-1.5" onClick={handleBarcodeScan}>
 <Barcode className="h-4 w-4" />
 اسکن بارکد
 </Button>
 <Button variant="outline" className="gap-1.5" onClick={() => handleQR()}>
 <QrCode className="h-4 w-4" />
 تولید QR
 </Button>
 <Button variant="outline" className="gap-1.5" onClick={handleStockTake}>
 <PackageCheck className="h-4 w-4" />
 انبارگردانی
 </Button>
 {/* دکمه تغییر واحد نمایش قیمت‌ها — تومان/ریال */}
 <Button
 variant="outline"
 className="gap-1.5"
 onClick={() => setDisplayUnit((u) => (u === "toman"? "rial": "toman"))}
 aria-label="تغییر واحد نمایش قیمت"
 title="تغییر واحد نمایش قیمت‌ها"
 >
 <Coins className="h-4 w-4" />
 {displayUnit === "toman"? "تومان": "ریال"}
 </Button>
 <Button className="gap-1.5" onClick={openAddProduct}>
 <Plus className="h-4 w-4" />
 کالای جدید
 </Button>
 </div>
 </CardContent>
 </Card>

 {/* لیست کالاها — خالی */}
 <Card className="card-hover">
 <CardHeader className="pb-3">
 <CardTitle className="text-base">مدیریت کالاها</CardTitle>
 {/* PERF-1200: نشانگر سرور-طرف + شمار نتایج جستجو */}
 {serverSearch && (
 <p className="text-xs text-muted-foreground mt-1">
 نتایج جستجو برای «{serverSearch}»: {toPersianDigits(productsTotal?? products.length)} کالا — کالاهای بدون موجودی هم نمایش داده می‌شوند.
 </p>
 )}
 </CardHeader>
 <CardContent className="p-0">
 {loading? (
 <div className="flex items-center justify-center py-12">
 <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
 </div>
 ): filtered.length === 0? (
 serverSearch || (productsTotal?? 0) > 0? (
 <EmptyState
 icon={Search}
 title="کالایی مطابق جستجو یافت نشد"
 description={`عبارت «${serverSearch}» با هیچ کالایی (نام، SKU یا بارکد) مطابقت ندارد.`}
 action={
 <Button size="sm" variant="outline" onClick={() => setSearch("")}>
 پاک‌کردن جستجو
 </Button>
 }
 />
 ) : (
 <EmptyState
 icon={Package}
 title="هنوز کالایی تعریف نشده"
 description="اولین کالای خود را با مشخص کردن SKU، نام، دسته‌بندی، موجودی و قیمت فروش ثبت کنید."
 action={
 <Button size="sm" className="gap-1.5" onClick={openAddProduct}>
 <Plus className="h-3.5 w-3.5" />
 تعریف اولین کالا
 </Button>
 }
 />
 )
 ): (
 <div className="overflow-x-auto">
 <table className="w-full text-sm min-w-[1100px] table-zebra">
 <thead>
 <tr className="text-start text-xs text-muted-foreground border-b">
 <th scope="col" className="font-medium px-4 py-2.5">SKU / بارکد</th>
 <th scope="col" className="font-medium px-4 py-2.5">نام کالا</th>
 <th scope="col" className="font-medium px-4 py-2.5">دسته</th>
 <th scope="col" className="font-medium px-4 py-2.5">موجودی</th>
 <th scope="col" className="font-medium px-4 py-2.5">حداقل</th>
 <th scope="col" className="font-medium px-4 py-2.5">موجودی نسبی</th>
 <th scope="col" className="font-medium px-4 py-2.5">
 قیمت فروش ({displayUnit === "toman"? "تومان": "ریال"})
 </th>
 <th scope="col" className="font-medium px-4 py-2.5">
 قیمت عمده ({displayUnit === "toman"? "تومان": "ریال"})
 </th>
 <th scope="col" className="font-medium px-4 py-2.5">
 بهای تمام‌شده ({displayUnit === "toman"? "تومان": "ریال"})
 </th>
 <th scope="col" className="font-medium px-4 py-2.5">وضعیت</th>
 <th scope="col" className="font-medium px-4 py-2.5 text-end">عملیات</th>
 </tr>
 </thead>
 <tbody className="tnum">
 {filtered.map((p) => {
 const pct = p.min > 0? Math.min((p.stock / (p.min * 3)) * 100, 100): 0;
 return (
 <tr
 key={p.id || p.sku}
 className="border-b border-border/40 transition-colors"
 >
 <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
 <td className="px-4 py-3 font-medium">
 <span className="inline-flex items-center gap-1.5">
 {p.name}
 {p.usdSynced && p.usdPrice != null && (
 <span
 title={`قیمت دلاری: ${p.usdPrice}$ — با نرخ دلار همگام است`}
 className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400"
 dir="ltr"
 >
 ${p.usdPrice}$
 </span>
 )}
 </span>
 </td>
 <td className="px-4 py-3 text-muted-foreground">
 {p.category}
 </td>
 <td className="px-4 py-3 font-medium">
 {toPersianDigits(formatNumber(p.stock))} {p.unit}
 </td>
 <td className="px-4 py-3 text-muted-foreground">
 {toPersianDigits(formatNumber(p.min))}
 </td>
 <td className="px-4 py-3 w-28">
 <Progress value={pct} className="h-1.5" />
 </td>
 <td className="px-4 py-3">
 <div className="flex flex-col">
 <span className="font-medium">
 {formatPriceCompact(p.price, displayUnit)}
 </span>
 {/* نمایش معادل در واحد دیگر به‌عنوان راهنما */}
 <span className="text-[10px] text-muted-foreground">
 {displayUnit === "toman"
? `${toPersianDigits(formatNumber(p.price))} ریال`
: `${toPersianDigits(formatNumber(p.priceToman))} تومان`}
 </span>
 </div>
 </td>
 {/* ⑪ قیمت عمده — ویرایش درون‌خطی (کلیک → ورود تومان → ذخیره با Enter/Blur) */}
 <td className="px-4 py-3">
 <WholesalePriceCell
 row={p}
 displayUnit={displayUnit}
 onSave={handleWholesaleSave}
 />
 </td>
 {/* ⑩ بهای تمام‌شده میانگین متحرک (= purchasePrice کالا) */}
 <td className="px-4 py-3">
 <div className="flex flex-col">
 <span className="font-medium">
 {p.avgCost > 0? formatPriceCompact(p.avgCost, displayUnit): "—"}
 </span>
 <span className="text-[10px] text-muted-foreground">میانگین متحرک</span>
 </div>
 </td>
 <td className="px-4 py-3">
 <Badge
 className={`text-[10px] ${STATUS_MAP[p.status].color}`}
 >
 {STATUS_MAP[p.status].label}
 </Badge>
 </td>
 <td className="px-4 py-3">
 <div className="flex items-center justify-end gap-1">
 {/* ⑩ گردش انبار — حرکات + بهای تمام‌شده */}
 <Button
 size="icon"
 variant="ghost"
 className="h-7 w-7"
 aria-label="گردش انبار"
 title="گردش انبار"
 onClick={() => openMovements(p)}
 >
 <ClipboardList className="h-3.5 w-3.5" />
 </Button>
 <Button
 size="icon"
 variant="ghost"
 className="h-7 w-7"
 aria-label="ویرایش"
 onClick={() => openEditProduct(p)}
 >
 <Pencil className="h-3.5 w-3.5" />
 </Button>
 <Button
 size="icon"
 variant="ghost"
 className="h-7 w-7 text-muted-foreground"
 aria-label="QR کد"
 onClick={() => handleRowAction(p, "qr")}
 >
 <QrCode className="h-3.5 w-3.5" />
 </Button>
 <Button
 size="icon"
 variant="ghost"
 className="h-7 w-7 text-destructive hover:text-destructive"
 aria-label="حذف"
 onClick={() => handleDelete(p)}
 >
 <Trash2 className="h-3.5 w-3.5" />
 </Button>
 </div>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 )}

 {/* PERF-1200: صفحه‌بندی سمت سرور — ۵۰ ردیف در هر صفحه + ناوبری */}
 {((productsTotal?? 0) > PAGE_SIZE || page > 0) && (
 <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5 text-xs">
 <span className="text-muted-foreground tnum">
 نمایش {toPersianDigits(page * PAGE_SIZE + (products.length? 1: 0))}
 {products.length > 1? ` تا ${toPersianDigits(page * PAGE_SIZE + products.length)}`: ""}
 از {toPersianDigits(productsTotal?? 0)} کالا
 </span>
 <div className="flex items-center gap-1">
 <Button
 variant="outline"
 size="sm"
 className="h-7 px-2 text-xs"
 disabled={page === 0 || loading}
 onClick={() => setPage((p) => Math.max(0, p - 1))}
 aria-label="صفحه قبل"
 >
 قبلی
 </Button>
 {/* شماره صفحات فشرده — حداکثر ۷ دکمه */}
 {(() => {
 const totalPages = Math.max(1, Math.ceil((productsTotal?? 0) / PAGE_SIZE));
 const pages: number[] = [];
 const start = Math.max(0, Math.min(page - 3, totalPages - 7));
 for (let i = start; i < Math.min(start + 7, totalPages); i++) pages.push(i);
 return pages.map((pNum) => (
 <Button
 key={pNum}
 variant={pNum === page? "default": "outline"}
 size="sm"
 className="h-7 w-7 p-0 text-xs tnum"
 disabled={loading}
 onClick={() => setPage(pNum)}
 aria-label={`صفحه ${pNum + 1}`}
 aria-current={pNum === page? "page": undefined}
 >
 {toPersianDigits(pNum + 1)}
 </Button>
 ));
 })()}
 <Button
 variant="outline"
 size="sm"
 className="h-7 px-2 text-xs"
 disabled={page >= Math.ceil((productsTotal?? 0) / PAGE_SIZE) - 1 || loading}
 onClick={() => setPage((p) => p + 1)}
 aria-label="صفحه بعد"
 >
 بعدی
 </Button>
 </div>
 </div>
 )}
 </CardContent>
 </Card>

 {/* دیالوگ آپلود گروهی کالاها */}
 <BulkImport
 entityType="products"
 open={bulkImportOpen}
 onOpenChange={setBulkImportOpen}
 />

 {/* دیالوگ ایجاد/ویرایش کالا — EDIT-ALL: همهٔ فیلدها قابل ویرایش + COMPACT: درون viewport با اسکرول */}
 <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
 <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
 <DialogHeader className="pb-1">
 <DialogTitle className="flex items-center gap-2 text-base">
 <Package className="h-4 w-4 text-primary" />
 {editingId? "ویرایش کالا": "کالای جدید"}
 </DialogTitle>
 <DialogDescription className="text-xs">
 {editingId
 ? "همهٔ اطلاعات کالا (کد، بارکد، قیمت‌ها، مالیات، موجودی و...) قابل ویرایش است."
 : "اطلاعات کالای جدید را وارد کنید تا در انبار ثبت شود."}
 </DialogDescription>
 </DialogHeader>

 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 py-0.5 text-xs">
 {/* ردیف ۱: SKU + بارکد — هر دو همیشه قابل ویرایش (EDIT-ALL) */}
 <div className="space-y-1">
 <Label className="text-xs">کد کالا (SKU) *</Label>
 <Input
 value={form.sku}
 onChange={(e) => {
 setForm((f) => ({...f, sku: e.target.value }));
 if (errors.sku) setErrors((prev) => ({...prev, sku: "" }));
 }}
 onBlur={() => {
 if (!form.sku.trim()) setErrors((prev) => ({...prev, sku: "کد کالا (SKU) الزامی است" }));
 }}
 placeholder="مثلاً SKU-1001"
 dir="ltr"
 className={`h-9 text-start ${errors.sku? "border-destructive focus-visible:ring-destructive": ""}`}
 aria-invalid={!!errors.sku}
 />
 {errors.sku && (
 <p className="text-[10px] text-destructive">{errors.sku}</p>
 )}
 </div>
 <div className="space-y-1">
 <Label className="text-xs">بارکد</Label>
 <Input
 value={form.barcode}
 onChange={(e) => setForm((f) => ({...f, barcode: e.target.value }))}
 placeholder="مثلاً 6260001234567"
 dir="ltr"
 className="h-9 text-start tnum"
 />
 </div>
 {/* ردیف ۲: نام + واحد */}
 <div className="space-y-1">
 <Label className="text-xs">نام کالا *</Label>
 <Input
 value={form.name}
 onChange={(e) => {
 setForm((f) => ({...f, name: e.target.value }));
 if (errors.name) setErrors((prev) => ({...prev, name: "" }));
 }}
 onBlur={() => {
 if (!form.name.trim()) setErrors((prev) => ({...prev, name: "نام کالا الزامی است" }));
 }}
 placeholder="مثلاً لپ‌تاپ ایکس‌وی‌بی۱۵"
 className={`h-9 ${errors.name? "border-destructive focus-visible:ring-destructive": ""}`}
 aria-invalid={!!errors.name}
 />
 {errors.name && (
 <p className="text-[10px] text-destructive">{errors.name}</p>
 )}
 </div>
 <div className="space-y-1">
 <Label className="text-xs">واحد</Label>
 <Select
 value={form.unit}
 onValueChange={(v) => setForm((f) => ({...f, unit: v }))}
 >
 <SelectTrigger className="h-9 w-full text-xs">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {UNITS.map((u) => (
 <SelectItem key={u} value={u}>
 {u}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 {/* ردیف ۳: نوع کالا + دسته‌بندی — هر دو قابل ویرایش (EDIT-ALL) */}
 <div className="space-y-1">
 <Label className="text-xs">نوع</Label>
 <Select
 value={form.type || "GOODS"}
 onValueChange={(v) => setForm((f) => ({...f, type: v }))}
 >
 <SelectTrigger className="h-9 w-full text-xs">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="GOODS">کالا</SelectItem>
 <SelectItem value="SERVICE">خدمت</SelectItem>
 <SelectItem value="ASSEMBLY">مجموعه / مونتاژ</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1">
 <Label className="text-xs">دسته‌بندی</Label>
 <Input
 value={form.category}
 onChange={(e) => setForm((f) => ({...f, category: e.target.value }))}
 placeholder="مثلاً الکترونیک"
 className="h-9"
 />
 </div>
 {/* ردیف ۴: واحد ورود قیمت + قیمت فروش */}
 <div className="space-y-1">
 <Label className="text-xs">واحد ورود قیمت‌ها</Label>
 <div className="flex gap-2">
 <Button
 type="button"
 size="sm"
 variant={form.priceUnit === "toman"? "default": "outline"}
 className="flex-1 gap-1 h-8"
 onClick={() => setForm((f) => ({...f, priceUnit: "toman" }))}
 >
 <Coins className="h-3 w-3" />
 تومان
 </Button>
 <Button
 type="button"
 size="sm"
 variant={form.priceUnit === "rial"? "default": "outline"}
 className="flex-1 gap-1 h-8"
 onClick={() => setForm((f) => ({...f, priceUnit: "rial" }))}
 >
 <Coins className="h-3 w-3" />
 ریال
 </Button>
 </div>
 </div>
 <div className="space-y-1">
 <Label className="text-xs">قیمت فروش ({form.priceUnit === "toman"? "تومان": "ریال"})</Label>
 <Input
 dir="ltr"
 inputMode="numeric"
 value={form.salePrice}
 onChange={(e) => setForm((f) => ({...f, salePrice: digitsOnly(e.target.value) }))}
 placeholder="0"
 className="h-9 text-start tnum"
 />
 </div>
 {/* ردیف ۵: قیمت خرید + قیمت عمده (EDIT-ALL) */}
 <div className="space-y-1">
 <Label className="text-xs">قیمت خرید ({form.priceUnit === "toman"? "تومان": "ریال"})</Label>
 <Input
 dir="ltr"
 inputMode="numeric"
 value={form.purchasePrice}
 onChange={(e) => setForm((f) => ({...f, purchasePrice: digitsOnly(e.target.value) }))}
 placeholder="0"
 className="h-9 text-start tnum"
 />
 </div>
 <div className="space-y-1">
 <Label className="text-xs">قیمت عمده ({form.priceUnit === "toman"? "تومان": "ریال"})</Label>
 <Input
 dir="ltr"
 inputMode="numeric"
 value={form.wholesalePrice}
 onChange={(e) => setForm((f) => ({...f, wholesalePrice: digitsOnly(e.target.value) }))}
 placeholder="0"
 className="h-9 text-start tnum"
 />
 </div>
 {/* ردیف ۶: حداقل + حداکثر موجودی */}
 <div className="space-y-1">
 <Label className="text-xs">حداقل موجودی (هشدار کمبود)</Label>
 <Input
 dir="ltr"
 inputMode="numeric"
 value={form.minStock}
 onChange={(e) => setForm((f) => ({...f, minStock: digitsOnly(e.target.value) }))}
 placeholder="0"
 className="h-9 text-start tnum"
 />
 </div>
 <div className="space-y-1">
 <Label className="text-xs">حداکثر موجودی (سقف انبار)</Label>
 <Input
 dir="ltr"
 inputMode="numeric"
 value={form.maxStock}
 onChange={(e) => setForm((f) => ({...f, maxStock: digitsOnly(e.target.value) }))}
 placeholder="0"
 className="h-9 text-start tnum"
 />
 </div>
 {/* ردیف ۷: مالیات + شناسه مودیان (EDIT-ALL) */}
 <div className="space-y-1">
 <Label className="text-xs">نرخ مالیات (٪)</Label>
 <Input
 dir="ltr"
 inputMode="numeric"
 value={form.taxRate}
 onChange={(e) => setForm((f) => ({...f, taxRate: digitsOnly(e.target.value) }))}
 placeholder="۱۰"
 className="h-9 text-start tnum"
 />
 <p className="text-[10px] text-muted-foreground">
 خالی = ۱۰٪ (نرخ قانونی ۱۴۰۴). صفر = معاف.
 </p>
 </div>
 <div className="space-y-1">
 <Label className="text-xs">شناسه کالا/خدمت مودیان</Label>
 <Input
 value={form.goodsCode}
 onChange={(e) => setForm((f) => ({...f, goodsCode: e.target.value }))}
 placeholder="اختیاری — برای صورتحساب B2B"
 dir="ltr"
 className="h-9 text-start"
 />
 </div>
 {/* ردیف ۸: موجودی — ویرایش = تعدیل انبار؛ ایجاد = موجودی اولیه (EDIT-ALL) */}
 {editingId? (
 <div className="space-y-1 sm:col-span-2">
 <Label className="text-xs flex items-center gap-1">
 <Boxes className="h-3.5 w-3.5 text-primary" />
 موجودی فعلی (تغییر = ثبت تعدیل در گردش انبار)
 </Label>
 <Input
 dir="ltr"
 inputMode="numeric"
 value={form.stockEdit}
 onChange={(e) => setForm((f) => ({...f, stockEdit: digitsOnly(e.target.value) }))}
 placeholder="0"
 className="h-9 text-start tnum sm:max-w-[16rem]"
 />
 <p className="text-[10px] text-muted-foreground">
 تغییر این عدد یک ردیف «تنظیم دستی» در گردش انبار ثبت می‌کند و بهای تمام‌شده میانگین متحرک بازمحاسبه می‌شود.
 </p>
 </div>
 ) : (
 <div className="space-y-1">
 <Label className="text-xs flex items-center gap-1">
 <Boxes className="h-3.5 w-3.5 text-primary" />
 موجودی اولیه
 </Label>
 <Input
 dir="ltr"
 inputMode="numeric"
 value={form.openingStock}
 onChange={(e) => setForm((f) => ({...f, openingStock: digitsOnly(e.target.value) }))}
 placeholder="0"
 className="h-9 text-start tnum"
 />
 <p className="text-[10px] text-muted-foreground">
 اگر خالی بماند، موجودی اولیه صفر ثبت می‌شود.
 </p>
 </div>
 )}
 {/* ردیف ۹: قیمت دلاری + همگام‌سازی (USD-PRICE) */}
 <div className="space-y-1 sm:col-span-2">
 <Label className="text-xs flex items-center gap-1">
 <span className="text-primary font-bold">$</span>
 قیمت پایه دلاری (اختیاری)
 </Label>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
 <Input
 dir="ltr"
 inputMode="decimal"
 value={form.usdPrice}
 onChange={(e) => setForm((f) => ({...f, usdPrice: e.target.value.replace(/[^0-9.,،٬]/g, "").slice(0, 12) }))}
 placeholder="مثلاً 1.74"
 className="h-9 text-start tnum"
 />
 <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2">
 <input
 type="checkbox"
 checked={form.usdSynced}
 onChange={(e) => setForm((f) => ({...f, usdSynced: e.target.checked }))}
 className="mt-0.5 h-4 w-4 accent-primary"
 />
 <span className="text-[10px] leading-relaxed text-muted-foreground">
 <span className="font-medium text-foreground">همگام‌سازی با نرخ دلار</span> —
 قیمت فروش = قیمت دلاری × نرخ روز
 </span>
 </label>
 </div>
 </div>
 {/* ردیف ۱۰: شرح (EDIT-ALL) */}
 <div className="space-y-1 sm:col-span-2">
 <Label className="text-xs">شرح / توضیحات</Label>
 <Input
 value={form.description}
 onChange={(e) => setForm((f) => ({...f, description: e.target.value.slice(0, 400) }))}
 placeholder="توضیح اختیاری کالا..."
 className="h-9"
 />
 </div>
 </div>

 <DialogFooter className="mt-1 gap-2">
 <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)} disabled={submitting}>
 انصراف
 </Button>
 <Button
 size="sm"
 onClick={handleSubmit}
 disabled={submitting ||!isFormValid}
 className="gap-1.5"
 >
 {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
 {editingId? "ذخیره تغییرات": "ایجاد کالا"}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {ConfirmDialogComponent}

 {/* دیالوگ QR Code کالا */}
 <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
 <DialogContent className="sm:max-w-md">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2">
 <QrCode className="h-4 w-4 text-primary" />
 کد QR کالا
 </DialogTitle>
 <DialogDescription>
 این QR را چاپ کرده و روی کالا بچسبانید — با اسکن، اطلاعات کالا نمایش داده می‌شود.
 </DialogDescription>
 </DialogHeader>
 {qrProduct && (
 <div className="flex flex-col items-center gap-3 py-4">
 <div className="rounded-xl border border-border/60 bg-white p-4 shadow-sm">
 {/* FIX(M1): ref-based — قبلاً getElementById("qr-code-dialog") عنصری با آن id
 وجود نداشت و دانلود SVG بی‌صدا no-op بود */}
 <div ref={qrSvgRef}>
 <QRCodeSVG
 value={JSON.stringify({
 id: qrProduct.id,
 name: qrProduct.name,
 sku: qrProduct.sku,
 })}
 size={180}
 level="M"
 />
 </div>
 </div>
 <div className="text-center">
 <p className="font-medium">{qrProduct.name}</p>
 <p className="text-xs text-muted-foreground">
 SKU: <span className="font-mono">{qrProduct.sku || "—"}</span>
 </p>
 </div>
 <Button
 variant="outline"
 size="sm"
 onClick={() => {
 // FIX(M1): دانلود QR به‌صورت SVG — انتخاب svg داخل ref (نه id ناموجود)
 const svg = qrSvgRef.current?.querySelector("svg") || null;
 if (!svg) {
 toast({
 title: "خطا در دانلود",
 description: "کد QR هنوز رندر نشده است.",
 variant: "destructive",
 });
 return;
 }
 const serializer = new XMLSerializer();
 const source = serializer.serializeToString(svg);
 const blob = new Blob([source], { type: "image/svg+xml" });
 const url = URL.createObjectURL(blob);
 const a = document.createElement("a");
 a.href = url;
 a.download = `qr-${qrProduct.sku || qrProduct.id}.svg`;
 a.click();
 // آزادسازی با تأخیر — revoke فوری در برخی مرورگرها دانلود را قطع می‌کند
 setTimeout(() => URL.revokeObjectURL(url), 1000);
 }}
 >
 <Download className="h-4 w-4" />
 دانلود SVG
 </Button>
 </div>
 )}
 <DialogFooter>
 <Button onClick={() => setQrDialogOpen(false)}>بستن</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* دیالوگ انبارگردانی */}
 <Dialog open={stockTakeOpen} onOpenChange={setStockTakeOpen}>
 <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
 <DialogHeader className="shrink-0">
 <DialogTitle className="flex items-center gap-2">
 <ClipboardCheck className="h-4 w-4 text-primary" />
 انبارگردانی
 </DialogTitle>
 <DialogDescription>
 موجودی فیزیکی را وارد کنید — مغایرت‌ها به‌صورت خودکار محاسبه و ثبت می‌شوند.
 </DialogDescription>
 </DialogHeader>
 <div className="flex-1 overflow-y-auto p-1">
 {stockTakeLoading? (
 <div className="flex flex-col items-center justify-center py-16 gap-3">
 <Loader2 className="h-8 w-8 animate-spin text-primary" />
 <p className="text-sm text-muted-foreground">در حال آماده‌سازی...</p>
 </div>
 ): stockTakeData.length === 0? (
 <EmptyState
 icon={ClipboardCheck}
 title="کالایی برای انبارگردانی وجود ندارد"
 description="ابتدا محصولاتی به انبار اضافه کنید."
 />
 ): (
 <div className="overflow-hidden rounded-lg border border-border/60">
 <table className="w-full text-sm">
 <thead className="bg-muted/40 sticky top-0">
 <tr className="text-muted-foreground">
 <th className="text-start p-2 font-medium">نام کالا</th>
 <th className="text-start p-2 font-medium">SKU</th>
 <th className="text-end p-2 font-medium">موجودی سیستم</th>
 <th className="text-end p-2 font-medium">موجودی فیزیکی</th>
 <th className="text-end p-2 font-medium">مغایرت</th>
 </tr>
 </thead>
 <tbody>
 {stockTakeData.map((row) => (
 <tr
 key={row.id}
 className="border-t border-border/40 hover:bg-muted/20"
 >
 <td className="p-2 font-medium">{row.name}</td>
 <td className="p-2 text-xs font-mono text-muted-foreground">{row.sku || "—"}</td>
 <td className="p-2 text-end tnum">{toPersianDigits(row.systemStock)}</td>
 <td className="p-2">
 <Input
 type="number"
 value={row.countedStock}
 onChange={(e) => updateCountedStock(row.id, Number(e.target.value))}
 className="h-8 w-24 text-end tnum"
 />
 </td>
 <td className={`p-2 text-end tnum font-medium ${
 row.diff === 0
? "text-muted-foreground"
: row.diff > 0
? "text-success"
: "text-destructive"
 }`}>
 {row.diff > 0? "+": ""}{toPersianDigits(row.diff)}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 <DialogFooter className="shrink-0 border-t border-border/40 pt-3">
 <Button variant="outline" onClick={() => setStockTakeOpen(false)}>انصراف</Button>
 <Button onClick={finalizeStockTake} disabled={stockTakeData.length === 0 || stockTakeSubmitting}>
 <ClipboardCheck className="h-4 w-4" />
 ثبت نهایی انبارگردانی
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* H9: دیالوگ اسکن بارکد */}
 <Dialog open={barcodeDialogOpen} onOpenChange={setBarcodeDialogOpen}>
 <DialogContent className="sm:max-w-md">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2">
 <Barcode className="h-4 w-4 text-primary" />
 اسکن بارکد کالا
 </DialogTitle>
 <DialogDescription>
 بارکد را دستی وارد کنید یا دوربین را روی بارکد کالا قرار دهید. پس از یافتن کالا، می‌توانید موجودی را سریع به‌روزرسانی کنید.
 </DialogDescription>
 </DialogHeader>
 <div className="space-y-3">
 <div className="space-y-1.5">
 <Label htmlFor="barcode-input">بارکد کالا</Label>
 <div className="flex gap-2">
 <Input
 id="barcode-input"
 dir="ltr"
 inputMode="numeric"
 placeholder="6291234567890"
 value={barcodeInput}
 onChange={(e) => setBarcodeInput(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === "Enter") {
 void searchByBarcode(barcodeInput);
 }
 }}
 className="font-mono text-sm"
 autoFocus
 />
 <Button
 onClick={() => void searchByBarcode(barcodeInput)}
 disabled={barcodeSearching ||!barcodeInput.trim()}
 className="gap-1.5"
 >
 {barcodeSearching? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ): (
 <Search className="h-4 w-4" />
 )}
 جستجو
 </Button>
 </div>
 </div>

 {/* پیش‌نمایش دوربین (در صورت پشتیبانی مرورگر) */}
 {cameraActive && (
 <div className="rounded-lg overflow-hidden border border-border bg-black">
 <video
 ref={videoRef}
 className="w-full h-40 object-cover"
 muted
 playsInline
 />
 <p className="text-[10px] text-muted-foreground text-center py-1 bg-muted/30">
 دوربین فعال است — بارکد را داخل کادر قرار دهید. (تشخیص خودکار تصویر نیازمند کتابخانه‌ی جداگانه است؛ در صورت نبود، بارکد را دستی وارد کنید.)
 </p>
 </div>
 )}
 {cameraError && (
 <p className="text-xs text-warning bg-warning/10 rounded p-2">{cameraError}</p>
 )}

 {!cameraActive && (
 <Button
 variant="outline"
 size="sm"
 onClick={() => void startCamera()}
 className="gap-1.5 w-full"
 >
 <Barcode className="h-4 w-4" />
 فعال‌سازی دوربین (تجربی)
 </Button>
 )}
 {cameraActive && (
 <Button
 variant="outline"
 size="sm"
 onClick={stopCamera}
 className="gap-1.5 w-full"
 >
 توقف دوربین
 </Button>
 )}

 {/* نتیجه‌ی جستجو */}
 {barcodeSearching && (
 <div className="flex items-center justify-center py-4">
 <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
 </div>
 )}
 {barcodeNotFound &&!barcodeSearching && (
 <div className="rounded-lg bg-destructive/5 border border-destructive/30 p-3 text-sm">
 <p className="font-medium text-destructive">کالایی با این بارکد یافت نشد</p>
 <p className="text-xs text-muted-foreground mt-1">
 بارکد را بررسی کنید یا ابتدا کالا را با این بارکد ثبت کنید.
 </p>
 </div>
 )}
 {barcodeResult &&!barcodeSearching && (
 <div className="rounded-lg border border-border bg-card p-3 space-y-2">
 <div className="flex items-start justify-between gap-2">
 <div>
 <p className="font-medium text-sm">{barcodeResult.name}</p>
 <p className="text-xs text-muted-foreground">
 SKU: <span className="font-mono">{barcodeResult.sku || "—"}</span>
 </p>
 </div>
 <Badge className={`text-[10px] ${STATUS_MAP[barcodeResult.status].color}`}>
 {STATUS_MAP[barcodeResult.status].label}
 </Badge>
 </div>
 <div className="grid grid-cols-2 gap-2 text-xs">
 <div className="bg-muted/40 rounded p-2">
 <p className="text-muted-foreground">موجودی فعلی</p>
 <p className="font-bold tnum">
 {toPersianDigits(barcodeResult.stock)} {barcodeResult.unit}
 </p>
 </div>
 <div className="bg-muted/40 rounded p-2">
 <p className="text-muted-foreground">حداقل موجودی</p>
 <p className="font-bold tnum">
 {toPersianDigits(barcodeResult.min)} {barcodeResult.unit}
 </p>
 </div>
 </div>
 <div className="flex gap-2 pt-1">
 <Button
 size="sm"
 variant="outline"
 className="gap-1.5 flex-1"
 onClick={() => void handleBarcodeQuickAdjust(1)}
 >
 <Plus className="h-3.5 w-3.5" />
 +۱
 </Button>
 <Button
 size="sm"
 variant="outline"
 className="gap-1.5 flex-1"
 onClick={() => void handleBarcodeQuickAdjust(10)}
 >
 <Plus className="h-3.5 w-3.5" />
 +۱۰
 </Button>
 <Button
 size="sm"
 variant="outline"
 className="gap-1.5 flex-1"
 onClick={() => void handleBarcodeQuickAdjust(-1)}
 >
 <Trash2 className="h-3.5 w-3.5" />
 −۱
 </Button>
 </div>
 </div>
 )}
 </div>
 <DialogFooter>
 <Button variant="outline" onClick={() => setBarcodeDialogOpen(false)}>بستن</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* ⑩ دیالوگ گردش انبار و بهای تمام‌شده */}
 <StockMovementsDialog
 open={movementsOpen}
 onOpenChange={setMovementsOpen}
 product={movementsProduct}
 />
 </div>
 );
}

/**
 * ⑪ سلول ویرایش درون‌خطی قیمت عمده — کلیک روی مقدار → ورود «تومان» →
 * ذخیره با Enter یا Blur (Esc = انصراف). مقدار در دیتابیس به ریال ذخیره می‌شود.
 */
function WholesalePriceCell({
 row,
 displayUnit,
 onSave,
}: {
 row: ProductRow;
 displayUnit: PriceUnit;
 onSave: (productId: string, wholesaleToman: number) => Promise<boolean>;
}) {
 const [editing, setEditing] = React.useState(false);
 const [draft, setDraft] = React.useState("");
 const [saving, setSaving] = React.useState(false);

 const startEdit = () => {
 // مقدار فعلی به تومان (ریال ÷ ۱۰) در ویرایشگر نمایش داده می‌شود
 setDraft(String(Math.trunc(row.wholesalePrice / 10)));
 setEditing(true);
 };

 const cancel = () => {
 setEditing(false);
 setDraft("");
 };

 const save = async () => {
 if (!editing) return;
 // FIX(M3): ارقام فارسی/عربی قبل از strip نرمال می‌شوند
 const toman = Number(toEnglishDigits(draft).replace(/[^\d]/g, "")) || 0;
 setEditing(false);
 if (toman * 10 === row.wholesalePrice) return; // بدون تغییر
 setSaving(true);
 await onSave(row.id, toman);
 setSaving(false);
 };

 if (editing) {
 return (
 <div className="flex items-center gap-1">
 <Input
 dir="ltr"
 inputMode="numeric"
 autoFocus
 value={draft}
 onChange={(e) => setDraft(toEnglishDigits(e.target.value).replace(/[^\d]/g, ""))}
 onKeyDown={(e) => {
 if (e.key === "Enter") {
 void save();
 } else if (e.key === "Escape") {
 cancel();
 }
 }}
 onBlur={() => void save()}
 className="h-8 w-24 text-xs tnum"
 aria-label={`قیمت عمده ${row.name} (تومان)`}
 />
 <span className="text-[10px] text-muted-foreground shrink-0">تومان</span>
 </div>
 );
 }

 return (
 <button
 type="button"
 onClick={startEdit}
 disabled={saving}
 className="group flex flex-col items-start text-start rounded-md px-1.5 py-0.5 -mx-1 hover:bg-muted/60 transition-colors cursor-pointer w-full"
 title="برای ویرایش قیمت عمده کلیک کنید"
 aria-label={`قیمت عمده ${row.name} — برای ویرایش کلیک کنید`}
 >
 <span className="font-medium flex items-center gap-1">
 {saving? (
 <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
 ): row.wholesalePrice > 0? (
 formatPriceCompact(row.wholesalePrice, displayUnit)
 ): (
 <span className="text-muted-foreground">—</span>
 )}
 </span>
 <span className="text-[10px] text-muted-foreground group-hover:text-primary flex items-center gap-1">
 <Pencil className="h-2.5 w-2.5" />
 {row.wholesalePrice > 0
 ? displayUnit === "toman"
 ? `${toPersianDigits(formatNumber(row.wholesalePrice))} ریال`
 : `${toPersianDigits(formatNumber(Math.trunc(row.wholesalePrice / 10)))} تومان`
 : "ثبت قیمت عمده"}
 </span>
 </button>
 );
}

/**
 * ⑩ دیالوگ «گردش انبار» — حرکات کالا (ورود/خروج/انتقال) + بهای تمام‌شده
 * میانگین متحرک + فیلتر بازه تاریخ شمسی. داده‌ها از /api/inventory/movements.
 */
function StockMovementsDialog({
 open,
 onOpenChange,
 product,
}: {
 open: boolean;
 onOpenChange: (open: boolean) => void;
 product: ProductRow | null;
}) {
 const [movements, setMovements] = React.useState<MovementRow[]>([]);
 const [summary, setSummary] = React.useState<MovementsSummary | null>(null);
 const [loading, setLoading] = React.useState(false);
 const [dateFrom, setDateFrom] = React.useState<string | undefined>(undefined);
 const [dateTo, setDateTo] = React.useState<string | undefined>(undefined);

 const load = React.useCallback(async () => {
 if (!product) return;
 try {
 setLoading(true);
 const params = new URLSearchParams({ productId: product.id, limit: "100" });
 if (dateFrom) params.set("from", dateFrom);
 if (dateTo) params.set("to", dateTo);
 const res = await authFetch(`/api/inventory/movements?${params.toString()}`, {
 cache: "no-store",
 });
 const json = await res.json().catch(() => ({}));
 if (json?.success) {
 setMovements(json.data?.movements?? []);
 setSummary(json.data?.summary?? null);
 } else {
 setMovements([]);
 setSummary(null);
 }
 } catch {
 setMovements([]);
 setSummary(null);
 } finally {
 setLoading(false);
 }
 }, [product, dateFrom, dateTo]);

 React.useEffect(() => {
 if (open) void load();
 }, [open, load]);

 // ریست فیلترها هنگام باز شدن برای کالای جدید
 React.useEffect(() => {
 if (open) {
 setDateFrom(undefined);
 setDateTo(undefined);
 }
 }, [open, product?.id]);

 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
 <DialogHeader className="shrink-0">
 <DialogTitle className="flex items-center gap-2">
 <ClipboardList className="h-4 w-4 text-primary" />
 گردش انبار — {product?.name?? ""}
 </DialogTitle>
 <DialogDescription>
 تاریخچه ورود، خروج و انتقال این کالا همراه با بهای تمام‌شده میانگین متحرک.
 </DialogDescription>
 </DialogHeader>

 <div className="flex-1 overflow-y-auto p-1 space-y-3">
 {/* خلاصه: بهای تمام‌شده + موجودی + مجموع ورود/خروج */}
 {summary? (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
 <div className="rounded-lg border bg-primary/5 p-2.5">
 <p className="text-[10px] text-muted-foreground">بهای تمام‌شده میانگین</p>
 <p className="text-sm font-bold tnum text-primary">
 {summary.avgCost > 0
 ? `${toPersianDigits(formatNumber(summary.avgCostToman))} تومان`
 : "—"}
 </p>
 </div>
 <div className="rounded-lg border p-2.5">
 <p className="text-[10px] text-muted-foreground">موجودی فعلی</p>
 <p className="text-sm font-bold tnum">
 {toPersianDigits(formatNumber(summary.currentStock))}{" "}
 {summary.productUnit}
 </p>
 </div>
 <div className="rounded-lg border border-success/30 bg-success/5 p-2.5">
 <p className="text-[10px] text-muted-foreground">مجموع ورود (بازه)</p>
 <p className="text-sm font-bold tnum flex items-center gap-1">
 <TrendingUp className="h-3.5 w-3.5 text-success" />
 {toPersianDigits(formatNumber(summary.totalIn))}
 </p>
 </div>
 <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
 <p className="text-[10px] text-muted-foreground">مجموع خروج (بازه)</p>
 <p className="text-sm font-bold tnum flex items-center gap-1">
 <TrendingDown className="h-3.5 w-3.5 text-destructive" />
 {toPersianDigits(formatNumber(summary.totalOut))}
 </p>
 </div>
 </div>
 ): (
 <div className="rounded-lg border border-border/60 p-2.5 text-xs text-muted-foreground">
 بهای تمام‌شده میانگین: {product? formatPriceCompact(product.avgCost, "toman"): "—"}
 <span className="text-[10px]"> (میانگین متحرک)</span>
 </div>
 )}

 {/* فیلتر بازه تاریخ شمسی */}
 <div className="flex items-end gap-2 flex-wrap">
 <div className="w-40 space-y-1">
 <Label className="text-[10px] text-muted-foreground">از تاریخ</Label>
 <JalaliDatePicker value={dateFrom} onChange={setDateFrom} className="h-8" />
 </div>
 <div className="w-40 space-y-1">
 <Label className="text-[10px] text-muted-foreground">تا تاریخ</Label>
 <JalaliDatePicker value={dateTo} onChange={setDateTo} className="h-8" />
 </div>
 <Button
 variant="outline"
 size="sm"
 className="h-8 gap-1.5"
 onClick={() => {
 setDateFrom(undefined);
 setDateTo(undefined);
 }}
 disabled={!dateFrom &&!dateTo}
 >
 پاک‌کردن فیلتر
 </Button>
 <Button
 variant="outline"
 size="sm"
 className="h-8 gap-1.5"
 onClick={() => void load()}
 disabled={loading}
 >
 {loading? (
 <Loader2 className="h-3.5 w-3.5 animate-spin" />
 ): (
 <ClipboardList className="h-3.5 w-3.5" />
 )}
 به‌روزرسانی
 </Button>
 </div>

 {/* جدول حرکات */}
 {loading? (
 <div className="flex items-center justify-center py-12">
 <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
 </div>
 ): movements.length === 0? (
 <EmptyState
 icon={ClipboardList}
 title="گردشی ثبت نشده"
 description="هر تغییر موجودی این کالا (تنظیم دستی، رسید یا حواله) به‌صورت خودکار اینجا ثبت می‌شود."
 />
 ): (
 <div className="max-h-96 overflow-y-auto rounded-lg border border-border/60">
 <table className="w-full text-sm min-w-[640px]">
 <thead className="bg-muted/40 sticky top-0">
 <tr className="text-muted-foreground">
 <th className="text-start p-2 font-medium">تاریخ</th>
 <th className="text-start p-2 font-medium">نوع</th>
 <th className="text-end p-2 font-medium">تعداد</th>
 <th className="text-end p-2 font-medium">بهای واحد</th>
 <th className="text-start p-2 font-medium">مرجع</th>
 <th className="text-start p-2 font-medium">انبار</th>
 </tr>
 </thead>
 <tbody>
 {movements.map((m) => {
 const typeFa = MOVEMENT_TYPE_FA[m.type]?? {
 label: m.type,
 color: "bg-muted text-muted-foreground",
 };
 return (
 <tr
 key={m.id}
 className="border-t border-border/40 hover:bg-muted/20"
 >
 <td className="p-2 tnum text-xs">{toJalali(new Date(m.date))}</td>
 <td className="p-2">
 <Badge className={`text-[10px] ${typeFa.color}`}>
 {typeFa.label}
 </Badge>
 </td>
 <td className="p-2 text-end tnum font-medium">
 {toPersianDigits(formatNumber(m.quantity))}{" "}
 {m.productUnit}
 </td>
 <td className="p-2 text-end tnum text-xs">
 {m.unitCost!= null && m.unitCost > 0
 ? formatPrice(m.unitCost, "toman")
 : "—"}
 </td>
 <td className="p-2 text-xs text-muted-foreground">
 {m.referenceType
 ? MOVEMENT_REFERENCE_FA[m.referenceType]?? m.referenceType
 : "—"}
 </td>
 <td className="p-2 text-xs text-muted-foreground">
 {m.type === "TRANSFER" || m.fromWarehouse
 ? `${m.fromWarehouse?? "—"} ← ${m.toWarehouse?? "—"}`
 : (m.toWarehouse?? "—")}
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 )}
 </div>

 <DialogFooter className="shrink-0 border-t border-border/40 pt-3">
 <Button onClick={() => onOpenChange(false)}>بستن</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 );
}
