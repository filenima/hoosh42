# اتصال کارتخوان (POS) به هوش — راهنمای نصب پل محلی

نسخه: Task 21-B · تاریخ: ۱۴۰۵

## چگونه کار می‌کند؟

«هوش» روی سرور (VPS) اجرا می‌شود و کارتخوان شما روی کامپیوتر خودتان متصل است؛
سرور نمی‌تواند مستقیم به دستگاه شما برسد. راه‌حل: یک **برنامهٔ پل (Bridge)** کوچک
روی همان کامپیوتری که کارتخوان به آن وصل است اجرا می‌کنید. مرورگرِ شما هنگام
«پرداخت با کارتخوان» درخواست را مستقیماً به همین برنامهٔ محلی می‌فرستد و پل،
مبلغ را به ترمینال (از طریق درایور/سرویس کارتخوان یا درگاه شارژ بانک شما)
ارسال می‌کند.

```
مرورگر (hoosh) ──HTTP──> پل محلی 127.0.0.1:9090 ──> کارتخوان / درگاه بانک
```

## فعال‌سازی در هوش

1. در ماژول «خرید و فروش» → منوی تنظیمات (چرخ‌دنده) → **اتصال کارتخوان**.
2. کلید «فعال» را روشن کنید، آدرس پل (پیش‌فرض `http://127.0.0.1:9090`) و در صورت
   نیاز شناسهٔ ترمینال را وارد کنید و ذخیره کنید.
3. با دکمهٔ **تست اتصال** سلامت پل را بررسی کنید (باید `ok:true` بدهد).
4. از این پس در دیالوگ «دریافت وجه» فاکتورها، دکمهٔ **پرداخت با کارتخوان**
   ظاهر می‌شود.

## قرارداد HTTP پل (Contract)

| متد | مسیر | بدنه/پاسخ |
| --- | --- | --- |
| GET | `/health` | پاسخ: `{"ok":true,"version":"1.0.0"}` |
| POST | `/charge` | درخواست: `{"amountRial":2500000,"invoiceNumber":"1405-001","terminalId":"T1"}` |
| | | پاسخ موفق: `{"ok":true,"status":"paid","reference":"12345"}` |
| | | پاسخ ناموفق: `{"ok":false,"status":"failed","message":"لغو توسط مشتری"}` |

- پل باید هدر `Access-Control-Allow-Origin` را برای دامنهٔ هوش شما بفرستد
  (در نمونهٔ زیر `*` گذاشته شده — در محیط واقعی دامنهٔ خودتان را بنویسید).
- مهلت پاسخ (timeout) از تنظیمات هوش قابل تغییر است (پیش‌فرض ۳۰ ثانیه).
- اگر پاسخ در مهلت نیامد، هوش پیام خطای فارسی می‌دهد و گزینهٔ «ثبت دستی پرداخت»
  نمایش داده می‌شود.

## نمونه پل با Node.js (~۴۰ خط)

فایل `pos-bridge.js` را ذخیره و اجرا کنید:

```js
// pos-bridge.js — پل محلی کارتخوان برای هوش
// اجرا:  node pos-bridge.js    (نیازمند Node 18+)
// توجه: این نمونهٔ آموزشی است — تابع doCharge را به درایور/سرویس کارتخوان
// خودتان (شاپرک، سامان کیش، پارسیان و…) وصل کنید.
const http = require("http");

const PORT = 9090;
const TERMINAL_ID = "T1";

// 🔌 اینجا اتصال واقعی به کارتخوان را پیاده کنید:
async function doCharge(amountRial, terminalId, invoiceNumber) {
  // مثال: فراخوانی SDK کارتخوان یا HTTP سرویس بانک
  // خروجی مورد انتظار: { ok: true, status: "paid", reference: "..." }
  await new Promise((r) => setTimeout(r, 1500)); // شبیه‌سازی
  return { ok: true, status: "paid", reference: String(Date.now()).slice(-8) };
}

const server = http.createServer(async (req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*", // در پروداکشن: دامنهٔ هوش شما
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

  const url = req.url.split("?")[0];
  if (req.method === "GET" && url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    return res.end(JSON.stringify({ ok: true, version: "1.0.0", terminalId: TERMINAL_ID }));
  }

  if (req.method === "POST" && url === "/charge") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { amountRial, terminalId, invoiceNumber } = JSON.parse(body || "{}");
      if (!Number.isFinite(amountRial) || amountRial <= 0) throw new Error("مبلغ نامعتبر");
      const result = await doCharge(amountRial, terminalId || TERMINAL_ID, invoiceNumber);
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ ok: false, status: "failed", message: String(err.message || err) }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json", ...cors });
  res.end(JSON.stringify({ ok: false, message: "not found" }));
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`POS bridge on http://127.0.0.1:${PORT}`)
);
```

## پرسش‌های رایج

- **آیا این درخواست از سرور هوش رد می‌شود؟** خیر — مستقیماً از مرورگر شما به
  `127.0.0.1` زده می‌شود (استثنای عمدی معماری؛ در کد `lib/pos-terminal.ts`
  مستند شده).
- **اگر پل در دسترس نباشد؟** خطای فارسی می‌گیرید و می‌توانید پرداخت را
  «ثبت دستی» کنید — فاکتور شما گیر نمی‌کند.
- **چند کارتخوان؟** فعلاً یک پل/ترمینال per tenant پشتیبانی می‌شود؛ برای
  چند ترمینال، پل می‌تواند بر اساس `terminalId` مسیریابی کند.
