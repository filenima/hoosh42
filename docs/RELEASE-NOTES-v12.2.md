# هوش — یادداشت‌های انتشار v12.2.0 (۲۰۲۶-۰۹-۱۷)

> این نسخه روی همان سورس v12.1.2-golive ساخته شده — **هیچ سورس جدیدی ساخته نشده.**
> ارتقای ایمن: **بدون تغییر schema دیتابیس** — مستقیم deploy روی دیتابیس موجود مجاز است.

---

## ۱) رفع باگ‌های گزارش‌شده مالک

| شناسه | مشکل (گزارش مالک) | رفع |
|---|---|---|
| **PAY-1** 🔴 | «درگاه پرداخت خطا میده» — پشت reverse-proxy آدرس کال‌بک با `req.nextUrl.origin` ساخته می‌شد → `http://localhost:3000` → زرین‌پال با **-10/-14** رد می‌کرد | تابع `resolvePaymentCallbackBase()` در lib/zarinpal.ts: اولویت تنظیم سوپرادمین → env → برندینگ → هدرهای پروکسی. اعمال در `/api/payments/create` |
| **PAY-2** 🔴 | «توی پنل سوپرادمین نمیشه کال بک رو ست کرد» | فیلد **«آدرس پایه کال‌بک»** + کلید sandbox در پنل سوپرادمین (صورتحساب و پرداخت → درگاه پرداخت) با نمایش «کال‌بک مؤثر» + توضیح خطای -10/-14. `enforcePaymentCallbackOrigin()` در ALL مسیرهای پرداخت (subscribe / register-and-pay / integrations) |
| **PAY-3** 🟠 | endpoint های زرین‌پال هاردکد تولید بودند | همه مسیرها حالا از `zarinpalUrls(sandbox)` استفاده می‌کنند — تست با sandbox ایمن شد (subscribe / register-and-pay / integrations) |
| **WH-1** 🔴 | «کد کالا SKU باید اتومات پر بشه» | API جدید `GET /api/products/next-sku` + prefill خودکار در فرم کالای جدید (انبار) و QuickCreate فاکتور — کاربر می‌تواند ویرایش کند. POST /api/products هم اگر SKU خالی بفرستید، ترتیبی تولید می‌کند |
| **WH-2** 🔴 | «هر کالای جدیدی توی فاکتور ساخته میشه باید توی انبار هم ذخیره بشه یا سوال بپرسه» | ردیف‌های فاکتور با شرح آزاد (بدون انتخاب کالا) دیگر **بی‌صدا حذف نمی‌شوند** — دیالوگ «ذخیره اقلام در انبار؟» با سه گزینه: ذخیره همه / فقط فاکتور / انصراف. با «ذخیره» کالا ساخته شده و به ردیف متصل می‌شود |
| **WH-3** 🟠 | کالاهای ساخته‌شده در فاکتور در لیست انبار دیده نمی‌شدند (stale) | رویداد سراسری `hoshhesab:data-changed` — ماژول انبار خودکار refresh می‌شود |
| **PREVIEW** 🟠 | «پیشنمایش کار نمی‌کنه» در sandbox dev | ریشه: OOM-kill سرور dev هنگام باز شدن پیش‌نمایش. circuit-breaker `turbopackMemoryLimit: 3072` + `turbopackFileSystemCacheForDev: false` + heap 1024MB — سرور زنده می‌ماند |

## ۲) قابلیت‌های جدید پنل سوپرادمین

### 📊 داشبورد مالی SaaS (تب جدید)
- **MRR / ARR / Churn%** با کارت‌های آماری و نشانگر روند
- نمودار رشد ۱۲ ماه (ماه شمسی): درآمد + کاربر جدید + churn
- توزیع tenant ها بر اساس پلن + جدول ماهانه + ARPU
- API: `GET /api/platform/saas-metrics`

### 💰 ویرایش کامل پلن‌ها (قیمت + امکانات + محدودیت‌ها)
- تب «محدودیت پلن‌ها»: **قیمت (تومان)**، امکانات (خط به خط)، نام، توضیح، popular، hidden + سقف کاربر/فاکتور/انبار + reset به پیش‌فرض
- ذخیره در `plan_overrides_v2` → **بلافاصله** روی صفحه قیمت، لندینگ، چک‌اوت و اعتبارسنجی مبلغ پرداخت اعمال می‌شود (`getPlanByPriceCheckEffective`)
- API عمومی جدید: `GET /api/plans` (منبع واحد همه نمایش‌ها)

### 🐞 اتوماسیون پاداش باگ (بدون کلیک)
- قواعد قابل تنظیم: **بحرانی = ۳۰ روز پلن حرفه‌ای، زیاد = ۱۵ روز** (پیش‌فرض فعال)
- با «تأیید باگ» در پنل سوپرادمین، پاداش **خودکار** صادر می‌شود (لایسنس + ارتقای tenant + امتیاز وفاداری + AuditLog `BUG_REWARD_AUTO_GRANTED`)
- شدت کم/متوسط: جریان دستی قبلی (پاپ‌آپ انتخاب) حفظ شد
- تنظیم قواعد: `GET/PUT /api/platform/bug-reports/settings`

### 📣 پیام‌های گروهی (تب جدید)
- ارسال **اعلان درون‌برنامه‌ای + ایمیل** به کاربران هدفمند
- فیلتر پلن (همه/رایگان/پایه/حرفه‌ای/سازمانی) + فعالیت (فعال ۷ روز / غایب ۳۰ روز)
- پیش‌نمایش تعداد گیرندگان + خلاصه ارسال + تاریخچه ۲۰ پیام آخر
- ایمیل سمت سرور با قالب برندشده RTL و تأخیر ۲۰۰ms (spam-safe)

### 🚨 هشدارهای سلامت
- **تلگرام + ایمیل** به مالک هنگام: خطای verify پرداخت (پول گرفته شد ولی تأیید نشد)، ...
- تنظیمات در تب پیام‌ها + دکمه تست + dedupe ۳۰ دقیقه‌ای per-key + ثبت در AuditLog

### 💾 بکاپ‌گیری خودکار روزانه (تب جدید)
- **بکاپ خودکار روزانه** (lazy — با اولین باز شدن پنل در روز، اگر >۲۴h گذشته) + دکمه «تهیه فوری»
- دانلود مستقیم از پنل + حذف + retention خودکار ۳۰ نسخه
- WAL checkpoint قبل از کپی → بکاپ سالم SQLite + مسیر دانلود ضد path-traversal
- API: `GET/POST/DELETE /api/platform/backups` + `GET /api/platform/backups/[name]`

## ۳) بهبودهای امنیتی
- endpoint های جدید همه superadmin-only (401 بدون توکن / با توکن کاربر عادی هم 401)
- اعتبارسنجی URL کال‌بک (فقط http/https) + path-traversal مسدود
- sandbox درگاه حالا واقعاً رعایت می‌شود (قبلاً تست با مرچنت واقعی به درگاه تولیدی می‌رفت!)

## ۴) موارد رایت‌شده روی نسخه قبلی (تأیید مجدد)
- سیستم رفرال: کد → ثبت‌نام دوست → SIGNED_UP → (پس از پرداخت موفق → REWARDED + ۵۰,۰۰۰ تومان) — E2E تست شد ✓
- گزارش باگ با اسکرین‌شات (پنل کاربر) + بررسی در سوپرادمین ✓ (موجود بود، سالم است)
- PWA: manifest + service worker + push subscription ✓ (موجود بود)

## ۵) فایل‌های جدید مهم
```
lib/product-sku.ts, lib/bug-rewards.ts, lib/health-alerts.ts, lib/backup.ts
app/api/products/next-sku/route.ts
app/api/plans/route.ts
app/api/platform/saas-metrics/route.ts
app/api/platform/backups/route.ts + [name]/route.ts
app/api/platform/messaging/{targets,send-email,alerts-settings}/route.ts
app/api/platform/bug-reports/settings/route.ts
components/views/superadmin/{saas-finance-tab,backup-tab,messaging-tab}.tsx
```

## ۶) ارتقا (deploy)
1. سورس را جایگزین کنید (بدون پوشه‌های node_modules/.next/db/backups خودتان)
2. `bun install` (بدون تغییر پکیج‌ها — فقط امنتی)
3. **نیازی به prisma db push نیست** (بدون تغییر schema)
4. در پنل سوپرادمین → درگاه پرداخت: «آدرس پایه کال‌بک» را `https://hoosh.nobatime.ir` بگذارید
5. `tsc --noEmit` = ۰ خطا ✓
