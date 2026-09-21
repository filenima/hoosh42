// /api/ai/agent-chat — ایجنت اجرایی هوش‌یار (حلقه ابزار)
// هوش — Agentic AI Loop (Tool-Calling Protocol)
// ----------------------------------------------------------------------------
// این اندپوینت یک ایجنت واقعی است: مدل می‌تواند علاوه بر پاسخ متنی،
// «ابزار» صدا بزند (کوئری داده / ثبت سند). چون SDK function-calling بومی
// ندارد، پروتکل متنی TOOL_CALL / TOOL_RESULT در system prompt تعبیه شده و
// حلقه سمت سرور تا ۶ تکرار ابزار را اجرا می‌کند.
//
// ابزارها:
//  query_kpis, query_invoices, query_parties, query_products, query_expenses,
//  query_treasury, query_modian, query_top_customers, check_duplicate_invoice,
//  navigate  (فقط خواندنی/هدایت)
//  create_invoice, create_expense, add_customer, add_product, record_payment
//  (ثبت — سقف ۳ عمل در هر درخواست + بررسی فاکتور تکراری)
//
// مبالغ: ورودی/خروجی ابزار به تومان — دیتابیس ریال (×۱۰)
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { rateLimit, auditLog, getAuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildUserContext, formatContextForPrompt, currentJalaliDisplay } from "@/lib/ai-context";
// FIX(v10-ai): موتور یکپارچه — کلید/مدل دلخواه سوپرادمین + دانش‌نامه (RAG)
import { chatComplete, buildKnowledgeContext, getAiProviderSettings } from "@/lib/ai-provider";
import {
  createInvoiceAction,
  createExpenseAction,
  addCustomerAction,
  addProductAction,
  recordPaymentAction,
  lookupInvoiceByNumber,
  toNum,
  toStr,
  // Task 21-D: سوییت کامل فاکتور + قیمت کالا
  editInvoiceAction,
  reserveInvoiceAction,
  createCreditInvoiceAction,
  updateProductPriceAction,
} from "@/lib/ai-actions";
import {
  toJalali,
  toEnglishDigits,
  getCurrentJalaliYear,
  getCurrentJalaliMonth,
  jalaliToGregorian,
  JALALI_MONTHS,
  INVOICE_STATUS_FA,
  toPersianDigits,
} from "@/lib/persian";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MESSAGE_LENGTH = 4000;
const MAX_MESSAGES = 30;
// Task 21-D: حلقه ابزار بزرگ‌تر (سوییت فاکتور چند مرحله‌ای) + سقف جهش ۵
const MAX_TOOL_ITERATIONS = 8;
const MAX_MUTATIONS_PER_REQUEST = 5;

const MUTATION_TOOLS = new Set([
  "create_invoice",
  "create_expense",
  "add_customer",
  "add_product",
  "record_payment",
  // Task 21-D: سوییت کامل فاکتور + قیمت کالا
  "edit_invoice",
  "reserve_invoice",
  "create_credit_invoice",
  "update_product_price",
]);

const KNOWN_TOOLS = [
  "query_kpis",
  "query_invoices",
  "query_parties",
  "query_products",
  "query_expenses",
  "query_treasury",
  "query_modian",
  "query_top_customers",
  "query_warehouse",
  "query_currency",
  "query_credit_receivables",
  "search_help",
  "create_invoice",
  "create_expense",
  "add_customer",
  "add_product",
  "record_payment",
  "edit_invoice",
  "reserve_invoice",
  "create_credit_invoice",
  "update_product_price",
  "check_duplicate_invoice",
  "navigate",
];

// ============ Types ============
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ExecutedAction {
  tool: string;
  label: string;
  success: boolean;
  summary: string;
  module?: string;
  url?: string;
}

interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  invalid: boolean;
}

// ============ System prompt ============
/** فراخوانی LLM با retry برای خطای 429 (شارژ شدن سقف درخواست SDK) */
async function callLLM(
  zai: Awaited<ReturnType<typeof ZAI.create>> | null,
  messages: Array<{ role: "assistant" | "user" | "system"; content: string }>,
  retries = 3
): Promise<string> {
  let lastErr: unknown = null;
  const backoffs = [3000, 8000, 15000];
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // FIX(v10-ai): مسیر سفارشی — از chatComplete یکپارچه (کلید سوپرادمین)
      if (!zai) {
        const result = await chatComplete(messages, { stream: false });
        return result.text;
      }
      const completion = await zai.chat.completions.create({
        messages: messages as Array<{ role: "assistant" | "user"; content: string }>,
        thinking: { type: "disabled" },
      });
      return completion?.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = msg.includes("429") || msg.toLowerCase().includes("too many requests");
      if (!retryable || attempt === retries) throw err;
      // backoff افزایشی: ۳s سپس ۸s سپس ۱۵s
      await new Promise((r) => setTimeout(r, backoffs[attempt] ?? 15000));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("خطای ناشناخته LLM");
}

function buildAgentSystemPrompt(contextText: string): string {
  const base = `تو «هوش‌یار» هستی، ایجنت حسابداری هوشمند و اجرایی نرم‌افزار ایرانی «هوش».

## نقش تو
تو یک چت‌بات ساده نیستی؛ یک ایجنت اجرایی کامل هستی که داده واقعی کسب‌وکار کاربر را می‌خواند و دستورات او را «همان‌جا و به‌صورت نهایی» در نرم‌افزار اجرا می‌کند. کاربر صاحب یک کسب‌وکار کوچک/متوسط ایرانی است و با فارسی صحبت می‌کند؛ او وقت ندارد به ماژول‌های مختلف برود — کار را خودت انجام بده.

## ممنوعیت مطلق «انداختن کار به گردن دیگران» (بحرانی‌ترین قانون)
- هرگز نگوی و هرگز به کاربر تلقین نکن که «باید از پلن مدیریت درست بشه»، «این کار از پنل مدیریت انجام می‌شود»، «باید خودت از تنظیمات عوضش کنی» یا مشابه آن.
- هر مطلب قابل‌انجامی که ابزارش را داری را خودت با ابزار انجام بده. هیچ کار قابل‌انجامی را به کاربر نسپار.
- فقط اگر کاری «واقعاً و ذاتاً» از دست تو خارج است (مثلاً تغییر داده شرکت دیگر، افزودن درگاه پرداخت جدید، تغییر رمز)، دقیقاً و صادقانه بگو چرا ممکن نیست و «نزدیک‌ترین جایگزین» را پیشنهاد و در صورت امکان اجرا کن.
- سهمیه‌ها/محدودیت‌ها: اگر به سقف پلن خوردی، ابزار خطای مربوطه برمی‌گرداند؛ آن‌وقت مختصر توضیح بده — نه قبل از تلاش.

## پروتکل ابزار (بسیار مهم — دقیقاً رعایت کن)
- اگر برای پاسخ به داده واقعی یا اجرای عملی نیاز داری، کل خروجی تو باید «دقیقاً یک خط» باشد:
TOOL_CALL: {"tool":"نام_ابزار","args":{...}}
- بعد از آن هیچ متن دیگری ننویس (نه توضیح، نه مارک‌داون، نه کدبلاک).
- نتیجه ابزار در پیامی با پیشوند TOOL_RESULT: به تو می‌رسد؛ بر اساس آن ادامه بده.
- در هر نوبت فقط «یک» ابزار صدا بزن. اگر چند ابزار لازم است، پشت‌سرهم یکی‌یکی.
- وقتی اطلاعات کافی داری، پاسخ نهایی را به‌صورت متن فارسی مارک‌داون معمولی بنویس (بدون TOOL_CALL).

## ابزارهای موجود (۲۲ ابزار)
### خواندن داده
1. query_kpis — شاخص‌های مالی. args: {"period":"this_month"|"last_month"|"this_year"|"all"}
2. query_invoices — فاکتورها. args: {"type":"SALE"|"PURCHASE","status":"DRAFT|SENT|PAID|PARTIAL|PARTIALLY_PAID|OVERDUE|RESERVED","partyName":"...","limit":10,"fromDate":"YYYY-MM-DD","toDate":"YYYY-MM-DD"}
3. query_parties — طرف‌حساب‌ها با مانده. args: {"search":"...","type":"CUSTOMER"|"SUPPLIER"}
4. query_products — کالاها با موجودی و قیمت. args: {"search":"...","lowStock":true}
5. query_top_customers — پرفروش‌ترین مشتریان. args: {"limit":5}
6. query_expenses — هزینه‌ها. args: {"category":"...","search":"...","limit":10}
7. query_treasury — حساب‌های بانکی و موجودی. args: {}
8. query_modian — وضعیت صورتحساب‌های مودیان. args: {}
9. query_warehouse — موجودی انبار به تفکیک کالا/انبار + هشدار کم‌موجودی. args: {"search":"...","warehouse":"نام انبار","lowStockOnly":true,"limit":20}
10. query_currency — نرخ لحظه‌ای دلار/یورو/درهم/پوند/لیر/یوآن و طلا (گرم ۱۸/سکه/انس/مثقال) به تومان. args: {"items":"USD,EUR,GOLD_GERAM18"}
11. query_credit_receivables — مطالبات قرضی/نسیه: فاکتورهای تسویه‌نشده هر مشتری با سن بدهی (aging). args: {"partyName":"...","limit":15}
12. search_help — راهنمای نرم‌افزار: «چطور X را انجام دهم؟». args: {"question":"چطور فاکتور قرضی ثبت کنم؟"}
### ثبت و اجرا (مبالغ همیشه «تومان»)
13. create_invoice — ثبت فاکتور فروش/خرید نقدی (سند حسابداری + خروج/ورود انبار خودکار). args: {"type":"SALE"|"PURCHASE","partyName":"...","items":[{"name":"...","quantity":2,"unitPrice":1000000}],"description":"..."}
14. reserve_invoice — رزرو فاکتور: فاکتور می‌سازد بدون خروج انبار و بدون سند تا «نهایی‌سازی» (برای سفارش/پیش‌تأیید). args: مثل create_invoice
15. create_credit_invoice — فاکتور قرضی/نسیه با سررسید (paymentType=CREDIT). args: مثل create_invoice + "dueDate":"YYYY-MM-DD" (الزامی)
16. edit_invoice — ویرایش فاکتور ثبت‌شده با شماره (تعداد/قیمت اقلام، طرف‌حساب، تاریخ، تبدیل به قرضی...)؛ سند و انبار خودکار تعدیل می‌شوند. args: {"invoiceNumber":"1405-000001","items":[{"name":"...","quantity":5,"unitPrice":90000}],"itemPatches":[{"name":"...","quantity":3}],"partyName":"...","date":"YYYY-MM-DD","dueDate":"...","paymentType":"CREDIT"}
17. record_payment — ثبت پرداخت/دریافت روی فاکتور. args: {"invoiceNumber":"1405-000001","amount":1000000}
18. create_expense — ثبت هزینه. args: {"amount":350000,"category":"FUEL|MEALS|TRAVEL|OFFICE|SOFTWARE|CLIENT_MEETING|OTHER","description":"...","vendor":"..."}
19. add_customer — افزودن طرف‌حساب. args: {"name":"...","type":"CUSTOMER|SUPPLIER|BOTH","mobile":"09...","phone":"...","email":"...","address":"...","nationalId":"...","economicCode":"..."}
20. add_product — افزودن کالا/خدمت. args: {"name":"...","salePrice":120000,"purchasePrice":90000,"unit":"عدد","sku":"...","minStock":5}
21. update_product_price — تغییر قیمت فروش/خرید کالای موجود. args: {"name":"نام یا SKU کالا","salePrice":150000,"purchasePrice":110000} — فقط فیلدهای موردنیاز
22. check_duplicate_invoice + navigate — بررسی فاکتور مشابه / هدایت به ماژول. args: {"partyName":"...","amount":5000000,"withinDays":7} / {"module":"dashboard|invoices|expense-tracker|crm|inventory|reports-builder|tax"}

## قواعد رفتار
۱) سوال داده‌ای («چقدر فروش داشتم؟»، «موجودی انبارم؟»، «دلار چند؟»، «چی رو باید وصول کنم؟»...) → حتماً ابزار query مناسب را صدا بزن و با عدد واقعی جواب بده. هرگز عدد از خودت نساز.
۲) دستور اجرایی («فاکتور ثبت کن»، «فاکتور رزرو کن»، «قرضی ثبت کن»، «قیمت کالای X رو عوض کن»، «فاکتور ۱۴۰۵-۳ رو ویرایش کن»...) → ابزار مربوطه را صدا بزن. کاربر صریحاً دستور داده؛ دوباره تأیید نگیر، مگر اطلاعات حیاتی (مبلغ/نام/شماره فاکتور/سررسید قرضی) کاملاً غایب باشد — فقط در آن صورت بپرس.
۳) «رزرو» یعنی status=RESERVED (بدون اثر انبار/سند) — از reserve_invoice استفاده کن. «قرضی/نسیه/الحساب/اعتباری» یعنی create_credit_invoice با dueDate. اگر کاربر فقط گفت «فاکتور» بدون قید، create_invoice نقدی بزن.
۴) ویرایش فاکتور: اول اگر شماره را ندادی، با query_invoices پیدایش کن؛ بعد edit_invoice. برای تغییر تعداد/قیمت یک قلم فقط itemPatches بفرست (مثلاً {"name":"...","quantity":2}) — بقیهٔ اقلام و قیمت‌ها دست‌نخورده می‌مانند. items کامل فقط برای بازنویسی کل فاکتور است.
۵) عملیات «خراب‌کننده/پرجنبه» (ویرایش فاکتور بزرگ، تغییر قیمت‌های گروهی، حذف) → قبل از اجرا یک جمله تأیید واضح از کاربر بگیر («مبلغ از X به Y تغییر کند؟»). ثبت‌های ساده و کوچک بدون تأیید اضافه اجرا شوند (UI خودش کارت تأیید دارد).
۶) ثبت فاکتور: سیستم خودش فاکتورهای مشابه را بررسی می‌کند و نتیجه در TOOL_RESULT می‌آید. اگر duplicates غیرخالی بود، در پاسخ نهایی حتماً هشدار بده (ثبت دوباره = مالیات و فروش دوباره!).
۷) حداکثر ۵ عمل ثبت در هر درخواست مجاز است.
۸) پاسخ نهایی: فارسی روان با bullet و **bold** و در صورت مفید بودن جدول مارک‌داون. اعداد با ارقام فارسی. مبالغ «تومان» با جداکننده هزارگان. آخر هر پاسخ یک «قدم بعدی» پیشنهادی کوتاه بده (مثل: «می‌خواهی مانده قرضی‌ها را هم ببینم؟»).
۹) اگر سندی ثبت/ویرایش شد، شماره سند و مبلغ را در پاسخ نهایی ذکر کن.
۱۰) **صداقت اجرا (بحرانی):** فقط زمانی بگو عملی «انجام/ثبت شد» که TOOL_RESULT موفق آن ابزار را دیده باشی. اگر ابزاری صدا نزدی، هرگز ادعا نکن — دستور را دقیق تکرار کن و آماده اجرا باش.
۱۱) **لینک ممنوع:** هرگز لینک/URL از خودت نساز؛ فقط شماره سند را بنویس، دکمه «مشاهده» را UI می‌سازد.
۱۲) تاریخ‌ها شمسی‌اند. تاریخ امروز: ${currentJalaliDisplay()}. تاریخ ورودی ابزارها را «شمسی» بفرست (YYYY/MM/DD مثل 1405/09/30) — خودمم تبدیل می‌شود؛ هرگز تبدیل میلادی دستی نکن. خروجی برای کاربر همیشه شمسی.
۱۳) سوالات عمومی حسابداری/مالیاتی (نرخ‌ها، مودیان، حقوق و دستمزد، چک صیادی) → مستقیم و تخصصی جواب بده. تو حسابدار ارشد ایرانی هستی.
۱۴) «چطور در خود نرم‌افزار X را انجام دهم؟» → اول search_help را امتحان کن؛ اگر پاسخ نداد، خودت راهنمایی دقیق ماژول‌به‌ماژول بده و در صورت امکان همان کار را با ابزار انجام بده.
۱۵) سوال خارج از حوزه → مودبانه هدایت کن.

نکته: «متن زمینه» پایین خلاصه لحظه‌ای است (KPI ماه، انبار، نرخ بازار، پلن...)؛ برای اعداد دقیق یا بازه‌های دیگر از ابزارهای query استفاده کن.`;

  return contextText ? `${base}\n\n${contextText}` : base;
}

// ============ TOOL_CALL parser ============
function parseToolCall(reply: string): ToolCall | null {
  if (!reply) return null;
  const tryParse = (raw: string): ToolCall | null => {
    const jsonPart = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    const start = jsonPart.indexOf("{");
    if (start === -1) return { tool: "", args: {}, invalid: true };
    const end = jsonPart.lastIndexOf("}");
    if (end <= start) return { tool: "", args: {}, invalid: true };
    try {
      const parsed = JSON.parse(jsonPart.slice(start, end + 1)) as {
        tool?: unknown;
        args?: unknown;
      };
      if (parsed && typeof parsed.tool === "string" && parsed.tool) {
        return {
          tool: parsed.tool,
          args:
            parsed.args && typeof parsed.args === "object"
              ? (parsed.args as Record<string, unknown>)
              : {},
          invalid: false,
        };
      }
      return { tool: "", args: {}, invalid: true };
    } catch {
      return { tool: "", args: {}, invalid: true };
    }
  };

  const lines = reply.split("\n").map((l) => l.trim());
  // ۱) کل پاسخ با TOOL_CALL شروع شود
  if (lines[0].startsWith("TOOL_CALL:")) {
    return tryParse(lines[0].slice("TOOL_CALL:".length));
  }
  // ۲) خطی در وسط پاسخ با TOOL_CALL شروع شود (code fences تحمل می‌شود)
  for (const line of lines) {
    const cleaned = line.replace(/^```(?:json)?\s*/i, "").trim();
    if (cleaned.startsWith("TOOL_CALL:")) {
      return tryParse(cleaned.slice("TOOL_CALL:".length));
    }
  }
  // FIX(v11-multiline): ۳) TOOL_CALL با JSON چندخطی (pretty-printed) —
  // قبلاً فقط خط‌به‌خط جستجو می‌شد و «TOOL_CALL: {» + ادامه در خطوط بعد
  // پارس نمی‌شد → ابزار اجرا نمی‌شد ولی مدل در پاسخ نهایی «انجام شد»
  // می‌گفت (توهم اجرا). حالا کل متن بعد از اولین TOOL_CALL: گرفته می‌شود.
  const idx = reply.indexOf("TOOL_CALL:");
  if (idx !== -1) {
    const rest = reply
      .slice(idx + "TOOL_CALL:".length)
      .replace(/```(?:json)?/gi, "")
      .trim();
    const start = rest.indexOf("{");
    const end = rest.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return tryParse(rest.slice(start, end + 1));
    }
  }
  return null;
}

// ============ Helpers ============
function toToman(v: bigint | number | null | undefined): number {
  const n = typeof v === "bigint" ? Number(v) : Number(v ?? 0);
  return Math.floor(n / 10);
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** بازه شمسی → میلادی {start, end} — end انحصاری است */
function jalaliPeriodRange(period: string): { start?: Date; end?: Date; label: string } {
  const now = new Date();
  const jy = getCurrentJalaliYear(now);
  const jm = getCurrentJalaliMonth(now);
  const mk = (y: number, m: number, d: number): Date => {
    const [gy, gm, gd] = jalaliToGregorian(y, m, d);
    return new Date(gy, gm - 1, gd);
  };
  switch (period) {
    case "last_month": {
      const py = jm === 1 ? jy - 1 : jy;
      const pm = jm === 1 ? 12 : jm - 1;
      const nm = pm === 12 ? 1 : pm + 1;
      const ny = pm === 12 ? py + 1 : py;
      return { start: mk(py, pm, 1), end: mk(ny, nm, 1), label: `ماه ${JALALI_MONTHS[pm - 1]} ${py}` };
    }
    case "this_year":
      return { start: mk(jy, 1, 1), end: mk(jy + 1, 1, 1), label: `سال ${jy}` };
    case "all":
      return { label: "کل دوره" };
    case "this_month":
    default:
      return {
        start: mk(jy, jm, 1),
        end: mk(jm === 12 ? jy + 1 : jy, jm === 12 ? 1 : jm + 1, 1),
        label: `ماه ${JALALI_MONTHS[jm - 1]} ${jy}`,
      };
  }
}

/** پارس تاریخ آرگومان ابزار — ISO یا شمسی ۱۴۰۴/۰۷/۱۵ (با ارقام فارسی) */
function parseDateArg(v: unknown): Date | null {
  if (v instanceof Date) return v;
  const s = toStr(v);
  if (!s) return null;
  const normalized = toEnglishDigits(s).trim();
  const jalali = normalized.replace(/\//g, "-").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (jalali) {
    const jy = Number(jalali[1]);
    const jm = Number(jalali[2]);
    const jd = Number(jalali[3]);
    if (jy >= 1300 && jy <= 1500 && jm >= 1 && jm <= 12 && jd >= 1 && jd <= 31) {
      const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
      return new Date(gy, gm - 1, gd);
    }
    // تاریخ میلادی (مثل 2025-10-01)
    const d = new Date(normalized.replace(/\//g, "-"));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(normalized.replace(/\//g, "-"));
  return isNaN(d.getTime()) ? null : d;
}

const invoiceTypeFa = (t: string): string =>
  t === "SALE"
    ? "فروش"
    : t === "PURCHASE"
      ? "خرید"
      : t === "RETURN"
        ? "برگشتی"
        : t === "PRE_INVOICE"
          ? "پیش‌فاکتور"
          : t;

// ============ فاکتورهای مشابه (ضدفروش) ============
interface DuplicateMatch {
  number: string;
  type: string;
  partyName: string;
  subtotalToman: number;
  totalToman: number;
  date: string;
  daysAgo: number;
}

async function findDuplicateInvoices(
  tenantId: string,
  partyName: string,
  amountToman: number,
  withinDays: number
): Promise<DuplicateMatch[]> {
  if (!partyName || amountToman <= 0) return [];
  const parties = await db.party.findMany({
    where: { tenantId, deletedAt: null, name: { contains: partyName } },
    select: { id: true },
    take: 5,
  });
  if (parties.length === 0) return [];
  const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);
  const invoices = await db.invoice.findMany({
    where: {
      tenantId,
      deletedAt: null,
      partyId: { in: parties.map((p) => p.id) },
      date: { gte: since },
    },
    include: { party: { select: { name: true } } },
    orderBy: { date: "desc" },
    take: 50,
  });
  const matches: DuplicateMatch[] = [];
  for (const inv of invoices) {
    const total = toToman(inv.total);
    const subtotal = toToman(inv.subtotal);
    // تطبیق با مبلغ خالص (بدون مالیات) یا مبلغ کل (با مالیات ۹٪) — پنجره ±۵٪
    const diff = Math.min(Math.abs(total - amountToman), Math.abs(subtotal - amountToman));
    if (diff <= amountToman * 0.05) {
      const daysAgo = Math.floor((Date.now() - inv.date.getTime()) / (24 * 60 * 60 * 1000));
      matches.push({
        number: inv.number,
        type: invoiceTypeFa(inv.type),
        partyName: inv.party?.name || "—",
        subtotalToman: subtotal,
        totalToman: total,
        date: toJalali(inv.date),
        daysAgo,
      });
    }
  }
  return matches;
}

// ============ Tool: query_kpis ============
async function toolQueryKpis(tenantId: string, args: Record<string, unknown>) {
  const period = toStr(args.period, "this_month");
  const range = jalaliPeriodRange(period);
  const dateFilter: { gte?: Date; lt?: Date } = {};
  if (range.start) dateFilter.gte = range.start;
  if (range.end) dateFilter.lt = range.end;
  const hasRange = Boolean(range.start);

  const [sales, purchases, expenses, cashSum, recSum, paySum] = await Promise.all([
    db.invoice.aggregate({
      where: {
        tenantId,
        type: "SALE",
        deletedAt: null,
        ...(hasRange ? { date: dateFilter } : {}),
      },
      _sum: { total: true },
    }),
    db.invoice.aggregate({
      where: {
        tenantId,
        type: "PURCHASE",
        deletedAt: null,
        ...(hasRange ? { date: dateFilter } : {}),
      },
      _sum: { total: true },
    }),
    db.expenseEntry.aggregate({
      where: { tenantId, type: "EXPENSE", ...(hasRange ? { date: dateFilter } : {}) },
      _sum: { amount: true },
    }),
    db.bankAccount.aggregate({ where: { tenantId, deletedAt: null }, _sum: { balance: true } }),
    db.invoice.aggregate({
      where: {
        tenantId,
        type: "SALE",
        deletedAt: null,
        status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
      },
      _sum: { total: true, paidAmount: true },
    }),
    db.invoice.aggregate({
      where: {
        tenantId,
        type: "PURCHASE",
        deletedAt: null,
        status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
      },
      _sum: { total: true, paidAmount: true },
    }),
  ]);

  const salesT = toToman(sales._sum?.total ?? null);
  const purchT = toToman(purchases._sum?.total ?? null);
  const expT = toToman(expenses._sum?.amount ?? null);
  const recT = Math.max(
    0,
    toToman(recSum._sum?.total ?? null) - toToman(recSum._sum?.paidAmount ?? null)
  );
  const payT = Math.max(
    0,
    toToman(paySum._sum?.total ?? null) - toToman(paySum._sum?.paidAmount ?? null)
  );

  return {
    period,
    periodLabel: range.label,
    currency: "toman",
    sales: fmt(salesT),
    purchases: fmt(purchT),
    expenses: fmt(expT),
    profit: fmt(salesT - purchT - expT),
    cashBalance: fmt(toToman(cashSum._sum?.balance ?? null)),
    receivables: fmt(recT),
    payables: fmt(payT),
    note: "همه مبالغ به تومان. سود = فروش − خرید − هزینه‌ها. cashBalance/receivables/payables مانده لحظه‌ای کل دوره‌هاست.",
  };
}

// ============ Tool: query_invoices ============
async function toolQueryInvoices(tenantId: string, args: Record<string, unknown>) {
  const limit = Math.min(Math.max(1, Math.round(toNum(args.limit) || 10)), 50);
  const type = toStr(args.type).toUpperCase();
  const status = toStr(args.status).toUpperCase();
  const partyName = toStr(args.partyName);
  const from = parseDateArg(args.fromDate);
  const to = parseDateArg(args.toDate);

  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  if (["SALE", "PURCHASE", "RETURN", "PRE_INVOICE"].includes(type)) where.type = type;
  if (
    [
      "DRAFT",
      "SENT",
      "PAID",
      "PARTIAL",
      "PARTIALLY_PAID",
      "OVERDUE",
      "RESERVED",
      "CANCELLED",
    ].includes(status)
  )
    where.status = status;
  // Task 21-D: فیلتر نوع پرداخت (نسیه) و اقلام قرضی
  const paymentType = toStr(args.paymentType).toUpperCase();
  if (paymentType === "CREDIT" || paymentType === "CASH") where.paymentType = paymentType;
  if (partyName) where.party = { name: { contains: partyName } };
  const dateFilter: Record<string, Date> = {};
  if (from) dateFilter.gte = from;
  if (to) {
    // شامل کل روز مقصد
    to.setHours(23, 59, 59, 999);
    dateFilter.lte = to;
  }
  if (Object.keys(dateFilter).length > 0) where.date = dateFilter;

  const [invoices, total] = await Promise.all([
    db.invoice.findMany({
      where,
      orderBy: { date: "desc" },
      take: limit,
      include: { party: { select: { name: true } } },
    }),
    db.invoice.count({ where }),
  ]);

  return {
    total,
    count: invoices.length,
    currency: "toman",
    invoices: invoices.map((inv) => ({
      number: inv.number,
      type: invoiceTypeFa(inv.type),
      party: inv.party?.name || "—",
      totalToman: fmt(toToman(inv.total)),
      paidToman: fmt(toToman(inv.paidAmount)),
      status: INVOICE_STATUS_FA[inv.status] || (inv.status === "RESERVED" ? "رزرو" : inv.status),
      paymentType: inv.paymentType === "CREDIT" ? "قرضی/نسیه" : "نقدی",
      dueDate: inv.dueDate ? toJalali(inv.dueDate) : null,
      date: toJalali(inv.date),
    })),
  };
}

// ============ Tool: query_parties ============
async function toolQueryParties(tenantId: string, args: Record<string, unknown>) {
  const search = toStr(args.search);
  const type = toStr(args.type).toUpperCase();
  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  if (["CUSTOMER", "SUPPLIER", "BOTH"].includes(type)) where.type = type;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { code: { contains: search } },
      { mobile: { contains: search } },
    ];
  }
  const parties = await db.party.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, code: true, name: true, type: true, mobile: true, phone: true, email: true },
  });
  if (parties.length === 0) return { count: 0, parties: [] };

  const ids = parties.map((p) => p.id);
  const [salesAgg, purchAgg] = await Promise.all([
    db.invoice.groupBy({
      by: ["partyId"],
      where: {
        tenantId,
        partyId: { in: ids },
        type: "SALE",
        deletedAt: null,
        status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
      },
      _sum: { total: true, paidAmount: true },
    }),
    db.invoice.groupBy({
      by: ["partyId"],
      where: {
        tenantId,
        partyId: { in: ids },
        type: "PURCHASE",
        deletedAt: null,
        status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
      },
      _sum: { total: true, paidAmount: true },
    }),
  ]);
  const recMap = new Map(
    salesAgg.map((g) => [
      g.partyId,
      Math.max(0, toToman(g._sum.total ?? null) - toToman(g._sum.paidAmount ?? null)),
    ])
  );
  const payMap = new Map(
    purchAgg.map((g) => [
      g.partyId,
      Math.max(0, toToman(g._sum.total ?? null) - toToman(g._sum.paidAmount ?? null)),
    ])
  );

  return {
    count: parties.length,
    currency: "toman",
    parties: parties.map((p) => ({
      name: p.name,
      code: p.code,
      type: p.type === "CUSTOMER" ? "مشتری" : p.type === "SUPPLIER" ? "تأمین‌کننده" : p.type,
      mobile: p.mobile || p.phone || "",
      email: p.email || "",
      // بدهی مشتری به ما (مطالبات)
      receivableToman: fmt(recMap.get(p.id) ?? 0),
      // بدهی ما به تأمین‌کننده
      payableToman: fmt(payMap.get(p.id) ?? 0),
    })),
  };
}

// ============ Tool: query_products ============
async function toolQueryProducts(tenantId: string, args: Record<string, unknown>) {
  const search = toStr(args.search);
  const lowStockOnly = args.lowStock === true;
  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { sku: { contains: search } },
      { barcode: { contains: search } },
    ];
  }
  const products = await db.product.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      sku: true,
      unit: true,
      minStock: true,
      salePrice: true,
      purchasePrice: true,
    },
  });
  if (products.length === 0) return { count: 0, products: [] };

  const stockAgg = await db.stockItem.groupBy({
    by: ["productId"],
    where: { tenantId, productId: { in: products.map((p) => p.id) } },
    _sum: { quantity: true },
  });
  const stockMap = new Map(stockAgg.map((s) => [s.productId, s._sum.quantity ?? 0]));

  let mapped = products.map((p) => {
    const stock = stockMap.get(p.id) ?? 0;
    return {
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      stock: Math.round(stock * 100) / 100,
      minStock: p.minStock,
      lowStock: stock <= p.minStock,
      salePriceToman: fmt(toToman(p.salePrice)),
      purchasePriceToman: fmt(toToman(p.purchasePrice)),
    };
  });
  if (lowStockOnly) mapped = mapped.filter((p) => p.lowStock);
  return { count: mapped.length, currency: "toman", products: mapped.slice(0, 30) };
}

// ============ Tool: query_top_customers ============
async function toolQueryTopCustomers(tenantId: string, args: Record<string, unknown>) {
  const limit = Math.min(Math.max(1, Math.round(toNum(args.limit) || 5)), 20);
  const grouped = await db.invoice.groupBy({
    by: ["partyId"],
    where: { tenantId, type: "SALE", deletedAt: null },
    _sum: { total: true },
    _count: { id: true },
    orderBy: { _sum: { total: "desc" } },
    take: limit,
  });
  if (grouped.length === 0) return { count: 0, customers: [] };
  const parties = await db.party.findMany({
    where: { id: { in: grouped.map((g) => g.partyId) } },
    select: { id: true, name: true, code: true, mobile: true },
  });
  const partyMap = new Map(parties.map((p) => [p.id, p]));
  return {
    count: grouped.length,
    currency: "toman",
    customers: grouped.map((g, i) => {
      const p = partyMap.get(g.partyId);
      return {
        rank: i + 1,
        name: p?.name || "—",
        code: p?.code || "",
        mobile: p?.mobile || "",
        totalSalesToman: fmt(toToman(g._sum.total ?? null)),
        invoiceCount: g._count.id,
      };
    }),
  };
}

// ============ Tool: query_expenses (جدید) ============
async function toolQueryExpenses(tenantId: string, args: Record<string, unknown>) {
  const limit = Math.min(Math.max(1, Math.round(toNum(args.limit) || 10)), 50);
  const category = typeof args.category === "string" ? args.category.toUpperCase() : undefined;
  const search = typeof args.search === "string" ? args.search.trim() : "";

  const where: Record<string, unknown> = { tenantId, type: "EXPENSE" };
  if (category && category !== "ALL") {
    where.category = category;
  }
  if (search) {
    where.OR = [
      { description: { contains: search } },
      { vendor: { contains: search } },
    ];
  }

  const entries = await db.expenseEntry.findMany({
    where,
    orderBy: { date: "desc" },
    take: limit,
    select: {
      amount: true,
      date: true,
      category: true,
      vendor: true,
      description: true,
      status: true,
    },
  });

  const totalToman = entries.reduce((s, e) => s + toToman(e.amount), 0);
  // گروه‌بندی بر اساس دسته
  const byCat = new Map<string, number>();
  for (const e of entries) {
    byCat.set(e.category, (byCat.get(e.category) || 0) + toToman(e.amount));
  }
  return {
    count: entries.length,
    currency: "toman",
    totalToman: fmt(totalToman),
    byCategory: Array.from(byCat.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat, sum]) => ({ category: cat, totalToman: fmt(sum) })),
    expenses: entries.map((e) => ({
      date: toJalali(e.date),
      category: e.category,
      vendor: e.vendor || "",
      description: e.description || "",
      status: e.status,
      amountToman: fmt(toToman(e.amount)),
    })),
  };
}

// ============ Tool: query_treasury (جدید) ============
async function toolQueryTreasury(tenantId: string) {
  const accounts = await db.bankAccount.findMany({
    where: { tenantId, deletedAt: null },
    select: { bankName: true, branch: true, type: true, balance: true, currency: true },
    orderBy: { balance: "desc" },
  });
  const totalRial = accounts.reduce((s, a) => s + Number(a.balance), 0);
  return {
    currency: "toman",
    totalBalanceToman: fmt(Math.floor(totalRial / 10)),
    accountCount: accounts.length,
    accounts: accounts.map((a) => ({
      bank: a.bankName,
      branch: a.branch || "",
      type: a.type, // CURRENT | SAVING | LOAN
      balanceToman: fmt(toToman(a.balance)),
    })),
  };
}

// ============ Tool: query_modian (جدید) ============
async function toolQueryModian(tenantId: string) {
  const grouped = await db.invoice.groupBy({
    by: ["modianStatus"],
    where: { tenantId, type: "SALE", deletedAt: null },
    _count: { id: true },
  });
  const statusMap = new Map(grouped.map((g) => [g.modianStatus ?? "NULL", g._count.id]));

  // فاکتورهای واجد شرایط ولی ارسال‌نشده (صف مودیان)
  const pending = await db.invoice.findMany({
    where: {
      tenantId,
      type: "SALE",
      deletedAt: null,
      // FIX: Prisma فیلتر in برای فیلد nullable آرایه‌ی null قبول نمی‌کند —
      // nullها با OR جداگانه پوشش داده می‌شوند (معادل in: [null, "PENDING", "REJECTED"])
      OR: [{ modianStatus: null }, { modianStatus: { in: ["PENDING", "REJECTED"] } }],
      status: { in: ["SENT", "PAID", "PARTIAL", "OVERDUE"] },
      total: { gt: 0 },
    },
    orderBy: { date: "desc" },
    take: 10,
    select: { number: true, date: true, total: true, modianStatus: true, partyId: true },
  });
  const parties = pending.length
    ? await db.party.findMany({
        where: { id: { in: pending.map((p) => p.partyId) } },
        select: { id: true, name: true },
      })
    : [];
  const partyMap = new Map(parties.map((p) => [p.id, p.name]));

  return {
    statusCounts: {
      unsent: (statusMap.get("NULL") ?? 0) + (statusMap.get("PENDING") ?? 0),
      sent: statusMap.get("SENT") ?? 0,
      accepted: statusMap.get("ACCEPTED") ?? 0,
      rejected: statusMap.get("REJECTED") ?? 0,
    },
    pendingQueue: pending.map((p) => ({
      number: p.number,
      party: partyMap.get(p.partyId) || "—",
      date: toJalali(p.date),
      totalToman: fmt(toToman(p.total)),
      status: p.modianStatus || "در صف",
    })),
    note: "فاکتورهای ارسال‌نشده باید طبق مهلت قانونی (حداکثر ۱۲ روز از صدور) به سامانه مودیان ارسال شوند.",
  };
}

// ============ Tool: query_warehouse (Task 21-D) ============
/** موجودی انبار به تفکیک کالا/انبار + هشدار کم‌موجودی (StockItem + Product.minStock) */
async function toolQueryWarehouse(tenantId: string, args: Record<string, unknown>) {
  const search = toStr(args.search);
  const warehouseName = toStr(args.warehouse);
  const lowStockOnly = args.lowStockOnly === true || args.lowStock === true;
  const limit = Math.min(Math.max(1, Math.round(toNum(args.limit) || 20)), 60);

  const productWhere: Record<string, unknown> = { tenantId, deletedAt: null };
  if (search) {
    productWhere.OR = [
      { name: { contains: search } },
      { sku: { contains: search } },
      { barcode: { contains: search } },
    ];
  }
  const [products, warehouses] = await Promise.all([
    db.product.findMany({
      where: productWhere,
      orderBy: { name: "asc" },
      take: limit,
      select: { id: true, name: true, sku: true, unit: true, minStock: true, salePrice: true },
    }),
    db.warehouse.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    }),
  ]);
  if (products.length === 0) return { count: 0, items: [], note: "کالایی یافت نشد" };
  const warehouseMap = new Map(warehouses.map((w) => [w.id, w.name]));

  const stockItems = await db.stockItem.findMany({
    where: { tenantId, productId: { in: products.map((p) => p.id) } },
    include: { warehouse: { select: { name: true } } },
  });

  // انبار فیلترشده؟
  const filteredStock = warehouseName
    ? stockItems.filter(
        (si) =>
          si.warehouse?.name?.includes(warehouseName) ||
          warehouseMap.get(si.warehouseId)?.includes(warehouseName)
      )
    : stockItems;

  // تجمیع: کل موجودی هر کالا + ردیف‌های تفکیکی انبار
  type Row = {
    product: string;
    sku: string;
    unit: string;
    stock: number;
    minStock: number;
    lowStock: boolean;
    warehouse: string;
    salePriceToman: string;
  };
  const totalByProduct = new Map<string, number>();
  for (const si of filteredStock) {
    totalByProduct.set(si.productId, (totalByProduct.get(si.productId) ?? 0) + si.quantity);
  }
  const rows: Row[] = [];
  for (const p of products) {
    const total = totalByProduct.get(p.id) ?? 0;
    const lowStock = total <= p.minStock;
    if (lowStockOnly && !lowStock) continue;
    const perWarehouse = filteredStock.filter((si) => si.productId === p.id && si.quantity !== 0);
    if (perWarehouse.length === 0) {
      rows.push({
        product: p.name,
        sku: p.sku,
        unit: p.unit,
        stock: Math.round(total * 100) / 100,
        minStock: p.minStock,
        lowStock,
        warehouse: "—",
        salePriceToman: fmt(toToman(p.salePrice)),
      });
    } else {
      for (const si of perWarehouse) {
        rows.push({
          product: p.name,
          sku: p.sku,
          unit: p.unit,
          stock: Math.round(si.quantity * 100) / 100,
          minStock: p.minStock,
          lowStock,
          warehouse: si.warehouse?.name || warehouseMap.get(si.warehouseId) || "—",
          salePriceToman: fmt(toToman(p.salePrice)),
        });
      }
    }
  }
  const lowCount = products.filter((p) => (totalByProduct.get(p.id) ?? 0) <= p.minStock).length;
  return {
    currency: "toman",
    productCount: products.length,
    warehouseCount: warehouses.length,
    lowStockCount: lowCount,
    rows: rows.slice(0, limit),
    note:
      lowCount > 0
        ? `${lowCount} کالا رو‌به‌اتمام است (موجودی ≤ حداقل) — در پاسخ نهایی هشدار بده.`
        : "هیچ کالایی زیر حداقل موجودی نیست.",
  };
}

// ============ Tool: query_currency (Task 21-D) ============
/** نرخ‌های ارز و طلا از ExchangeRate (واحد ریال) — خروجی تومان */
async function toolQueryCurrency(tenantId: string, args: Record<string, unknown>) {
  void tenantId; // نرخ‌ها سراسری‌اند
  const labels: Record<string, string> = {
    USD: "دلار آمریکا",
    EUR: "یورو",
    AED: "درهم امارات",
    GBP: "پوند انگلیس",
    TRY: "لیر ترکیه",
    CNY: "یوآن چین",
    GOLD_GERAM18: "گرم طلای ۱۸ عیار",
    GOLD_SEKEE: "سکه امامی",
    GOLD_ONSE: "انس جهانی طلا",
    GOLD_MESGHAL: "مثقال طلا",
  };
  const itemsFilter = toStr(args.items);
  const where: Record<string, unknown> = { toCurrency: "IRR" };
  if (itemsFilter) {
    const codes = itemsFilter
      .split(/[,،\s]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    if (codes.length > 0) where.fromCurrency = { in: codes };
  }
  const rates = await db.exchangeRate.findMany({
    where,
    orderBy: { fetchedAt: "desc" },
    take: 40,
  });
  const latest = new Map<string, { rate: number; fetchedAt: Date; source: string }>();
  for (const r of rates) {
    if (!latest.has(r.fromCurrency)) {
      latest.set(r.fromCurrency, { rate: r.rate, fetchedAt: r.fetchedAt, source: r.source });
    }
  }
  if (latest.size === 0) {
    return {
      items: [],
      note: "هنوز هیچ نرخ ارز/طلا در سیستم ثبت نشده — کاربر می‌تواند از ماژول انبار «همگام‌سازی با نرخ بازار» یا بخش ارز نرخ‌ها را دریافت کند.",
    };
  }
  return {
    currency: "toman",
    items: Array.from(latest.entries()).map(([code, v]) => ({
      code,
      label: labels[code] || code,
      rateToman: fmt(Math.floor(v.rate / 10)),
      source: v.source,
      fetchedAt: toJalali(v.fetchedAt),
    })),
    note: "نرخ‌ها از آخرین به‌روزرسانی ثبت‌شده در سیستم‌اند (منبع: tgju/دستی). نوسان لحظه‌ای ممکن است.",
  };
}

// ============ Tool: query_credit_receivables (Task 21-D) ============
/** مطالبات قرضی/نسیه — فاکتورهای فروش تسویه‌نشده با سن بدهی (aging) */
async function toolQueryCreditReceivables(tenantId: string, args: Record<string, unknown>) {
  const partyName = toStr(args.partyName);
  const limit = Math.min(Math.max(1, Math.round(toNum(args.limit) || 15)), 50);
  // فقط قرضی‌ها؟ (پیش‌فرض: همهٔ تسویه‌نشده‌ها — نقدی هم اگر تسویه نشده باشد مطالبه است)
  const creditOnly = args.creditOnly === true;

  const where: Record<string, unknown> = {
    tenantId,
    type: "SALE",
    deletedAt: null,
    status: { in: ["SENT", "PARTIAL", "PARTIALLY_PAID", "OVERDUE"] },
  };
  if (creditOnly) where.paymentType = "CREDIT";
  if (partyName) where.party = { name: { contains: partyName } };

  const invoices = await db.invoice.findMany({
    where,
    orderBy: { date: "asc" }, // قدیمی‌ترین بدهی اول (aging)
    take: limit,
    include: { party: { select: { name: true } } },
  });

  const now = Date.now();
  const rows = invoices
    .map((inv) => {
      const total = toToman(inv.total);
      const paid = toToman(inv.paidAmount);
      const remaining = Math.max(0, total - paid);
      const ageDays = Math.floor((now - inv.date.getTime()) / (24 * 60 * 60 * 1000));
      const bucket =
        ageDays <= 30 ? "۰-۳۰ روز" : ageDays <= 60 ? "۳۱-۶۰ روز" : ageDays <= 90 ? "۶۱-۹۰ روز" : "بیش از ۹۰ روز";
      return {
        number: inv.number,
        party: inv.party?.name || "—",
        totalToman: fmt(total),
        paidToman: fmt(paid),
        remainingToman: fmt(remaining),
        paymentType: inv.paymentType === "CREDIT" ? "قرضی" : "نقدی (تسویه‌نشده)",
        dueDate: inv.dueDate ? toJalali(inv.dueDate) : null,
        invoiceDate: toJalali(inv.date),
        ageDays,
        agingBucket: bucket,
        overdue: inv.dueDate ? inv.dueDate.getTime() < now && remaining > 0 : ageDays > 90,
      };
    })
    .filter((r) => Number(r.remainingToman.replace(/,/g, "")) > 0);

  const totalRemaining = rows.reduce((sum, r) => sum + Number(r.remainingToman.replace(/,/g, "")), 0);
  const byBucket = new Map<string, number>();
  for (const r of rows) {
    byBucket.set(r.agingBucket, (byBucket.get(r.agingBucket) ?? 0) + Number(r.remainingToman.replace(/,/g, "")));
  }
  return {
    currency: "toman",
    count: rows.length,
    totalRemainingToman: fmt(totalRemaining),
    aging: Array.from(byBucket.entries()).map(([bucket, sum]) => ({
      bucket,
      remainingToman: fmt(sum),
    })),
    invoices: rows,
    note: "ترتیب از قدیمی‌ترین بدهی. مطالبات بالای ۹۰ روز را برای پیگیری/مراجعه حقوقی جدا کن.",
  };
}

// ============ Tool: search_help (Task 21-D) ============
/** راهنمای نرم‌افزار — «چطور X را انجام دهم؟» از دانش‌نامه/راهنمای داخلی */
async function toolSearchHelp(question: string) {
  const q = question.trim();
  if (!q) return { error: "سوال راهنما (question) الزامی است" };
  // دانش‌نامه (RAG) — همان منبعی که سوپرادمین تغذیه می‌کند
  const knowledge = await buildKnowledgeContext(q);
  if (knowledge.contextText) {
    return {
      source: "knowledge-base",
      matchedTitles: knowledge.matchedTitles,
      excerpt: knowledge.contextText.slice(0, 4000),
      note: "این متن از اسناد راهنمای رسمی پلتفرم است — بر اساس آن پاسخ گام‌به‌گام بده.",
    };
  }
  // راهنمای داخلی ماژول‌ها — نگاشت کلیدواژه → ماژول (فال‌بک)
  const guide: Array<{ keys: string[]; module: string; how: string }> = [
    {
      keys: ["فاکتور قرضی", "نسیه", "الحساب", "اعتباری"],
      module: "invoices",
      how: "در فرم فاکتور (ثبت فاکتور یا فاکتور سریع) «نوع پرداخت» را روی «قرضی (نسیه)» بگذار و «تاریخ سررسید» شمسی را انتخاب کن؛ یا همین‌جا بگو تا من ثبتش کنم (create_credit_invoice).",
    },
    {
      keys: ["رزرو فاکتور", "پیش‌فاکتور سفارشی", "سفارش"],
      module: "invoices",
      how: "در فرم فاکتور دکمه «رزرو فاکتور» را بزن — فاکتور بدون خروج انبار و سند می‌ماند تا «ثبت نهایی»؛ یا از من بخواه (reserve_invoice).",
    },
    {
      keys: ["ویرایش فاکتور", "اصلاح فاکتور"],
      module: "invoices",
      how: "در لیست فاکتورها دکمه «ویرایش» هر ردیف، یا از من بگو شماره و تغییرات را تا edit_invoice اجرا کنم (سند و انبار خودکار تعدیل می‌شوند).",
    },
    {
      keys: ["کارتخوان", "پوز", "pos"],
      module: "settings",
      how: "تنظیمات ماژول فاکتور → «اتصال کارتخوان» — آدرس پل محلی + شماره ترمینال؛ در دیالوگ «دریافت وجه» گزینه پرداخت با کارتخوان فعال می‌شود.",
    },
    {
      keys: ["دلار", "نرخ ارز", "طلا", "تگجو", "tgju", "همگامسازی قیمت", "همگام‌سازی قیمت"],
      module: "inventory",
      how: "ماژول انبار → «همگام‌سازی قیمت با نرخ بازار» (لنگر دلار/طلا) یا بخش ارز → دریافت نرخ‌ها؛ نرخ‌های جدید را query_currency به من نشان می‌دهد.",
    },
    {
      keys: ["مودیان", "سامانه مودیان", "ارسال صورتحساب"],
      module: "tax",
      how: "ماژول مالیات/مودیان → ارسال صورتحساب‌های الکترونیکی؛ وضعیت صف ارسال را query_modian به من نشان می‌دهد.",
    },
    {
      keys: ["درون‌ریزی", "ایمپورت", "افزودن گروهی کالا", "اکسل", "excel", "csv"],
      module: "data-import",
      how: "ماژول درون‌ریزی/برون‌بری → بارگذاری CSV/Excel هلو/سپیدار با نگاشت خودکار ستون‌ها (تا ۱۰۰ هزار ردیف).",
    },
    {
      keys: ["چک", "صیادی", "خزانه"],
      module: "treasury",
      how: "ماژول خزانه → چک‌های دریافتی/پرداختی با تاریخ سررسید و وضعیت صیادی.",
    },
  ];
  const norm = toEnglishDigits(q).replace(/[\u200c\s]+/g, " ").toLowerCase();
  const hits = guide.filter((g) => g.keys.some((k) => norm.includes(k)));
  if (hits.length > 0) {
    return {
      source: "builtin-guide",
      topics: hits.map((h) => ({ module: h.module, how: h.how })),
      note: "راهنمای داخلی — گام‌ها را برای کاربر بازگو کن و پیشنهاد بده خودت همان کار را انجام دهی.",
    };
  }
  return {
    source: "none",
    note: "موضوع در راهنما پیدا نشد — از دانش حسابداری خودت راهنمایی کلی بده و نزدیک‌ترین ابزارت را پیشنهاد کن.",
  };
}

// ============ Module ============
const MODULE_BY_TOOL: Record<string, string> = {
  create_invoice: "invoices",
  create_expense: "expense-tracker",
  add_customer: "crm",
  add_product: "inventory",
  record_payment: "invoices",
  // Task 21-D
  edit_invoice: "invoices",
  reserve_invoice: "invoices",
  create_credit_invoice: "invoices",
  update_product_price: "inventory",
};

// ============ Endpoint ============
export async function POST(req: NextRequest) {
  try {
    const authCtx = await getAuthContext(req);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    if (!authCtx) {
      return NextResponse.json(
        { success: false, error: "احراز هویت الزامی است" },
        { status: 401 }
      );
    }

    // Rate limit: 10 requests/minute per user
    const rateKey = `agent-chat:${authCtx.tenantId}:${authCtx.userId ?? ip}`;
    if (!rateLimit(rateKey, 10, 60_000)) {
      return NextResponse.json(
        { success: false, error: "سقف درخواست ایجنت پر شده است. یک دقیقه بعد تلاش کنید." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { messages } = body as { messages?: ChatMessage[] };

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ success: false, error: "پیام الزامی است" }, { status: 400 });
    }
    if (messages.length > MAX_MESSAGES) {
      messages.splice(0, messages.length - MAX_MESSAGES);
    }
    for (const m of messages) {
      if (m && typeof m.content === "string" && m.content.length > MAX_MESSAGE_LENGTH) {
        return NextResponse.json(
          { success: false, error: `حداکثر طول هر پیام ${MAX_MESSAGE_LENGTH} کاراکتر است` },
          { status: 400 }
        );
      }
    }

    const lastUser = [...messages].reverse().find((m) => m.role === "user");

    // ─── ساخت پیام‌های API (system prompt به‌صورت role assistant — محدودیت SDK) ───
    const userCtx = await buildUserContext(req, authCtx.tenantId);
    const contextText = userCtx ? formatContextForPrompt(userCtx) : "";
    // FIX(v10-ai): دانش‌نامه — اسناد سوپرادمین به پرامپت ایجنت تزریق می‌شود
    const knowledge = await buildKnowledgeContext(lastUser?.content || "");
    const systemPrompt = buildAgentSystemPrompt(
      knowledge.contextText ? `${contextText}${knowledge.contextText}` : contextText
    );

    // FIX(v10-ai): انتخاب مسیر موتور — zai (SDK) یا custom (کلید سوپرادمین با role system)
    const providerSettings = await getAiProviderSettings();
    const useCustom =
      providerSettings.provider === "custom" &&
      providerSettings.baseUrl &&
      providerSettings.apiKey;

    const apiMessages: Array<{ role: "assistant" | "user" | "system"; content: string }> = useCustom
      ? [{ role: "system", content: systemPrompt }]
      : [{ role: "assistant", content: systemPrompt }];
    for (const m of messages) {
      if (m.role === "user" || m.role === "assistant") {
        if (typeof m.content === "string" && m.content.trim()) {
          apiMessages.push({ role: m.role, content: m.content });
        }
      }
    }

    // مسیر zai فقط وقتی لازم است ساخته می‌شود (مسیر سفارشی بدون SDK)
    const zai = useCustom ? null : await ZAI.create();

    const executedActions: ExecutedAction[] = [];
    const toolTrace: string[] = [];
    let mutationCount = 0;
    let navigate: { module: string; action?: string } | undefined;
    let finalReply = "";

    // ─── حلقه ایجنت ───
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const isLastIteration = iteration === MAX_TOOL_ITERATIONS - 1;
      const promptMessages = [...apiMessages];
      if (isLastIteration && iteration > 0) {
        promptMessages.push({
          role: "user",
          content:
            "SYSTEM_NOTE: سقف فراخوانی ابزار پر شده — دیگر هیچ TOOL_CALL ننویس و همین حالا پاسخ نهایی فارسی را با اطلاعات موجود بده.",
        });
      }

      let reply: string;
      try {
        reply = await callLLM(zai, promptMessages);
      } catch (llmErr) {
        // Task 21-D: تاب‌آوری خطا — هیچ‌وقت stack خام به کاربر نرود؛ پیام فارسی
        // دوستانه + خلاصهٔ کارهای انجام‌شدهٔ همین درخواست برمی‌گردد (۲۰۰).
        console.error("[agent-chat] LLM failure mid-loop:", llmErr);
        const partial = executedActions
          .filter((a) => a.success)
          .map((a) => `- ${a.label}`)
          .join("\n");
        finalReply =
          `⚠️ ارتباط با موتور هوش مصنوعی برای ادامه پاسخ برقرار نشد — لطفاً پیام را دوباره بفرستید.` +
          (partial
            ? `\n\nاما این کارها در همین درخواست **با موفقیت انجام شد**:\n${partial}`
            : "");
        break;
      }

      const toolCall = parseToolCall(reply);
      if (!toolCall) {
        finalReply = reply.trim();
        break;
      }

      // ─── اجرای ابزار ───
      if (toolCall.invalid || !toolCall.tool) {
        apiMessages.push({ role: "assistant", content: "TOOL_CALL: (نامعتبر)" });
        apiMessages.push({
          role: "user",
          content:
            'TOOL_RESULT: {"error":"فرمت TOOL_CALL نامعتبر است. دقیقاً این شکل را رعایت کن: TOOL_CALL: {\\"tool\\":\\"query_kpis\\",\\"args\\":{}}"}',
        });
        continue;
      }

      const { tool, args } = toolCall;
      toolTrace.push(tool);
      apiMessages.push({
        role: "assistant",
        content: `TOOL_CALL: ${JSON.stringify({ tool, args })}`,
      });

      let result: Record<string, unknown>;

      try {
        // ── navigate: اجرا در فرانت‌اند ──
        if (tool === "navigate") {
          const moduleName = toStr(args.module, "dashboard");
          const action = toStr(args.action) || undefined;
          navigate = { module: moduleName, action };
          result = { navigated: true, module: moduleName, action: action ?? null };
        }
        // ── check_duplicate_invoice ──
        else if (tool === "check_duplicate_invoice") {
          const partyName = toStr(args.partyName);
          const amount = toNum(args.amount);
          const withinDays = Math.min(Math.max(1, Math.round(toNum(args.withinDays) || 7)), 90);
          const duplicates = await findDuplicateInvoices(
            authCtx.tenantId,
            partyName,
            amount,
            withinDays
          );
          result = {
            checked: true,
            withinDays,
            duplicatesFound: duplicates.length,
            duplicates,
            note:
              duplicates.length > 0
                ? "فاکتور مشابه پیدا شد — احتمال ثبت دوباره. حتماً به کاربر هشدار بده."
                : "فاکتور مشابهی در این بازه یافت نشد.",
          };
        }
        // ── ابزارهای کوئری ──
        else if (tool === "query_kpis") {
          result = await toolQueryKpis(authCtx.tenantId, args);
        } else if (tool === "query_invoices") {
          result = await toolQueryInvoices(authCtx.tenantId, args);
        } else if (tool === "query_parties") {
          result = await toolQueryParties(authCtx.tenantId, args);
        } else if (tool === "query_products") {
          result = await toolQueryProducts(authCtx.tenantId, args);
        } else if (tool === "query_expenses") {
          result = await toolQueryExpenses(authCtx.tenantId, args);
          executedActions.push({ tool, label: "جستجوی هزینه‌ها", success: true, summary: "هزینه‌ها بر اساس فیلتر بازیابی شد" });
        } else if (tool === "query_treasury") {
          result = await toolQueryTreasury(authCtx.tenantId);
          executedActions.push({ tool, label: "موجودی خزانه", success: true, summary: "موجودی حساب‌های بانکی خوانده شد" });
        } else if (tool === "query_modian") {
          result = await toolQueryModian(authCtx.tenantId);
          executedActions.push({ tool, label: "وضعیت مودیان", success: true, summary: "وضعیت صورتحساب‌های مودیان بررسی شد" });
        } else if (tool === "query_top_customers") {
          result = await toolQueryTopCustomers(authCtx.tenantId, args);
        } else if (tool === "query_warehouse") {
          result = await toolQueryWarehouse(authCtx.tenantId, args);
          executedActions.push({
            tool,
            label: "موجودی انبار",
            success: true,
            summary: "موجودی انبار به تفکیک کالا/انبار خوانده شد",
          });
        } else if (tool === "query_currency") {
          result = await toolQueryCurrency(authCtx.tenantId, args);
          executedActions.push({
            tool,
            label: "نرخ ارز و طلا",
            success: true,
            summary: "آخرین نرخ‌های ثبت‌شده بازار خوانده شد",
          });
        } else if (tool === "query_credit_receivables") {
          result = await toolQueryCreditReceivables(authCtx.tenantId, args);
          executedActions.push({
            tool,
            label: "مطالبات و بدهی قرضی",
            success: true,
            summary: "فاکتورهای تسویه‌نشده با سن بدهی محاسبه شد",
          });
        } else if (tool === "search_help") {
          result = await toolSearchHelp(toStr(args.question ?? args.query ?? args.search));
        }
        // ── ابزارهای ثبت (جهش‌دار) ──
        else if (MUTATION_TOOLS.has(tool)) {
          if (mutationCount >= MAX_MUTATIONS_PER_REQUEST) {
            result = {
              error: `سقف مجاز ${MAX_MUTATIONS_PER_REQUEST} عمل ثبت در هر درخواست پر شده است. بقیه را در پیام بعدی انجام بده.`,
            };
          } else {
            let outcome;
            let label = "";
            let summary = "";

            if (tool === "create_invoice") {
              // ── ضدروش: بررسی فاکتور تکراری قبل از ثبت ──
              const partyName = toStr(args.partyName);
              const itemsEstimate = Array.isArray(args.items)
                ? (args.items as Array<Record<string, unknown>>).reduce(
                    (s, it) => s + toNum(it.quantity ?? 1) * toNum(it.unitPrice ?? it.amount ?? 0),
                    0
                  )
                : 0;
              const amountEstimate = toNum(args.amount) || itemsEstimate;
              const duplicates =
                partyName && amountEstimate > 0
                  ? await findDuplicateInvoices(authCtx.tenantId, partyName, amountEstimate, 7)
                  : [];

              outcome = await createInvoiceAction(authCtx.tenantId, authCtx.userId, args, req);
              const d = outcome.data ?? {};
              const totalToman = toNum(d.totalToman);
              const number = toStr(d.number);
              const invoiceType = toStr(d.type, "SALE") === "PURCHASE" ? "خرید" : "فروش";
              if (outcome.ok) {
                label = `فاکتور ${invoiceType} ${number} برای ${partyName || "طرف‌حساب"} به مبلغ ${toPersianDigits(
                  totalToman.toLocaleString("en-US")
                )} تومان ثبت شد`;
                summary = `شماره ${number} · مبلغ کل ${toPersianDigits(
                  totalToman.toLocaleString("en-US")
                )} تومان (شامل مالیات ${toPersianDigits(
                  toNum(d.taxToman).toLocaleString("en-US")
                )} تومان)`;
              } else {
                label = `ثبت فاکتور ${invoiceType} برای ${partyName || "طرف‌حساب"}`;
                summary = outcome.error ?? "خطای ناشناخته";
              }
              // نتیجه تکراری‌ها به مدل هم می‌رسد تا در پاسخ هشدار دهد
              result = {
                ...(outcome.ok
                  ? { created: true, invoice: outcome.data }
                  : { created: false, error: outcome.error }),
                duplicates,
                duplicateWarning:
                  duplicates.length > 0
                    ? "توجه: فاکتور(های) مشابهی برای همین طرف‌حساب با مبلغ نزدیک در ۷ روز اخیر ثبت شده — در پاسخ نهایی به کاربر هشدار بده."
                    : null,
              };
            } else if (tool === "create_expense") {
              outcome = await createExpenseAction(authCtx.tenantId, authCtx.userId, args, req);
              const d = outcome.data ?? {};
              const amountToman = toNum(d.amountToman);
              const desc = toStr(d.description);
              if (outcome.ok) {
                label = `هزینه ${toPersianDigits(amountToman.toLocaleString("en-US"))} تومانی${
                  desc ? ` (${desc})` : ""
                } ثبت شد`;
                summary = `مبلغ ${toPersianDigits(
                  amountToman.toLocaleString("en-US")
                )} تومان · دسته ${toStr(d.category)}`;
              } else {
                label = "ثبت هزینه";
                summary = outcome.error ?? "خطای ناشناخته";
              }
              result = outcome.ok
                ? { created: true, expense: outcome.data }
                : { created: false, error: outcome.error };
            } else if (tool === "add_customer") {
              outcome = await addCustomerAction(authCtx.tenantId, authCtx.userId, args, req);
              const d = outcome.data ?? {};
              const name = toStr(d.name) || toStr(args.name);
              if (outcome.ok) {
                label = d.existing
                  ? `طرف‌حساب «${name}» از قبل موجود بود`
                  : `مشتری «${name}» با کد ${toStr(d.code)} اضافه شد`;
                summary = d.existing
                  ? "طرف‌حساب تکراری — از موجود استفاده شد"
                  : `کد ${toStr(d.code)} · نوع ${
                      toStr(d.type) === "SUPPLIER" ? "تأمین‌کننده" : "مشتری"
                    }`;
              } else {
                label = `افزودن طرف‌حساب «${name}»`;
                summary = outcome.error ?? "خطای ناشناخته";
              }
              result = outcome.ok
                ? { created: !d.existing, existing: Boolean(d.existing), party: outcome.data }
                : { created: false, error: outcome.error };
            } else if (tool === "add_product") {
              outcome = await addProductAction(authCtx.tenantId, authCtx.userId, args, req);
              const d = outcome.data ?? {};
              const name = toStr(d.name) || toStr(args.name);
              if (outcome.ok) {
                label = d.existing
                  ? `کالای «${name}» از قبل موجود بود`
                  : `کالای «${name}» با کد ${toStr(d.sku)} اضافه شد`;
                summary = d.existing
                  ? "کد SKU تکراری — از موجود استفاده شد"
                  : `کد ${toStr(d.sku)} · قیمت فروش ${toPersianDigits(
                      toNum(d.salePriceToman).toLocaleString("en-US")
                    )} تومان`;
              } else {
                label = `افزودن کالای «${name}»`;
                summary = outcome.error ?? "خطای ناشناخته";
              }
              result = outcome.ok
                ? { created: !d.existing, existing: Boolean(d.existing), product: outcome.data }
                : { created: false, error: outcome.error };
            } else if (tool === "edit_invoice") {
              outcome = await editInvoiceAction(authCtx.tenantId, authCtx.userId, args, req);
              const d = outcome.data ?? {};
              if (outcome.ok) {
                label = `فاکتور ${toStr(d.number)} ویرایش شد`;
                summary = `مبلغ ${toPersianDigits(
                  toNum(d.oldTotalToman).toLocaleString("en-US")
                )} ← ${toPersianDigits(
                  toNum(d.newTotalToman).toLocaleString("en-US")
                )} تومان · وضعیت ${toStr(d.status)}`;
              } else {
                label = `ویرایش فاکتور ${toStr(args.invoiceNumber) || toStr(args.number)}`;
                summary = outcome.error ?? "خطای ناشناخته";
              }
              result = outcome.ok
                ? { updated: true, invoice: outcome.data }
                : { updated: false, error: outcome.error };
            } else if (tool === "reserve_invoice") {
              outcome = await reserveInvoiceAction(authCtx.tenantId, authCtx.userId, args, req);
              const d = outcome.data ?? {};
              const totalToman = toNum(d.totalToman);
              if (outcome.ok) {
                label = `فاکتور رزرو ${toStr(d.number)} برای ${
                  toStr(args.partyName) || "طرف‌حساب"
                } ثبت شد`;
                summary = `رزرو (بدون اثر انبار/سند) · مبلغ ${toPersianDigits(
                  totalToman.toLocaleString("en-US")
                )} تومان — با «ثبت نهایی» از لیست فاکتورها فعال می‌شود`;
              } else {
                label = `رزرو فاکتور برای ${toStr(args.partyName) || "طرف‌حساب"}`;
                summary = outcome.error ?? "خطای ناشناخته";
              }
              result = outcome.ok
                ? { created: true, reserved: true, invoice: outcome.data }
                : { created: false, error: outcome.error };
            } else if (tool === "create_credit_invoice") {
              outcome = await createCreditInvoiceAction(authCtx.tenantId, authCtx.userId, args, req);
              const d = outcome.data ?? {};
              const totalToman = toNum(d.totalToman);
              if (outcome.ok) {
                label = `فاکتور قرضی ${toStr(d.number)} برای ${
                  toStr(args.partyName) || "طرف‌حساب"
                } ثبت شد`;
                summary = `نسیه با سررسید ${toStr(args.dueDate) || "—"} · مبلغ ${toPersianDigits(
                  totalToman.toLocaleString("en-US")
                )} تومان`;
              } else {
                label = `ثبت فاکتور قرضی برای ${toStr(args.partyName) || "طرف‌حساب"}`;
                summary = outcome.error ?? "خطای ناشناخته";
              }
              result = outcome.ok
                ? { created: true, credit: true, invoice: outcome.data }
                : { created: false, error: outcome.error };
            } else if (tool === "update_product_price") {
              outcome = await updateProductPriceAction(authCtx.tenantId, authCtx.userId, args, req);
              const d = outcome.data ?? {};
              if (outcome.ok) {
                label = `قیمت کالای «${toStr(d.name)}» به‌روزرسانی شد`;
                summary = `قیمت فروش ${toPersianDigits(
                  toNum(d.salePriceToman).toLocaleString("en-US")
                )} تومان · خرید ${toPersianDigits(
                  toNum(d.purchasePriceToman).toLocaleString("en-US")
                )} تومان`;
              } else {
                label = `به‌روزرسانی قیمت کالای «${toStr(args.name) || toStr(args.sku)}»`;
                summary = outcome.error ?? "خطای ناشناخته";
              }
              result = outcome.ok
                ? { updated: true, product: outcome.data }
                : { updated: false, error: outcome.error };
            } else {
              // record_payment
              const invoiceNumber = toStr(args.invoiceNumber);
              const amount = toNum(args.amount);
              const invoice = invoiceNumber
                ? await lookupInvoiceByNumber(authCtx.tenantId, invoiceNumber)
                : null;
              if (!invoice) {
                outcome = {
                  ok: false,
                  status: 404,
                  error: `فاکتوری با شماره ${invoiceNumber || "—"} یافت نشد`,
                };
                label = `ثبت پرداخت روی فاکتور ${invoiceNumber}`;
                summary = outcome.error ?? "خطای ناشناخته";
                result = { created: false, error: outcome.error };
              } else {
                outcome = await recordPaymentAction(
                  authCtx.tenantId,
                  authCtx.userId,
                  { invoiceId: invoice.id, amount },
                  req
                );
                const d = outcome.data ?? {};
                if (outcome.ok) {
                  label = `پرداخت ${toPersianDigits(
                    amount.toLocaleString("en-US")
                  )} تومانی روی فاکتور ${toStr(d.number)} ثبت شد`;
                  summary = `وضعیت جدید: ${toStr(d.status)} · مانده ${toPersianDigits(
                    toNum(d.remainingToman).toLocaleString("en-US")
                  )} تومان`;
                } else {
                  label = `ثبت پرداخت روی فاکتور ${toStr(d.number) || invoiceNumber}`;
                  summary = outcome.error ?? "خطای ناشناخته";
                }
                result = outcome.ok
                  ? { created: true, payment: outcome.data }
                  : { created: false, error: outcome.error };
              }
            }

            executedActions.push({
              tool,
              label,
              success: outcome.ok,
              summary,
              module: MODULE_BY_TOOL[tool],
              url: outcome.ok ? (outcome.data?.url as string | undefined) : undefined,
            });
            // FIX(v11): فقط عملیات «موفق» سقف و محافظ صداقت را مصرف می‌کند —
            // قبلاً تلاش ناموفق هم mutationCount را بالا می‌برد
            if (outcome.ok) mutationCount++;
          }
        } else {
          result = {
            error: `ابزار «${tool}» شناخته نشد. ابزارهای معتبر: ${KNOWN_TOOLS.join(", ")}`,
          };
        }
      } catch (err) {
        console.error(`[agent-chat] tool '${tool}' error:`, err);
        result = { error: `خطا در اجرای ابزار ${tool}` };
      }

      apiMessages.push({
        role: "user",
        content: `TOOL_RESULT: ${JSON.stringify(result)}`,
      });
    }

    // اگر پس از حلقه هنوز پاسخ نهایی نهایی نیستیم (همه تکرارها ابزار بود)
    if (!finalReply) {
      finalReply = (
        await callLLM(zai, [
          ...apiMessages,
          {
            role: "user",
            content:
              "SYSTEM_NOTE: حلقه ابزار تمام شد — الان پاسخ نهایی فارسی مارک‌داون را بنویس و هیچ TOOL_CALL ننویس.",
          },
        ])
      ).trim();
    }

    if (!finalReply) {
      finalReply = "متأسفم، در پردازش درخواست شما مشکلی پیش آمد. لطفاً دوباره تلاش کنید.";
    }

    // FIX(v11-honesty): محافظ صداقت — اگر پاسخ نهایی ادعای «ثبت شد» دارد ولی
    // هیچ عمل ثبت واقعی در این درخواست انجام نشده (mutationCount=0)، هشدار
    // صادقانه به پاسخ اضافه می‌شود تا کاربر فریب ادعای کاذب مدل را نخورد.
    if (mutationCount === 0) {
      const claimsDone = /(ثبت\s*شد|ایجاد\s*شد|انجام\s*شد|ساخته\s*شد|اضافه\s*شد|پرداخت\s*شد)/.test(
        finalReply
      );
      const lastUserContent = lastUser?.content ?? "";
      const wasCommand =
        /(فاکتور|هزینه|مشتری|کالا|پرداخت|دریافت)/.test(lastUserContent) &&
        /(ثبت|بزن|بساز|ایجاد|اضافه|انجام|پرداخت)/.test(lastUserContent);
      if (claimsDone && wasCommand) {
        finalReply +=
          "\n\n---\n⚠️ **نکته مهم:** در این گفتگو هیچ سندی واقعاً در سیستم ثبت نشده است. لطفاً دوباره دستور خود را بفرستید (مثلاً: «فاکتور فروش ۲ میلیون تومانی برای مشتری X ثبت کن») تا ابزار ثبت اجرا شود، یا از ماژول مربوطه به‌صورت دستی ثبت کنید.";
      }
    }

    // ─── Audit log ───
    await auditLog({
      tenantId: authCtx.tenantId,
      userId: authCtx.userId,
      action: "AI_AGENT_CHAT",
      entity: "ai.agent",
      changes: {
        messageCount: messages.length,
        preview: lastUser?.content?.slice(0, 200) ?? "",
        toolTrace,
        mutationCount,
        executedActions: executedActions.length,
        contextLoaded: Boolean(userCtx),
      },
      req,
    });

    return NextResponse.json({
      success: true,
      reply: finalReply,
      executedActions,
      // FIX(v10-ai): منابع دانش‌نامه استفاده‌شده — برای بج «دانش اختصاصی» در UI
      knowledgeSources: knowledge.matchedTitles,
      ...(navigate ? { navigate } : {}),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "خطای ناشناخته";
    console.error("AI agent-chat error:", msg);
    const isConfigError =
      msg.includes("missing X-Token header") || msg.includes("Configuration file not found");
    // خطای 429 سرویس بالادستی (سقف درخواست SDK) → همان 429 با پیام فارسی
    const isUpstreamRateLimit =
      msg.includes("429") || msg.toLowerCase().includes("too many requests");
    return NextResponse.json(
      {
        success: false,
        error: isConfigError
          ? "سرویس هوش مصنوعی در حال حاضر در دسترس نیست (خطای پیکربندی سرور). لطفاً بعداً تلاش کنید."
          : isUpstreamRateLimit
            ? "سقف درخواست سرویس هوش مصنوعی پر شده است. چند لحظه بعد دوباره تلاش کنید."
            : "خطا در ارتباط با ایجنت هوش مصنوعی. لطفاً دوباره تلاش کنید.",
      },
      { status: isConfigError ? 503 : isUpstreamRateLimit ? 429 : 500 }
    );
  }
}

// GET — health + ابزارهای موجود
export async function GET() {
  return NextResponse.json({
    success: true,
    endpoint: "/api/ai/agent-chat",
    tools: KNOWN_TOOLS,
    features: [
      "agentic-loop-max-8-iterations",
      "max-5-mutations-per-request",
      "duplicate-invoice-guard",
      "invoice-suite-edit-reserve-credit",
      "warehouse-currency-receivables-queries",
      "audit-logged",
      "auth-required",
      "rate-limit-10-per-minute",
    ],
  });
}
