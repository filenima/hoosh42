# هوش — یادداشت انتشار v12.3.0 (بازبینی ۲)

تاریخ: ۱۴۰۵/۰۶/۲۷ — بر پایه v12.2.0 (بدون تغییر دیتابیس؛ قابل استقرار روی دیتابیس موجود بدون db push)

## ۱) رفع باگ‌های گزارش‌شده مالک

### درگاه پرداخت — خطای -14 (The callback URL domain does not match the registered terminal domain)
- **ریشه:** چهار مسیر پرداخت، تنظیمات مرکزی (آدرس کال‌بک + سندباکس) را نادیده می‌گرفتند و URLهای تولیدی زرین‌پال هاردکد بود:
  1. `POST /api/platform/payment-test` (تست پرداخت پنل سوپرادمین — عین خطای گزارش‌شده): از این پس `resolvePaymentCallbackBase()` را می‌خواند (اولویت: تنظیم سوپرادمین → env → برندینگ → پروکسی) و URLها از `zarinpalUrls(sandbox)` ساخته می‌شوند. پاسخ اکنون شامل `callbackUrl` مؤثر است تا همیشه ببینید چه آدرسی ارسال می‌شود. (PAY-4)
  2. `POST /api/portal/[token]/pay` (پورتال پرداخت مشتریان): همان اصلاحات. (PAY-5)
  3. `GET|POST /api/integrations/payment/verify`: تأیید تراکنش به همان محیطی می‌رود که پرداخت در آن ساخته شده (سندباکس/تولیدی). قبلاً verify همیشه به api.zarinpal.com می‌رفت و پرداخت‌های سندباکس هرگز تأیید نمی‌شدند. (PAY-6)
  4. `POST /api/payment` (درگاه legacy چندگانه): سندباکس + بازنویسی origin کال‌بک با `enforcePaymentCallbackOrigin`. (PAY-7)
- **خطای مسیر اشتباه sandbox:** فیلد درست `settings.zarinpal.sandbox` است (قبلاً سطح اشتباه خوانده می‌شد → سندباکس هرگز فعال نمی‌شد).
- **راهنمای اکشن برای مالک:** در پنل سوپرادمین → صورتحساب و پرداخت → تب درگاه پرداخت: «آدرس بازگشت (Callback Base URL)» را دقیقاً `https://hoosh.nobatime.ir` بگذارید. حالت سندباکس برای تست پول‌واقعی‌نزدن روشن بماند؛ برای فروش واقعی خاموشش کنید. خطاهای -10/-14 حالا راهنمای دقیق درون‌پیام دارند.

### انبار — فیلد «موجودی اولیه» نبود (کالا همیشه با ۰ ثبت می‌شد)
- فرم کالای جدید اکنون فیلد «موجودی اولیه» دارد (WH-5): مقدار واردشده در انبار پیش‌فرض ثبت و یک رسید تعدیل (ADJUSTMENT) در گردش انبار ایجاد می‌شود — API از قبل پشتیبانی می‌کرد، فرم اضافه شد. در ویرایش کالا این فیلد عمداً نیست (تغییر موجودی از مسیر شمارش/گردش).

### فاکتور سریع — کالای جدید نمایش داده نمی‌شد
- کش ۳ دقیقه‌ای localStorage لیست کالا/طرف‌ها (WH-6): حالا الگوی stale-while-revalidate (نمایش فوری از کش + تازه‌سازی همیشگی پس‌زمینه) + شنونده رویداد `hoshhesab:data-changed` برای ابطال بی‌درنگ هنگام ثبت کالا در انبار/فاکتور اصلی.

### لوگو
- نشان پیش‌فرض برند ارتقا یافت (گرادیان عمیق‌تر، نقاط داده، سایه) (LOGO-1). تصویر خراب/ناکافی `logoUrl` با `onError` خودکار به نشان پیش‌فرض برمی‌گردد — دیگر «Z» یا تصویر شکسته دیده نمی‌شود.
- پنل سوپرادمین → برندینگ: دکمه «بازنشانی به لوگوی پیش‌فرض» + لینک مشاهده تصویر فعلی اضافه شد. (اگر روی سرور شما لوگوی قدیمی ذخیره شده، همین دکمه آن را پاک می‌کند.)

### پیش‌نمایش فاکتور
- ممیزی کامل زنجیره (دکمه → دیالوگ → fetch تک‌فاکتور → مولد HTML → iframe): همه لایه‌ها تست شدند و سالم‌اند؛ خطای قبلی «نبود دکمه/کد مرده» در v12.1 رفع شده بود. اولین کلیک به‌دلیل lazy-compile کند است (چند ثانیه) — عادی است. اگر روی سرور شما مشکل باقی است، پاپ‌آپ‌کر مرورگر را مجاز کنید و کش مرورگر را پاک کنید.

### همگام‌سازی قیمت با دلار (درخواست جدید)
- قابلیت موجود «همگام‌سازی قیمت با نرخ بازار» (انبار → کارت همگام‌سازی) تست و تأیید شد: لنگر دلار آمریکا، اسنپ‌شات قیمت پایه، و با تغییر نرخ، قیمت‌های ریالی به تناسب به‌روز می‌شوند. پلن حرفه‌ای/سازمانی.

## ۲) بلاگ — ۲۷ مقاله سئوی تخصصی
- ۲۷ مقاله فارسی (هرکدام ۳٫۶ تا ۵٫۵ هزار کلمه) در ۶ دسته (مودیان، مالیات، حسابداری، حقوق و دستمزد، فاکتور/انبار، کسب‌وکار/نرم‌افزار) با کلیدواژه‌های پرجستجو، جداول، مثال‌های عددی، FAQ، لینک‌سازی داخلی، متادیتا و JSON-LD خودکار.
- **مهم برای استقرار:** پوشه `blog-seed/` به بسته اضافه شده است. پس از استقرار روی سرور، اجرا کنید:
  `bun blog-seed/seed.mjs` (idempotent است — بر اساس slug مقالات را upsert می‌کند)
- اسلاگ‌ها: moadian-system-complete-guide، electronic-invoice-moadian-guide، vat-tax-1404-guide، vat-return-filing-guide، income-tax-assessment-guide، article-101-tax-law-guide، what-is-accounting-complete-guide، general-ledger-vs-subsidiary-ledger، trial-balance-guide، financial-statements-guide، petty-cash-and-bank-management، cash-flow-statement-guide، payroll-calculation-complete-guide، social-security-insurance-guide، payroll-tax-1404-brackets، severance-pay-calculation-guide، annual-leave-guide، sales-invoice-legal-guide، proforma-invoice-vs-invoice، sales-return-invoice-guide، stock-card-kardex-guide، cost-of-goods-calculation-guide، how-to-choose-accounting-software، cloud-vs-desktop-accounting، free-vs-paid-accounting-software، retail-shop-accounting-guide، bank-reconciliation-guide

## ۳) نکات بهره‌برداری
- بدون تغییر schema — استقرار روی دیتابیس موجود بدون `db push` مجاز است.
- پس از استقرار: (۱) تنظیم کال‌بک درگاه طبق بالا (۲) اجرای seed بلاگ (۳) بازنشانی لوگو اگر لازم بود.
- `tsc --noEmit` و eslint روی همه فایل‌های تغییریافته: پاک.
