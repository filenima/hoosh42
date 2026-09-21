"use client";

import * as React from "react";
import {
  Upload,
  Download,
  FileSpreadsheet,
  FileJson,
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Eye,
  ArrowDownToLine,
  Package,
  Users,
  ShoppingCart,
  Loader2,
  Wand2,
  Table2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { toPersianDigits, toJalali } from "@/lib/persian";
import { authFetch } from "@/lib/auth-fetch";
import { useToast } from "@/hooks/use-toast";
/* FIX(21-A): پارسر مشترک ایمپورت — انکودینگ (cp1256/UTF-16/UTF-8)، جداکننده،
 * بازچینش قیمت‌های شکستهٔ خروجی هلو/سپیدار (۲,۳۹۰,۰۰۰ در سه سلول!) */
import {
  decodeBuffer,
  detectDelimiter,
  parseCsvMatrix,
  matrixToTable,
  normalizeHeaderKey,
  normalizeDigits,
  isBlankOrNumeric,
  combineCategory,
} from "@/lib/import-parser";

/* ============================================================
 FIX(IMPORT-REWRITE): ایمپورت واقعی — CSV / XLSX / JSON
 ============================================================
 * FIX(21-A): ارتقای کامل برای فایل‌های واقعی نرم‌افزارهای حسابداری ایرانی:
 *  ۱) تشخیص انکودینگ واقعی (BOM / UTF-8 سخت‌گیر / Windows-1256 / UTF-16) —
 *     فایل واقعی مالک cp1256 بود و FileReader.readAsText('utf-8') آن را
 *     کاملاً خراب می‌کرد. حالا ArrayBuffer خوانده و با جدول cp1256 دیکد می‌شود.
 *  ۲) تشخیص جداکننده (, ; \t |) و پسوندهای .txt / .tsv
 *  ۳) بازچینش قیمت‌های شکسته (جداکننده هزارگانِ بی‌کوتیشن) — الگوریتم
 *     backtracking با قید «هر ستون ≥۱ سلول» و «گروه‌های ۳رقمی فقط ادامهٔ قیمت»
 *  ۴) سقف ۱۰۰,۰۰۰ ردیف در هر فایل — ایمپورت چانک‌های ۵۰۰تایی
 *  ۵) پیش‌نمایش ۸ ردیف اول + نگاشت ستون‌ها (خودکار/دستی) + استراتژی تکراری
 *  ۶) جمع‌بندی نهایی کامل: ایجاد + به‌روزرسانی + ردشده + خطا = کل ردیف‌ها
 *     (خواستهٔ مالک: «هیچ کالایی کم یا ناقص نباشه»)
 *  ۷) تاریخچه واقعی از GET /api/import (AuditLog) با ستون‌های جدید
 * ============================================================ */

type ImportEntity = "products" | "customers" | "invoices";
// entityType که API انتظار دارد: customers → parties
const apiEntity = (e: ImportEntity): "products" | "parties" | "invoices" =>
  e === "customers" ? "parties" : e;

type ExportFormat = "csv" | "csv-excel" | "json";

/** استراتژی برخورد با SKU های تکراری */
type DuplicateStrategy = "skip" | "update";

/** سقف کل ردیف‌های هر فایل (سمت کلاینت — سرور ۵۰۰۰ ردیف/درخواست) */
const MAX_IMPORT_ROWS = 100000;
const IMPORT_CHUNK_SIZE = 500; // هر چانک حداکثر ۵۰۰ ردیف

interface ImportHistoryEntry {
  id: string;
  entity: ImportEntity;
  fileName: string;
  totalRows: number;
  successRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  errorRows: number;
  date: string;
  status: "success" | "partial" | "failed";
}

/* فیلدهای قابل نگاشت برای هر موجودیت — کلید=فیلد API، label=نام فارسی */
interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  /** فیلد مخفی: خودکار نگاشت می‌شود ولی در گرید نگاشت نمایش داده نمی‌شود */
  hidden?: boolean;
  /** هدرهایی که در فایل‌های خروجی نرم‌افزارهای حسابداری با این فیلد مطابقت دارند */
  aliases: string[];
}

const ENTITY_META: Record<
  ImportEntity,
  { label: string; icon: React.ElementType; fields: FieldDef[] }
> = {
  products: {
    label: "محصولات",
    icon: Package,
    fields: [
      { key: "name", label: "نام کالا", required: true, aliases: ["نام کالا", "نام", "شرح کالا", "شرح", "عنوان", "کالنامه", "name", "title"] },
      { key: "sku", label: "کد کالا", aliases: ["کد کالا", "کد", "شناسه کالا", "کد شناسایی", "کد یکتا", "sku", "code", "id"] },
      { key: "stock", label: "موجودی", aliases: ["موجودی", "موجودي", "تعداد", "کمیت", "مقدار", "stock", "quantity", "qty"] },
      { key: "unit", label: "واحد", aliases: ["واحد شمارش", "واحد", "واحد کالا", "واحد های کالا", "آیتم", "unit", "uom"] },
      // ترتیب alias ها اولویت است: ميانگين خريد (بهای میانگین متحرک) > قیمت خرید
      { key: "salePrice", label: "قیمت فروش", aliases: ["قیمت فروش", "في فروش", "فی فروش", "فی", "قیمت", "نرخ فروش", "فروش", "قیمت واحد فروش", "saleprice", "price", "sale"] },
      { key: "purchasePrice", label: "قیمت خرید", aliases: ["ميانگين خريد", "میانگین خرید", "قیمت خرید", "نرخ خرید", "بهای خرید", "قیمت واحد خرید", "آخرين في خريد", "آخرین فی خرید", "purchaseprice", "cost", "buy"] },
      { key: "category", label: "دسته‌بندی", aliases: ["دسته‌بندی", "گروه کالا", "گروه", "دسته", "category", "group"] },
      { key: "barcode", label: "بارکد", aliases: ["بارکد", "کد بارکد", "barcode", "gtin"] },
      { key: "description", label: "توضیحات", aliases: ["توضیحات", "ملاحظات", "description", "notes"] },
      // --- فیلدهای مخفی (خودکار نگاشت می‌شوند؛ در گرید نمایش داده نمی‌شوند) ---
      { key: "purchasePriceAvg", label: "میانگین خرید", hidden: true, aliases: ["ميانگين خريد", "میانگین خرید", "میانگین خرید کالا", "average purchase"] },
      { key: "purchasePriceLast", label: "آخرین فی خرید", hidden: true, aliases: ["آخرين في خريد", "آخرین فی خرید", "آخرین نرخ خرید", "last purchase price"] },
      { key: "categoryMain", label: "گروه اصلی", hidden: true, aliases: ["گروه اصلي", "گروه اصلی", "گروه اصلی کالا", "main group", "maincategory"] },
      { key: "categorySub", label: "گروه فرعی", hidden: true, aliases: ["گروه فرعي", "گروه فرعی", "زیرگروه", "sub group", "subcategory"] },
    ],
  },
  customers: {
    label: "مشتریان",
    icon: Users,
    fields: [
      { key: "name", label: "نام", required: true, aliases: ["نام طرف‌حساب", "نام مشتری", "نام شخص", "نام و نام خانوادگی", "نام", "حساب", "name", "title", "full name"] },
      { key: "code", label: "کد", aliases: ["کد مشتری", "کد حساب", "کد طرف‌حساب", "کد", "شماره حساب", "code", "customer code"] },
      { key: "type", label: "نوع", aliases: ["نوع", "نوع طرف‌حساب", "type", "customer/supplier"] },
      { key: "phone", label: "تلفن", aliases: ["تلفن", "شماره تلفن", "phone", "tel"] },
      { key: "mobile", label: "موبایل", aliases: ["موبایل", "همراه", "تلفن همراه", "شماره موبایل", "mobile", "cell"] },
      { key: "nationalId", label: "کد ملی", aliases: ["کد ملی", "شناسه ملی", "کد ملی/شناسه ملی", "nationalid", "national code"] },
      { key: "economicCode", label: "کد اقتصادی", aliases: ["کد اقتصادی", "شناسه اقتصادی", "شماره اقتصادی", "economiccode", "economic id"] },
      { key: "taxId", label: "کد مالیاتی", aliases: ["کد مالیاتی", "شناسه مالیاتی", "شماره مالیاتی", "شناسه یکتای مالیاتی", "taxid", "tax id"] },
      { key: "email", label: "ایمیل", aliases: ["ایمیل", "پست الکترونیکی", "email", "mail"] },
      { key: "address", label: "آدرس", aliases: ["آدرس", "نشانی", "address"] },
    ],
  },
  invoices: {
    label: "فاکتورها",
    icon: ShoppingCart,
    fields: [
      { key: "number", label: "شماره", required: true, aliases: ["شماره فاکتور", "شماره", "شماره سند", "number", "no", "invoice no"] },
      { key: "partyCode", label: "کد مشتری", required: true, aliases: ["کد مشتری", "کد طرف‌حساب", "کد حساب", "partycode", "customer code"] },
      { key: "date", label: "تاریخ", aliases: ["تاریخ فاکتور", "تاریخ", "تاریخ سند", "date"] },
      { key: "total", label: "مبلغ کل", aliases: ["مبلغ کل", "جمع کل", "مبلغ فاکتور", "مبلغ", "total", "amount"] },
      { key: "items", label: "اقلام", required: true, aliases: ["اقلام", "ردیف‌ها", "items", "lines"] },
      { key: "description", label: "توضیحات", aliases: ["توضیحات", "شرح", "description"] },
    ],
  },
};

const FORMAT_META: Record<ExportFormat, { label: string; icon: React.ElementType; mime: string; ext: string }> = {
  csv: { label: "CSV (UTF-8)", icon: FileText, mime: "text/csv;charset=utf-8", ext: "csv" },
  "csv-excel": { label: "CSV برای اکسل (;)", icon: FileSpreadsheet, mime: "text/csv;charset=utf-8", ext: "csv" },
  json: { label: "JSON", icon: FileJson, mime: "application/json", ext: "json" },
};

/* ============================================================
 تشخیص خودکار نگاشت ستون‌ها (با نرمال‌سازی ي/ك عربی و اولویت alias)
 ============================================================ */

/** تشخیص خودکار نگاشت ستون‌ها: برای هر فیلد، هدر منطبق را پیدا کن
 * FIX(21-A): تطبیق با normalizeHeaderKey (ي→ی، ك→ک، حذف فاصله/ZWNJ) تا
 * هدرهای عربیِ خروجی هلو («نام كالا», «في فروش») هم شناسایی شوند.
 * alias ها به ترتیب اولویت امتحان می‌شوند (مثلاً «ميانگين خريد» قبل از
 * «آخرين في خريد» برای قیمت خرید). */
function autoDetectMapping(
  headers: string[],
  entity: ImportEntity
): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  const normHeaders = headers.map((h) => ({ raw: h, norm: normalizeHeaderKey(h) }));

  // پاس ۱: تطبیق دقیق (با اولویت alias)
  for (const field of ENTITY_META[entity].fields) {
    for (const alias of field.aliases) {
      const na = normalizeHeaderKey(alias);
      if (!na) continue;
      const found = normHeaders.find((h) => !used.has(h.raw) && h.norm === na);
      if (found) {
        mapping[field.key] = found.raw;
        used.add(found.raw);
        break;
      }
    }
  }
  // پاس ۲: تطبیق شامل (هدر شامل alias یا برعکس) برای هدرهای ترکیبی
  for (const field of ENTITY_META[entity].fields) {
    if (mapping[field.key]) continue;
    const aliases = field.aliases.map((a) => normalizeHeaderKey(a));
    const found = normHeaders.find(
      (h) =>
        !used.has(h.raw) &&
        aliases.some(
          (a) =>
            (a.length > 2 && h.norm.includes(a)) ||
            (h.norm.length > 2 && a.includes(h.norm))
        )
    );
    if (found) {
      mapping[field.key] = found.raw;
      used.add(found.raw);
    }
  }
  return mapping;
}

/* ============================================================
 خواندن فایل — تشخیص نوع واقعی از محتوا (نه فقط پسوند)
 ============================================================ */

interface ParsedFileResult {
  headers: string[];
  rows: Record<string, string>[];
  format: "csv" | "xlsx" | "json";
  /** اطلاعات تشخیص (انکودینگ/جداکننده) برای نمایش به کاربر */
  info: string;
}

async function parseFile(file: File, entity: ImportEntity): Promise<ParsedFileResult> {
  void entity; // نگاشت بعد از پارس انجام می‌شود — فقط برای سازگاری امضا
  const lowerName = file.name.toLowerCase();
  const isJson = lowerName.endsWith(".json");
  const isXlsx = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls");

  // --- JSON ---
  if (isJson) {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("فایل JSON نامعتبر است");
    }
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>)?.data)
        ? (parsed as Record<string, unknown>).data
        : null;
    if (!arr || !Array.isArray(arr) || arr.length === 0) {
      throw new Error("ساختار JSON پشتیبانی نمی‌شود — باید آرایه‌ای از رکوردها باشد");
    }
    const rows = (arr as Record<string, unknown>[]).map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? "" : String(v)]))
    );
    const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    return { headers, rows, format: "json", info: "JSON" };
  }

  // --- XLSX/XLS (باینری واقعی با SheetJS) ---
  if (isXlsx) {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", codepage: 65001 });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new Error("فایل اکسل هیچ شیتی ندارد");
    const sheet = workbook.Sheets[firstSheetName];
    // sheet_to_json با header:1 → آرایه‌ای از ردیف‌ها؛ خام برای تشخیص هدر
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    if (!matrix || matrix.length === 0) {
      throw new Error("شیتی که انتخاب شد خالی است");
    }
    // قیمت‌های اکسل تک‌سلولی هستند → reassemble=false (بدون جذب گروه)
    const table = matrixToTable(matrix as unknown as string[][], { delimiter: ",", reassemble: false });
    return {
      headers: table.headers,
      rows: table.rows,
      format: "xlsx",
      info: `اکسل — شیت «${firstSheetName.slice(0, 20)}»`,
    };
  }

  // --- CSV / TXT / TSV (پیش‌فرض) — با تشخیص انکودینگ واقعی ---
  // FIX(21-A): خروجی هلو/سپیدار Windows-1256 است — readAsText('utf-8') آن را
  // خراب می‌کرد. حالا: ArrayBuffer → BOM → UTF-8 سخت‌گیر → cp1256 → utf-16
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // PK signature — فایل xlsx بدون پسوند درست!
    throw new Error(
      "این فایل اکسل (XLSX) است اما پسوند CSV دارد — پسوند فایل را اصلاح کنید یا فایل را در اکسل باز و CSV ذخیره کنید"
    );
  }
  const { text, encoding } = decodeBuffer(bytes);
  const delimiter = detectDelimiter(text);
  const matrix = parseCsvMatrix(text, delimiter);
  if (matrix.length === 0) throw new Error("فایل خالی است یا قابل خواندن نیست");
  // بازچینش قیمت‌های شکسته (جداکننده هزارگانِ بی‌کوتیشن خروجی هلو)
  const table = matrixToTable(matrix, { delimiter, encoding, reassemble: true });
  const delimLabel =
    delimiter === "," ? "کاما" : delimiter === ";" ? "سمی‌کالن" : delimiter === "\t" ? "Tab" : "|";
  const encodingLabel =
    encoding === "windows-1256"
      ? "Windows-1256"
      : encoding === "utf-8"
        ? "UTF-8"
        : encoding === "utf-8bom"
          ? "UTF-8 (BOM)"
          : encoding.toUpperCase();
  return {
    headers: table.headers,
    rows: table.rows,
    format: "csv",
    info: `${encodingLabel} • جداکننده ${delimLabel}`,
  };
}

/* ============================================================
 اعتبارسنجی ردیف‌ها بعد از نگاشت
 ============================================================ */

interface RowError {
  row: number;
  message: string;
}

function validateRows(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  entity: ImportEntity
): RowError[] {
  const errors: RowError[] = [];
  const fields = ENTITY_META[entity].fields;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const idx = i + 1;
    for (const f of fields) {
      const header = mapping[f.key];
      if (!header) continue; // ستونی برای این فیلد نگاشت نشده
      const value = (row[header] ?? "").trim();
      if (f.required && !value) {
        errors.push({ row: idx, message: `«${f.label}» (ستون «${header}») خالی است` });
      }
      // اعتبارسنجی عددی قیمت‌ها/موجودی — باید عددی شود بعد از نرمال‌سازی
      if (
        value &&
        (f.key === "salePrice" ||
          f.key === "purchasePrice" ||
          f.key === "total" ||
          f.key === "stock")
      ) {
        const n = Number(normalizeDigits(value));
        if (Number.isNaN(n) || n < 0) {
          errors.push({ row: idx, message: `«${f.label}» عددی نیست: «${value.slice(0, 30)}»` });
        }
      }
    }
  }
  return errors;
}

/* ============================================================
 ساخت ردیف‌های نهایی برای API از روی نگاشت
 ============================================================ */

const NUMERIC_FIELDS = new Set([
  "salePrice",
  "purchasePrice",
  "purchasePriceAvg",
  "purchasePriceLast",
  "wholesalePrice",
  "total",
  "stock",
]);

/** مقدار پیش‌نمایش یک فیلد (دسته‌بندی = ترکیب گروه اصلی/فرعی) */
function previewFieldValue(
  row: Record<string, string>,
  fieldKey: string,
  mapping: Record<string, string>
): string {
  if (fieldKey === "category") {
    const explicit = mapping.category ? (row[mapping.category] ?? "").trim() : "";
    if (explicit) return explicit;
    const combined = combineCategory(
      mapping.categoryMain ? row[mapping.categoryMain] ?? "" : "",
      mapping.categorySub ? row[mapping.categorySub] ?? "" : ""
    );
    return combined;
  }
  return (row[mapping[fieldKey]] ?? "").trim();
}

/** ساخت ردیف‌های نهایی برای API از روی نگاشت
 * FIX(21-A): موجودی + ترکیب دسته‌بندی اصلی/فرعی + فیلدهای مخفی میانگین/آخرین
 * خرید (سرور برای هر ردیف اولویت می‌دهد: میانگین > آخرین فی خرید) */
function buildApiRows(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  entity: ImportEntity
): Record<string, unknown>[] {
  const fields = ENTITY_META[entity].fields;
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.key === "category") {
        // دسته‌بندی: مقدار مستقیم یا ترکیب «گروه اصلی / گروه فرعی»
        const value = previewFieldValue(row, "category", mapping);
        if (value) out.category = value;
        continue;
      }
      const header = mapping[f.key];
      if (!header) continue;
      let value = (row[header] ?? "").trim();
      if (!value) continue;
      if (NUMERIC_FIELDS.has(f.key)) {
        value = normalizeDigits(value);
        if (value === "") continue;
      }
      if (f.key === "unit" && isBlankOrNumeric(value)) {
        // «واحد هاي کالا» در خروجی هلو عددی/خالی است → «عدد»
        value = "عدد";
      }
      out[f.key] = value;
    }
    return out;
  });
}

/* ============================================================
 ابزار: بارگذاری داده واقعی برای صادرکرد
 ============================================================ */

async function fetchApiRows(url: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await authFetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    if (json && Array.isArray(json.data)) return json.data as Record<string, unknown>[];
    if (Array.isArray(json)) return json as Record<string, unknown>[];
    return [];
  } catch {
    return [];
  }
}

// نگاشت داده واقعی API به ستون‌های هر موجودیت (همان ترتیب قالب‌ها)
async function fetchExportRows(entity: ImportEntity): Promise<Record<string, unknown>[]> {
  if (entity === "invoices") {
    const rows = await fetchApiRows("/api/accounting/invoices?limit=500");
    return rows.map((inv) => {
      const party = (inv.party ?? {}) as Record<string, unknown>;
      const dateRaw = typeof inv.date === "string" ? new Date(inv.date) : null;
      return {
        "شماره": inv.number ?? "",
        "مشتری": typeof party.name === "string" ? party.name : "—",
        "تاریخ": dateRaw && !Number.isNaN(dateRaw.getTime()) ? toJalali(dateRaw) : "—",
        "مبلغ کل (ریال)": Number(inv.total ?? 0),
        "وضعیت": inv.status ?? "",
        "توضیحات": inv.description ?? "",
      };
    });
  }
  if (entity === "products") {
    const rows = await fetchApiRows("/api/products?limit=500");
    return rows.map((p) => ({
      "نام کالا": p.name ?? "",
      "قیمت فروش (ریال)": Number(p.salePrice ?? 0),
      "قیمت خرید (ریال)": Number(p.purchasePrice ?? 0),
      "واحد شمارش": p.unit ?? "",
      "دسته‌بندی": typeof p.category === "string" ? p.category : "",
      "کد کالا": p.sku ?? "",
      "بارکد": p.barcode ?? "",
      "توضیحات": p.description ?? "",
    }));
  }
  // customers طرف‌حساب‌ها
  const rows = await fetchApiRows("/api/parties?limit=500");
  return rows.map((p) => ({
    "نام": p.name ?? "",
    "کد": p.code ?? "",
    "نوع": p.type ?? "",
    "تلفن": p.phone ?? "",
    "موبایل": p.mobile ?? "",
    "کد ملی": p.nationalId ?? "",
    "کد اقتصادی": p.economicCode ?? "",
    "کد مالیاتی": p.taxId ?? "",
    "ایمیل": p.email ?? "",
    "آدرس": p.address ?? "",
  }));
}

/* تولید CSV واقعی با BOM (پشتیبانی فارسی در اکسل) و escape صحیح */
function rowsToCsv(rows: Record<string, unknown>[], delimiter: string): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /["\n\r,;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    headers.map(esc).join(delimiter),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(delimiter)),
  ];
  // BOM برای نمایش صحیح فارسی در Excel
  return "\uFEFF" + lines.join("\r\n");
}

function downloadBlob(content: string, mime: string, fileName: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================================================
 کامپوننت: پیش‌نمایش واردات + نگاشت ستون‌ها
 ============================================================ */

interface ImportPreviewProps {
  entity: ImportEntity;
  headers: string[];
  rows: Record<string, string>[];
  mapping: Record<string, string>;
  onMappingChange: (fieldKey: string, header: string) => void;
  duplicateStrategy: DuplicateStrategy;
  onDuplicateStrategyChange: (s: DuplicateStrategy) => void;
  errors: RowError[];
  importing: boolean;
  progress: number;
  progressLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  fileName: string;
  fileFormat: "csv" | "xlsx" | "json";
  fileInfo: string;
}

function ImportPreview({
  entity,
  headers,
  rows,
  mapping,
  onMappingChange,
  duplicateStrategy,
  onDuplicateStrategyChange,
  errors,
  importing,
  progress,
  progressLabel,
  onConfirm,
  onCancel,
  fileName,
  fileFormat,
  fileInfo,
}: ImportPreviewProps) {
  // فقط فیلدهای قابل مشاهده (مخفی‌ها خودکار نگاشت می‌شوند)
  const fields = ENTITY_META[entity].fields.filter((f) => !f.hidden);
  const hiddenMapped = ENTITY_META[entity].fields.filter((f) => f.hidden && mapping[f.key]);
  const mappedHeaders = fields.map((f) => mapping[f.key]).filter(Boolean);
  const unmappedRequired = fields.filter((f) => f.required && !mapping[f.key]);
  const unmappedCount = unmappedRequired.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">پیش‌نمایش داده‌ها</span>
          <Badge variant="outline" className="text-[10px] gap-1">
            {fileFormat === "xlsx" ? <FileSpreadsheet className="h-3 w-3" /> : fileFormat === "json" ? <FileJson className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
            {fileName.slice(0, 30)}
          </Badge>
          {fileInfo && (
            <Badge variant="secondary" className="text-[10px]">
              {fileInfo}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {errors.length > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {toPersianDigits(errors.length)} خطا
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">
            {toPersianDigits(rows.length)} ردیف
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {toPersianDigits(mappedHeaders.length)}/{toPersianDigits(fields.length)} ستون نگاشت شده
          </Badge>
        </div>
      </div>

      {/* نگاشت ستون‌ها — برای هر فیلد، انتخاب ستون فایل */}
      <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Wand2 className="h-3.5 w-3.5 text-primary" />
          نگاشت ستون‌ها (خودکار تشخیص داده شد — قابل ویرایش)
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {fields.map((f) => {
            const isUnmappedRequired = f.required && !mapping[f.key];
            return (
              <div key={f.key} className="flex items-center gap-2">
                <span className="text-[11px] min-w-[80px] text-foreground/80">
                  {f.label}
                  {f.required && <span className="text-destructive mr-0.5">*</span>}
                </span>
                <Select
                  value={mapping[f.key] ?? "__none__"}
                  onValueChange={(v) => onMappingChange(f.key, v === "__none__" ? "" : v)}
                  disabled={importing}
                >
                  <SelectTrigger
                    className={cn(
                      "h-7 text-[11px] flex-1",
                      isUnmappedRequired && "border-destructive/60"
                    )}
                  >
                    <SelectValue placeholder="نامشخص" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" className="text-[11px]">نامشخص</SelectItem>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h} className="text-[11px]">
                        {h || "(بی‌نام)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isUnmappedRequired && (
                  <Badge variant="destructive" className="text-[9px] shrink-0">
                    اجباری — نگاشت نشده
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
        {hiddenMapped.length > 0 && (
          <p className="text-[10px] text-muted-foreground">
            نگاشت خودکار پشتیبان: {hiddenMapped.map((f) => f.label).join("، ")}
            {" "}(در محاسبه قیمت خرید/دسته‌بندی به‌صورت هوشمند استفاده می‌شوند)
          </p>
        )}
        {unmappedCount > 0 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            {toPersianDigits(unmappedCount)} فیلد اجباری هنوز نگاشت نشده — ستون آن را از لیست بالا انتخاب کنید.
          </p>
        )}
      </div>

      {/* استراتژی SKU تکراری — فقط برای کالاها */}
      {entity === "products" && (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 text-primary" />
            برخورد با کد کالای تکراری (SKU)
          </div>
          <RadioGroup
            value={duplicateStrategy}
            onValueChange={(v) => onDuplicateStrategyChange(v === "update" ? "update" : "skip")}
            className="grid grid-cols-1 sm:grid-cols-2 gap-2"
            disabled={importing}
          >
            <label
              className={cn(
                "flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors",
                duplicateStrategy === "skip"
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:border-primary/30"
              )}
            >
              <RadioGroupItem value="skip" className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block text-xs font-medium">رد ردیف‌های تکراری</span>
                <span className="block text-[10px] text-muted-foreground">
                  ردیف‌هایی که کد کالایشان قبلاً ثبت شده رد می‌شوند (با گزارش دلیل)
                </span>
              </span>
            </label>
            <label
              className={cn(
                "flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors",
                duplicateStrategy === "update"
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:border-primary/30"
              )}
            >
              <RadioGroupItem value="update" className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block text-xs font-medium">به‌روزرسانی قیمت و موجودی</span>
                <span className="block text-[10px] text-muted-foreground">
                  قیمت‌ها و توضیحات به‌روزرسانی و موجودی تعدیل می‌شود (حرکت ADJUSTMENT)
                </span>
              </span>
            </label>
          </RadioGroup>
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
          <p className="text-xs font-medium text-destructive">
            خطاهای اعتبارسنجی ({toPersianDigits(errors.length)} — ردیف‌های نامعتبر با دلیل دقیق گزارش می‌شوند):
          </p>
          <ScrollArea className="max-h-24">
            {errors.slice(0, 10).map((e, i) => (
              <p key={i} className="text-[11px] text-destructive/80">
                ردیف {toPersianDigits(e.row)}: {e.message}
              </p>
            ))}
            {errors.length > 10 && (
              <p className="text-[11px] text-muted-foreground">
                و {toPersianDigits(errors.length - 10)} خطای دیگر...
              </p>
            )}
          </ScrollArea>
        </div>
      )}

      {/* جدول پیش‌نمایش با داده‌ی واقعی نگاشت‌شده — ۸ ردیف اول */}
      <ScrollArea className="max-h-56">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">#</TableHead>
              {fields.filter((f) => mapping[f.key] || f.key === "category").map((f) => (
                <TableHead key={f.key} className="text-xs">{f.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 8).map((row, ri) => (
              <TableRow key={ri}>
                <TableCell className="text-center text-xs text-muted-foreground">
                  {toPersianDigits(ri + 1)}
                </TableCell>
                {fields.filter((f) => mapping[f.key] || f.key === "category").map((f) => (
                  <TableCell key={f.key} className="text-xs max-w-[160px] truncate">
                    {previewFieldValue(row, f.key, mapping) || "—"}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length > 8 && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            نمایش {toPersianDigits(8)} از {toPersianDigits(rows.length)} ردیف
          </p>
        )}
      </ScrollArea>

      {importing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{progressLabel}</span>
            <span className="font-medium">{toPersianDigits(progress)}٪</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={importing}>
          انصراف
        </Button>
        <Button
          size="sm"
          onClick={onConfirm}
          disabled={importing || rows.length === 0 || unmappedCount > 0}
        >
          {importing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 ml-1 animate-spin" />
              در حال وارد کردن...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 ml-1" />
              وارد کردن {toPersianDigits(rows.length)} ردیف
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
 کامپوننت اصلی: DataImportExport
 ============================================================ */

/* ============================================================
 * FIX(v2.2): پروفایل‌های نگاشت ذخیره‌شده (Mapping Profiles)
 * نگاشت‌های اصلاح‌شده کاربر برای هر موجودیت در localStorage ذخیره
 * می‌شود تا دفعه‌ی بعد با فایل مشابه، همان نگاشت خودکار اعمال شود.
 * ============================================================ */
const MAPPING_PROFILES_KEY = "hoshhesab_import_mapping_profiles";

interface MappingProfile {
  entity: ImportEntity;
  /** نگاشت قبلی: فیلد API → نام هدر فایل قبلی */
  mapping: Record<string, string>;
  savedAt: number;
  fileFormat: "csv" | "xlsx" | "json";
}

function loadMappingProfiles(): MappingProfile[] {
  try {
    const raw = localStorage.getItem(MAPPING_PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MappingProfile[]) : [];
  } catch {
    return [];
  }
}

function saveMappingProfile(profile: MappingProfile): void {
  try {
    const profiles = loadMappingProfiles();
    // فقط جدیدترین پروفایل هر موجودیت نگه داشته می‌شود
    const next = [...profiles.filter((p) => p.entity !== profile.entity), profile].slice(-3);
    localStorage.setItem(MAPPING_PROFILES_KEY, JSON.stringify(next));
  } catch {
    /* localStorage not available — ignore */
  }
}

/* ============================================================
 * FIX(21-A): ساختار نتیجه‌ی ایمپورت — جمع‌بندی کامل بدون ردیف گم‌شده:
 * هر ردیف دقیقاً در یکی از ایجاد/به‌روزرسانی/ردشده/خطا ختم می‌شود و
 * جمعِ این چهار باید برابر ردیف‌های پارس‌شده باشد.
 * ============================================================ */
interface ImportSummary {
  entity: ImportEntity;
  fileName: string;
  /** کل ردیف‌های فایل (بعد از حذف ردیف‌های کاملاً خالی) */
  totalRows: number;
  /** ردیف‌هایی که به سرور ارسال شدند */
  rowsParsed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { row: number; message: string }[];
  skippedDetails: { row: number; message: string }[];
  finishedAt: string;
  duplicateStrategy: DuplicateStrategy;
}

export function DataImportExport() {
  const { toast } = useToast();
  const [importEntity, setImportEntity] = React.useState<ImportEntity>("products");
  const [exportEntity, setExportEntity] = React.useState<ImportEntity>("products");
  const [exportFormat, setExportFormat] = React.useState<ExportFormat>("csv");
  const [previewOpen, setPreviewOpen] = React.useState(false);
  // داده‌ی فایل پارس‌شده
  const [fileHeaders, setFileHeaders] = React.useState<string[]>([]);
  const [fileRows, setFileRows] = React.useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = React.useState("");
  const [fileFormat, setFileFormat] = React.useState<"csv" | "xlsx" | "json">("csv");
  const [fileInfo, setFileInfo] = React.useState("");
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [previewErrors, setPreviewErrors] = React.useState<RowError[]>([]);
  const [importing, setImporting] = React.useState(false);
  const [importProgress, setImportProgress] = React.useState(0);
  const [importProgressLabel, setImportProgressLabel] = React.useState("در حال واردات...");
  const [exporting, setExporting] = React.useState(false);
  const [history, setHistory] = React.useState<ImportHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = React.useState(false);
  // FIX(21-A): استراتژی SKU تکراری + دیالوگ نتیجه + پروفایل نگاشت
  const [duplicateStrategy, setDuplicateStrategy] = React.useState<DuplicateStrategy>("skip");
  const [lastImportSummary, setLastImportSummary] = React.useState<ImportSummary | null>(null);
  const [summaryOpen, setSummaryOpen] = React.useState(false);
  const [summaryErrorsExpanded, setSummaryErrorsExpanded] = React.useState(false);

  /* دانلود گزارش کامل خطاها/رد‌شده‌ها به‌صورت CSV */
  const handleDownloadErrorReport = (summary: ImportSummary) => {
    const lines = [
      "ردیف,نوع,دلیل",
      ...summary.errors.map(
        (e) => `${e.row},خطا,"${e.message.replace(/"/g, '""')}"`
      ),
      ...summary.skippedDetails.map(
        (e) => `${e.row},ردشده,"${e.message.replace(/"/g, '""')}"`
      ),
    ];
    const csv = "\uFEFF" + lines.join("\r\n");
    downloadBlob(
      csv,
      "text/csv;charset=utf-8",
      `گزارش_ایمپورت_${summary.entity}_${new Date().toISOString().slice(0, 10)}.csv`
    );
  };

  /* دانلود قالب خالی برای پر کردن — با هدرهای استاندارد هوش */
  const handleDownloadTemplate = () => {
    const fields = ENTITY_META[importEntity].fields.filter((f) => !f.hidden && (f.key !== "items" || importEntity === "invoices"));
    const headers = fields.map((f) => f.aliases[0]); // هدر فارسی اصلی
    const csv = "\uFEFF" + headers.join(",") + "\r\n";
    downloadBlob(csv, "text/csv;charset=utf-8", `قالب_${importEntity}.csv`);
    toast({
      title: "قالب دانلود شد",
      description: "ستون‌ها را همان‌طور که هستند پر کنید — هدرهای فارسی هلو/سپیدار/محک هم خودکار تشخیص داده می‌شوند.",
    });
  };

  /* بارگذاری تاریخچه واقعی از سرور */
  const loadHistory = React.useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await authFetch("/api/import", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json?.success && Array.isArray(json.data)) {
          const mapped: ImportHistoryEntry[] = json.data.map(
            (h: Record<string, unknown>) => {
              const createdRows = Number(h.createdRows ?? 0);
              const updatedRows = Number(h.updatedRows ?? 0);
              return {
                id: String(h.id ?? Math.random()),
                entity: (["products", "customers", "invoices"].includes(String(h.entity))
                  ? h.entity
                  : String(h.entity) === "parties" ? "customers" : "products") as ImportEntity,
                fileName: String(h.fileName ?? ""),
                totalRows: Number(h.totalRows ?? 0),
                createdRows,
                updatedRows,
                skippedRows: Number(h.skippedRows ?? 0),
                successRows: Number(h.successRows ?? createdRows + updatedRows),
                errorRows: Number(h.errorRows ?? 0),
                date: String(h.date ?? new Date().toISOString()),
                status: (h.status ?? "success") as "success" | "partial" | "failed",
              };
            }
          );
          setHistory(mapped);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  /* پردازش فایل انتخاب‌شده — پارس واقعی CSV/TXT/TSV/XLSX/JSON */
  const processFile = async (file: File) => {
    try {
      setImportProgress(0);
      const parsed = await parseFile(file, importEntity);
      if (parsed.rows.length === 0) {
        toast({
          title: "فایل داده‌ای ندارد",
          description: "فایل پارس شد اما هیچ ردیفی پیدا نشد.",
          variant: "destructive",
        });
        return;
      }
      // FIX(21-A): سقف کل ۱۰۰,۰۰۰ ردیف (سرور هر درخواست را ۵۰۰۰تایی می‌پذیرد و
      // کلاینت به چانک‌های ۵۰۰تایی تقسیم می‌کند)
      if (parsed.rows.length > MAX_IMPORT_ROWS) {
        toast({
          title: "فایل خیلی بزرگ است",
          description: `حداکثر ${toPersianDigits(MAX_IMPORT_ROWS)} ردیف مجاز است — این فایل ${toPersianDigits(parsed.rows.length)} ردیف دارد. فایل را بخش‌بندی کنید.`,
          variant: "destructive",
        });
        return;
      }
      const autoMapping = autoDetectMapping(parsed.headers, importEntity);
      // FIX(v2.2): اعمال پروفایل نگاشت ذخیره‌شده — اگر کاربر قبلاً برای این
      // موجودیت نگاشتی ذخیره کرده، ستون‌های هم‌نام با همان نگاشت قبلی تنظیم می‌شوند
      const savedProfile = loadMappingProfiles().find((p) => p.entity === importEntity);
      let effectiveMapping = autoMapping;
      if (savedProfile && Object.keys(savedProfile.mapping).length > 0) {
        const merged: Record<string, string> = {};
        for (const [fieldKey, header] of Object.entries(savedProfile.mapping)) {
          if (parsed.headers.includes(header)) merged[fieldKey] = header;
        }
        // فیلدهایی که پروفایل ندارد → از auto-detect
        for (const [fieldKey, header] of Object.entries(autoMapping)) {
          if (!(fieldKey in merged)) merged[fieldKey] = header;
        }
        effectiveMapping = merged;
      }
      setFileHeaders(parsed.headers);
      setFileRows(parsed.rows);
      setFileName(file.name);
      setFileFormat(parsed.format);
      setFileInfo(parsed.info);
      setMapping(effectiveMapping);
      setPreviewErrors(validateRows(parsed.rows, effectiveMapping, importEntity));
      setPreviewOpen(true);
      setSummaryErrorsExpanded(false);
      const mappedCount = Object.keys(effectiveMapping).length;
      const usedProfile = savedProfile && Object.keys(savedProfile.mapping).length > 0;
      toast({
        title: `فایل ${parsed.format === "csv" ? "CSV/متن" : parsed.format.toUpperCase()} پارس شد`,
        description: mappedCount > 0
          ? `${toPersianDigits(parsed.rows.length)} ردیف — ${toPersianDigits(mappedCount)} ستون نگاشت شد${usedProfile ? " (از پروفایل ذخیره‌شده شما)" : ""}${parsed.info ? ` • ${parsed.info}` : ""}`
          : `${toPersianDigits(parsed.rows.length)} ردیف — ستون‌ها را دستی نگاشت کنید.`,
      });
    } catch (err) {
      toast({
        title: "خطا در خواندن فایل",
        description: err instanceof Error ? err.message : "فایل قابل خواندن نیست.",
        variant: "destructive",
      });
    }
  };

  /* انتخاب فایل از input */
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
    e.target.value = "";
  };

  /* دراپ فایل */
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await processFile(file);
  };

  /* تغییر نگاشت + اعتبارسنجی مجدد */
  const handleMappingChange = (fieldKey: string, header: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (header) next[fieldKey] = header;
      else delete next[fieldKey];
      setPreviewErrors(validateRows(fileRows, next, importEntity));
      return next;
    });
  };

  /* اجرای واقعی واردات — چانک‌های ۵۰۰تایی به POST /api/import
   * FIX(21-A): تجمیع ایجاد/به‌روزرسانی/ردشده/خطا در کل چانک‌ها + شماره
   * ردیف جهانی (offset) + نوار پیشرفت «بخش X از Y — ردیف N تا M از T» */
  const handleConfirmImport = async () => {
    if (fileRows.length === 0) return;
    setImporting(true);
    setImportProgress(0);
    setImportProgressLabel("آماده‌سازی داده‌ها...");

    try {
      const apiRows = buildApiRows(fileRows, mapping, importEntity);
      const chunks: Record<string, unknown>[][] = [];
      for (let i = 0; i < apiRows.length; i += IMPORT_CHUNK_SIZE) {
        chunks.push(apiRows.slice(i, i + IMPORT_CHUNK_SIZE));
      }

      let totalCreated = 0;
      let totalUpdated = 0;
      let totalSkipped = 0;
      const allErrors: { row: number; message: string }[] = [];
      const allSkipped: { row: number; message: string }[] = [];
      let rowOffset = 0;

      for (let c = 0; c < chunks.length; c++) {
        const chunkStart = rowOffset + 1;
        const chunkEnd = rowOffset + chunks[c].length;
        setImportProgressLabel(
          `بخش ${toPersianDigits(c + 1)} از ${toPersianDigits(chunks.length)} — ردیف ${toPersianDigits(chunkStart)} تا ${toPersianDigits(chunkEnd)} از ${toPersianDigits(apiRows.length)}`
        );
        const res = await authFetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityType: apiEntity(importEntity),
            data: chunks[c],
            fileName,
            duplicateStrategy,
          }),
        });
        const data = await res.json().catch(() => ({} as {
          success?: boolean;
          created?: number;
          updated?: number;
          skipped?: number;
          errors?: { row: number; message: string }[];
          skippedRows?: { row: number; message: string }[];
          error?: string;
        }));
        if (!res.ok || !data.success) {
          throw new Error(data?.error || "خطای سرور در وارد کردن داده‌ها");
        }
        totalCreated += data.created ?? 0;
        totalUpdated += data.updated ?? 0;
        totalSkipped += data.skipped ?? 0;
        for (const err of data.errors ?? []) {
          allErrors.push({ row: err.row + rowOffset, message: err.message });
        }
        for (const sk of data.skippedRows ?? []) {
          allSkipped.push({ row: sk.row + rowOffset, message: sk.message });
        }
        rowOffset += chunks[c].length;
        setImportProgress(Math.round(((c + 1) / chunks.length) * 100));
      }

      setImporting(false);
      setImportProgress(0);
      setPreviewOpen(false);

      // FIX(v2.2): ذخیره پروفایل نگاشت برای دفعه‌ی بعد — نگاشت فعلی کاربر
      // (چه خودکار چه اصلاح‌شده) ذخیره می‌شود
      if (Object.keys(mapping).length > 0) {
        saveMappingProfile({
          entity: importEntity,
          mapping,
          savedAt: Date.now(),
          fileFormat,
        });
      }

      // FIX(21-A): دیالوگ نتیجه‌ی کامل — جمع‌بندی صریح بدون ردیف گم‌شده
      const totalFailed = allErrors.length;
      const summary: ImportSummary = {
        entity: importEntity,
        fileName,
        totalRows: fileRows.length,
        rowsParsed: apiRows.length,
        created: totalCreated,
        updated: totalUpdated,
        skipped: totalSkipped,
        failed: totalFailed,
        errors: allErrors,
        skippedDetails: allSkipped,
        finishedAt: new Date().toISOString(),
        duplicateStrategy,
      };
      setLastImportSummary(summary);
      setSummaryOpen(true);

      const accounted = totalCreated + totalUpdated + totalSkipped + totalFailed;
      if (accounted !== summary.rowsParsed) {
        // محافظ حسابداری — نباید هرگز رخ دهد؛ اگر شد کاربر شفاف ببیند
        toast({
          title: "هشدار شمارش ردیف‌ها",
          description: `جمع وضعیت‌ها (${toPersianDigits(accounted)}) با ردیف‌های ارسال‌شده (${toPersianDigits(summary.rowsParsed)}) برابر نیست — گزارش خطاها را بررسی کنید.`,
          variant: "destructive",
        });
      } else if (totalCreated === 0 && totalUpdated === 0) {
        toast({
          title: "هیچ ردیفی وارد نشد",
          description: allErrors[0]?.message ?? allSkipped[0]?.message ?? "همه ردیف‌ها خطا داشتند — نگاشت ستون‌ها را بررسی کنید.",
          variant: "destructive",
        });
      } else if (totalFailed > 0) {
        toast({
          title: "واردات ناقص انجام شد",
          description: `${toPersianDigits(totalCreated + totalUpdated)} ردیف ذخیره شد، ${toPersianDigits(totalFailed)} خطا، ${toPersianDigits(totalSkipped)} رد شده. اولین خطا: ${allErrors[0]?.message ?? ""}`,
        });
      } else {
        toast({
          title: "واردات با موفقیت انجام شد",
          description: `${toPersianDigits(totalCreated)} ایجاد، ${toPersianDigits(totalUpdated)} به‌روزرسانی، ${toPersianDigits(totalSkipped)} ردشده — همهٔ ${toPersianDigits(apiRows.length)} ردیف حساب شدند.`,
        });
      }

      // پاک‌سازی حالت
      setFileHeaders([]);
      setFileRows([]);
      setMapping({});
      setFileName("");
      setFileInfo("");
      setPreviewErrors([]);
      // تاریخچه را تازه کن
      void loadHistory();
    } catch (err) {
      setImporting(false);
      setImportProgress(0);
      toast({
        title: "خطا در واردات",
        description: err instanceof Error ? err.message : "ارتباط با سرور برقرار نشد.",
        variant: "destructive",
      });
    }
  };

  /* صادرکردن داده‌های واقعی از پایگاه داده (فاکتور/محصول/طرف‌حساب) */
  const handleExport = async () => {
    const entityLabel = ENTITY_META[exportEntity].label;
    setExporting(true);
    try {
      const rows = await fetchExportRows(exportEntity);
      if (rows.length === 0) {
        toast({
          title: "داده‌ای برای صادرکردن وجود ندارد",
          description: `هیچ ${entityLabel}ی در سیستم ثبت نشده است.`,
          variant: "destructive",
        });
        return;
      }
      if (exportFormat === "json") {
        downloadBlob(
          JSON.stringify(rows, null, 2),
          "application/json",
          `هوش_${entityLabel}_${new Date().toISOString().slice(0, 10)}.json`
        );
      } else {
        const delimiter = exportFormat === "csv-excel" ? ";" : ",";
        downloadBlob(
          rowsToCsv(rows, delimiter),
          "text/csv;charset=utf-8",
          `هوش_${entityLabel}_${new Date().toISOString().slice(0, 10)}.csv`
        );
      }
      toast({
        title: "خروجی آماده شد",
        description: `${toPersianDigits(rows.length)} رکورد واقعی از پایگاه داده صادر شد.`,
      });
    } catch {
      toast({
        title: "خطا در صادرکردن",
        description: "دریافت داده از سرور ناموفی بود. دوباره تلاش کنید.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const statusIcon = (status: ImportHistoryEntry["status"]) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
      case "partial":
        return <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />;
      case "failed":
        return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    }
  };

  const entityLabel = (e: string) =>
    ENTITY_META[(["products", "customers", "invoices"].includes(e) ? e : "products") as ImportEntity].label;

  return (
    <div className="space-y-6" dir="rtl">
      <Tabs defaultValue="import" className="w-full">
        <TabsList className="w-full max-w-md">
          <TabsTrigger value="import" className="gap-1.5">
            <Upload className="h-3.5 w-3.5" />
            واردات داده
          </TabsTrigger>
          <TabsTrigger value="export" className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            صادرکرد داده
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            تاریخچه
          </TabsTrigger>
        </TabsList>

        {/* ========= تب واردات — ایمپورت واقعی ========= */}
        <TabsContent value="import" className="space-y-4 mt-4">
          {/* FIX(v2.2): کارت‌های آماری ایمپورت — خلاصه‌ی وضعیت */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: "کل واردات‌ها",
                value: history.length,
                icon: Upload,
                color: "text-primary",
                bg: "bg-primary/10",
              },
              {
                label: "ردیف‌های ذخیره‌شده",
                value: history.reduce((s, h) => s + h.successRows, 0),
                icon: CheckCircle2,
                color: "text-emerald-600 dark:text-emerald-400",
                bg: "bg-emerald-500/10",
              },
              {
                label: "ردیف‌های خطادار",
                value: history.reduce((s, h) => s + h.errorRows, 0),
                icon: AlertTriangle,
                color: "text-amber-600 dark:text-amber-400",
                bg: "bg-amber-500/10",
              },
              {
                label: "آخرین واردات",
                value: history[0]
                  ? (() => {
                      try {
                        return toJalali(new Date(history[0].date));
                      } catch {
                        return "—";
                      }
                    })()
                  : "—",
                icon: Clock,
                color: "text-muted-foreground",
                bg: "bg-muted",
                isText: true,
              },
            ].map((stat, i) => (
              <div
                key={i}
                className="rounded-xl border bg-card p-3 flex items-center gap-3 transition-shadow hover:shadow-sm"
              >
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", stat.bg)}>
                  <stat.icon className={cn("h-4 w-4", stat.color)} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground truncate">{stat.label}</p>
                  <p className={cn("text-sm font-bold truncate", stat.isText ? "text-foreground text-xs" : "text-foreground")}>
                    {stat.isText ? String(stat.value) : toPersianDigits(Number(stat.value))}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-5 w-5 text-primary" />
                واردات داده از فایل
                <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700 hover:bg-emerald-100 text-[10px]">
                  ذخیره‌سازی واقعی
                </Badge>
              </CardTitle>
              <CardDescription>
                فایل CSV، متن (TXT/TSV) یا Excel (XLSX/XLS) یا JSON را وارد کنید.
                هدرهای فارسی خروجی نرم‌افزارهای هلو، سپیدار و محک — حتی با انکودینگ
                Windows-1256 و قیمت‌های شکسته — خودکار تشخیص و اصلاح می‌شوند و
                داده‌ها مستقیم در پایگاه داده ذخیره می‌شوند.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Select value={importEntity} onValueChange={(v) => setImportEntity(v as ImportEntity)}>
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder="نوع داده" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ENTITY_META).map(([key, meta]) => {
                      const Icon = meta.icon;
                      return (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5" />
                            {meta.label}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  onClick={handleDownloadTemplate}
                  className="gap-2"
                >
                  <ArrowDownToLine className="h-4 w-4" />
                  دانلود قالب {ENTITY_META[importEntity].label}
                </Button>
              </div>

              {/* ناحیه آپلود — با دراپ واقعی — v2.2 استایل حرفه‌ای‌تر */}
              <div
                className={cn(
                  "group relative border-2 border-dashed rounded-2xl px-6 py-10 text-center transition-all duration-300 cursor-pointer overflow-hidden",
                  dragActive
                    ? "border-primary bg-primary/10 scale-[1.01] shadow-lg shadow-primary/10"
                    : "border-border hover:border-primary/60 hover:bg-primary/[0.03] hover:shadow-md"
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
                }}
                aria-label="آپلود فایل برای واردات"
              >
                {/* هاله‌ی گرادیانی پس‌زمینه — هنگام hover نمایان می‌شود */}
                <div
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-amber-500/10 transition-opacity duration-500",
                    dragActive ? "opacity-100" : "opacity-0 group-hover:opacity-60"
                  )}
                />
                {/* آیکن آپلود با دایره‌ی گرادیانی */}
                <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center">
                  <div
                    className={cn(
                      "absolute inset-0 rounded-2xl bg-gradient-to-br transition-transform duration-300",
                      dragActive
                        ? "from-primary/30 to-amber-500/30 scale-110 rotate-3"
                        : "from-primary/15 to-amber-500/15 group-hover:scale-105 group-hover:-rotate-3"
                    )}
                  />
                  <Upload
                    className={cn(
                      "relative h-7 w-7 transition-all duration-300",
                      dragActive
                        ? "text-primary scale-110 -translate-y-1"
                        : "text-primary/80 group-hover:text-primary group-hover:-translate-y-0.5"
                    )}
                  />
                  {dragActive && (
                    <span className="absolute -top-1 -left-1 flex h-4 w-4">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                      <span className="relative inline-flex h-4 w-4 rounded-full bg-primary" />
                    </span>
                  )}
                </div>
                <p className="relative text-sm font-semibold text-foreground">
                  {dragActive ? "فایل را همین‌جا رها کنید" : "فایل خود را اینجا رها کنید یا کلیک کنید"}
                </p>
                <p className="relative text-xs text-muted-foreground mt-1.5">
                  فرمت‌های پشتیبانی‌شده — حداکثر {toPersianDigits(MAX_IMPORT_ROWS)} ردیف:
                </p>
                {/* بَج‌های فرمت با آیکن */}
                <div className="relative mt-3 flex flex-wrap items-center justify-center gap-2">
                  {[
                    { label: "CSV", icon: FileText },
                    { label: "TXT", icon: FileText },
                    { label: "TSV", icon: FileText },
                    { label: "XLSX", icon: FileSpreadsheet },
                    { label: "XLS", icon: FileSpreadsheet },
                    { label: "JSON", icon: FileJson },
                  ].map(({ label, icon: Icon }) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1 rounded-full border bg-background/80 px-2.5 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur transition-colors group-hover:text-foreground"
                    >
                      <Icon className="h-3 w-3" />
                      {label}
                    </span>
                  ))}
                </div>
                {/* نکته‌ی نرم‌افزارهای ایرانی */}
                <div className="relative mt-4 inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-[11px] text-primary/90 dark:text-primary/80">
                  <Table2 className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    خروجی هلو/سپیدار/محک: از منوی گزارشات، خروجی CSV/Excel بگیرید و همین‌جا وارد کنید — انکودینگ Windows-1256 و قیمت‌های شکسته خودکار اصلاح می‌شوند
                  </span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.tsv,.xlsx,.xls,.json,text/csv,text/plain,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>

              {importing && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{importProgressLabel}</span>
                    <span className="font-medium">{toPersianDigits(importProgress)}٪</span>
                  </div>
                  <Progress value={importProgress} className="h-2" />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========= تب صادرکرد — داده واقعی ========= */}
        <TabsContent value="export" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Download className="h-5 w-5 text-primary" />
                صادرکرد داده
                <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700 hover:bg-emerald-100 text-[10px]">
                  داده واقعی
                </Badge>
              </CardTitle>
              <CardDescription>
                داده‌های واقعی ثبت‌شده در سیستم شما (فاکتور، محصول، طرف‌حساب) را در فرمت دلخواه صادر کنید. فایل‌های CSV با UTF-8 BOM تولید می‌شوند تا فارسی در اکسل درست نمایش داده شود.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Select value={exportEntity} onValueChange={(v) => setExportEntity(v as ImportEntity)}>
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder="نوع داده" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ENTITY_META).map(([key, meta]) => {
                      const Icon = meta.icon;
                      return (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5" />
                            {meta.label}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Select value={exportFormat} onValueChange={(v) => setExportFormat(v as ExportFormat)}>
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue placeholder="فرمت خروجی" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FORMAT_META).map(([key, meta]) => {
                      const Icon = meta.icon;
                      return (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5" />
                            {meta.label}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Button onClick={() => void handleExport()} disabled={exporting} className="gap-2">
                  {exporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {exporting ? "در حال دریافت داده..." : "صادرکرد"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========= تب تاریخچه — واقعی از AuditLog ========= */}
        <TabsContent value="history" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                تاریخچه واردات
                <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700 hover:bg-emerald-100 text-[10px]">
                  داده واقعی
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void loadHistory()}
                  disabled={historyLoading}
                  className="mr-auto gap-1"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", historyLoading && "animate-spin")} />
                  به‌روزرسانی
                </Button>
              </CardTitle>
              <CardDescription>
                لیست واردات‌های قبلی و وضعیت آن‌ها — مستقیم از لاگ ممیزی سیستم.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {history.length === 0 && !historyLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">هنوز وارداتی ثبت نشده است.</p>
                  <p className="text-xs mt-1">از تب «واردات داده» اولین فایل خود را وارد کنید.</p>
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">وضعیت</TableHead>
                        <TableHead className="text-xs">نوع</TableHead>
                        <TableHead className="text-xs">نام فایل</TableHead>
                        <TableHead className="text-xs text-center">کل</TableHead>
                        <TableHead className="text-xs text-center">ایجاد</TableHead>
                        <TableHead className="text-xs text-center">به‌روزرسانی</TableHead>
                        <TableHead className="text-xs text-center">ردشده</TableHead>
                        <TableHead className="text-xs text-center">خطا</TableHead>
                        <TableHead className="text-xs">تاریخ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell>{statusIcon(h.status)}</TableCell>
                          <TableCell className="text-xs">{entityLabel(h.entity)}</TableCell>
                          <TableCell className="text-xs font-medium max-w-[140px] truncate">
                            {h.fileName || "—"}
                          </TableCell>
                          <TableCell className="text-xs text-center">{toPersianDigits(h.totalRows)}</TableCell>
                          <TableCell className="text-xs text-center text-emerald-600">{toPersianDigits(h.createdRows)}</TableCell>
                          <TableCell className="text-xs text-center text-sky-600 dark:text-sky-400">{toPersianDigits(h.updatedRows)}</TableCell>
                          <TableCell className="text-xs text-center text-amber-600 dark:text-amber-400">{toPersianDigits(h.skippedRows)}</TableCell>
                          <TableCell className="text-xs text-center text-destructive">{toPersianDigits(h.errorRows)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {(() => {
                              try {
                                return toJalali(new Date(h.date));
                              } catch {
                                return h.date?.slice(0, 10) ?? "—";
                              }
                            })()}
                          </TableCell>
                        </TableRow>
                      ))}
                      {historyLoading && (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center">
                            <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* دیالوگ پیش‌نمایش واردات */}
      <Dialog open={previewOpen} onOpenChange={(open) => !importing && setPreviewOpen(open)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              پیش‌نمایش واردات {ENTITY_META[importEntity].label}
            </DialogTitle>
            <DialogDescription>
              داده‌های فایل را بررسی و نگاشت ستون‌ها را تنظیم کنید. بعد از تأیید،
              داده‌ها به‌صورت واقعی در پایگاه داده ذخیره می‌شوند.
            </DialogDescription>
          </DialogHeader>
          <ImportPreview
            entity={importEntity}
            headers={fileHeaders}
            rows={fileRows}
            mapping={mapping}
            onMappingChange={handleMappingChange}
            duplicateStrategy={duplicateStrategy}
            onDuplicateStrategyChange={setDuplicateStrategy}
            errors={previewErrors}
            importing={importing}
            progress={importProgress}
            progressLabel={importProgressLabel}
            onConfirm={() => void handleConfirmImport()}
            onCancel={() => setPreviewOpen(false)}
            fileName={fileName}
            fileFormat={fileFormat}
            fileInfo={fileInfo}
          />
        </DialogContent>
      </Dialog>

      {/* FIX(21-A): دیالوگ نتیجه‌ی ایمپورت — جمع‌بندی کامل بدون ردیف گم‌شده */}
      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" dir="rtl">
          {lastImportSummary && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {lastImportSummary.created + lastImportSummary.updated === 0 ? (
                    <XCircle className="h-5 w-5 text-destructive" />
                  ) : lastImportSummary.failed > 0 ? (
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  )}
                  نتیجه‌ی واردات {ENTITY_META[lastImportSummary.entity]?.label ?? ""}
                </DialogTitle>
                <DialogDescription>
                  فایل «{lastImportSummary.fileName.slice(0, 40) || "بدون نام"}» —{" "}
                  {toJalali(new Date(lastImportSummary.finishedAt))}
                  {lastImportSummary.duplicateStrategy === "update" && " • استراتژی: به‌روزرسانی تکراری‌ها"}
                </DialogDescription>
              </DialogHeader>

              {/* آمار کامل: هر ردیف دقیقاً در یکی از این چهار وضعیت است */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="rounded-xl border bg-muted/40 p-3 text-center">
                  <p className="text-[10px] text-muted-foreground">کل ردیف‌های فایل</p>
                  <p className="text-lg font-bold text-foreground mt-0.5">
                    {toPersianDigits(lastImportSummary.totalRows)}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/40 p-3 text-center">
                  <p className="text-[10px] text-muted-foreground">ردیف‌های پارس‌شده</p>
                  <p className="text-lg font-bold text-foreground mt-0.5">
                    {toPersianDigits(lastImportSummary.rowsParsed)}
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/30 p-3 text-center">
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-300">ایجادشده</p>
                  <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">
                    {toPersianDigits(lastImportSummary.created)}
                  </p>
                </div>
                <div className="rounded-xl border border-sky-200 bg-sky-50/60 dark:border-sky-900/60 dark:bg-sky-950/30 p-3 text-center">
                  <p className="text-[10px] text-sky-700 dark:text-sky-300">به‌روزرسانی‌شده</p>
                  <p className="text-lg font-bold text-sky-700 dark:text-sky-300 mt-0.5">
                    {toPersianDigits(lastImportSummary.updated)}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/30 p-3 text-center">
                  <p className="text-[10px] text-amber-700 dark:text-amber-300">ردشده (تکراری)</p>
                  <p className="text-lg font-bold text-amber-700 dark:text-amber-300 mt-0.5">
                    {toPersianDigits(lastImportSummary.skipped)}
                  </p>
                </div>
                <div
                  className={cn(
                    "rounded-xl border p-3 text-center",
                    lastImportSummary.failed > 0
                      ? "border-destructive/30 bg-destructive/5"
                      : "border-border bg-muted/40"
                  )}
                >
                  <p className="text-[10px] text-muted-foreground">خطا</p>
                  <p
                    className={cn(
                      "text-lg font-bold mt-0.5",
                      lastImportSummary.failed > 0 ? "text-destructive" : "text-foreground"
                    )}
                  >
                    {toPersianDigits(lastImportSummary.failed)}
                  </p>
                </div>
              </div>

              {/* راستی‌آزمایی حسابداری: هیچ کالایی کم یا ناقص نباشد */}
              {lastImportSummary.rowsParsed > 0 && (() => {
                const accounted =
                  lastImportSummary.created +
                  lastImportSummary.updated +
                  lastImportSummary.skipped +
                  lastImportSummary.failed;
                const ok = accounted === lastImportSummary.rowsParsed;
                return (
                  <div
                    className={cn(
                      "rounded-lg border p-2.5 text-[11px] flex items-center gap-2",
                      ok
                        ? "border-emerald-300/60 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300"
                        : "border-destructive/40 bg-destructive/5 text-destructive"
                    )}
                  >
                    {ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>
                      ایجاد {toPersianDigits(lastImportSummary.created)} + به‌روزرسانی{" "}
                      {toPersianDigits(lastImportSummary.updated)} + ردشده{" "}
                      {toPersianDigits(lastImportSummary.skipped)} + خطا{" "}
                      {toPersianDigits(lastImportSummary.failed)} ={" "}
                      {toPersianDigits(accounted)} از {toPersianDigits(lastImportSummary.rowsParsed)} ردیف پارس‌شده
                      {ok ? " — هیچ ردیفی گم نشده ✓" : " — مغایرت! گزارش خطاها را بررسی کنید"}
                    </span>
                  </div>
                );
              })()}

              {/* نوار موفقیت */}
              {lastImportSummary.rowsParsed > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>نرخ موفقیت (ایجاد + به‌روزرسانی)</span>
                    <span className="font-medium">
                      {toPersianDigits(
                        Math.round(
                          ((lastImportSummary.created + lastImportSummary.updated) /
                            lastImportSummary.rowsParsed) *
                            100
                        )
                      )}
                      ٪
                    </span>
                  </div>
                  <Progress
                    value={
                      ((lastImportSummary.created + lastImportSummary.updated) /
                        lastImportSummary.rowsParsed) *
                      100
                    }
                    className="h-2"
                  />
                </div>
              )}

              {/* لیست خطاها/ردشده‌ها — بازشو، ۱۰۰ مورد اول */}
              {(lastImportSummary.errors.length > 0 || lastImportSummary.skippedDetails.length > 0) && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between text-xs font-medium text-destructive"
                    onClick={() => setSummaryErrorsExpanded((v) => !v)}
                  >
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      ردیف‌های ناموفق ({toPersianDigits(lastImportSummary.failed)} خطا،{" "}
                      {toPersianDigits(lastImportSummary.skipped)} ردشده)
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {summaryErrorsExpanded ? "بستن ▲" : "نمایش ▼"}
                    </span>
                  </button>
                  {summaryErrorsExpanded && (
                    <ScrollArea className="max-h-40">
                      {lastImportSummary.errors.slice(0, 100).map((e, i) => (
                        <p key={`e-${i}`} className="text-[11px] text-destructive/80">
                          ردیف {toPersianDigits(e.row)} (خطا): {e.message}
                        </p>
                      ))}
                      {lastImportSummary.skippedDetails.slice(0, 100).map((e, i) => (
                        <p key={`s-${i}`} className="text-[11px] text-amber-700 dark:text-amber-400">
                          ردیف {toPersianDigits(e.row)} (ردشده): {e.message}
                        </p>
                      ))}
                      {lastImportSummary.errors.length + lastImportSummary.skippedDetails.length > 100 && (
                        <p className="text-[11px] text-muted-foreground">
                          و {toPersianDigits(
                            lastImportSummary.errors.length +
                              lastImportSummary.skippedDetails.length -
                              100
                          )}{" "}
                          مورد دیگر — برای مشاهدهٔ کامل، گزارش CSV را دانلود کنید.
                        </p>
                      )}
                    </ScrollArea>
                  )}
                </div>
              )}

              <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
                {(lastImportSummary.errors.length > 0 || lastImportSummary.skippedDetails.length > 0) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownloadErrorReport(lastImportSummary)}
                    className="gap-1.5 w-full sm:w-auto sm:ml-auto"
                  >
                    <Download className="h-3.5 w-3.5" />
                    دانلود گزارش خطاها (CSV)
                  </Button>
                )}
                <Button size="sm" onClick={() => setSummaryOpen(false)} className="w-full sm:w-auto">
                  متوجه شدم
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
