/* ============================================================
 * پارسر ایمپورت هوش — lib/import-parser.ts
 * ============================================================
 * ماژول «بدون وابستگی سروری» (client-safe) برای خواندن فایل‌های
 * درون‌ریزی از نرم‌افزارهای حسابداری ایرانی (هلو / سپیدار / محک):
 *
 *  ۱) تشخیص انکودینگ واقعی فایل:
 *     - BOM (UTF-8 / UTF-16LE / UTF-16BE) → دیکد مطابق BOM
 *     - تلاش UTF-8 سخت‌گیر (fatal) + heuristic ضد-موجیبک
 *     - fallback: Windows-1256 (جدول دستی — خروجی واقعی هلو/سپیدار)
 *     (فایل واقعی مالک: ۱۲۹۸ خط، Windows-1256، بایت اول d1 cf ed dd)
 *
 *  ۲) تشخیص خودکار جداکننده (, ; \t |) از خطوط اول فایل
 *
 *  ۳) پارسر RFC4180 کامل (کوتیشن، کوتیشن داخل کوتیشن، چندخطی)
 *
 *  ۴) «بازچینش قیمت‌های شکسته» (CRITICAL):
 *     هلو/سپیدار قیمت‌ها را با جداکننده هزارگانِ بی‌کوتیشن خروجی
 *     می‌گیرد؛ یعنی ۲,۳۹۰,۰۰۰ در سه سلول «2»,«390»,«000» می‌نشیند و
 *     split ساده همه ستون‌های بعدی را جابه‌جا می‌کند. الگوریتم:
 *     قدم‌زدن روی ستون‌های هدر با «نوع» هر ستون (قیمتی/تعدادی/درصدی/متنی)؛
 *     ستون قیمتی سلول‌های بعدیِ دقیقاً ۳رقمی (^\d{3}$) را جذب و الحاق
 *     می‌کند. چون ممکن است چند ستون قیمتیِ «مجاور» هرکدام شکسته باشند
 *     (مثل «في فروش» و «آخرين في خريد»)، تخصیص گروه‌ها با backtracking
 *     حل می‌شود با این قیودها:
 *       - هر ستون دقیقاً ≥۱ سلول مصرف می‌کند (جمع سلول‌ها دقیقاً تراز)
 *       - سلول اولِ قیمت نباید صفرِ پیشرو داشته باشد («0» تنها مجاز است؛
 *         «000» فقط می‌تواند ادامهٔ گروه باشد)
 *       - ترجیح: بیشترین جذب در ستون قیمتیِ زودتر (قیمت‌های ایرانی
 *         معمولاً هزارگانِ گرد هستند: 2,390,000 نه 2 + 390,000,900)
 *     اگر هیچ تخصیص معتبری پیدا نشد → fallback جذب حریصانه با سقف
 *     budget (سلول اضافه) و رهاکردن سلول‌های انتهایی اضافه.
 *
 * این فایل نباید هیچ import سروری داشته باشد (در /tmp/test-import-parse.mjs
 * با bun مستقیم import می‌شود و در کلاینت Next.js هم استفاده می‌شود).
 * ============================================================ */

/* ---------- ۱) جدول Windows-1256 (بایت 0x80..0xFF → یونیکد) ----------
 * جدول رسمی WHATWG/Unicode برای windows-1256 — به‌صورت رشتهٔ ۱۲۸کاراکتری.
 * جدول دستی لازم است چون TextDecoder('windows-1256') در همهٔ runtimeها
 * موجود نیست (مثلاً Bun آن را ندارد). */
const CP1256_HIGH =
  "\u20AC\u067E\u201A\u0192\u201E\u2026\u2020\u2021" +
  "\u02C6\u2030\u0679\u2039\u0152\u0686\u0698\u0688" +
  "\u06AF\u2018\u2019\u201C\u201D\u2022\u2013\u2014" +
  "\u06A9\u2122\u0691\u203A\u0153\u200C\u200D\u06BA" +
  "\u00A0\u060C\u00A2\u00A3\u00A4\u00A5\u00A6\u00A7" +
  "\u00A8\u00A9\u06BE\u00AB\u00AC\u00AD\u00AE\u00AF" +
  "\u00B0\u00B1\u00B2\u00B3\u00B4\u00B5\u00B6\u00B7" +
  "\u00B8\u00B9\u061B\u00BB\u00BC\u00BD\u00BE\u061F" +
  "\u06C1\u0621\u0622\u0623\u0624\u0625\u0626\u0627" +
  "\u0628\u0629\u062A\u062B\u062C\u062D\u062E\u062F" +
  "\u0630\u0631\u0632\u0633\u0634\u0635\u0636\u00D7" +
  "\u0637\u0638\u0639\u063A\u0640\u0641\u0642\u0643" +
  "\u00E0\u0644\u00E2\u0645\u0646\u0647\u0648\u00E7" +
  "\u00E8\u00E9\u00EA\u00EB\u0649\u064A\u00EE\u00EF" +
  "\u064B\u064C\u064D\u064E\u00F4\u064F\u0650\u00F7" +
  "\u0651\u00F9\u0652\u00FB\u00FC\u200E\u200F\u06D2";

/** دیکد دستی بایت‌های Windows-1256 (سرعت: جدول از پیش ساخته می‌شود) */
const CP1256_MAP: string[] = (() => {
  const arr: string[] = new Array(256);
  for (let b = 0; b < 0x80; b++) arr[b] = String.fromCharCode(b);
  for (let b = 0x80; b <= 0xff; b++) arr[b] = CP1256_HIGH.charAt(b - 0x80);
  return arr;
})();

export function decodeWindows1256(bytes: Uint8Array): string {
  let out = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    let part = "";
    for (let j = 0; j < slice.length; j++) part += CP1256_MAP[slice[j]];
    out += part;
  }
  return out;
}

/** دیکد دستی UTF-16LE/BE (بدون وابستگی به TextDecoder) */
export function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = littleEndian
      ? bytes[i] | (bytes[i + 1] << 8)
      : (bytes[i] << 8) | bytes[i + 1];
    out += String.fromCharCode(code);
  }
  return out;
}

/** UTF-8 سخت‌گیر — اگر بایت نامعتبر بود throw می‌کند (بدون جایگزینی خاموش) */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    let len = 0;
    let cp = 0;
    if (b >= 0xc2 && b <= 0xdf) {
      len = 2;
      cp = b & 0x1f;
    } else if (b >= 0xe0 && b <= 0xef) {
      len = 3;
      cp = b & 0x0f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      len = 4;
      cp = b & 0x07;
    } else {
      throw new Error(`invalid-utf8:${b.toString(16)}`);
    }
    if (i + len > n) throw new Error("invalid-utf8:truncated");
    for (let k = 1; k < len; k++) {
      const c = bytes[i + k];
      if ((c & 0xc0) !== 0x80) throw new Error("invalid-utf8:continuation");
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      throw new Error("invalid-utf8:codepoint");
    }
    out += String.fromCodePoint(cp);
    i += len;
  }
  return out;
}

/**
 * heuristic ضد-موجیبک: متن cp1256 که به‌زور با UTF-8 دیکد شود،
 * کاراکترهای «سریانی/عربی گسترش‌یافته» (U+0700–U+077F) تولید می‌کند که
 * در متن فارسی واقعی هرگز حضور ندارند. اگر یافت شد → UTF-8 رد می‌شود.
 */
function looksLikeUtf8Mojibake(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x0700 && c <= 0x077f) return true;
  }
  return false;
}

export interface DecodedText {
  text: string;
  /** نام انکودینگ تشخیص‌داده‌شده (برای نمایش در UI) */
  encoding: "utf-8" | "utf-8bom" | "utf-16le" | "utf-16be" | "windows-1256";
}

/**
 * تشخیص انکودینگ و دیکد نهایی یک بافر فایل:
 * ۱) BOM → utf-8 / utf-16le / utf-16be
 * ۲) UTF-8 سخت‌گیر (+ heuristic) — فایل‌های سالم UTF-8 اینجا برمی‌گردند
 * ۳) Windows-1256 — خروجی واقعی هلو/سپیدار/اکسل فارسی (بدون BOM)
 */
export function decodeBuffer(buf: ArrayBuffer | Uint8Array): DecodedText {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  // --- BOM ها ---
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decodeUtf8Strict(bytes.subarray(3)), encoding: "utf-8bom" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decodeUtf16(bytes.subarray(2), true), encoding: "utf-16le" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decodeUtf16(bytes.subarray(2), false), encoding: "utf-16be" };
  }
  // --- UTF-8 سخت‌گیر ---
  try {
    const text = decodeUtf8Strict(bytes);
    if (!looksLikeUtf8Mojibake(text)) return { text, encoding: "utf-8" };
  } catch {
    /* UTF-8 نبود — ادامه به cp1256 */
  }
  // --- Windows-1256 ---
  return { text: decodeWindows1256(bytes), encoding: "windows-1256" };
}

/* ---------- ۲) تشخیص جداکننده ---------- */

const DELIMITER_CANDIDATES = [",", ";", "\t", "|"] as const;

/** شمارش جداکننده‌های کاندید در ۱۵ خط اول و انتخاب پرتکرارترین */
export function detectDelimiter(text: string): string {
  const sampleLines = text.split(/\r?\n/).slice(0, 15);
  let best = ",";
  let bestCount = -1;
  for (const d of DELIMITER_CANDIDATES) {
    let count = 0;
    for (const line of sampleLines) {
      for (const ch of line) if (ch === d) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return bestCount <= 0 ? "," : best;
}

/* ---------- ۳) پارسر RFC4180 ---------- */

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** پارسر CSV با پشتیبانی کامل کوتیشن، کوتیشن داخل کوتیشن، فیلدهای چندخطی */
export function parseCsvMatrix(text: string, delimiter?: string): string[][] {
  const clean = stripBom(text);
  const delim = delimiter ?? detectDelimiter(clean);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < clean.length) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delim) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // حذف ردیف‌های کاملاً خالی
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/* ---------- ۴) نرمال‌سازی هدر (ي/ك عربی → فارسی) ---------- */

/**
 * نرمال‌سازی هدر برای مقایسه — همان منطق سرور (app/api/import):
 * حذف ZWNJ/RLE-PDF/کشیده/فاصله/زیرخط/خط تیره + ي→ی + ك→ک + أإآ→ا + lowercase.
 * خروجی نرم‌افزارهای ایرانی اغلب «ي/ك» عربی دارند («رديف,نام كالا,في فروش»).
 */
export function normalizeHeaderKey(key: string): string {
  return key
    .replace(/[\u200c\u200f\u200e]/g, "")
    .replace(/[\s_\-.\u0640]/g, "")
    .replace(/\u064a/g, "\u06cc") // ي عربی → ی فارسی
    .replace(/\u0643/g, "\u06a9") // ك عربی → ک فارسی
    .replace(/[\u0623\u0625\u0622]/g, "\u0627") // أ إ آ → ا
    .toLowerCase()
    .trim();
}

/* ---------- ۵) معناشناسی ستون‌های خروجی هلو/سپیدار ---------- */

export type ColumnKind = "price" | "qty" | "percent" | "text" | "ignore";

export interface HeaderSemantic {
  /** فیلد هدف (برای مستندسازی/تست) */
  field: string;
  kind: ColumnKind;
}

/**
 * هدرهای خام (همان‌طور که در فایل ظاهر می‌شوند — با ي/ك عربی یا فارسی،
 * فرقی نمی‌کند) → معناشناسی. کلیدها در زمان لود با normalizeHeaderKey
 * نرمال می‌شوند تا خطای دستیِ نسخهٔ نرمال‌شده ممکن نباشد.
 */
const RAW_HEADER_SEMANTICS: Array<[string, HeaderSemantic]> = [
  // --- ردیف و گروه‌ها ---
  ["رديف", { field: "rowNo", kind: "ignore" }],
  ["گروه اصلي", { field: "categoryMain", kind: "text" }],
  ["گروه فرعي", { field: "categorySub", kind: "text" }],
  ["گروه اصلی", { field: "categoryMain", kind: "text" }],
  ["گروه فرعی", { field: "categorySub", kind: "text" }],
  ["زیرگروه", { field: "categorySub", kind: "text" }],
  // --- نام/شرح ---
  ["نام كالا", { field: "name", kind: "text" }],
  ["نام کالا", { field: "name", kind: "text" }],
  ["شرح کالا", { field: "name", kind: "text" }],
  ["شرح", { field: "name", kind: "text" }],
  // --- موجودی/تعداد (تک‌مقداری — هرگز جذب نمی‌شود) ---
  ["موجودي", { field: "stock", kind: "qty" }],
  ["موجودی", { field: "stock", kind: "qty" }],
  ["تعداد", { field: "stock", kind: "qty" }],
  ["كميت", { field: "stock", kind: "qty" }],
  ["مقدار", { field: "stock", kind: "qty" }],
  // --- قیمت‌ها (جذب گروه‌های ۳رقمی) ---
  ["ميانگين خريد", { field: "purchasePriceAvg", kind: "price" }],
  ["میانگین خرید", { field: "purchasePriceAvg", kind: "price" }],
  ["آخرين في خريد", { field: "purchasePriceLast", kind: "price" }],
  ["آخرین فی خرید", { field: "purchasePriceLast", kind: "price" }],
  ["آخرين نرخ خريد", { field: "purchasePriceLast", kind: "price" }],
  ["قیمت خرید", { field: "purchasePrice", kind: "price" }],
  ["نرخ خرید", { field: "purchasePrice", kind: "price" }],
  ["في فروش", { field: "salePrice", kind: "price" }],
  ["فی فروش", { field: "salePrice", kind: "price" }],
  ["فی", { field: "salePrice", kind: "price" }],
  ["نرخ فروش", { field: "salePrice", kind: "price" }],
  ["قیمت فروش", { field: "salePrice", kind: "price" }],
  ["قیمت", { field: "salePrice", kind: "price" }],
  ["قیمت عمده", { field: "wholesalePrice", kind: "price" }],
  // --- متن ---
  ["توضيحات", { field: "description", kind: "text" }],
  ["توضیحات", { field: "description", kind: "text" }],
  // --- درصد (تک‌مقداری) ---
  ["درصد تخفيف", { field: "ignore", kind: "percent" }],
  ["درصد تخفیف", { field: "ignore", kind: "percent" }],
  // --- واحد ---
  ["واحد هاي کالا", { field: "unit", kind: "text" }],
  ["واحد های کالا", { field: "unit", kind: "text" }],
  ["واحد شمارش", { field: "unit", kind: "text" }],
  ["واحد كالا", { field: "unit", kind: "text" }],
  ["واحد کالا", { field: "unit", kind: "text" }],
  ["واحد", { field: "unit", kind: "text" }],
  // --- ستون‌های بی‌اثر (نادیده گرفته می‌شوند) ---
  ["موجودي با احتساب پيش فاکتور", { field: "ignore", kind: "ignore" }],
  ["موجودی با احتساب پیش فاکتور", { field: "ignore", kind: "ignore" }],
  ["آخرين تاريخ تغيير قيمت فروش", { field: "ignore", kind: "ignore" }],
  ["آخرین تاریخ تغییر قیمت فروش", { field: "ignore", kind: "ignore" }],
];

/** نقشهٔ نرمال‌شده — یک‌بار در زمان لود ساخته می‌شود */
export const HEADER_SEMANTICS: Record<string, HeaderSemantic> = (() => {
  const map: Record<string, HeaderSemantic> = {};
  for (const [raw, sem] of RAW_HEADER_SEMANTICS) {
    const nk = normalizeHeaderKey(raw);
    if (nk && !(nk in map)) map[nk] = sem;
  }
  return map;
})();

/** نوع یک هدر فایل — پیش‌فرض: text (بدون جذب سلول) */
export function headerKind(header: string): ColumnKind {
  return HEADER_SEMANTICS[normalizeHeaderKey(header)]?.kind ?? "text";
}

/** فیلد معنایی یک هدر (برای تست‌ها/دیباگ) */
export function headerField(header: string): string | undefined {
  return HEADER_SEMANTICS[normalizeHeaderKey(header)]?.field;
}

/* ---------- ۶) بازچینش قیمت‌های شکسته ---------- */

const THREE_DIGIT_RE = /^\d{3}$/;
const ALL_DIGITS_RE = /^\d+$/;
/** حداکثر گروه‌های هزارگی که به یک قیمت الحاق می‌شود (تا ۱۰^۱۸) */
const MAX_PRICE_GROUPS = 6;
/** بالاترین تعداد ستون برای backtracking (محافظ پیچیدگی) */
const MAX_BACKTRACK_HEADERS = 64;

function padRow(cells: string[], length: number): string[] {
  if (cells.length >= length) return cells.slice(0, length);
  return [...cells, ...new Array(length - cells.length).fill("")];
}

/**
 * تخصیص سلول‌ها به ستون‌ها با backtracking:
 * - هر ستون ≥۱ سلول مصرف می‌کند و همهٔ سلول‌ها دقیقاً مصرف می‌شوند
 * - ستون قیمتی: سلول اول + گروه‌های ۳رقمی بعدی؛ سلول اول نباید صفرِ
 *   پیشرو داشته باشد («0» تنها مجاز است — «000» فقط ادامهٔ گروه است)
 * - ترتیب تلاش: بیشترین جذب اول (قیمت‌های گرد هزارگان)
 * خروجی null یعنی هیچ تخصیص معتبری وجود ندارد.
 */
function reassembleRowBacktrack(
  kinds: ColumnKind[],
  cells: string[]
): string[] | null {
  const n = kinds.length;
  if (n === 0 || n > MAX_BACKTRACK_HEADERS || cells.length < n) return null;
  const out: string[] = new Array(n).fill("");

  const walk = (h: number, ci: number): boolean => {
    if (h === n) return ci === cells.length;
    if (ci >= cells.length) return false; // هر ستون ≥۱ سلول
    const cell = (cells[ci] ?? "").trim();
    if (kinds[h] !== "price") {
      out[h] = cells[ci] ?? "";
      return walk(h + 1, ci + 1);
    }
    if (cell === "" || !ALL_DIGITS_RE.test(cell)) {
      // قیمت خالی/غیرعددی → تک‌سلولی
      out[h] = cells[ci] ?? "";
      return walk(h + 1, ci + 1);
    }
    if (cell.length > 1 && cell.startsWith("0")) {
      // «000» یا «0450» به‌عنوان سلول اول قیمت نامعتبر است
      return false;
    }
    // حداکثر گروه‌های قابل جذب
    let maxK = 0;
    if (cell !== "0") {
      while (
        maxK < MAX_PRICE_GROUPS &&
        ci + 1 + maxK < cells.length &&
        THREE_DIGIT_RE.test((cells[ci + 1 + maxK] ?? "").trim())
      ) {
        maxK++;
      }
    }
    for (let k = maxK; k >= 0; k--) {
      let value = cell;
      for (let j = 1; j <= k; j++) value += (cells[ci + j] ?? "").trim();
      out[h] = value;
      if (walk(h + 1, ci + 1 + k)) return true;
    }
    return false;
  };

  return walk(0, 0) ? out : null;
}

/**
 * جذب حریصانه با سقف budget = سلول‌های اضافه (fallback مطمئن):
 * سلول‌های ۳رقمی بعد از ستون‌های قیمتی الحاق می‌شوند تا budget تمام شود؛
 * سلول‌های انتهاییِ باقی‌مانده رها می‌شوند.
 */
function reassembleRowGreedy(
  kinds: ColumnKind[],
  cells: string[]
): string[] {
  const nHeaders = kinds.length;
  let budget = cells.length - nHeaders;
  const out: string[] = [];
  let ci = 0;
  for (let h = 0; h < nHeaders; h++) {
    if (ci >= cells.length) {
      out.push("");
      continue;
    }
    const cell = (cells[ci++] ?? "").trim();
    if (
      kinds[h] === "price" &&
      cell !== "" &&
      ALL_DIGITS_RE.test(cell) &&
      !(cell.length > 1 && cell.startsWith("0"))
    ) {
      let value = cell;
      while (
        budget > 0 &&
        ci < cells.length &&
        THREE_DIGIT_RE.test((cells[ci] ?? "").trim())
      ) {
        value += (cells[ci++] ?? "").trim();
        budget--;
      }
      out.push(value);
    } else {
      out.push(cell);
    }
  }
  return out;
}

/**
 * بازچینش یک ردیف CSV با هدرهای «نوع‌دار»:
 * - ردیف با تعداد سلول ≤ هدر → فقط pad (بدون تغییر — سازگار با CSV سالم)
 * - ردیف با سلول بیشتر → backtracking؛ در نبود تخصیص معتبر → greedy fallback
 */
export function reassembleRow(kinds: ColumnKind[], cells: string[]): string[] {
  const nHeaders = kinds.length;
  if (cells.length <= nHeaders) {
    return padRow(cells, nHeaders);
  }
  return reassembleRowBacktrack(kinds, cells) ?? reassembleRowGreedy(kinds, cells);
}

/* ---------- ۷) ارقام/اعداد فارسی ---------- */

/** ارقام فارسی/عربی → انگلیسی + حذف جداکننده هزارگان همه‌جانبه */
export function normalizeDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[٫/]/g, ".")
    .replace(/[,،٬\s\u00A0\u200C\u200E\u200F]/g, "");
}

/** مقدار عددی از سلول (با پشتیبانی ارقام فارسی) — fallback 0 */
export function toNumberLoose(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value !== "string") return fallback;
  const n = Number(normalizeDigits(value));
  return Number.isFinite(n) ? n : fallback;
}

/** سلول خالی/عددی است؟ (برای واحد: «واحد هاي کالا»=0 → «عدد») */
export function isBlankOrNumeric(value: string): boolean {
  const v = value.trim();
  return v === "" || /^[\d.,،٬\s۰-۹٠-٩]+$/.test(v);
}

/* ---------- ۸) ترکیب دسته‌بندی «اصلی / فرعی» ---------- */

/**
 * گروه اصلی + فرعی → نام دسته‌بندی:
 * هر دو پر و متفاوت → «اصلی / فرعی»؛ فقط یکی پر → همان؛ هیچ‌کدام → ""
 */
export function combineCategory(main: string, sub: string): string {
  const m = (main ?? "").trim();
  const s = (sub ?? "").trim();
  if (m && s && m !== s) return `${m} / ${s}`;
  return m || s || "";
}

/* ---------- ۹) ماتریس → ردیف‌های آبجکتی ---------- */

export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: string;
  encoding: string;
}

function uniqueHeaders(rawHeaders: string[]): string[] {
  const seen = new Map<string, number>();
  return rawHeaders.map((h, i) => {
    const base = (h ?? "").trim() || `ستون ${i + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

/**
 * تبدیل ماتریس خام (هدر + ردیف‌ها) به آبجکت‌ها با بازچینش قیمت‌های شکسته.
 * reassemble=false برای Excel (قیمت‌ها تک‌سلولی هستند).
 */
export function matrixToTable(
  matrix: string[][],
  opts?: { delimiter?: string; encoding?: string; reassemble?: boolean }
): ParsedTable {
  const reassemble = opts?.reassemble ?? true;
  if (!matrix || matrix.length === 0) {
    return {
      headers: [],
      rows: [],
      delimiter: opts?.delimiter ?? ",",
      encoding: opts?.encoding ?? "",
    };
  }
  const headers = uniqueHeaders(matrix[0]);
  const kinds = matrix[0].map((h) => headerKind(h));
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r];
    if (!cells.some((c) => (c ?? "").trim() !== "")) continue; // ردیف کاملاً خالی
    const fixed = reassemble
      ? reassembleRow(kinds, cells)
      : padRow(cells, headers.length);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = (fixed[i] ?? "").trim();
    }
    rows.push(row);
  }
  return {
    headers,
    rows,
    delimiter: opts?.delimiter ?? ",",
    encoding: opts?.encoding ?? "",
  };
}

/** دیکد + تشخیص جداکننده + پارس + بازچینش — کل خط لولهٔ فایل‌های متنی */
export function parseDelimitedBuffer(
  buf: ArrayBuffer | Uint8Array
): ParsedTable {
  const { text, encoding } = decodeBuffer(buf);
  const delimiter = detectDelimiter(text);
  const matrix = parseCsvMatrix(text, delimiter);
  return matrixToTable(matrix, { delimiter, encoding, reassemble: true });
}
