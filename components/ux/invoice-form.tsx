"use client";

import * as React from "react";
import {
 Plus,
 Trash2,
 Loader2,
 FileText,
 FormInput,
 Coins,
 Info,
 RefreshCw,
 Building2,
 PackagePlus,
 Warehouse as WarehouseIcon,
 CheckCircle2,
 AlertCircle,
 History,
 ScanLine,
 Upload,
 Image as ImageIcon,
 Clock,
} from "lucide-react";
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from "@/components/ui/dialog";
import {
 Sheet,
 SheetContent,
 SheetDescription,
 SheetFooter,
 SheetHeader,
 SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { formatNumber, toPersianDigits, toLocalISODate } from "@/lib/persian";
// VOICE-REMOVE (درخواست مالک): ورودی صوتی حذف شد — Web Speech API در مرورگرهای
// ایران به سرویس گوگل وصل است و تحریم‌شده است؛ «صوتی» هرگز کار نمی‌کرد.
// مسیرهای سالم: فرم دستی + اسکن رسید (OCR) + دستیار هوشمند متنی.
import { validateField } from "@/lib/form-validation";
import { useAutoSave } from "@/hooks/use-auto-save";
import { AutoSaveIndicator } from "@/components/ux/auto-save-indicator";
import { JalaliDatePicker } from "@/components/ui/jalali-date-picker";
import { authFetch } from "@/lib/auth-fetch";
import { ProductPicker, type PickerProduct } from "@/components/ux/product-picker";

interface Party {
 id: string;
 name: string;
 code: string;
 type: string;
}

interface CurrencyInfo {
 code: string;
 label: string;
 symbol: string;
}

const SUPPORTED_CURRENCIES: CurrencyInfo[] = [
 { code: "IRR", label: "ریال ایران", symbol: "ریال" },
 { code: "TOMAN", label: "تومان ایران", symbol: "تومان" },
 { code: "USD", label: "دلار آمریکا", symbol: "$" },
 { code: "EUR", label: "یورو", symbol: "€" },
 { code: "AED", label: "درهم امارات", symbol: "د.إ" },
 { code: "GBP", label: "پوند انگلیس", symbol: "£" },
 { code: "TRY", label: "لیر ترکیه", symbol: "₺" },
 { code: "CNY", label: "یوآن چین", symbol: "¥" },
 { code: "SAR", label: "ریال عربستان", symbol: "ر.س" },
];

const CURRENCY_SYMBOL: Record<string, string> = SUPPORTED_CURRENCIES.reduce(
 (acc, c) => ({...acc, [c.code]: c.symbol }),
 {} as Record<string, string>
);
interface Product {
 id: string;
 name: string;
 sku: string;
 unit: string;
 salePrice: number;
 purchasePrice: number;
 taxRate: number;
}
interface Warehouse {
 id: string;
 name: string;
 code: string;
}

interface InvoiceItemRow {
 id: string;
 productId: string;
 description: string;
 quantity: number;
 unitPrice: number;
 discount: number; // درصد
 taxRate: number; // درصد
}

// FIX(مالیات ۱۴۰۴): نرخ مالیات بر ارزش افزوده ایران ۱۰٪ است (قبلاً ۹٪ بود)
const TAX_RATE_DEFAULT = 10; // ۱۰٪ ارزش افزوده
// نرخ کسری پیش‌فرض هنگام خواندن از کالا (taxRate کالا در DB کسری است — مثل 0.1)
const DEFAULT_VAT_RATE = 0.1;

function uid() {
 return Math.random().toString(36).slice(2, 10);
}

function emptyRow(): InvoiceItemRow {
 return {
 id: uid(),
 productId: "",
 description: "",
 quantity: 1,
 unitPrice: 0,
 discount: 0,
 taxRate: TAX_RATE_DEFAULT,
 };
}

// WH-2: ردیف «پُرشده» = کالای انتخاب‌شده دارد یا شرح/قیمت وارد شده است.
// ردیف‌های کاملاً خالی موقع ثبت حذف می‌شوند؛ بقیه (حتی بدون کالا) دیگر
// بی‌صدا دور ریخته نمی‌شوند — از کاربر پرسیده می‌شود که به انبار اضافه شوند.
function isFilledRow(r: InvoiceItemRow): boolean {
 return Boolean(r.productId || r.description.trim() !== "" || r.unitPrice > 0);
}

function lineTotal(row: InvoiceItemRow): number {
 const gross = row.quantity * row.unitPrice;
 const afterDiscount = gross * (1 - row.discount / 100);
 const tax = afterDiscount * (row.taxRate / 100);
 return afterDiscount + tax;
}

function lineSubtotal(row: InvoiceItemRow): number {
 const gross = row.quantity * row.unitPrice;
 return gross * (1 - row.discount / 100);
}

function lineTax(row: InvoiceItemRow): number {
 return lineSubtotal(row) * (row.taxRate / 100);
}

/* ============ Task 21-B: ویرایش فاکتور — داده‌های اولیه ============ */

/** دادهٔ فاکتور برای پیش‌پر کردن فرم در حالت ویرایش (هم‌شکل GET /api/invoices/[id]) */
export interface InvoiceFormInitialInvoice {
 id: string;
 number: string;
 type?: string;
 partyId?: string;
 date?: string;
 dueDate?: string | null;
 warehouseId?: string | null;
 description?: string | null;
 currency?: string;
 exchangeRate?: number | null;
 paymentType?: string | null;
 status?: string;
 items?: Array<{
 productId?: string | null;
 description?: string;
 quantity?: number;
 unitPrice?: number; // ریال (نحوهٔ ذخیره در DB)
 discount?: number;
 taxRate?: number; // کسر (مثل 0.1)
 }>;
}

/** ISO تاریخ DB → تاریخ محلی فرم (بدون شیفت روز — بخش تاریخ ISO همان روز ثبت‌شده است) */
function isoToLocalDate(iso: string | null | undefined): string {
 if (!iso) return "";
 const s = String(iso);
 const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
 if (m) return m[1];
 const d = new Date(s);
 return Number.isNaN(d.getTime()) ? "" : toLocalISODate(d);
}

/* ============ Quick Create: Party ============ */
function QuickCreatePartySheet({
 open,
 onOpenChange,
 onCreated,
}: {
 open: boolean;
 onOpenChange: (open: boolean) => void;
 onCreated: (party: Party) => void;
}) {
 const { toast } = useToast();
 const [submitting, setSubmitting] = React.useState(false);
 const [name, setName] = React.useState("");
 const [type, setType] = React.useState<"CUSTOMER" | "SUPPLIER" | "BOTH">(
 "CUSTOMER"
 );
 const [phone, setPhone] = React.useState("");
 const [nationalId, setNationalId] = React.useState("");

 const reset = () => {
 setName("");
 setType("CUSTOMER");
 setPhone("");
 setNationalId("");
 };

 const handleSubmit = async () => {
 if (!name.trim()) {
 toast({
 title: "خطا",
 description: "نام طرف‌حساب الزامی است.",
 variant: "destructive",
 });
 return;
 }
 setSubmitting(true);
 try {
 const code = `P-${Date.now().toString().slice(-6)}`;
 const res = await authFetch("/api/parties", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 code,
 name: name.trim(),
 type,
 phone: phone.trim() || undefined,
 nationalId: nationalId.trim() || undefined,
 creditLimit: 0,
 }),
 });
 const data = await res.json();
 if (!res.ok ||!data.success) {
 throw new Error(data.error || "خطا در ایجاد طرف‌حساب");
 }
 toast({
 title: "طرف‌حساب ایجاد شد",
 description: `«${name.trim()}» با موفقیت اضافه شد.`,
 });
 const created: Party = {
 id: data.data.id,
 name: data.data.name,
 code: data.data.code,
 type: data.data.type,
 };
 onCreated(created);
 reset();
 onOpenChange(false);
 } catch (err) {
 const message = err instanceof Error? err.message: "خطای ناشناخته";
 toast({
 title: "خطا در ایجاد طرف‌حساب",
 description: message,
 variant: "destructive",
 });
 } finally {
 setSubmitting(false);
 }
 };

 return (
 <Sheet open={open} onOpenChange={onOpenChange}>
 <SheetContent
 side="bottom"
 className="w-full sm:max-w-lg sm:mx-auto sm:rounded-t-xl max-h-[90vh] overflow-y-auto"
 >
 <SheetHeader>
 <SheetTitle className="flex items-center gap-2 text-base">
 <Building2 className="h-4 w-4 text-primary" />
 شرکت جدید
 </SheetTitle>
 <SheetDescription className="text-xs">
 طرف‌حساب جدید را سریع ثبت کنید و در فاکتور انتخاب کنید.
 </SheetDescription>
 </SheetHeader>
 <div className="px-4 space-y-3">
 <div className="space-y-1.5">
 <Label className="text-xs">نام *</Label>
 <Input
 value={name}
 onChange={(e) => setName(e.target.value)}
 placeholder="نام شرکت یا شخص..."
 className="h-11"
 autoFocus
 />
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">نوع</Label>
 <Select
 value={type}
 onValueChange={(v) =>
 setType(v as "CUSTOMER" | "SUPPLIER" | "BOTH")
 }
 >
 <SelectTrigger className="h-11">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="CUSTOMER">مشتری</SelectItem>
 <SelectItem value="SUPPLIER">تأمین‌کننده</SelectItem>
 <SelectItem value="BOTH">هر دو</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 <div className="space-y-1.5">
 <Label className="text-xs">تلفن</Label>
 <Input
 value={phone}
 onChange={(e) => setPhone(e.target.value)}
 placeholder="۰۹۱۲..."
 className="h-11"
 dir="ltr"
 inputMode="tel"
 />
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">کد ملی</Label>
 <Input
 value={nationalId}
 onChange={(e) => setNationalId(e.target.value)}
 placeholder="کد ملی ۱۰ رقمی"
 className="h-11"
 dir="ltr"
 inputMode="numeric"
 maxLength={11}
 />
 </div>
 </div>
 </div>
 <SheetFooter className="px-4 pb-4 flex-row gap-2 sm:justify-end">
 <Button
 variant="outline"
 className="h-11 flex-1 sm:flex-none"
 onClick={() => onOpenChange(false)}
 disabled={submitting}
 >
 انصراف
 </Button>
 <Button
 className="h-11 flex-1 sm:flex-none gap-1.5"
 onClick={handleSubmit}
 disabled={submitting}
 >
 {submitting? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ): (
 <Plus className="h-4 w-4" />
 )}
 ثبت طرف‌حساب
 </Button>
 </SheetFooter>
 </SheetContent>
 </Sheet>
 );
}

/* ============ Quick Create: Product ============ */
function QuickCreateProductSheet({
 open,
 onOpenChange,
 onCreated,
}: {
 open: boolean;
 onOpenChange: (open: boolean) => void;
 onCreated: (product: Product) => void;
}) {
 const { toast } = useToast();
 const [submitting, setSubmitting] = React.useState(false);
 const [name, setName] = React.useState("");
 const [sku, setSku] = React.useState("");
 const [unit, setUnit] = React.useState("عدد");
 const [salePrice, setSalePrice] = React.useState<number>(0);

 const reset = () => {
 setName("");
 setSku("");
 setUnit("عدد");
 setSalePrice(0);
 };

 // WH-1: هنگام باز شدن شیت، SKU ترتیبی بعدی را بگیر و پیش‌پر کن
 // (اگر خطا شد خالی می‌ماند — سرور خودش تولید می‌کند؛ placeholder: «خالی = خودکار»)
 React.useEffect(() => {
 if (!open) return;
 let cancelled = false;
 authFetch("/api/products/next-sku", { cache: "no-store" })
 .then((r) => r.json())
 .then((j: { success?: boolean; data?: { sku?: unknown } }) => {
 if (cancelled) return;
 const next = j?.data?.sku;
 if (j?.success && typeof next === "string" && next) {
 setSku(next);
 }
 })
 .catch(() => undefined);
 return () => {
 cancelled = true;
 };
 }, [open]);

 const handleSubmit = async () => {
 if (!name.trim()) {
 toast({
 title: "خطا",
 description: "نام کالا الزامی است.",
 variant: "destructive",
 });
 return;
 }
 setSubmitting(true);
 try {
 // WH-1: اگر کاربر SKU خالی گذاشت، سرور به‌صورت ترتیبی تولید می‌کند
 // (قبلاً SKU-<timestamp> زشت ساخته می‌شد)
 const res = await authFetch("/api/products", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 sku: sku.trim(),
 name: name.trim(),
 unit: unit.trim() || "عدد",
 salePrice: Number(salePrice) || 0,
 purchasePrice: 0,
 wholesalePrice: 0,
 taxRate: DEFAULT_VAT_RATE,
 }),
 });
 const data = await res.json();
 if (!res.ok ||!data.success) {
 throw new Error(data.error || "خطا در ایجاد کالا");
 }
 toast({
 title: "کالا ایجاد شد",
 description: `«${name.trim()}» با موفقیت اضافه شد.`,
 });
 const created: Product = {
 id: data.data.id,
 name: data.data.name,
 sku: data.data.sku,
 unit: data.data.unit,
 salePrice: Number(data.data.salePrice),
 purchasePrice: Number(data.data.purchasePrice),
 taxRate: data.data.taxRate,
 };
 onCreated(created);
 // WH-3: اطلاع‌رسانی به ماژول انبار از ایجاد کالای جدید از داخل فاکتور
 window.dispatchEvent(
 new CustomEvent("hoshhesab:data-changed", { detail: { entity: "products" } })
 );
 reset();
 onOpenChange(false);
 } catch (err) {
 const message = err instanceof Error? err.message: "خطای ناشناخته";
 toast({
 title: "خطا در ایجاد کالا",
 description: message,
 variant: "destructive",
 });
 } finally {
 setSubmitting(false);
 }
 };

 return (
 <Sheet open={open} onOpenChange={onOpenChange}>
 <SheetContent
 side="bottom"
 className="w-full sm:max-w-lg sm:mx-auto sm:rounded-t-xl max-h-[90vh] overflow-y-auto"
 >
 <SheetHeader>
 <SheetTitle className="flex items-center gap-2 text-base">
 <PackagePlus className="h-4 w-4 text-primary" />
 کالای جدید
 </SheetTitle>
 <SheetDescription className="text-xs">
 کالای جدید را سریع ثبت کنید و در فاکتور انتخاب کنید.
 </SheetDescription>
 </SheetHeader>
 <div className="px-4 space-y-3">
 <div className="space-y-1.5">
 <Label className="text-xs">نام کالا *</Label>
 <Input
 value={name}
 onChange={(e) => setName(e.target.value)}
 placeholder="نام کالا یا خدمت..."
 className="h-11"
 autoFocus
 />
 </div>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 <div className="space-y-1.5">
 <Label className="text-xs">کد کالا (SKU)</Label>
 <Input
 value={sku}
 onChange={(e) => setSku(e.target.value)}
 placeholder="خالی = خودکار"
 className="h-11"
 dir="ltr"
 />
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">واحد</Label>
 <Select value={unit} onValueChange={setUnit}>
 <SelectTrigger className="h-11">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="عدد">عدد</SelectItem>
 <SelectItem value="کیلوگرم">کیلوگرم</SelectItem>
 <SelectItem value="گرم">گرم</SelectItem>
 <SelectItem value="لیتر">لیتر</SelectItem>
 <SelectItem value="متر">متر</SelectItem>
 <SelectItem value="متر مربع">متر مربع</SelectItem>
 <SelectItem value="متر مکعب">متر مکعب</SelectItem>
 <SelectItem value="جعبه">جعبه</SelectItem>
 <SelectItem value="کارتن">کارتن</SelectItem>
 <SelectItem value="بسته">بسته</SelectItem>
 <SelectItem value="ساعت">ساعت</SelectItem>
 <SelectItem value="روز">روز</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">قیمت فروش (ریال)</Label>
 <Input
 type="number"
 min={0}
 step={1000}
 value={salePrice}
 onChange={(e) => setSalePrice(Number(e.target.value) || 0)}
 className="h-11 tnum"
 dir="ltr"
 inputMode="numeric"
 />
 </div>
 </div>
 <SheetFooter className="px-4 pb-4 flex-row gap-2 sm:justify-end">
 <Button
 variant="outline"
 className="h-11 flex-1 sm:flex-none"
 onClick={() => onOpenChange(false)}
 disabled={submitting}
 >
 انصراف
 </Button>
 <Button
 className="h-11 flex-1 sm:flex-none gap-1.5"
 onClick={handleSubmit}
 disabled={submitting}
 >
 {submitting? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ): (
 <Plus className="h-4 w-4" />
 )}
 ثبت کالا
 </Button>
 </SheetFooter>
 </SheetContent>
 </Sheet>
 );
}

/* ============ Quick Create: Warehouse ============ */
function QuickCreateWarehouseSheet({
 open,
 onOpenChange,
 onCreated,
}: {
 open: boolean;
 onOpenChange: (open: boolean) => void;
 onCreated: (warehouse: Warehouse) => void;
}) {
 const { toast } = useToast();
 const [submitting, setSubmitting] = React.useState(false);
 const [code, setCode] = React.useState("");
 const [name, setName] = React.useState("");
 const [address, setAddress] = React.useState("");

 const reset = () => {
 setCode("");
 setName("");
 setAddress("");
 };

 const handleSubmit = async () => {
 if (!name.trim() ||!code.trim()) {
 toast({
 title: "خطا",
 description: "کد و نام انبار الزامی است.",
 variant: "destructive",
 });
 return;
 }
 setSubmitting(true);
 try {
 const res = await authFetch("/api/warehouses", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 code: code.trim(),
 name: name.trim(),
 address: address.trim() || undefined,
 isActive: true,
 }),
 });
 const data = await res.json();
 if (!res.ok ||!data.success) {
 throw new Error(data.error || "خطا در ایجاد انبار");
 }
 toast({
 title: "انبار ایجاد شد",
 description: `«${name.trim()}» با موفقیت اضافه شد.`,
 });
 const created: Warehouse = {
 id: data.data.id,
 name: data.data.name,
 code: data.data.code,
 };
 onCreated(created);
 reset();
 onOpenChange(false);
 } catch (err) {
 const message = err instanceof Error? err.message: "خطای ناشناخته";
 toast({
 title: "خطا در ایجاد انبار",
 description: message,
 variant: "destructive",
 });
 } finally {
 setSubmitting(false);
 }
 };

 return (
 <Sheet open={open} onOpenChange={onOpenChange}>
 <SheetContent
 side="bottom"
 className="w-full sm:max-w-lg sm:mx-auto sm:rounded-t-xl max-h-[90vh] overflow-y-auto"
 >
 <SheetHeader>
 <SheetTitle className="flex items-center gap-2 text-base">
 <WarehouseIcon className="h-4 w-4 text-primary" />
 انبار جدید
 </SheetTitle>
 <SheetDescription className="text-xs">
 انبار جدید را سریع ثبت کنید و در فاکتور انتخاب کنید.
 </SheetDescription>
 </SheetHeader>
 <div className="px-4 space-y-3">
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 <div className="space-y-1.5">
 <Label className="text-xs">کد انبار *</Label>
 <Input
 value={code}
 onChange={(e) => setCode(e.target.value)}
 placeholder="WH-001"
 className="h-11"
 dir="ltr"
 autoFocus
 />
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">نام انبار *</Label>
 <Input
 value={name}
 onChange={(e) => setName(e.target.value)}
 placeholder="انبار مرکزی..."
 className="h-11"
 />
 </div>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">آدرس</Label>
 <Input
 value={address}
 onChange={(e) => setAddress(e.target.value)}
 placeholder="آدرس انبار (اختیاری)..."
 className="h-11"
 />
 </div>
 </div>
 <SheetFooter className="px-4 pb-4 flex-row gap-2 sm:justify-end">
 <Button
 variant="outline"
 className="h-11 flex-1 sm:flex-none"
 onClick={() => onOpenChange(false)}
 disabled={submitting}
 >
 انصراف
 </Button>
 <Button
 className="h-11 flex-1 sm:flex-none gap-1.5"
 onClick={handleSubmit}
 disabled={submitting}
 >
 {submitting? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ): (
 <Plus className="h-4 w-4" />
 )}
 ثبت انبار
 </Button>
 </SheetFooter>
 </SheetContent>
 </Sheet>
 );
}

/**
 * InvoiceForm — فرم ایجاد فاکتور فروش/خرید
 *
 * @example
 * <InvoiceForm open={open} onOpenChange={setOpen} onCreated={() => refresh()} />
 */
export function InvoiceForm({
 open,
 onOpenChange,
 onCreated,
 // Task 21-B: حالت ویرایش — فاکتور ذخیره‌شده با این داده‌ها پیش‌پر می‌شود
 // و ثبت به PUT /api/invoices/[id] می‌رود (به‌جای POST ایجاد).
 initialInvoice = null,
 onUpdated,
}: {
 open: boolean;
 onOpenChange: (open: boolean) => void;
 onCreated?: (invoice: unknown) => void;
 /** Task 21-B — ویرایش فاکتور ذخیره‌شده */
 initialInvoice?: InvoiceFormInitialInvoice | null;
 onUpdated?: (invoice: unknown) => void;
}) {
 const { toast } = useToast();
 const [loading, setLoading] = React.useState(false);
 const [submitting, setSubmitting] = React.useState(false);
 const [parties, setParties] = React.useState<Party[]>([]);
 const [products, setProducts] = React.useState<Product[]>([]);
 const [warehouses, setWarehouses] = React.useState<Warehouse[]>([]);

 // وضعیت Quick Create drawers
 const [partySheetOpen, setPartySheetOpen] = React.useState(false);
 const [productSheetOpen, setProductSheetOpen] = React.useState(false);
 const [warehouseSheetOpen, setWarehouseSheetOpen] = React.useState(false);

 // WH-2: دیالوگ «ذخیره اقلام آزاد در انبار؟» — ردیف‌هایی که شرح دارند ولی
 // کالایشان انتخاب نشده، پیش از ثبت از کاربر درباره ذخیره‌شان پرسیده می‌شود
 const [freeTextDialogOpen, setFreeTextDialogOpen] = React.useState(false);
 const [freeTextCount, setFreeTextCount] = React.useState(0);
 const freeTextChoiceRef = React.useRef<
 ((choice: "save" | "skip" | "cancel") => void) | null
 >(null);

 const askSaveFreeTextItems = (
 count: number
 ): Promise<"save" | "skip" | "cancel"> => {
 return new Promise((resolve) => {
 setFreeTextCount(count);
 freeTextChoiceRef.current = resolve;
 setFreeTextDialogOpen(true);
 });
 };

 const resolveFreeTextChoice = (choice: "save" | "skip" | "cancel") => {
 setFreeTextDialogOpen(false);
 const resolve = freeTextChoiceRef.current;
 freeTextChoiceRef.current = null;
 resolve?.(choice);
 };

 const [entryTab, setEntryTab] = React.useState<"form" | "scan">("form");
 const [type, setType] = React.useState<"SALE" | "PURCHASE">("SALE");
 const [partyId, setPartyId] = React.useState("");
 const [date, setDate] = React.useState(() => toLocalISODate(new Date()));
 const [warehouseId, setWarehouseId] = React.useState("");
 const [description, setDescription] = React.useState("");
 const [items, setItems] = React.useState<InvoiceItemRow[]>([emptyRow()]);
 // چندارزی
 const [currency, setCurrency] = React.useState<string>("IRR");
 const [exchangeRate, setExchangeRate] = React.useState<number>(1);
 const [rateLoading, setRateLoading] = React.useState(false);
 // Task 21-B: نوع پرداخت (CASH | CREDIT قرضی/نسیه) + تاریخ سررسید
 const [paymentType, setPaymentType] = React.useState<"CASH" | "CREDIT">("CASH");
 const [dueDate, setDueDate] = React.useState("");

 // حالت ویرایش؟ (فاکتور موجود — ثبت به PUT /api/invoices/[id] می‌رود)
 const isEditMode = Boolean(initialInvoice && initialInvoice.id);

 /* ============ Task 21-B: پیش‌پر کردن فرم در حالت ویرایش ============ */
 const prefillIdRef = React.useRef<string | null>(null);
 React.useEffect(() => {
 if (!open) {
 prefillIdRef.current = null;
 return;
 }
 if (!initialInvoice || !initialInvoice.id) return;
 if (prefillIdRef.current === initialInvoice.id) return;
 prefillIdRef.current = initialInvoice.id;
 const inv = initialInvoice;
 setType(inv.type === "PURCHASE" ? "PURCHASE" : "SALE");
 setPartyId(inv.partyId || "");
 setDate(isoToLocalDate(inv.date) || toLocalISODate(new Date()));
 const cur = String(inv.currency || "IRR").toUpperCase();
 const rate =
 cur === "TOMAN"
 ? 10
 : typeof inv.exchangeRate === "number" && inv.exchangeRate > 0
 ? inv.exchangeRate
 : 1;
 setCurrency(cur);
 setExchangeRate(rate);
 setWarehouseId(inv.warehouseId || "");
 setDescription(inv.description || "");
 setPaymentType(inv.paymentType === "CREDIT" ? "CREDIT" : "CASH");
 setDueDate(isoToLocalDate(inv.dueDate));
 setItems(
 Array.isArray(inv.items) && inv.items.length > 0
 ? inv.items.map((it) => {
 // قیمت DB همیشه ریال است — به ارز فاکتور تبدیل می‌شود
 const upIrr = Number(it.unitPrice ?? 0) || 0;
 let unitPrice = upIrr;
 if (cur === "TOMAN") unitPrice = Math.round(upIrr / 10);
 else if (cur !== "IRR") unitPrice = Math.round(upIrr / (rate || 1));
 return {
 id: uid(),
 productId: it.productId || "",
 description: it.description || "",
 quantity: Number(it.quantity ?? 1) || 1,
 unitPrice,
 discount: Number(it.discount ?? 0) || 0,
 // DB کسر (0.1) — فرم درصد می‌خواهد
 taxRate: Math.round((Number(it.taxRate ?? 0.1) || 0.1) * 100),
 };
 })
 : [emptyRow()]
 );
 setTouched({ partyId: false, date: false, items: false });
 }, [open, initialInvoice]);

 /* ============ اعتبارسنجی real-time ============
 * خطاها را on-change محاسبه می‌کنیم، اما فقط پس از blur نمایش می‌دهیم.
 * قوانین: partyId (required), date (required), items (>=1 valid item)
 */
 const [touched, setTouched] = React.useState<{
 partyId: boolean;
 date: boolean;
 items: boolean;
 }>({ partyId: false, date: false, items: false });

 const errors = React.useMemo(
 () => ({
 partyId: validateField(partyId, { required: true, message: "انتخاب طرف‌حساب الزامی است." }),
 date: validateField(date, { required: true, message: "تاریخ الزامی است." }),
 items:
 // WH-2: ردیف با شرح آزاد (بدون انتخاب کالا) هم معتبر است — در ثبت،
 // از کاربر پرسیده می‌شود که به‌عنوان کالای جدید ذخیره شود یا نه
 items.filter((r) => isFilledRow(r) && r.quantity > 0).length === 0
? ["حداقل یک ردیف با کالا یا شرح و تعداد مثبت اضافه کنید."]
: [],
 }),
 [partyId, date, items]
 );

 const isFormValid =
 errors.partyId.length === 0 &&
 errors.date.length === 0 &&
 errors.items.length === 0;

 /* ============ ذخیره‌ی خودکار پیش‌نویس ============ */
 const draftData = React.useMemo(
 () => ({
 type,
 partyId,
 date,
 warehouseId,
 description,
 items,
 currency,
 exchangeRate,
 entryTab,
 }),
 [type, partyId, date, warehouseId, description, items, currency, exchangeRate, entryTab]
 );

 const autoSave = useAutoSave("invoice-form", draftData, 3000);

 // هنگام باز شدن فرم، اگر پیش‌نویس موجود باشد، toast نمایش بده
 // Task 21-B: در حالت ویرایش، پیش‌نویسِ ایجاد جدید هرگز بازیابی/اعلان نمی‌شود
 const draftCheckedRef = React.useRef(false);
 React.useEffect(() => {
 if (!open) {
 draftCheckedRef.current = false;
 return;
 }
 if (draftCheckedRef.current) return;
 draftCheckedRef.current = true;
 if (isEditMode) return;
 const draft = autoSave.restore();
 if (draft && (draft.data.partyId || draft.data.items.some((r) => r.productId))) {
 toast({
 title: "پیش‌نویس موجود است",
 description: "می‌توانید پیش‌نویس قبلی را بازیابی کنید.",
 });
 }
 }, [open, autoSave, toast]);

 const handleRestoreDraft = () => {
 const draft = autoSave.restore();
 if (!draft) return;
 const d = draft.data;
 setType(d.type?? "SALE");
 setPartyId(d.partyId?? "");
 setDate(d.date?? toLocalISODate(new Date()));
 setWarehouseId(d.warehouseId?? "");
 setDescription(d.description?? "");
 setItems(d.items?.length? d.items: [emptyRow()]);
 setCurrency(d.currency?? "IRR");
 setExchangeRate(d.exchangeRate?? 1);
 setEntryTab(d.entryTab === "scan"? "scan": "form");
 toast({
 title: "پیش‌نویس بازیابی شد",
 description: "اطلاعات فرم از آخرین ذخیره‌ی خودکار بازگردانی شد.",
 });
 };

 /* ============ OCR اسکن رسید ============ */
 const [ocrLoading, setOcrLoading] = React.useState(false);
 const [ocrPreview, setOcrPreview] = React.useState<string | null>(null);
 const fileInputRef = React.useRef<HTMLInputElement | null>(null);

 const handleOcrFile = React.useCallback(
 async (file: File) => {
 if (!file.type.startsWith("image/")) {
 toast({
 title: "فایل پشتیبانی نمی‌شود",
 description: "لطفاً تصویر فاکتور/رسید را (JPG، PNG) انتخاب کنید.",
 variant: "destructive",
 });
 return;
 }
 if (file.size > 5 * 1024 * 1024) {
 toast({
 title: "تصویر بزرگ است",
 description: "حداکثر حجم مجدد ۵ مگابایت است.",
 variant: "destructive",
 });
 return;
 }

 // پیش‌نمایش تصویر
 const reader = new FileReader();
 reader.onload = async () => {
 const dataUrl = reader.result as string;
 setOcrPreview(dataUrl);
 setOcrLoading(true);
 try {
 const res = await authFetch("/api/ai/ocr", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ image: dataUrl }),
 });
 const json = await res.json().catch(() => ({}));
 if (!res.ok ||!json?.success) {
 throw new Error(json?.error || "خطا در پردازش تصویر");
 }
 const data = json.data as {
 sellerName?: string;
 buyerName?: string;
 invoiceNumber?: string;
 date?: string;
 totalAmount?: number;
 vat?: number;
 items?: Array<{
 description: string;
 qty: number;
 unitPrice: number;
 lineTotal: number;
 }>;
 };

 // اعمال اطلاعات استخراج‌شده روی فرم
 if (data.invoiceNumber) {
 setDescription((prev) =>
 prev? prev: `شماره فاکتور: ${data.invoiceNumber}`
 );
 }
 if (data.sellerName) {
 const match = parties.find(
 (p) =>
 p.name.includes(data.sellerName!) ||
 data.sellerName!.includes(p.name)
 );
 if (match && type === "PURCHASE") {
 setPartyId(match.id);
 }
 }
 if (data.buyerName && type === "SALE") {
 const match = parties.find(
 (p) =>
 p.name.includes(data.buyerName!) ||
 data.buyerName!.includes(p.name)
 );
 if (match) setPartyId(match.id);
 }

 // اعمال ردیف‌های کالا
 if (Array.isArray(data.items) && data.items.length > 0) {
 const newRows: InvoiceItemRow[] = data.items.map((it) => {
 // تلاش برای تطبیق با محصول موجود بر اساس نام
 const prod = products.find(
 (p) =>
 p.name.includes(it.description) ||
 it.description.includes(p.name) ||
 p.sku === it.description
 );
 return {
 id: Math.random().toString(36).slice(2),
 productId: prod?.id?? "",
 description: it.description || "",
 quantity: Number(it.qty) || 1,
 unitPrice: Number(it.unitPrice) || 0,
 // FIX: taxRate محصول به‌صورت «کسر» ذخیره می‌شود (0.09) اما ردیف‌های
 // فرم «درصد» می‌خواهند — قبلاً 0.09 مستقیم می‌رفت و مالیات تقریباً
 // صفر می‌شد. مثل بقیه‌ی نقاط فرم (L1091/L1204) تبدیل درصد انجام شود.
 taxRate: Math.round((prod?.taxRate?? DEFAULT_VAT_RATE) * 100),
 discount: 0,
 };
 });
 setItems(newRows);
 }

 toast({
 title: "اطلاعات فاکتور استخراج شد",
 description: `${data.items?.length?? 0} ردیف کالا پیدا شد. لطفاً بررسی و تکمیل کنید.`,
 });
 setEntryTab("form");
 } catch (err) {
 toast({
 title: "خطا در OCR",
 description:
 err instanceof Error? err.message: "خطای ناشناخته",
 variant: "destructive",
 });
 } finally {
 setOcrLoading(false);
 }
 };
 reader.readAsDataURL(file);
 },
 [parties, products, type, toast]
 );

 const handleClearDraft = () => {
 autoSave.clear();
 toast({
 title: "پیش‌نویس حذف شد",
 description: "نسخه‌ی ذخیره‌شده پاک شد.",
 });
 };

 // واکشی داده‌های فرم هنگام باز شدن
 const refreshFormData = React.useCallback(() => {
 setLoading(true);
 return authFetch("/api/accounting/form-data")
.then((r) => r.json())
.then((res) => {
 if (res?.data) {
 setParties(res.data.parties?? []);
 setProducts(res.data.products?? []);
 setWarehouses(res.data.warehouses?? []);
 }
 })
.catch(() => {
 // خطای خاموش — فرم با لیست خالی باز می‌ماند
 })
.finally(() => setLoading(false));
 }, []);

 React.useEffect(() => {
 if (!open) return;
 refreshFormData();
 }, [open, refreshFormData]);

 // وقتی ارز تغییر کرد، نرخ تبدیل را به‌صورت خودکار از API بگیر (فقط برای ارز غیرریالی)
 // ابتدا از نرخ‌های ذخیره‌شده استفاده می‌کنیم و سپس به‌صورت زنده از تگ‌جو به‌روزرسانی می‌کنیم
 const refreshLiveRate = React.useCallback(async (cur: string) => {
 if (cur === "IRR") {
 setExchangeRate(1);
 return;
 }
 // تومان = ریال ÷ ۱۰ — نرخ ثابت، نیازی به fetch زنده ندارد
 if (cur === "TOMAN") {
 setExchangeRate(10);
 return;
 }
 setRateLoading(true);
 try {
 // ۱) دریافت نرخ ذخیره‌شده از /api/currency
 const r1 = await authFetch("/api/currency", { cache: "no-store" });
 const j1 = await r1.json();
 const rates: Array<{ code: string; rateToIrr: number | null }> = j1?.data?? [];
 const match = rates.find((x) => x.code === cur);
 if (match?.rateToIrr && match.rateToIrr > 0) {
 setExchangeRate(match.rateToIrr);
 }
 // ۲) تلاش برای دریافت نرخ زنده از تگ‌جو (به‌روزرسانی غیرهمزمان)
 authFetch("/api/currency/fetch-tgju", { method: "GET", cache: "no-store" })
.then((r) => r.json())
.then((res) => {
 if (!res?.success ||!res?.data) return;
 // نگاشت کد ارز به کلید item تگ‌جو
 const itemKey = `currency:${cur}`;
 const goldKey = "gold:GERAM18";
 const price = res.data[itemKey]?.price?? res.data[goldKey]?.price;
 if (typeof price === "number" && price > 0 && cur!== "IRR") {
 // فقط ارزها از کلید currency:XXX استفاده می‌کنند
 const direct = res.data[itemKey]?.price;
 if (typeof direct === "number" && direct > 0) {
 setExchangeRate(direct);
 }
 }
 })
.catch(() => {
 // خطای خاموش — نرخ ذخیره‌شده باقی می‌ماند
 });
 } catch {
 // نرخ دستی باقی می‌ماند
 } finally {
 setRateLoading(false);
 }
 }, []);

 React.useEffect(() => {
 refreshLiveRate(currency);
 }, [currency, refreshLiveRate]);

 // نمایش نرخ به‌روز کنار انتخاب ارز
 const formattedLiveRate = React.useMemo(() => {
 if (currency === "IRR") return null;
 return toPersianDigits(
 new Intl.NumberFormat("en-US").format(Math.round(exchangeRate))
 );
 }, [currency, exchangeRate]);

 const totals = React.useMemo(() => {
 let subtotal = 0;
 let discount = 0;
 let tax = 0;
 for (const row of items) {
 const gross = row.quantity * row.unitPrice;
 const afterDiscount = gross * (1 - row.discount / 100);
 subtotal += afterDiscount;
 discount += gross * (row.discount / 100);
 tax += afterDiscount * (row.taxRate / 100);
 }
 return {
 subtotal,
 discount,
 tax,
 total: subtotal + tax,
 // معادل ریالی (با نرخ تبدیل)
 subtotalIrr: subtotal * exchangeRate,
 taxIrr: tax * exchangeRate,
 totalIrr: (subtotal + tax) * exchangeRate,
 };
 }, [items, exchangeRate]);

 // مدیریت ردیف‌ها
 const updateRow = (id: string, patch: Partial<InvoiceItemRow>) => {
 setItems((prev) =>
 prev.map((r) => (r.id === id? {...r,...patch }: r))
 );
 setTouched((p) => ({...p, items: true }));
 };

 const addRow = () => {
 setItems((prev) => [...prev, emptyRow()]);
 setTouched((p) => ({...p, items: true }));
 };

 const removeRow = (id: string) => {
 setItems((prev) => (prev.length === 1? prev: prev.filter((r) => r.id!== id)));
 setTouched((p) => ({...p, items: true }));
 };

 // وقتی محصول انتخاب شد، قیمت و نرخ مالیات آن را پر کن
 // FIX(H3 — چندارزی): قیمت کالا در DB همیشه «ریال» است — اگر ارز فاکتور
 // غیرریالی باشد باید تبدیل شود (قبلاً عدد ریالی خام در ردیف می‌نشست و
 // totalIrr = total × exchangeRate مقدار غلط می‌داد)
 const applyProductToRow = (
 rowId: string,
 p: { id: string; name: string; salePrice: number; purchasePrice: number; taxRate: number }
 ) => {
 const basePrice = type === "SALE"? p.salePrice: p.purchasePrice;
 let unitPrice = basePrice;
 if (currency === "TOMAN") {
 unitPrice = Math.round(basePrice / 10); // ریال → تومان
 } else if (currency !== "IRR") {
 // ریال → ارز فاکتور (نرخ = ریال به‌ازای هر واحد ارز)
 const rate = exchangeRate > 0? exchangeRate: 1;
 unitPrice = Math.round(basePrice / rate);
 }
 updateRow(rowId, {
 productId: p.id,
 description: p.name,
 unitPrice,
 taxRate: Math.round((p.taxRate?? DEFAULT_VAT_RATE) * 100),
 });
 };

 const onProductSelect = (rowId: string, productId: string) => {
 const p = products.find((x) => x.id === productId);
 if (!p) {
 updateRow(rowId, { productId, description: "" });
 return;
 }
 applyProductToRow(rowId, p);
 };

 // PERF-1200 + ZERO-STOCK: انتخاب کالا از طریق ProductPicker (جستجوی سرور در
 // همهٔ کالاها + هشدار موجودی صفر). نتیجهٔ کامل مستقیماً در ردیف می‌نشیند
 // (بدون وابستگی به لیست محلی ۲۰۰تایی) و کالا در لیست محلی هم کش می‌شود.
 const onPickerProductSelect = (rowId: string, pp: PickerProduct) => {
 setProducts((prev) =>
 prev.some((x) => x.id === pp.id)
 ? prev
 : [
 {
 id: pp.id,
 name: pp.name,
 sku: pp.sku,
 unit: pp.unit,
 salePrice: pp.salePrice,
 purchasePrice: pp.purchasePrice,
 taxRate: pp.taxRate,
 },
 ...prev,
 ]
 );
 applyProductToRow(rowId, pp);
 };

 const resetForm = () => {
 setType("SALE");
 setPartyId("");
 setWarehouseId("");
 setDescription("");
 setItems([emptyRow()]);
 setDate(toLocalISODate(new Date()));
 setCurrency("IRR");
 setExchangeRate(1);
 // Task 21-B
 setPaymentType("CASH");
 setDueDate("");
 setTouched({ partyId: false, date: false, items: false });
 // پاک کردن پیش‌نویس پس از ثبت موفق
 autoSave.clear();
 };

 /**
 * Task 21-B — ثبت فرم:
 *  - submitKind="issue": ثبت عادی (ایجاد: POST /api/invoices — ویرایش: PUT /api/invoices/[id])
 *  - submitKind="reserve": رزرو فاکتور (فقط ایجاد — status=RESERVED بدون اثر انبار/سند)
 */
 const handleSubmit = async (submitKind: "issue" | "reserve" = "issue") => {
 // اعتبارسنجی — تمام فیلدها را touched می‌کنیم تا خطاها نمایش داده شوند
 setTouched({ partyId: true, date: true, items: true });
 if (!isFormValid) {
 // لرزش دکمه برای بازخورد خطا
 const submitBtn = document.querySelector<HTMLButtonElement>(
 '[data-action="submit"]'
 );
 if (submitBtn) {
 submitBtn.classList.remove("animate-shake");
 // force reflow برای restart animation
 void submitBtn.offsetWidth;
 submitBtn.classList.add("animate-shake");
 }
 toast({
 title: "لطفاً خطاهای فرم را برطرف کنید",
 description: "برخی فیلدها مقدار نامعتبر دارند.",
 variant: "destructive",
 });
 return;
 }

 // WH-2: اقلام آزاد — ردیف‌هایی که شرح/قیمت دارند ولی کالایشان انتخاب نشده.
 // قبلاً این ردیف‌ها بی‌صدا حذف می‌شدند؛ حالا از کاربر می‌پرسیم آیا به‌عنوان
 // کالای جدید در انبار ذخیره شوند یا فقط در فاکتور ثبت شوند.
 const freeTextRows = items.filter(
 (r) => !r.productId && r.quantity > 0 && isFilledRow(r)
 );

 setSubmitting(true);
 try {
 // کپی محلی ردیف‌ها — بعد از ساخت کالاها productId همین‌جا به‌روز می‌شود
 let workingRows = items;

 if (freeTextRows.length > 0) {
 const choice = await askSaveFreeTextItems(freeTextRows.length);
 if (choice === "cancel") {
 // کاربر به فرم برمی‌گردد و ردیف‌ها را ویرایش می‌کند
 return;
 }
 if (choice === "save") {
 // برای هر ردیفِ دارای شرح، کالای جدید با SKU خودکار می‌سازیم
 const results: Array<{
 rowId: string;
 name: string;
 product?: Product;
 error?: string;
 }> = [];
 for (const row of freeTextRows) {
 const productName = row.description.trim();
 if (!productName) continue; // بدون شرح نمی‌توان کالا ساخت — ردیف آزاد می‌ماند
 // تبدیل قیمت واحد فاکتور → ریال (قیمت کالا همیشه ریالی ذخیره می‌شود)
 let salePriceRial = row.unitPrice;
 if (currency === "TOMAN") {
 salePriceRial = row.unitPrice * 10;
 } else if (currency !== "IRR") {
 salePriceRial = Math.round(
 row.unitPrice * (exchangeRate > 0? exchangeRate: 1)
 );
 }
 try {
 const res = await authFetch("/api/products", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 sku: "", // SKU به‌صورت ترتیبی سمت سرور تولید می‌شود
 name: productName,
 unit: "عدد",
 salePrice: Math.round(salePriceRial),
 purchasePrice: 0,
 wholesalePrice: 0,
 taxRate: (row.taxRate?? 0) / 100,
 }),
 });
 const data = await res.json();
 if (!res.ok ||!data.success) {
 throw new Error(data.error || "خطا در ایجاد کالا");
 }
 results.push({
 rowId: row.id,
 name: productName,
 product: {
 id: data.data.id,
 name: data.data.name,
 sku: data.data.sku,
 unit: data.data.unit,
 salePrice: Number(data.data.salePrice),
 purchasePrice: Number(data.data.purchasePrice),
 taxRate: data.data.taxRate,
 },
 });
 } catch (err) {
 results.push({
 rowId: row.id,
 name: productName,
 error: err instanceof Error? err.message: "خطای ناشناخته",
 });
 }
 }

 const created = results.filter((x) => x.product);
 const failed = results.filter((x) => x.error);
 if (created.length > 0) {
 // اتصال کالاهای تازه‌ساخته‌شده به ردیف‌های متناظر
 const productByRow = new Map(
 created.map((x) => [x.rowId, x.product as Product])
 );
 workingRows = items.map((r) => {
 const p = productByRow.get(r.id);
 return p? {...r, productId: p.id, description: p.name }: r;
 });
 setProducts((prev) => [
 ...created.map((x) => x.product as Product),
 ...prev,
 ]);
 // WH-3: رفرش ماژول انبار و سایر شنونده‌ها
 window.dispatchEvent(
 new CustomEvent("hoshhesab:data-changed", {
 detail: { entity: "products" },
 })
 );
 toast({
 title: "اقلام در انبار ذخیره شد",
 description: `${toPersianDigits(created.length)} قلم به‌عنوان کالای جدید ثبت شد.`,
 });
 }
 if (failed.length > 0) {
 toast({
 title: "ذخیره برخی اقلام در انبار ناموفق بود",
 description: `${toPersianDigits(failed.length)} قلم فقط در فاکتور ثبت می‌شود: ${failed
 .map((x) => x.name)
 .join("، ")}`,
 variant: "destructive",
 });
 }
 }
 }

 // فقط ردیف‌های کاملاً خالی حذف می‌شوند (ردیف‌های آزادِ دارای شرح باقی می‌مانند)
 const validItems = workingRows.filter((r) => r.quantity > 0 && isFilledRow(r));

 const payload = {
 type,
 partyId,
 date,
 warehouseId: warehouseId && warehouseId!== "_none"? warehouseId: undefined,
 description: description || undefined,
 currency,
 exchangeRate: currency === "IRR"? undefined: exchangeRate,
 // Task 21-B: قرضی (نسیه) + سررسید
 paymentType,
 dueDate: dueDate || undefined,
 // Task 21-B: رزرو — بدون اثر انبار/سند تا «ثبت نهایی»
 ...(submitKind === "reserve" && !isEditMode ? { status: "RESERVED" } : {}),
 items: validItems.map((r) => ({
 productId: r.productId,
 description: r.description,
 quantity: Number(r.quantity), // BigInt-safe: عدد ساده
 unitPrice: Number(r.unitPrice), // به ارز فاکتور
 discount: Number(r.discount),
 taxRate: Number(r.taxRate) / 100,
 })),
 };

 // Task 21-B: ایجاد → POST /api/invoices (آینهٔ کامل accounting + رزرو/قرضی)
 // ویرایش → PUT /api/invoices/[id] (معکوس‌سازی و اعمال مجدد انبار/سند سمت سرور)
 const editId = isEditMode && initialInvoice ? initialInvoice.id : null;
 const res = await authFetch(editId ? `/api/invoices/${editId}` : "/api/invoices", {
 method: editId ? "PUT" : "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(payload),
 });
 const data = await res.json();

 if (!res.ok ||!data.success) {
 throw new Error(data.error || "خطا در ثبت فاکتور");
 }

 if (editId) {
 // ویرایش موفق
 toast({
 title: `فاکتور ${toPersianDigits(String(data.data?.number?? initialInvoice?.number?? ""))} به‌روزرسانی شد`,
 description: data.message || "تغییرات فاکتور ذخیره شد.",
 });
 onUpdated?.(data.data);
 } else {
 toast({
 title: submitKind === "reserve" ? "فاکتور رزرو شد" : "فاکتور ثبت شد",
 description:
 data.message ||
 (submitKind === "reserve"
 ? "فاکتور رزرو شد — بدون اثر انبار/سند تا «ثبت نهایی»."
 : "فاکتور با موفقیت ایجاد شد."),
 });
 onCreated?.(data.data);
 }
 // اطلاع‌رسانی به لیست فاکتورها/داشبورد (همان الگوی quick-invoice)
 if (typeof window!== "undefined") {
 window.dispatchEvent(new CustomEvent("hoshhesab:invoices-changed"));
 }
 resetForm();
 onOpenChange(false);
 } catch (err) {
 const message = err instanceof Error? err.message: "خطای ناشناخته";
 toast({
 title: isEditMode? "خطا در ویرایش فاکتور": "خطا در ثبت فاکتور",
 description: message,
 variant: "destructive",
 });
 } finally {
 setSubmitting(false);
 }
 };

 // پس از ساخت موفق طرف‌حساب/کالا/انبار، لیست را به‌روز و آیتم جدید را انتخاب کن
 const handlePartyCreated = (p: Party) => {
 setParties((prev) => [p,...prev]);
 setPartyId(p.id);
 toast({
 title: "انتخاب خودکار",
 description: `«${p.name}» برای این فاکتور انتخاب شد.`,
 });
 };
 const handleProductCreated = (p: Product) => {
 setProducts((prev) => [p,...prev]);
 // WH-3: اطلاع‌رسانی به ماژول انبار از ایجاد کالای جدید (Quick Create)
 window.dispatchEvent(
 new CustomEvent("hoshhesab:data-changed", { detail: { entity: "products" } })
 );
 // FIX(H3): قیمت کالای تازه‌ساخته‌شده ریالی است — به واحد ارز فاکتور تبدیل می‌شود
 const basePrice = type === "SALE"? p.salePrice: p.purchasePrice;
 let unitPrice = basePrice;
 if (currency === "TOMAN") {
 unitPrice = Math.round(basePrice / 10);
 } else if (currency !== "IRR") {
 const rate = exchangeRate > 0? exchangeRate: 1;
 unitPrice = Math.round(basePrice / rate);
 }
 // انتخاب خودکار محصول در ردیف اول فاقد محصول
 setItems((prev) => {
 const idx = prev.findIndex((r) =>!r.productId);
 if (idx === -1) return prev;
 const copy = [...prev];
 copy[idx] = {
...copy[idx],
 productId: p.id,
 description: p.name,
 unitPrice,
 taxRate: Math.round((p.taxRate?? DEFAULT_VAT_RATE) * 100),
 };
 return copy;
 });
 toast({
 title: "انتخاب خودکار",
 description: `«${p.name}» در اولین ردیف خالی انتخاب شد.`,
 });
 };
 const handleWarehouseCreated = (w: Warehouse) => {
 setWarehouses((prev) => [w,...prev]);
 setWarehouseId(w.id);
 toast({
 title: "انتخاب خودکار",
 description: `«${w.name}» برای این فاکتور انتخاب شد.`,
 });
 };

 return (
 <>
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent
 data-tour="invoice-form"
 className="flex flex-col p-0 gap-0 max-w-none sm:max-w-3xl w-full h-full sm:h-auto sm:max-h-[calc(100vh-3rem)]!inset-0 sm:!inset-auto sm:!top-1/2 sm:!left-1/2 sm:!-translate-x-1/2 sm:!-translate-y-1/2!translate-x-0!translate-y-0!rounded-none sm:!rounded-lg"
 >
 {/* هدر (چسبان بالای دیالوگ) */}
 <div className="shrink-0 px-4 sm:px-6 pt-4 sm:pt-5 pb-3 border-b border-border bg-background">
 <DialogHeader className="text-start">
 <DialogTitle className="flex items-center gap-2 text-base">
 <FileText className="h-4 w-4 text-primary" />
 {isEditMode
 ? `ویرایش فاکتور ${toPersianDigits(initialInvoice?.number ?? "")}`
 : "فاکتور جدید"}
 </DialogTitle>
 <DialogDescription className="text-xs">
 {isEditMode
 ? "اصلاح اقلام، قیمت‌ها، تخفیف، طرف‌حساب، تاریخ و یادداشت — انبار و دفاتر خودکار تعدیل می‌شوند"
 : "ثبت فاکتور فروش یا خرید با محاسبه خودکار ارزش افزوده"}
 </DialogDescription>
 </DialogHeader>
 </div>

 {/* بدنه قابل اسکرول */}
 <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 max-h-[calc(100vh-180px)] sm:max-h-[calc(100vh-220px)]">
 {loading? (
 <div className="flex items-center justify-center py-12">
 <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
 <span className="ms-2 text-sm text-muted-foreground">
 در حال بارگذاری داده‌ها...
 </span>
 </div>
 ): (
 <div className="space-y-4">
 {/* انتخاب روش ورود: فرم / اسکن */}
 <Tabs value={entryTab} onValueChange={(v) => setEntryTab(v as "form" | "scan")}>
 <TabsList className="w-full grid grid-cols-2 h-11">
 <TabsTrigger value="form" className="gap-1.5">
 <FormInput className="h-3.5 w-3.5" />
 فرم دستی
 </TabsTrigger>
 <TabsTrigger value="scan" className="gap-1.5">
 <ScanLine className="h-3.5 w-3.5" />
 اسکن رسید
 </TabsTrigger>
 </TabsList>
 <TabsContent value="scan" className="pt-4">
 <div className="space-y-4">
 <div className="rounded-lg border-2 border-dashed border-border bg-muted/30 p-6 text-center">
 {ocrLoading? (
 <div className="flex flex-col items-center gap-3 py-6">
 <Loader2 className="h-8 w-8 animate-spin text-primary" />
 <p className="text-sm font-medium text-foreground">
 در حال پردازش تصویر با هوش مصنوعی...
 </p>
 <p className="text-xs text-muted-foreground">
 استخراج اطلاعات فاکتور ممکن است ۱۰ تا ۳۰ ثانیه طول بکشد.
 </p>
 </div>
 ): ocrPreview? (
 <div className="space-y-3">
 <img
 src={ocrPreview}
 alt="پیش‌نمایش فاکتور"
 className="max-h-64 mx-auto rounded-lg border border-border"
 />
 <Button
 type="button"
 variant="outline"
 size="sm"
 className="gap-1.5"
 onClick={() => fileInputRef.current?.click()}
 >
 <Upload className="h-3.5 w-3.5" />
 انتخاب تصویر دیگر
 </Button>
 </div>
 ): (
 <button
 type="button"
 onClick={() => fileInputRef.current?.click()}
 className="flex flex-col items-center gap-2 py-6 w-full hover:bg-muted/50 rounded-lg transition-colors"
 >
 <div className="rounded-full bg-primary/10 p-3">
 <ImageIcon className="h-6 w-6 text-primary" />
 </div>
 <p className="text-sm font-medium text-foreground">
 تصویر فاکتور را آپلود کنید
 </p>
 <p className="text-xs text-muted-foreground">
 فرمت JPG یا PNG — حداکثر ۵ مگابایت
 </p>
 <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
 <ScanLine className="h-3.5 w-3.5" />
 انتخاب فایل
 </span>
 </button>
 )}
 <input
 ref={fileInputRef}
 type="file"
 accept="image/*"
 className="hidden"
 onChange={(e) => {
 const f = e.target.files?.[0];
 if (f) handleOcrFile(f);
 e.target.value = "";
 }}
 />
 </div>
 <div className="rounded-lg bg-info/10 border border-info/30 p-3 text-xs text-info-foreground">
 <p className="flex items-start gap-2">
 <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
 <span>
 هوش مصنوعی نام فروشنده، شماره فاکتور، تاریخ، مبلغ کل و ردیف‌های کالا را از تصویر استخراج می‌کند. اطلاعات استخراج‌شده را حتماً قبل از ذخیره بررسی کنید.
 </span>
 </p>
 </div>
 </div>
 </TabsContent>
 <TabsContent value="form" className="pt-4 space-y-4">
 {/* فیلدهای اصلی — روی موبایل تک‌ستونه */}
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 {/* طرف‌حساب + دکمه شرکت جدید */}
 <div className="space-y-1.5">
 <div className="flex items-center justify-between gap-2">
 <Label className="text-xs">طرف‌حساب *</Label>
 <Button
 type="button"
 variant="ghost"
 size="sm"
 className="h-7 px-2 text-[11px] gap-1 text-primary"
 onClick={() => setPartySheetOpen(true)}
 >
 <Building2 className="h-3.5 w-3.5" />
 شرکت جدید
 </Button>
 </div>
 <div className="relative">
 <Select
 value={partyId}
 onValueChange={(v) => {
 setPartyId(v);
 setTouched((p) => ({...p, partyId: true }));
 }}
 >
 <SelectTrigger
 className={`h-11 w-full ${
 touched.partyId && errors.partyId.length > 0
? "border-destructive focus-visible:ring-destructive/30"
: touched.partyId && partyId
? "border-success focus-visible:ring-success/30"
: ""
 }`}
 onBlur={() =>
 setTouched((p) => ({...p, partyId: true }))
 }
 >
 <SelectValue placeholder="انتخاب..." />
 </SelectTrigger>
 <SelectContent>
 {parties.length === 0? (
 <SelectItem value="_empty" disabled>
 طرف‌حسابی ثبت نشده
 </SelectItem>
 ): (
 parties.map((p) => (
 <SelectItem key={p.id} value={p.id}>
 {p.name} {p.code? `(${p.code})`: ""}
 </SelectItem>
 ))
 )}
 </SelectContent>
 </Select>
 {touched.partyId && partyId && errors.partyId.length === 0 && (
 <CheckCircle2 className="absolute top-1/2 -translate-y-1/2 end-2 h-4 w-4 text-success animate-check-pop pointer-events-none" />
 )}
 </div>
 {touched.partyId && errors.partyId.length > 0 && (
 <p className="text-[11px] text-destructive flex items-center gap-1 animate-fade-in-up">
 <AlertCircle className="h-3 w-3" />
 {errors.partyId[0]}
 </p>
 )}
 </div>

 {/* نوع فاکتور */}
 <div className="space-y-1.5">
 <Label className="text-xs">نوع فاکتور</Label>
 <Select
 value={type}
 onValueChange={(v) => setType(v as "SALE" | "PURCHASE")}
 >
 <SelectTrigger className="h-11">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="SALE">فروش</SelectItem>
 <SelectItem value="PURCHASE">خرید</SelectItem>
 </SelectContent>
 </Select>
 </div>

 {/* تاریخ */}
 <div className="space-y-1.5">
 <Label className="text-xs">تاریخ *</Label>
 <div className="relative">
 <JalaliDatePicker
 value={date}
 onChange={(v) => {
 setDate(v);
 setTouched((p) => ({...p, date: true }));
 }}
 placeholder="انتخاب تاریخ"
 className={`h-11 ${
 touched.date && errors.date.length > 0
? "border-destructive focus-visible:ring-destructive/30"
: touched.date && date
? "border-success focus-visible:ring-success/30"
: ""
 }`}
 />
 {touched.date && date && errors.date.length === 0 && (
 <CheckCircle2 className="absolute top-1/2 -translate-y-1/2 end-2 h-4 w-4 text-success animate-check-pop pointer-events-none z-10" />
 )}
 </div>
 {touched.date && errors.date.length > 0 && (
 <p className="text-[11px] text-destructive flex items-center gap-1 animate-fade-in-up">
 <AlertCircle className="h-3 w-3" />
 {errors.date[0]}
 </p>
 )}
 </div>

 {/* انبار + دکمه انبار جدید */}
 <div className="space-y-1.5">
 <div className="flex items-center justify-between gap-2">
 <Label className="text-xs">انبار</Label>
 <Button
 type="button"
 variant="ghost"
 size="sm"
 className="h-7 px-2 text-[11px] gap-1 text-primary"
 onClick={() => setWarehouseSheetOpen(true)}
 >
 <WarehouseIcon className="h-3.5 w-3.5" />
 انبار جدید
 </Button>
 </div>
 <Select
 value={warehouseId || "_none"}
 onValueChange={(v) => setWarehouseId(v === "_none"? "": v)}
 >
 <SelectTrigger className="h-11">
 <SelectValue placeholder="—" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="_none">— بدون انبار —</SelectItem>
 {warehouses.map((w) => (
 <SelectItem key={w.id} value={w.id}>
 {w.name}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>

 {/* Task 21-B: نوع پرداخت (نقدی/قرضی) + تاریخ سررسید */}
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 <div className="space-y-1.5">
 <Label className="text-xs">نوع پرداخت</Label>
 <Select
 value={paymentType}
 onValueChange={(v) => setPaymentType(v === "CREDIT" ? "CREDIT" : "CASH")}
 >
 <SelectTrigger className="h-11">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="CASH">نقدی</SelectItem>
 <SelectItem value="CREDIT">قرضی (نسیه)</SelectItem>
 </SelectContent>
 </Select>
 {paymentType === "CREDIT" && (
 <p className="text-[10px] text-muted-foreground flex items-center gap-1">
 <Info className="h-3 w-3" />
 فاکتور قرضی — مبلغ در «طرف حساب‌های دریافتنی» می‌ماند تا تسویه.
 </p>
 )}
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">
 تاریخ سررسید {paymentType === "CREDIT" ? "(اختیاری)" : ""}
 </Label>
 <JalaliDatePicker
 value={dueDate}
 onChange={setDueDate}
 placeholder="انتخاب تاریخ سررسید"
 className="h-11"
 />
 </div>
 </div>

 {/* ردیف ارز و نرخ تبدیل — چندارزی */}
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 <div className="space-y-1.5">
 <Label className="text-xs flex items-center gap-1">
 <Coins className="h-3 w-3 text-primary" />
 ارز فاکتور
 </Label>
 <Select value={currency} onValueChange={setCurrency}>
 <SelectTrigger className="h-11">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {SUPPORTED_CURRENCIES.map((c) => (
 <SelectItem key={c.code} value={c.code}>
 {c.label} ({c.code})
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>

 {currency!== "IRR" && (
 <div className="space-y-1.5">
 <Label className="text-xs flex items-center gap-1.5">
 نرخ تبدیل به ریال
 {rateLoading? (
 <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
 ): null}
 <Button
 type="button"
 variant="ghost"
 size="sm"
 className="h-6 px-2 text-[11px] gap-1 text-primary"
 onClick={() => refreshLiveRate(currency)}
 disabled={rateLoading}
 title="دریافت نرخ به‌روز از تگ‌جو"
 >
 <RefreshCw className={`h-3 w-3 ${rateLoading? "animate-spin": ""}`} />
 نرخ به‌روز
 </Button>
 </Label>
 <Input
 type="number"
 min={0}
 step={100}
 value={exchangeRate}
 onChange={(e) => setExchangeRate(Number(e.target.value) || 0)}
 className="h-11 tnum"
 dir="ltr"
 inputMode="numeric"
 />
 {formattedLiveRate && (
 <p className="text-[10px] text-muted-foreground flex items-center gap-1">
 <Info className="h-3 w-3" />
 نرخ به‌روز: ۱ {currency} ≈ {formattedLiveRate} ریال
 </p>
 )}
 </div>
 )}
 </div>

 {currency!== "IRR" && (
 <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 flex items-center justify-between gap-2 flex-wrap">
 <div className="flex flex-col">
 <span className="text-[10px] text-muted-foreground">مبلغ ارزی</span>
 <span className="text-sm font-bold text-foreground tnum">
 {formatNumber(totals.total)} {currency}
 </span>
 </div>
 <div className="text-muted-foreground text-lg">≈</div>
 <div className="flex flex-col">
 <span className="text-[10px] text-muted-foreground">معادل ریالی</span>
 <span className="text-sm font-bold text-primary tnum">
 {formatNumber(totals.totalIrr)} ریال
 </span>
 </div>
 </div>
 )}

 {/* دکمه کالای جدید — بالای جدول/کارت‌ها */}
 <div className="flex items-center justify-between gap-2 flex-wrap">
 <Label className="text-xs font-medium flex items-center gap-1">
 اقلام فاکتور
 {touched.items && errors.items.length === 0 && (
 <CheckCircle2 className="h-3.5 w-3.5 text-success animate-check-pop" />
 )}
 </Label>
 <div className="flex items-center gap-1.5">
 <Button
 type="button"
 variant="ghost"
 size="sm"
 className="h-8 px-2 text-[11px] gap-1 text-primary"
 onClick={() => setProductSheetOpen(true)}
 >
 <PackagePlus className="h-3.5 w-3.5" />
 کالای جدید
 </Button>
 <Button
 type="button"
 variant="ghost"
 size="sm"
 className="h-8 px-2 text-[11px] gap-1 text-primary"
 onClick={addRow}
 >
 <Plus className="h-3.5 w-3.5" />
 افزودن ردیف
 </Button>
 </div>
 </div>
 {touched.items && errors.items.length > 0 && (
 <p className="text-[11px] text-destructive flex items-center gap-1 animate-fade-in-up -mt-2">
 <AlertCircle className="h-3 w-3" />
 {errors.items[0]}
 </p>
 )}

 {/* جدول اقلام — دسکتاپ */}
 <div className="hidden sm:block rounded-lg border border-border overflow-hidden">
 <div className="overflow-x-auto">
 <table className="w-full text-xs min-w-[760px]">
 <thead>
 <tr className="bg-muted/40 text-muted-foreground text-right">
 <th className="font-medium px-2 py-2 w-8">#</th>
 <th className="font-medium px-2 py-2">کالا / شرح</th>
 <th className="font-medium px-2 py-2 w-20">تعداد</th>
 <th className="font-medium px-2 py-2 w-28">قیمت واحد</th>
 <th className="font-medium px-2 py-2 w-20">تخفیف٪</th>
 <th className="font-medium px-2 py-2 w-20">مالیات٪</th>
 <th className="font-medium px-2 py-2 w-28 text-left">جمع</th>
 <th className="font-medium px-2 py-2 w-10"></th>
 </tr>
 </thead>
 <tbody>
 {items.map((row, idx) => (
 <tr
 key={row.id}
 className="border-t border-border/40 align-middle"
 >
 <td className="px-2 py-1.5 text-muted-foreground tnum">
 {toPersianDigits(idx + 1)}
 </td>
 <td className="px-2 py-1.5">
 <ProductPicker
 value={row.productId}
 onSelect={(pp) => onPickerProductSelect(row.id, pp)}
 initialLabel={row.productId? row.description || null: null}
 placeholder="انتخاب کالا (جستجوی سراسری)..."
 triggerClassName="bg-background"
 priceUnit="rial"
 />
 <Input
 value={row.description}
 onChange={(e) =>
 updateRow(row.id, { description: e.target.value })
 }
 placeholder="شرح..."
 className="h-8 mt-1 text-[11px]"
 />
 </td>
 <td className="px-2 py-1.5">
 <Input
 type="number"
 min={0}
 step={1}
 value={row.quantity}
 onChange={(e) =>
 updateRow(row.id, {
 quantity: Number(e.target.value) || 0,
 })
 }
 className="h-9 text-xs tnum"
 dir="ltr"
 inputMode="numeric"
 />
 </td>
 <td className="px-2 py-1.5">
 <Input
 type="number"
 min={0}
 step={1000}
 value={row.unitPrice}
 onChange={(e) =>
 updateRow(row.id, {
 unitPrice: Number(e.target.value) || 0,
 })
 }
 className="h-9 text-xs tnum"
 dir="ltr"
 inputMode="numeric"
 />
 </td>
 <td className="px-2 py-1.5">
 <Input
 type="number"
 min={0}
 max={100}
 step={1}
 value={row.discount}
 onChange={(e) =>
 updateRow(row.id, {
 discount: Number(e.target.value) || 0,
 })
 }
 className="h-9 text-xs tnum"
 dir="ltr"
 inputMode="numeric"
 />
 </td>
 <td className="px-2 py-1.5">
 <Input
 type="number"
 min={0}
 max={100}
 step={1}
 value={row.taxRate}
 onChange={(e) =>
 updateRow(row.id, {
 taxRate: Number(e.target.value) || 0,
 })
 }
 className="h-9 text-xs tnum"
 dir="ltr"
 inputMode="numeric"
 />
 </td>
 <td className="px-2 py-1.5 text-left font-medium tnum">
 {formatNumber(lineTotal(row))}
 </td>
 <td className="px-2 py-1.5">
 <Button
 variant="ghost"
 size="icon"
 className="h-8 w-8 text-muted-foreground hover:text-destructive"
 onClick={() => removeRow(row.id)}
 disabled={items.length === 1}
 aria-label="حذف ردیف"
 >
 <Trash2 className="h-3.5 w-3.5" />
 </Button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>

 {/* لیست کارت‌ها — موبایل */}
 <div className="sm:hidden space-y-3">
 {items.map((row, idx) => (
 <Card
 key={row.id}
 className="p-3 space-y-2.5 shadow-none border-border"
 >
 <div className="flex items-center justify-between">
 <span className="text-[10px] font-semibold text-muted-foreground tnum">
 ردیف {toPersianDigits(idx + 1)}
 </span>
 <div className="flex items-center gap-2">
 <span className="text-xs font-bold text-primary tnum">
 {formatNumber(lineTotal(row))}
 </span>
 <Button
 variant="ghost"
 size="icon"
 className="h-8 w-8 text-muted-foreground hover:text-destructive"
 onClick={() => removeRow(row.id)}
 disabled={items.length === 1}
 aria-label="حذف ردیف"
 >
 <Trash2 className="h-3.5 w-3.5" />
 </Button>
 </div>
 </div>

 {/* کالا — PERF-1200: جستجوی سرور (جایگزین Select با ۲۰۰+ آیتم) */}
 <ProductPicker
 value={row.productId}
 onSelect={(pp) => onPickerProductSelect(row.id, pp)}
 initialLabel={row.productId? row.description || null: null}
 placeholder="انتخاب کالا (جستجوی سراسری)..."
 triggerClassName="h-11 bg-background"
 priceUnit="rial"
 />

 <Input
 value={row.description}
 onChange={(e) =>
 updateRow(row.id, { description: e.target.value })
 }
 placeholder="شرح..."
 className="h-10 text-xs"
 />

 {/* تعداد و قیمت */}
 <div className="grid grid-cols-2 gap-2">
 <div className="space-y-1">
 <Label className="text-[10px] text-muted-foreground">تعداد</Label>
 <Input
 type="number"
 min={0}
 step={1}
 value={row.quantity}
 onChange={(e) =>
 updateRow(row.id, {
 quantity: Number(e.target.value) || 0,
 })
 }
 className="h-11 text-sm tnum"
 dir="ltr"
 inputMode="numeric"
 />
 </div>
 <div className="space-y-1">
 <Label className="text-[10px] text-muted-foreground">قیمت واحد</Label>
 <Input
 type="number"
 min={0}
 step={1000}
 value={row.unitPrice}
 onChange={(e) =>
 updateRow(row.id, {
 unitPrice: Number(e.target.value) || 0,
 })
 }
 className="h-11 text-sm tnum"
 dir="ltr"
 inputMode="numeric"
 />
 </div>
 </div>

 {/* تخفیف و مالیات */}
 <div className="grid grid-cols-2 gap-2">
 <div className="space-y-1">
 <Label className="text-[10px] text-muted-foreground">تخفیف (٪)</Label>
 <Input
 type="number"
 min={0}
 max={100}
 step={1}
 value={row.discount}
 onChange={(e) =>
 updateRow(row.id, {
 discount: Number(e.target.value) || 0,
 })
 }
 className="h-11 text-sm tnum"
 dir="ltr"
 inputMode="numeric"
 />
 </div>
 <div className="space-y-1">
 <Label className="text-[10px] text-muted-foreground">مالیات (٪)</Label>
 <Input
 type="number"
 min={0}
 max={100}
 step={1}
 value={row.taxRate}
 onChange={(e) =>
 updateRow(row.id, {
 taxRate: Number(e.target.value) || 0,
 })
 }
 className="h-11 text-sm tnum"
 dir="ltr"
 inputMode="numeric"
 />
 </div>
 </div>

 {/* جمع ردیف */}
 <div className="flex items-center justify-between pt-2 border-t border-border">
 <span className="text-[11px] text-muted-foreground">جمع این ردیف:</span>
 <span className="text-sm font-bold text-primary tnum">
 {formatNumber(lineTotal(row))} {CURRENCY_SYMBOL[currency]}
 </span>
 </div>
 </Card>
 ))}

 <Button
 type="button"
 variant="outline"
 className="w-full h-11 gap-1.5"
 onClick={addRow}
 >
 <Plus className="h-4 w-4" />
 افزودن ردیف
 </Button>
 </div>

 {/* شرح کلی */}
 <div className="space-y-1.5">
 <Label className="text-xs">توضیحات</Label>
 <Input
 value={description}
 onChange={(e) => setDescription(e.target.value)}
 placeholder="توضیحات اختیاری فاکتور..."
 className="h-11"
 />
 </div>

 {/* جمع‌بندی */}
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 <div className="rounded-lg bg-muted/40 p-3 text-xs space-y-1.5">
 <div className="flex justify-between text-muted-foreground">
 <span>تعداد اقلام:</span>
 <span className="tnum">{toPersianDigits(items.filter((r) => isFilledRow(r)).length)}</span>
 </div>
 <div className="flex justify-between text-muted-foreground">
 <span>تخفیف کل:</span>
 <span className="tnum">
 {formatNumber(totals.discount)} {CURRENCY_SYMBOL[currency]}
 </span>
 </div>
 <div className="flex justify-between text-muted-foreground">
 <span>مالیات بر ارزش افزوده:</span>
 <span className="tnum">
 {formatNumber(totals.tax)} {CURRENCY_SYMBOL[currency]}
 </span>
 </div>
 {currency!== "IRR" && (
 <div className="flex justify-between text-muted-foreground pt-1 border-t border-border">
 <span>نرخ تبدیل به ریال:</span>
 <span className="tnum">{toPersianDigits(exchangeRate.toLocaleString("en-US"))}</span>
 </div>
 )}
 </div>
 <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1.5">
 <div className="flex justify-between text-xs text-muted-foreground">
 <span>جمع کل پس از تخفیف:</span>
 <span className="tnum">
 {formatNumber(totals.subtotal)} {CURRENCY_SYMBOL[currency]}
 </span>
 </div>
 <div className="flex justify-between items-center pt-1 border-t border-primary/20 mt-1">
 <span className="text-sm font-semibold text-foreground">مبلغ نهایی:</span>
 <span className="text-lg font-bold text-primary tnum">
 {formatNumber(totals.total)} {CURRENCY_SYMBOL[currency]}
 </span>
 </div>
 {currency!== "IRR" && (
 <div className="flex justify-between items-center pt-1 border-t border-primary/20 mt-1">
 <span className="text-xs text-muted-foreground">معادل ریالی:</span>
 <span className="text-sm font-bold text-foreground tnum">
 {formatNumber(totals.totalIrr)} ریال
 </span>
 </div>
 )}
 </div>
 </div>
 </TabsContent>
 </Tabs>
 </div>
 )}
 </div>

 {/* فوتر چسبان — پایین دیالوگ */}
 <div className="shrink-0 border-t border-border bg-background px-4 sm:px-6 py-3">
 <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
 {/* Task 21-B: پیش‌نویس فقط برای ایجاد — در ویرایش بازیابی، داده‌های ویرایش را می‌پوشاند */}
 {!isEditMode && (
 <>
 <AutoSaveIndicator
 isSaving={autoSave.isSaving}
 lastSaved={autoSave.lastSaved}
 hasDraft={autoSave.hasDraft}
 onRestore={handleRestoreDraft}
 onClear={handleClearDraft}
 showClear
 />
 {autoSave.hasDraft && (
 <Button
 type="button"
 variant="ghost"
 size="sm"
 className="h-7 px-2 text-[11px] gap-1 text-primary"
 onClick={handleRestoreDraft}
 >
 <History className="h-3 w-3" />
 بازیابی پیش‌نویس
 </Button>
 )}
 </>
 )}
 </div>
 <div className="flex items-center justify-end gap-2">
 <Button
 variant="outline"
 className="h-11 flex-1 sm:flex-none"
 onClick={() => onOpenChange(false)}
 disabled={submitting}
 >
 انصراف
 </Button>
 {/* Task 21-B: رزرو فاکتور — فقط در حالت ایجاد (فاکتور رزرو با «ثبت نهایی» فعال می‌شود) */}
 {!isEditMode && (
 <Button
 onClick={() => void handleSubmit("reserve")}
 disabled={submitting || loading || !isFormValid}
 data-action="submit-reserve"
 variant="secondary"
 className="h-11 flex-1 sm:flex-none gap-1.5"
 title="فاکتور بدون اثر انبار/سند ذخیره می‌شود — بعداً «ثبت نهایی» بزنید"
 >
 {submitting ? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ) : (
 <Clock className="h-4 w-4" />
 )}
 رزرو فاکتور
 </Button>
 )}
 <Button
 onClick={() => void handleSubmit("issue")}
 disabled={submitting || loading ||!isFormValid}
 data-action="submit"
 data-form="invoice-form"
 className="h-11 flex-1 sm:flex-none gap-1.5"
 title={!isFormValid? "ابتدا خطاهای فرم را برطرف کنید": undefined}
 >
 {submitting? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ): (
 <FileText className="h-4 w-4" />
 )}
 {isEditMode ? "ذخیره تغییرات" : "ثبت فاکتور"}
 </Button>
 </div>
 </div>
 </DialogContent>
 </Dialog>

 {/* Quick Create Drawers */}
 <QuickCreatePartySheet
 open={partySheetOpen}
 onOpenChange={setPartySheetOpen}
 onCreated={handlePartyCreated}
 />
 <QuickCreateProductSheet
 open={productSheetOpen}
 onOpenChange={setProductSheetOpen}
 onCreated={handleProductCreated}
 />
 <QuickCreateWarehouseSheet
 open={warehouseSheetOpen}
 onOpenChange={setWarehouseSheetOpen}
 onCreated={handleWarehouseCreated}
 />

 {/* WH-2: دیالوگ اقلام آزاد — ذخیره به‌عنوان کالای جدید در انبار؟ */}
 <Dialog
 open={freeTextDialogOpen}
 onOpenChange={(open) => {
 // بستن با Esc/کلیک بیرون = انصراف از ثبت
 if (!open) resolveFreeTextChoice("cancel");
 }}
 >
 <DialogContent className="max-w-md">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2 text-base">
 <PackagePlus className="h-4 w-4 text-primary" />
 ذخیره اقلام در انبار؟
 </DialogTitle>
 <DialogDescription>
 {toPersianDigits(freeTextCount)} قلم بدون انتخاب کالا — آیا این اقلام
 به‌عنوان کالای جدید در انبار ذخیره شوند؟
 </DialogDescription>
 </DialogHeader>
 <div className="rounded-lg bg-info/10 border border-info/30 p-3 text-xs text-info-foreground">
 <p className="flex items-start gap-2">
 <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
 <span>
 با انتخاب «ذخیره همه در انبار»، هر شرح به کالای جدید تبدیل می‌شود
 (کد کالا و قیمت فروش به‌صورت خودکار ثبت می‌شود) و در ماژول انبار
 قابل مشاهده خواهد بود.
 </span>
 </p>
 </div>
 <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
 <Button
 variant="ghost"
 className="h-11 flex-1 sm:flex-none"
 onClick={() => resolveFreeTextChoice("cancel")}
 >
 انصراف
 </Button>
 <Button
 variant="outline"
 className="h-11 flex-1"
 onClick={() => resolveFreeTextChoice("skip")}
 >
 فقط فاکتور ثبت شود
 </Button>
 <Button
 className="h-11 flex-1 gap-1.5"
 onClick={() => resolveFreeTextChoice("save")}
 >
 <PackagePlus className="h-4 w-4" />
 ذخیره همه در انبار
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </>
 );
}

export default InvoiceForm;
