# راهنمای کامل مهاجرت به سرور ایران (مبین‌هاست) — «هوش»

> **این سند، راهنمای مالکِ (Master Guide) مهاجرت سرور «هوش» است** و پاسخ می‌دهد:
> «سرور مبین‌هاست را خریدم — ۲ میلیون تومان پیکربندی بپردازم یا خودم؟ سورس را با گیت‌هاب ببرم یا نه؟ از کجا شروع کنم؟»
>
> - **سرور:** مبین‌هاست IR/VPS/KVM — ‏۱۲GB RAM، ۴ هسته، ۸۰GB SSD، پورت ۱۰Gbps، ۱۰۰GB ترافیک ماهانه (قابل توسعه)
> - **هزینه:** ~۱۵,۹۵۰,۰۰۰ IRR/ماه (≈ ۲۰M در سال) + ‏۲,۰۰۰,۰۰۰ IRR یک‌باره «پیکربندی سرور»
> - **دامنه:** `hoosh.nobatime.ir` (کنترل DNS در پنل `nobatime.ir`)
> - **مخاطب:** خودِ صاحب کسب‌وکار با تجربه‌ی سرور کم — هر دستور قابل کپی‌پیست است
>
> 📌 **اسناد مکمل همین پروژه:**
> - `DEPLOYMENT-GUIDE.md` (ریشه پروژه) — مرجع کامل استقرار؛ گزینه‌ی Caddy برای SSL، جزئیات پنل سوپرادمین (~۴۸ تب)، Smoke Test و جدول رفع اشکال آنجا است. این راهنما را **جایگزین** نمی‌کند، بلکه برای «سرور ایران + تصمیم ۲ میلیونی + گیت‌هاب + زرین‌پال/اینماد» آن را تکمیل و ساده‌تر می‌کند.
> - `BENCHMARK-REPORT.md` (پوشه `download/`) — ظرفیت واقعی این سرور برای ۱۰۰+ کاربر.
> - `UPGRADE-SUGGESTIONS.md` — نقشه راه ارتقا بعد از Go-Live.

> 🗓️ **به‌روزرسانی ۵ سپتامبر ۲۰۲۶ (آخرین نسخه):**
> - ✅ `prisma/schema.postgres.prisma` **اعتبارسنجی و اصلاح شد** (۵۱ خطای native-type رفع شد: `@db.Jsonb`→Text و `@db.Money`→`@db.BigInt`) — قبلاً `prisma db push` روی سرور با خطا می‌شکست؛ حالا معتبر است.
> - ✅ ایندکس‌های ترکیبی مهم به schema پستگرس اضافه شد: `Invoice(tenantId,date,status)`، `Invoice(tenantId,type,status)`، `Invoice(modianUid)`، `Invoice(modianStatus)`، `JournalEntry(tenantId,date,status)`، `JournalEntry(tenantId,fiscalYearId,status)`، `Notification(userId,isRead)`، `Notification(createdAt)` — هم‌راستا با SQLite اصلی.
> - ✅ کش ۳۰ثانیه‌ای `/api/dashboard` (per-tenant) پیاده شد + باطل‌سازی خودکار بعد از فاکتور/سند/حساب بانکی/پرداخت زرین‌پال.
> - ✅ polling اعلان‌ها از ۳۰s به ۶۰s + توقف کامل در تب غیرفعال (visibilitychange).
> - ✅ کد اینماد دقیق (id=742712) در فوتر لندینگ + اینستاگرام `webzlux_com` + تلگرام `webzlux` + واتساپ/موبایل `09176392389` کنار تلفن ثابت.
> - ✅ مرچنت زرین‌پال `bd690050-40f2-477c-8086-647688f7a514` در DB ثبت و با درخواست واقعی تست شد (خطای `-14` فقط به‌خاطر دامنه‌ی سندباکس است — روی `hoosh.nobatime.ir` رفع می‌شود؛ توضیح در ۸.۵).
> - ✅ هیروی لندینگ به ماک‌آپ زنده‌ی داشبورد برگشت (طبق سلیقه‌ی مالک) و تصاویر اضافی لندینگ حذف شدند (فقط بلاگ عکس دارد).

---

## فهرست

1. [تصمیم ۲ میلیونی: بپردازم یا خودم؟](#۱-تصمیم-۲-میلیونی)
2. [روش انتقال سورس — گیت‌هاب یا نه؟](#۲-روش-انتقال-سورس)
3. [آماده‌سازی سرور (دستورات دقیق)](#۳-آمادهسازی-سرور)
4. [مهاجرت دیتابیس SQLite → PostgreSQL](#۴-مهاجرت-دیتابیس-sqlite--postgresql)
5. [بیلد و اجرای دائمی (PM2)](#۵-بیلد-و-اجرا)
6. [Nginx + SSL دامنه hoosh.nobatime.ir](#۶-nginx--ssl)
7. [تنظیمات داخل اپ (.env و سوپرادمین)](#۷-تنظیمات-داخل-اپ)
8. [زرین‌پال](#۸-زرینپال)
9. [اینماد](#۹-اینماد)
10. [بکاپ خودکار](#۱۰-بکاپ-خودکار)
11. [مانیتورینگ و نگهداشت](#۱۱-مانیتورینگ-و-نگهداشت)
12. [چک‌لیست نهایی Go-Live](#۱۲-چکلیست-نهایی-go-live)
13. [سؤالات پرتکرار (FAQ)](#۱۳-سؤالات-پرتکرار-faq)

---

## ۱. تصمیم ۲ میلیونی

سرویس «پیکربندی سرور» مبین‌هاست (۲,۰۰۰,۰۰۰ IRR یک‌باره) معمولاً شامل نصب سیستم‌عامل، فایروال، وب‌سرور و SSL است. آیا ارزش دارد؟

### ۱.۱ مقایسه صادقانه

| گزینه | هزینه | زمان شما | ریسک | مناسب چه کسی؟ |
|---|---|---|---|---|
| همه را خودم انجام دهم با این راهنما | ۰ | ‏۴-۶ ساعت اولین بار | کم (دستورها تست‌شده‌اند) | کمی حوصله + توان کپی‌پیست |
| **راه وسط (پیشنهاد این راهنما):** خرید «کانفیگ پایه» و ادامه خودم | ۲M | ‏۱-۲ ساعت | خیلی کم | شما ✅ — با تجربه‌ی کم |
| بدهم پشتیبان همه‌چیز را بکند | ۲M+ | ‏۳۰ دقیقه | متوسط — چون جزئیات اپ (Prisma/PM2/پنل سوپرادمین) را نمی‌شناسد و احتمالاً فقط زیرساخت را نصب می‌کند | کسی که وقت صفر دارد |

**توصیه صریح:** با دانش فنی کم، پرداخت ۲ میلیون برای **راه‌اندازی اولیه‌ی زیرساخت** منطقی و منصفانه است — اما توجه کنید:
- پشتیبان هاست معمولاً «نصب وردپرس/لاراول» را بلد است، نه این استک (Next.js + Prisma + PM2). **بخش اپ را به‌هرحال خودتان با این راهنما انجام می‌دهید (~۸۰٪ ارزش کار).**
- اگر ۴-۶ ساعت وقت دارید، با همین راهنما کل مسیر بدون هزینه انجام می‌شود — همه‌ی دستورها مرحله‌به‌مرحله و تست‌شده‌اند.
- **راه وسط بهترین نسبت ارزش/هزینه است:** از پشتیبان فقط «کانفیگ پایه سرور» بگیرید (بخش ۱.۲)، بعد خودتان سورس/دیتابیس/اپ/زرین‌پال/اینماد را بچینید.

### ۱.۲ دقیقاً چه چیزی از پشتیبان مبین‌هاست بخواهم (چک‌لیست سفارش)

این متن را برای تیکت پشتیبانی کپی کنید:

> لطفاً روی VPS من (IP: …) پیکربندی پایه انجام شود:
> ۱) نصب **Ubuntu 22.04 یا 24.04 LTS** (تمیز، بدون پنل اضافه)
> ۲) ساخت کاربر غیر-root با دسترسی sudo (نام: `deploy`) و تنظیم **ورود SSH با کلید**
> ۳) فعال‌سازی فایروال **ufw** فقط با پورت‌های ۲۲، ۸۰، ۴۴۳
> ۴) نصب **Nginx** به‌عنوان reverse proxy برای پورت ۳۰۰۰ + گواهی SSL با **certbot** برای دامنه `hoosh.nobatime.ir`
> ۵) نصب **PostgreSQL 16** و ساخت دیتابیس/کاربر (من خودم رمزها را ست می‌کنم)
> ۶) نصب **Node.js 20+**
> ⚠️ رمزهای root و کاربر deploy را در پایان به من بدهید؛ به هیچ عنوان فایل‌های اپ/`.env` را در اختیار نگذارید.

| ✔ | خواسته | چرا لازم است | اگر خودتان بکنید |
|---|---|---|---|
| ☐ | Ubuntu 22.04/24.04 **LTS** تمیز | پایه همه‌چیز؛ LTS = آپدیت ۵ ساله | در پنل مبین‌هاست هنگام ساخت VPS انتخاب می‌شود (خودتان هم می‌توانید) |
| ☐ | کاربر non-root (`deploy`) + کلید SSH | اجرای اپ با root = ریسک امنیتی جدی | بخش ۳.۲ همین راهنما (۵ دقیقه) |
| ☐ | فایروال ufw (۲۲/۸۰/۴۴۳) | بستن پورت ۵۴۳۲ (PostgreSQL) و ۳۰۰۰ در برابر اینترنت | بخش ۳.۳ (۲ دقیقه) |
| ☐ | Node 20+ و (اختیاری) Bun | موتور اجرای Next.js | بخش ۳.۵ (۵ دقیقه) |
| ☐ | PostgreSQL 16 + DB/کاربر | دیتابیس production | بخش ۳.۶ (۱۰ دقیقه) |
| ☐ | Nginx reverse proxy + SSL (certbot) | HTTPS دامنه | بخش ۶ (۱۵ دقیقه) |

### ۱.۳ قواعد امنیتی وقتی کار را دیگری انجام می‌دهد

- ⛔ **هرگز** محتویات `.env`، کد پذیرنده زرین‌پال، رمز Gmail/SMTP یا کلیدهای VAPID را به هیچ‌کس (حتی پشتیبان هاست) ندهید. آن‌ها فقط روی سرور و نزد خودتان باید باشند.
- ✅ بعد از تحویل کار: رمز `root` و `deploy` و کاربر PostgreSQL را **خودتان عوض کنید**، ورود با رمز به SSH را ببندید (بخش ۱۱.۵) و وجود فایل‌های اضافی (`ls -la /home/deploy`) را چک کنید.
- ✅ از پشتیبان بخواهید فهرست دقیق هر کاری که کرده را بنویسد (برای عیب‌یابی بعدی).

---

## ۲. روش انتقال سورس

### ۲.۱ سه گزینه

| معیار | 🥇 گیت‌هاب (repo خصوصی) | آپلود مستقیم (zip + SFTP) | rsync / git مستقیم روی سرور |
|---|---|---|---|
| سادگی اولیه | متوسط (یک‌بار یاد می‌گیرید) | خیلی ساده | متوسط |
| تاریخچه/نسخه | ✅ کامل — هر تغییر ثبت می‌شود | ❌ هیچ | ✅ (rsync فقط کپی است ولی git-روی-سرور تاریخچه دارد) |
| بازگشت به نسخه قبل (rollback) | ✅ `git checkout` در ۱۰ ثانیه | ❌ (باید zip قدیمی نگه دارید) | ✅ |
| آپدیت‌های بعدی | `git pull` (چند ثانیه) | آپلود دوباره کل فایل‌ها | push/checkout |
| اعتماد نفس «چه چیزی روی سرور است؟» | ✅ دقیقاً همان commit | مبهم | ✅ |
| CI/CD بعداً (تست/دپلوی خودکار) | ✅ آماده | ❌ | نیمه |
| دسترسی از ایران | معمولاً OK؛ گاهی کند | ✅ (SFTP مستقیم) | ✅ |
| **حکم** | **پیشنهاد اصلی** | فقط برای شروعِ فوری | بهترین گزینه پایدار برای ایران |

**پاسخ سؤال شما: بله، گیت‌هاب (repo خصوصی) پیشنهاد اصلی است** — نه به‌خاطر «مكان ذخیره»، بلکه به‌خاطر نسخه‌بندی و rollback: وقتی آپدیت بعدی چیزی را خراب کرد، با یک دستور به دیروز برمی‌گردید. از آپلود zip صرفاً برای «اولین بار/انتقال اضطراری» استفاده کنید.

### ۲.۲ آموزش گیت از صفر (روی سیستم خودتان)

> سیستم شما ویندوز است؟ «Git Bash» را از git-scm.com نصب کنید — همه دستورها همان‌جا کار می‌کنند. مک/لینوکس: ترمینال.

**مرحله ۱ — ساخت repo خصوصی در گیت‌هاب:**
1. در github.com ثبت‌نام/ورود کنید.
2. دکمه **New repository** → نام: `hoosh` → مخفی (**Private**) ⚠️ → **Create**. (صفحه بعدی را نبندید؛ آدرس repo لازم دارید: `https://github.com/USERNAME/hoosh.git`)

**مرحله ۲ — ⚠️ مهم‌ترین قانون امنیتی: کلیدها هرگز به گیت‌هاب نروند**

پروژه فایل `.gitignore` دارد که خط `.env*` را شامل می‌شود (یعنی گیت به‌طور پیش‌فرض فایل‌های `.env` را نادیده می‌گیرد). قبل از اولین commit این را **تأیید** کنید:

```bash
cd /home/z/my-project        # مسیر سورس «هوش» روی سیستم شما
grep -n "^\.env" .gitignore  # باید .env* را نشان دهد

# اطمینان نهایی — هیچ فایل محتوهمدار نباید در خروجی باشد:
git ls-files | grep -i "\.env"   # → خروجی خالی (یا فقط .env.example بدون مقدار واقعی)
git ls-files | grep -iE "\.db$|custom\.db"   # → دیتابیس هم نباید push شود

# اگر به‌اشتباه .env قبلاً add شده بود، از index حذفش کنید (از فایل روی دیسک حذف نمی‌شود):
git rm --cached .env
```

> 🔴 اگر روزی رمز/کلیدی روی گیت‌هاب push شد: فوراً آن رمز را **عوض** کنید (rotate) — حذف از history کافی نیست؛ ربات‌ها مخازن خصوصیِ لو رفته را هم اسکن می‌کنند.

**مرحله ۳ — اولین commit و push:**

```bash
cd /home/z/my-project
git init                                   # اگر repo از قبل init شده باشد، خطای بی‌ضرر می‌دهد
git add -A
git commit -m "نسخه پایدار هوش قبل از استقرار سرور ایران"
git branch -M main
git remote add origin https://github.com/USERNAME/hoosh.git
git push -u origin main
# نام کاربری/رمز گیت‌هاب: رمز حساب کاربری جواب نمی‌دهد؛ باید Personal Access Token بسازید:
#   GitHub → Settings → Developer settings → Personal access tokens → Generate new token
#   دسترسی repo را تیک بزنید و توکن را جای رمز paste کنید.
```

> اگر سرعت/دسترسی گیت‌هاب از ایران مشکل بود: با شبکه‌ای که در اختیار دارید push کنید، یا از گزینه «git مستقیم روی سرور» (بخش ۲.۴) استفاده کنید — push از سیستم خودتان به IP سرور خودتان همیشه سریع است.

**مرحله ۴ — کلید Deploy روی سرور (لازم برای pull بدون رمز):**

روی **سرور** (بعد از ساخت کاربر deploy در بخش ۳):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/hoosh_deploy -N ""       # کلید مخصوص گیت‌هاب
cat ~/.ssh/hoosh_deploy.pub                                # این خروجی را کپی کنید
```

در گیت‌هاب: repo `hoosh` → **Settings → Deploy keys → Add deploy key** → عنوان: `mobin-server` → کلید را paste کنید → فقط **read-only** بماند (سرور لازم نیست push بزند) → Add.

راهنمای ssh برای استفاده خودکار از این کلید:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/hoosh_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh -T git@github.com        # پیام "Hi USERNAME!" یعنی موفق ✓
```

**مرحله ۵ — دریافت سورس روی سرور:**

```bash
sudo apt install -y git
git clone git@github.com:USERNAME/hoosh.git /home/deploy/hoosh
ls /home/deploy/hoosh/package.json   # ✓ وجودش یعنی درست clone شده
```

از این به بعد هر آپدیت: روی سیستم خودتان `git add/commit/push`، روی سرور `cd /home/deploy/hoosh && git pull`.

### ۲.۳ گزینه ساده برای شروع فوری: zip + SFTP

روی **سیستم خودتان** (در Git Bash/ترمینال):

```bash
cd /home/z/my-project
zip -r /tmp/hoosh-source-latest.zip . \
  -x "node_modules/*" ".next/*" "*.log" "tool-results/*" ".zscripts/*" \
  -x "db/custom.db" "download/*" ".git/*"
scp /tmp/hoosh-source-latest.zip deploy@SERVER_IP:/tmp/
```

روی **سرور**:

```bash
mkdir -p /home/deploy/hoosh
unzip /tmp/hoosh-source-latest.zip -d /home/deploy/hoosh
```

> ⚠️ فایل‌های zip قدیمی موجود در پوشه `download/` پروژه (مثل `hoosh-source-v17.zip`) **قدیمی** هستند — همیشه zip تازه بسازید (دستور بالا). و `.env` عمداً در zip نیست؛ روی سرور دستی ساخته می‌شود (بخش ۷).

### ۲.۴ گزینه پایدار برای ایران: git مستقیم روی سرور (بدون گیت‌هاب)

اگر گیت‌هاب دردسرساز شد، خودِ سرور را «remote» کنید:

```bash
# روی سرور — یک repo خشک (bare) بسازید
git init --bare /home/deploy/hoosh.git

# روی سیستم خودتان — سرور را به‌عنوان remote دوم اضافه کنید
git remote add server ssh://deploy@SERVER_IP/home/deploy/hoosh.git
git push server main

# روی سرور — سورس قابل استفاده بسازید (فقط بار اول clone، بعداً pull)
git clone /home/deploy/hoosh.git /home/deploy/hoosh
```

همه‌ی مزایای نسخه‌بندی/rollback، بدون وابستگی به سرویس خارجی. (گیت‌هاب فقط وقتی لازم می‌شود که بخواهید سورس روی سرویس دیگری هم باشد.)

---

## ۳. آماده‌سازی سرور

> اگر بخش ۱.۲ را به پشتیبان سپردید، از بخش ۳.۷ ادامه دهید — و فقط صحت کارهای او را با دستورهای تست هر مرحله چک کنید.

### ۳.۱ ورود و به‌روزرسانی

```bash
ssh root@SERVER_IP            # IP را از پنل مبین‌هاست بردارید
apt update && apt upgrade -y  # چند دقیقه
apt install -y curl git unzip sqlite3
```

### ۳.۲ ساخت Swap (⚠️ حیاتی — ۵ دقیقه)

بدون Swap، اگر رم سر رود، کرنل پروسه‌ی اپ را می‌کشد و سایت خاموش می‌شود (این دقیقاً همان چیزی است که در بنچمارک در ۱۵۰ کاربر دیدیم). با ۱۲GB رم احتمالش کم است، ولی Swap = بیمه‌ی رایگان:

```bash
sudo fallocate -l 8G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf
sudo sysctl -p /etc/sysctl.d/99-swap.conf
free -h     # ردیف Swap باید 8.0Gi نشان دهد ✓
```

### ۳.۳ کاربر deploy (بدون اجرا با root)

```bash
adduser deploy                # رمز قوی بدهید
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # کلید SSH را منتقل کنید
ssh deploy@SERVER_IP          # تست — از این به بعد با deploy کار کنید
```

### ۳.۴ فایروال ufw + fail2ban

```bash
sudo ufw allow OpenSSH
sudo ufw limit ssh            # ضد brute-force
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable               # → y
sudo ufw status verbose       # فقط 22/80/443 باید ALLOW باشد
```

> پورت ۳۰۰۰ (اپ) و ۵۴۳۲ (PostgreSQL) **عمداً** باز نیستند — از بیرون قابل دسترسی نیستند و فقط از داخل سرور (reverse proxy) استفاده می‌شوند.

```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban --now
sudo fail2ban-client status sshd
```

ساعت سرور (برای لاگ/توکن/زرین‌پال مهم است):

```bash
sudo timedatectl set-timezone Asia/Tehran
timedatectl
```

### ۳.۵ نصب Bun و Node.js 20

هر دو لازم‌اند: Bun برای `install/اسکریپت‌ها`، Node برای اجرای خود پروسه‌ی Next (PM2).

```bash
# Bun — با کاربر deploy، بدون sudo
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version                 # مثلاً 1.3.x

# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version                # v20.x
```

> اگر مخزن NodeSource از ایران در دسترس نبود: `nvm` جایگزین خوبی است — `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash` سپس `source ~/.bashrc && nvm install 20`.

### ۳.۶ نصب PostgreSQL 16 + ساخت دیتابیس

```bash
sudo apt install -y postgresql postgresql-contrib
psql --version               # Ubuntu 24.04 → 16.x (LTS بهتر است)
sudo systemctl enable postgresql --now
```

> اگر Ubuntu 22.04 نصب کرده‌اید و نسخه ۱۴ بود، برای PostgreSQL 16 مخزن رسمی را اضافه کنید:
> ```bash
> sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
> curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /usr/share/keyrings/pgdg.gpg
> sudo apt update && sudo apt install -y postgresql-16
> ```

ساخت دیتابیس و کاربر (رمز را **قوی** انتخاب و در جای امن ذخیره کنید — در `.env` لازم دارید):

```bash
sudo -u postgres psql -c "CREATE USER hoosh WITH PASSWORD 'HOOSH_DB_STRONG_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE hoosh_prod OWNER hoosh;"

# تست اتصال:
sudo -u postgres psql "postgresql://hoosh:HOOSH_DB_STRONG_PASSWORD@localhost:5432/hoosh_prod" -c "SELECT 1;"
```

تنظیم اتصال‌های کافی برای ترافیک (هر instance اپ تا ۱۰ اتصال، ۲ instance + PgBouncer بعداً):

```bash
sudo tee -a /etc/postgresql/16/main/postgresql.conf > /dev/null <<'EOF'
max_connections = 100
EOF
sudo systemctl restart postgresql
```

> ‏100 اتصال برای صدها کاربر اپ کافی است (Prisma اتصال‌ها را pool می‌کند).

### ۳.۷ آماده‌سازی پوشه اپ

```bash
sudo mkdir -p /backups && sudo chown deploy:deploy /backups
# سورس را طبق بخش ۲ به /home/deploy/hoosh منتقل کنید (اگر نکرده‌اید)
ls /home/deploy/hoosh/package.json   # ✓
```

---

## ۴. مهاجرت دیتابیس SQLite → PostgreSQL

> چرا PostgreSQL در production؟ سه دلیل مستند: (۱) نوشتن همزمان — SQLite فقط یک نویسنده در لحظه دارد، PostgreSQL چند نویسنده موازی؛ (۲) رفتار بهتر تحت بار صدها کاربر (بنچمارک همین نتیجه را داد: گلوگاهِ بعدی، نوشتن DB و کوئری تجمعی داشبورد است)؛ (۳) پشتیبان‌گیری تراکنشیِ امن با `pg_dump`. برای شروعِ بدون داده‌ی قدیمی هم هیچ دلیلی برای SQLite روی سرور نیست.

### ۴.۱ دو حالت دارید؟

| حالت | یعنی | کاری که باید بکنید |
|---|---|---|
| **شروع تازه** (سرور خالی، هنوز مشتری واقعی ندارید) | داده‌ی SQLite محلی فقط تست است | فقط بخش ۴.۲ — جدول‌ها روی PostgreSQL ساخته می‌شوند؛ داده منتقل نمی‌شود |
| **داده‌ی واقعی دارید** (مشتری/فاکتور ثبت‌شده در نسخه dev) | باید منتقل شود | ‏۴.۲ + ۴.۴ (اسکریپت آماده‌ی پروژه) |

### ۴.۲ ساخت جدول‌ها روی PostgreSQL

پروژه اسکیمای آماده دارد: `prisma/schema.postgres.prisma` — نیازی به تغییر اسکیمای اصلی نیست:

```bash
cd /home/deploy/hoosh
bun install                    # وابستگی‌ها + prisma generate (چند دقیقه اولین بار)

# کلاینت Prisma را از اسکیمای PostgreSQL تولید کنید:
bunx prisma generate --schema=prisma/schema.postgres.prisma

# جدول‌ها را روی hoosh_prod بسازید:
bunx prisma db push --schema=prisma/schema.postgres.prisma
# → "Your database is now in sync with your schema." ✓

# تأیید — تعداد جدول‌ها را ببینید:
sudo -u postgres psql -d hoosh_prod -c "\dt" | head -30
```

> ⚠️ **قانون طلایی PostgreSQL:** در تمام عمر این نصب، کلاینت Prisma باید با `--schema=prisma/schema.postgres.prisma` تولید شده باشد و **بیلد بعد از همین generate** گرفته شود — کلاینتِ ساخته از اسکیمای SQLite با PostgreSQL کار نمی‌کند.

### ۴.۳ تنظیم `.env` (برش دیتابیس — بقیه در بخش ۷)

```bash
cd /home/deploy/hoosh
cat > .env <<'EOF'
DATABASE_URL="postgresql://hoosh:HOOSH_DB_STRONG_PASSWORD@localhost:5432/hoosh_prod?schema=public"
EOF
chmod 600 .env
```

تست سلامت (بعد از اجرای اپ در بخش ۵): `curl -s http://localhost:3000/api/health` باید `"database":{"status":"up"}` بدهد.

### ۴.۴ انتقال داده‌ی SQLite موجود (اگر داده واقعی دارید)

پروژه اسکریپت آماده دارد: `scripts/migrate-to-postgres.sh` (خروجی SQLite → تبدیل ساختار → وارد PostgreSQL → به‌روزرسانی `.env`):

```bash
cd /home/deploy/hoosh
# فایل SQLite منبع را روی سرور بگذارید (مثلاً scp از سیستم خودتان):
#   scp db/custom.db deploy@SERVER_IP:/home/deploy/hoosh/db/custom.db

DATABASE_URL="postgresql://hoosh:HOOSH_DB_STRONG_PASSWORD@localhost:5432/hoosh_prod" \
SQLITE_PATH="/home/deploy/hoosh/db/custom.db" \
bash scripts/migrate-to-postgres.sh
```

> 💡 اول با `DRY_RUN=1` اجرا کنید تا فقط خروجی SQL را ببینید و چیزی وارد نشود.
> بعد از انتقال: چند رکورد کلیدی را چک کنید (تعداد کاربران/فاکتورها) و **قبل از first-run روی دیتابیس جدید، سوپرادمین قدیمیِ منتقل‌شده را با رمز جدید جایگزین کنید** (بخش ۷.۴).

### ۴.۵ بعد از مهاجرت چک کنید

```bash
sudo -u postgres psql -d hoosh_prod -c "SELECT count(*) FROM \"User\";"
sudo -u postgres psql -d hoosh_prod -c "SELECT count(*) FROM \"Invoice\";"
```

اعداد باید با SQLite مبدأ بخواند. لاگ اپ (`pm2 logs hoosh`) نباید خطای Prisma بدهد.

---

## ۵. بیلد و اجرا

### ۵.۱ متغیرهای محیطی و بیلد

```bash
cd /home/deploy/hoosh
# .env کامل را طبق بخش ۷ بسازید (قبل از بیلد — متغیرهای NEXT_PUBLIC_* موقع بیلد داخل کد embed می‌شوند!)

NEXT_TELEMETRY_DISABLED=1 bun run build
# اولین بیلد چند دقیقه طول می‌کشد؛ روی این سرور (۱۲GB) راحت انجام می‌شود.
```

تست سریع اجرا:

```bash
bun run start &
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/manifest.webmanifest   # → 200
curl -s http://localhost:3000/api/health | head -c 200                                # → healthy
kill %1
```

> ⛔ روی سرور **هرگز** `bun run dev` اجرا نکنید — حالت توسعه رم زیادی مصرف می‌کند (در بنچمارک تا ~۳.۳GB روی یک پروسه رسید و در فشار، OOM شد) و برای production امن نیست. حالت production فقط `bun run build` + `start` است.

### ۵.۲ PM2 با ecosystem — کلاستر ۲ instance + محافظ رم

فایل `ecosystem.config.cjs` در `/home/deploy/hoosh` بسازید:

```js
// ecosystem.config.cjs — اجرای «هوش» با PM2
module.exports = {
  apps: [
    {
      name: "hoosh",
      cwd: "/home/deploy/hoosh",
      script: "./node_modules/.bin/next",   // باینری next (اسکریپت Node)
      args: "start -p 3000",
      exec_mode: "cluster",                 // چند پروسه روی پورت ۳۰۰۰
      instances: 2,                         // ۲ instance = استفاده از ۴ هسته + تحمل خطا
      max_memory_restart: "3G",             // اگر RSS از ۳GB گذشت، ری‌استارت خودکار (نه OOM-kill)
      kill_timeout: 10000,
      autorestart: true,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_OPTIONS: "--max-old-space-size=2560",
      },
      out_file: "/home/deploy/hoosh/logs/pm2-out.log",
      error_file: "/home/deploy/hoosh/logs/pm2-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
```

```bash
mkdir -p logs
bunx pm2 start ecosystem.config.cjs
bunx pm2 status          # دو پروسه hoosh با status=online ✓
bunx pm2 logs hoosh --lines 30
```

> **چرا ۲ instance؟** ‏۴ هسته دارید؛ ۲ instance اپ (هرکدام یک event loop) + PostgreSQL + Nginx توزیع بار متعادلی می‌سازد. اگر بعداً خواستید ۴ instance کنید، فقط `instances: 4` و `pm2 restart ecosystem.config.cjs --update-env`.

اجرای خودکار بعد از ریبوت:

```bash
bunx pm2 save
bunx pm2 startup
# خروجی یک دستور sudo چاپ می‌کند — کپی و اجرایش کنید، سپس:
sudo reboot
# بعد از بالا آمدن: ssh مجدد → bunx pm2 status (باید online باشد)
```

چرخش لاگ (جلوگیری از پر شدن دیسک ۸۰GB):

```bash
bunx pm2 install pm2-logrotate
bunx pm2 set pm2-logrotate:max_size 50M
bunx pm2 set pm2-logrotate:retain 10
```

---

## ۶. Nginx + SSL

> گزینه‌ی ساده‌تر Caddy (SSL خودکار بدون certbot) در `DEPLOYMENT-GUIDE.md` بخش ۹.۲ توضیح داده شده — اگر ترجیح می‌دهید همان را اجرا کنید و این بخش را رد کنید. اینجا Nginx (که پشتیبان هاست هم معمولاً نصب می‌کند) را کامل می‌آوریم.

### ۶.۱ رکورد DNS (پنل دامنه nobatime.ir)

در پنل مدیریت دامنه‌ی `nobatime.ir` (جایی که دامنه را مدیریت می‌کنید):

| نوع | Host | مقدار | TTL |
|---|---|---|---|
| A | `hoosh` | `SERVER_IP` | ۳۶۰۰ |
| CNAME | `www.hoosh` | `hoosh.nobatime.ir` | ۳۶۰۰ |

تست انتشار (چند دقیقه تا چند ساعت): `dig +short hoosh.nobatime.ir` باید IP سرور را برگرداند.

### ۶.۲ نصب Nginx و بلوک اولیه

```bash
sudo apt install -y nginx
sudo tee /etc/nginx/sites-available/hoosh > /dev/null <<'EOF'
server {
    listen 80;
    server_name hoosh.nobatime.ir;

    # اندازه‌ی پیوست تیکت‌ها (۵ فایل × ۵MB) و آپلودها:
    client_max_body_size 12M;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript
               application/xml image/svg+xml font/woff2;
    gzip_min_length 1024;

    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;          # websocket/SSE
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/hoosh /etc/nginx/sites-enabled/hoosh
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: hoosh.nobatime.ir" http://localhost/
# → 200 (وقتی اپ با PM2 روشن است)
```

### ۶.۳ SSL رایگان با certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d hoosh.nobatime.ir
# → ایمیل را وارد کنید، قوانین را بپذیرید؛ certbot خودش:
#    ۱) گواهی می‌گیرد  ۲) بلوک 443 را می‌سازد  ۳) ریدایرکت 80→443 را فعال می‌کند

# تمدید خودکار (دوبار در روز، فقط اگر لازم باشد):
sudo systemctl status certbot.timer     # باید active باشد
sudo certbot renew --dry-run            # تمرین تمدید بدون خطا ✓
```

تست نهایی:

```bash
curl -sI https://hoosh.nobatime.ir | head -3          # HTTP/2 200 ✓
curl -s -o /dev/null -w "%{redirect_url}\n" http://hoosh.nobatime.ir   # → https://... ✓
```

> گواهی Let's Encrypt هر ~۶۰ روز تمدید می‌شود — certbot این کار را خودکار انجام می‌دهد؛ فقط بعد از ۲ ماه یک‌بار چک کنید.
> اگر خطای «Failed authorization» گرفتید: DNS هنوز منتشر نشده یا پورت ۸۰ از پنل مبین‌هاست مسدود است.

---

## ۷. تنظیمات داخل اپ

### ۷.۱ فایل `.env` کامل (نمونه‌ی نهایی)

```bash
cd /home/deploy/hoosh
nano .env
chmod 600 .env
```

```env
# ─── دیتابیس (PostgreSQL — بخش ۴) ───
DATABASE_URL="postgresql://hoosh:HOOSH_DB_STRONG_PASSWORD@localhost:5432/hoosh_prod?schema=public"

# ─── امنیت (الزامی در production) ───
# تولید: openssl rand -hex 32  (هرکدام مقدار جدا)
JWT_SECRET="خروجی-openssl-برای-jwt"              # بدون آن، ورود کاربران در production خطا می‌دهد
CHAT_INTERNAL_SECRET="خروجی-openssl-برای-chat"   # رمز API داخلی پشتیبانی
CRON_SECRET="خروجی-openssl-برای-cron"            # رمز کرون‌ها (بخش ۷.۳)

# ─── آدرس عمومی ───
NEXT_PUBLIC_APP_URL="https://hoosh.nobatime.ir"   # در لینک‌های ایمیل/callback زرین‌پال استفاده می‌شود

# ─── ایمیل SMTP (Gmail با App Password — آموزش ۷.۲) ───
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="yourgmail@gmail.com"
SMTP_PASS="۱۶-کاراکتر-App-Password"
SMTP_FROM="هوش <yourgmail@gmail.com>"

# ─── Sentry (اختیاری ولی توصیه‌شده — خطاها را می‌بیند) ───
SENTRY_DSN="https://xxx@sentry.io/yyy"
NEXT_PUBLIC_SENTRY_DSN="https://xxx@sentry.io/yyy"

# ─── Web Push / VAPID (اعلان مرورگر) ───
VAPID_PUBLIC_KEY="کلید-عمومی-موجود"
VAPID_PRIVATE_KEY="کلید-خصوصی-موجود"
VAPID_SUBJECT="mailto:admin@nobatime.ir"
NEXT_PUBLIC_VAPID_PUBLIC_KEY="کلید-عمومی-موجود"

# ─── اولین ورود سوپرادمین — بعد از ورود حتماً حذف/کامنت و ری‌استارت! ───
ALLOW_SUPERADMIN_BOOTSTRAP=1

# ─── سایر ───
NODE_OPTIONS="--max-old-space-size=2560"
NEXT_TELEMETRY_DISABLED=1
# ⛔ ENABLE_SOURCE_DOWNLOAD هرگز ست نشود (دانلود سورس فقط برای dev است)
```

نکته‌ها:
- **کلیدهای VAPID:** جفت‌کلیدهای موجود پروژه‌تان را از محیط توسعه‌ی خودتان (`.env` لوکال) کپی کنید؛ اگر ندارید بسازید: `bunx web-push generate-vapid-keys` → مقدار Public/Private را در ۴ متغیر بالا بگذارید. (تا قبل از Go-Live تعویض کلید مشکلی ندارد؛ بعدش، تعویض = اعلان‌های push کاربران از کار می‌افتد تا دوباره allow کنند.)
- **زرین‌پال:** کد پذیرنده `bd690050-40f2-477c-8086-647688f7a514` از **پنل سوپرادمین** ثبت می‌شود (بخش ۸) — در `.env` نیازی به آن نیست.
- `NEXT_PUBLIC_*` ‏ها موقع **بیلد** داخل کد embed می‌شوند — اگر بعداً عوضشان کردید، دوباره `bun run build` لازم است.

### ۷.۲ ساخت Gmail App Password (اختیاری — برای ایمیل واقعی)

1. به [myaccount.google.com](https://myaccount.google.com) با حساب Gmail خودتان بروید.
2. **Security → 2-Step Verification** — اگر خاموش است، فعال کنید (لازم است).
3. در همان صفحه **App passwords** (جستجو کنید: «App passwords») → **Create**.
4. نام: `hoosh-smtp` → یک رمز ۱۶ کاراکتری به شما نشان داده می‌شود → همان لحظه کپی کنید (دیگر دیده نمی‌شود).
5. مقدارش را در `SMTP_PASS` بگذارید (فاصله‌ها را حذف کنید یا نگه دارید — هر دو کار می‌کند).

> محدودیت Gmail: ~۵۰۰ ایمیل در روز برای حساب عادی — برای سرویس کوچک کافی است؛ رشد کردید سرویس ایمیل سازمانی/ایرانی بخرید. اگر SMTP را خالی بگذارید، fallback سرویس FormSubmit (تنظیم از پنل سوپرادمین) فعال است — بخش ۱۰.۴ `DEPLOYMENT-GUIDE.md`.

### ۷.۳ کرون‌های اپ

```bash
crontab -e
# (SECRET را با CRON_SECRET واقعی عوض کنید)

*/5 * * * * curl -s -H "X-Cron-Secret: SECRET_VALUE" https://hoosh.nobatime.ir/api/scheduled-reports/run > /dev/null 2>&1
0 2 * * * curl -s -H "X-Cron-Secret: SECRET_VALUE" https://hoosh.nobatime.ir/api/ai/anomaly-cron > /dev/null 2>&1
```

### ۷.۴ سوپرادمین — ساخت اولین حساب (فقط یک‌بار)

۱. `.env` باید `ALLOW_SUPERADMIN_BOOTSTRAP=1` داشته باشد (در نمونه بالا هست) و اپ با آن ری‌استارت شده باشد: `bunx pm2 restart hoosh`.

۲. در مرورگر: `https://hoosh.nobatime.ir` → دکمه «ورود» → نام کاربری: **`superadmin`** → رمز قوی ۱۶+ کاراکتری خودتان را **همین‌جا انتخاب کنید** → ورود. سیستم چون کاربری به این نام نیست، به‌صورت مخفی از `/api/platform/login` اولین سوپرادمین را می‌سازد و وارد می‌کند. (تست ترمینالی در `DEPLOYMENT-GUIDE.md` §10.1.)

۳. **حتماً فلگ را خاموش کنید** (وگرنه هرکس زودتر برسد می‌تواند سوپرادمین بسازد):

```bash
cd /home/deploy/hoosh
sed -i 's/^ALLOW_SUPERADMIN_BOOTSTRAP=1/#ALLOW_SUPERADMIN_BOOTSTRAP=1/' .env
bunx pm2 restart hoosh
```

۴. اولین تنظیمات پنل سوپرادمین (به‌ترتیب — جزئیات کامل: `DEPLOYMENT-GUIDE.md` §10.2):

| # | تب پنل | کار |
|---|---|---|
| ۱ | **برندینگ و وایت‌لیبل** | نام برند «هوش»، لوگو، و **دامنه = `hoosh.nobatime.ir`** |
| ۲ | **صورتحساب و پرداخت** | مرچنت زرین‌پال (بخش ۸) |
| ۳ | **نمادهای اعتماد** | کد اینماد (بخش ۹) |
| ۴ | **پیامک و ایمیل** | SMTP/فرم‌سابمیت (بخش ۷.۲) |
| ۵ | **تنظیمات پلتفرم** | تریال ۱۴ روز، باز/بسته‌بودن ثبت‌نام |
| ۶ | **امنیت و IP** | اگر IP ثابت دارید، لیست سفید ورود سوپرادمین |

> اگر دیتابیس dev را کامل منتقل کرده‌اید و سوپرادمینِ قدیمی داخلش هست، قبل از bootstrap جدول سوپرادمین را پاک کنید تا رمز جدیدِ خودتان مالک باشد (دستور دقیق در `DEPLOYMENT-GUIDE.md` §10.1 «حالت خاص»).

---

## ۸. زرین‌پال

### ۸.۱ پیش‌نیازها (هر دو را دارید ✓)

| الزام زرین‌پال | وضعیت شما |
|---|---|
| وب‌سایت با **SSL فعال** روی دامنه ثبت‌شده | ✅ `https://hoosh.nobatime.ir` (بخش ۶) |
| **IP ثابت ایران** برای callback | ✅ سرور مبین‌هاست داخل ایران است — دقیقاً مزیت انتخاب شما |
| کد پذیرنده (مرچنت) | ✅ ‏`bd690050-40f2-477c-8086-647688f7a514` |

> اگر مرچنت را هنوز در پنل zarinpal.com نگرفته‌اید: ثبت‌نام → «درگاه پرداخت» → درخواست کد پذیرنده با آدرس سایت `https://hoosh.nobatime.ir` (آدرس ثبت‌شده در پنل زرین‌پال باید با دامنه‌ی واقعی یکی باشد وگرنه فعال‌سازی/تسویه مشکل می‌شود).

### ۸.۲ ثبت در هوش

پنل سوپرادمین → تب **«صورتحساب و پرداخت»** → بخش زرین‌پال → کد پذیرنده را paste کنید → «فعال» → ذخیره.

- فرمت UUID اعتبارسنجی می‌شود؛ در `SystemSettings` با کلید `payment_zarinpal_merchant` ذخیره می‌شود و **بدون ری‌استارت** (پس از کش ۵ دقیقه‌ای تنظیمات) در جریان پرداخت استفاده می‌شود.
- در همین تب، درگاه آیدی‌پی هم (با API Key) پشتیبانی می‌شود — اختیاری.

### ۸.۳ جریان پرداخت و Callback

```
کاربر → صفحه خرید پلن → POST /api/payment
     → ریدایرکت به درگاه زرین‌پال
     → بازگشت به https://hoosh.nobatime.ir/payment/callback?Authority=…&Status=OK
     → تأیید سمت سرور از api.zarinpal.com/pg/v4/payment/verify.json
     → فعال‌سازی پلن کاربر
```

Callback URL به‌صورت خودکار از دامنه‌ی عمومی ساخته می‌شود — فقط مطمئن شوید **هر دو** یکی باشند: `NEXT_PUBLIC_APP_URL` در `.env` و دامنه‌ی تب «برندینگ و وایت‌لیبل» (اگر `.env` عوض شد، بیلد مجدد لازم است).

### ۸.۴ تست نهایی

با یک کاربر آزمایشی، خریدِ کم‌ترین مبلغِ پلن‌ها را واقعی انجام دهید و فعال‌شدن پلن را ببینید (معتبرترین تست، تراکنش واقعی است). بعد از آن، تراکنش را در پنل زرین‌پال (تسویه) هم چک کنید.

### ۸.۵ نتیجه‌ی تست زنده‌ی درخواست پرداخت (۵ سپتامبر ۲۰۲۶)

درخواست واقعی `payment.request.json` با کد پذیرنده‌ی شما **از سرور توسعه** ارسال شد و زرین‌پال پاسخ داد:

| تست | نتیجه | معنی |
|---|---|---|
| کد پذیرنده `bd690050-…-a514` | ✅ شناسایی شد | مرچنت صحیح و فعال است |
| Callback URL | ❌ کد `-14` | آدرس کال‌بک در محیط توسعه `localhost` است — زرین‌پال فقط دامنه‌ی **ثبت‌شده در پنل خودش** را می‌پذیرد |

> **نتیجه:** یکپارچه‌سازی زرین‌پال درست کار می‌کند. روی سرور ایران (بخش ۶، بعد از اتصال دامنه `hoosh.nobatime.ir` + SSL) این خطا خودبه‌خود رفع می‌شود چون callback از همان دامنه ساخته می‌شود. فقط مطمئن شوید در **پنل zarinpal.com** آدرس سایتِ پذیرنده را دقیقاً `https://hoosh.nobatime.ir` ثبت کرده‌اید.
>
> جدول کدهای خطای فارسی در `lib/zarinpal.ts` کامل است (کد `-14` هم اضافه شد) و کاربر پیام واضح فارسی می‌بیند.

---

## ۹. اینماد

### ۹.۱ چی است و کی بگیریم؟

اینماد («نماد اعتماد الکترونیکی») برای فروش/خدمات آنلاین در ایران عملاً الزام اعتمادسازی است و در فوتر لندینگ نمایش داده می‌شود. نکته‌ی مهم: **ابتدا سایت باید روی دامنه + SSL زنده باشد** (اینماد سایت را بررسی می‌کند) — یعنی بعد از بخش‌های ۶-۸ درخواست بدهید.

ثبت: به [enamad.ir](https://enamad.ir) بروید → ثبت‌نام کسب‌وکار → ارسال مدارک (احتمالاً آگهی/مجوز اگر هست، اطلاعات تماس، آدرس سایت `https://hoosh.nobatime.ir`) → پس از تأیید، **کد HTML نماد** را به شما می‌دهند (تگ `<a>` + `<img>` با پارامترهای id و Code).

### ۹.۲ درج در «هوش» — از قبل آماده است ✅

پنل سوپرادمین → تب **«نمادهای اعتماد»** (با «برندینگ…» در GOD panel):

1. «افزودن نماد» → عنوان: `اینماد`.
2. کد HTML دریافتی از enamad.ir را در فیلد «کد HTML نماد» بچسبانید → ذخیره.
3. نمادها در **فوتر لندینگ** برای همه‌ی بازدیدکنندگان نمایش داده می‌شوند (`GET /api/trust-badges` با کش عمومی).

> 💡 **سریع‌راه:** کد اینماد شما از قبل در این تب به‌عنوان «کد نمونه‌ی اینماد» آماده seed شده — دکمه‌ی **«درج کد نمونه‌ی اینماد»** را بزنید تا کد با شناسه‌ی `742712` و کد `0H2FJwLlJ05wlmBZKpxzIjqp2Xc8oiQk` (مربوط به حساب اینماد خودتان) یک‌جا پر شود؛ فقط اگر enamad.ir کد جدیدی داده، مقادیر را جایگزین و ذخیره کنید.
>
> ✅ **وضعیت فعلی (۵ سپتامبر):** کد دقیق و کامل اینماد شما (تگ `<a>` + `<img>` عیناً بدون کم‌وکاست، شامل `code='0H2FJwLlJ05wlmBZKpxzIjqp2Xc8oiQk'` و `referrerpolicy='origin'`) همین‌اکنون در دیتابیس ذخیره شده و در **فوتر لندینگ** نمایش داده می‌شود — روی سرور ایران تصویر نماد از `trustseal.enamad.ir` لود می‌شود. **هیچ کاری لازم نیست.**
>
> نکات امنیتی این تب: تگ‌های `script`/`iframe` به‌طور خودکار حذف می‌شوند؛ حداکثر ۱۲ نماد (اینماد، ساماندهی و…). می‌توانید «ساماندهی» (samandehi.ir) را هم با همین روش اضافه کنید.

---

## ۱۰. بکاپ خودکار

> قانون طلایی: بکاپی که فقط روی همان سرور باشد، بکاپ نیست. «روزانه خودکار + کپی خارج از سرور + تست بازیابی».

### ۱۰.۱ بکاپ روزانه PostgreSQL (کرون)

```bash
sudo mkdir -p /backups && sudo chown deploy:deploy /backups
crontab -e
```

```cron
# ─── بکاپ «هوش» ───
# ۱) دیتابیس هر روز ۳:۳۰ بامداد (فرمت -c = فشرده + قابل بازیابی انتخابی)
30 3 * * * sudo -u postgres pg_dump -Fc hoosh_prod > /backups/hoosh-pg-$(date +\%F).dump

# ۲) پیوست تیکت‌ها/آپلودها هر روز ۴:۰۰
0 4 * * * tar -czf /backups/uploads-$(date +\%F).tar.gz -C /home/deploy/hoosh public/uploads 2>/dev/null

# ۳) کپی خارج از سرور (بخش ۱۰.۲) هر روز ۴:۴۵
45 4 * * * rclone copy /backups/ offsite:hoosh-backups/ --max-age 25h >> /backups/rclone.log 2>&1

# ۴) نگهداری: ۷ نسخه‌ی آخر (هفتگی) + پاک‌سازی بعد از ۳۰ روز
0 5 * * 0 find /backups -name "*.dump" -o -name "*.tar.gz" | head -n -14 | xargs -r rm   # قفسه هفتگی ساده
0 5 * * * find /backups -name "hoosh-pg-*.dump" -mtime +30 -delete
10 5 * * * find /backups -name "uploads-*.tar.gz" -mtime +30 -delete
```

> در crontab علامت `%` باید `\%` نوشته شود (بالا رعایت شده).
> سیاست پیشنهادی: **۷ روز آخر + ۴ آخرِِ هر هفته برای یک ماه** — نمونه‌ی بالا ساده‌شده است؛ نسخه‌ی کامل‌تر با اسکریپت `scripts/backup.sh` پروژه هم ممکن است (برای حالت SQLite). در PostgreSQL همان `pg_dump` کافی است.

### ۱۰.۲ کپی خارج از سرور (offsite) با rclone

گزینه‌های ایرانی/در دسترس: **مبین‌کلود** (همان گروه مبین — راحت‌ترین برای شما)، ابرآروان، لیارا، یا هر S3 سازگار:

```bash
sudo apt install -y rclone
rclone config      # remote جدید → نام: offsite → نوع: s3 (یا ftp/webdav بسته به سرویس) → کلیدها را از پنل سرویس ابری بگیرید

# تست دستی:
rclone copy /backups/hoosh-pg-$(date +%F).dump offsite:hoosh-backups/
rclone ls offsite:hoosh-backups/ | tail -3
```

### ۱۰.۳ بازیابی (در روز بد)

```bash
bunx pm2 stop hoosh
sudo -u postgres pg_restore -c -d hoosh_prod /backups/hoosh-pg-2026-09-05.dump
bunx pm2 start hoosh
curl -s https://hoosh.nobatime.ir/api/health
```

### ۱۰.۴ تست ماهانه بازیابی (۵ دقیقه — خیلی مهم)

ماهی یک‌بار روی دیتابیس تستی، فایل بکاپ را بازیابی کنید تا مطمئن شوید واقعاً سالم است:

```bash
sudo -u postgres psql -c "CREATE DATABASE hoosh_restore_test OWNER hoosh;"
sudo -u postgres pg_restore -d hoosh_restore_test /backups/hoosh-pg-$(date +%F).dump
sudo -u postgres psql -d hoosh_restore_test -c "SELECT count(*) FROM \"User\";"
sudo -u postgres psql -c "DROP DATABASE hoosh_restore_test;"
```

---

## ۱۱. مانیتورینگ و نگهداشت

### ۱۱.۱ فرمان‌های روزمره (هر چند روز یک‌بار، ۲ دقیقه)

```bash
bunx pm2 status            # هر دو instance: online؛ علامت ↺ِ زیاد = مشکل
bunx pm2 monit             # داشبورد زنده CPU/RAM (Ctrl+C خروج)
bunx pm2 logs hoosh --lines 100
free -h                    # RAM و Swap
df -h                      # دیسک ۸۰GB (پر شد >۸۰٪ → پاکسازی/ارتقا)
uptime                     # load — بالای ~۴ (تعداد هسته) یعنی فشار
sudo ufw status
curl -s https://hoosh.nobatime.ir/api/health | head -c 120
```

### ۱۱.۲ پایش خودکار ساده (اختیاری)

یک چکِ زنده‌بودنِ رایگان — uptime‌های خارجی مثل UptimeRobot را روی `https://hoosh.nobatime.ir/api/health` تنظیم کنید؛ اگر ۲ پینگ پشت‌سرهم fail شد ایمیل/تلگرام می‌گیرید.

### ۱۱.۳ Sentry

اگر `SENTRY_DSN` را در `.env` گذاشته‌اید، خطاهای سرور و کلاینت خودکار گزارش می‌شوند (`instrumentation.ts` پروژه سمت سرور را فعال می‌کند؛ بدون DSN کاملاً خاموش است). ماهی یک‌بار Inbox Sentry را چک کنید.

### ۱۱.۴ آپدیت ماهانه امنیتی (بدون قطعی)

```bash
# ماهی یک‌بار (مثلاً اول هر ماه):
sudo apt update && sudo apt upgrade -y      # امنیت سیستم‌عامل
sudo systemctl restart postgresql nginx     # فقط اگر بسته‌های آن‌ها ارتقا خورد

# آپدیت خود اپ (نسخه جدید سورس):
cd /home/deploy/hoosh
bunx pm2 stop hoosh
sudo -u postgres pg_dump -Fc hoosh_prod > /backups/hoosh-before-update-$(date +%F).dump   # بکاپ قبل از تغییر
git pull                                    # یا rsync/بخش ۲
bun install                                 # اگر package.json عوض شده بود
bunx prisma generate --schema=prisma/schema.postgres.prisma
bunx prisma db push --schema=prisma/schema.postgres.prisma   # فقط اگر مدل‌ها عوض شده بود
bun run build
bunx pm2 start hoosh                        # بالا آمدن نسخه جدید
curl -s https://hoosh.nobatime.ir/api/health
```

> روی نسخه‌های بعدی می‌توانید از `bunx pm2 reload ecosystem.config.cjs` استفاده کنید (ری‌استارت instanceها به‌نوبت = تقریباً بدون قطعی). اسکریپت آماده blue-green هم در `scripts/blue-green-deploy.sh` پروژه هست — وقتی حس کردید لازم شد.

### ۱۱.۵ سخت‌سازی SSH (بعد از اطمینان از ورود با کلید!)

```bash
# اول مطمئن شوید: ssh deploy@SERVER_IP بدون رمز وارد می‌شود، بعد:
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
# ⚠️ ترمینال فعلی را نبندید؛ یک ssh جدید باز کنید و تست کنید که هنوز وارد می‌شوید.
```

همچنین: `sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure --priority=low unattended-upgrades` (آپدیت امنیتی خودکار سیستم‌عامل).

---

## ۱۲. چک‌لیست نهایی Go-Live

| ✔ | مورد | محل/دستور تأیید |
|---|---|---|
| ☐ | Ubuntu 22.04/24.04 + `apt upgrade` انجام | `lsb_release -a` |
| ☐ | **Swap ۸GB فعال و دائمی** | `free -h` |
| ☐ | کاربر `deploy` + ufw فقط ۲۲/۸۰/۴۴۳ + fail2ban | `sudo ufw status` |
| ☐ | Bun + Node 20 نصب | `bun --version`, `node --version` |
| ☐ | PostgreSQL 16 + دیتابیس `hoosh_prod` + کاربر با رمز قوی | `sudo -u postgres psql -c "\l"` |
| ☐ | سورس فعلی (گیت‌هاب/zip) در `/home/deploy/hoosh` | `ls package.json` |
| ☐ | کلیدها/رمزها **هرگز** در گیت push نشده | `git ls-files \| grep -i env` → خالی |
| ☐ | `.env` کامل: DATABASE_URL (PostgreSQL) + JWT_SECRET + CRON_SECRET + NEXT_PUBLIC_APP_URL | `cat .env` |
| ☐ | کلاینت Prisma از `schema.postgres.prisma` generate شده | `bunx prisma generate --schema=…` |
| ☐ | `bun run build` بدون خطا (بعد از generate) | — |
| ☐ | PM2: ‏۲ instance online + `pm2 save` + startup | `bunx pm2 status` |
| ☐ | DNS: ‏`hoosh.nobatime.ir` → IP سرور | `dig +short hoosh.nobatime.ir` |
| ☐ | Nginx + SSL: ‏`https://hoosh.nobatime.ir` قفل سبز + ریدایرکت 80→443 | `curl -sI https://hoosh.nobatime.ir` |
| ☐ | سوپرادمین ساخته و **`ALLOW_SUPERADMIN_BOOTSTRAP` کامنت شد** | ورود پنل |
| ☐ | تب «برندینگ و وایت‌لیبل»: دامنه = hoosh.nobatime.ir | `curl -s https://hoosh.nobatime.ir/api/branding` |
| ☐ | تب «صورتحساب و پرداخت»: مرچنت زرین‌پال `bd690050-…` فعال | پرداخت تستی موفق |
| ☐ | تب «نمادهای اعتماد»: کد اینماد ثبت (id 742712) و در فوتر دیده می‌شود | بازدید لندینگ |
| ☐ | ایمیل کار می‌کند (SMTP Gmail یا FormSubmit فعال) | فراموشی رمز کاربر تست |
| ☐ | کرون‌ها (scheduled-reports + anomaly) در crontab | `crontab -l` |
| ☐ | بکاپ روزانه pg_dump + rclone offsite + نگهداری ۳۰ روز | `ls /backups`, `rclone ls` |
| ☐ | Smoke Test کامل (curlها + ۷ سناریوی مرورگر) سبز | `DEPLOYMENT-GUIDE.md` §11 |
| ☐ | تست بازیابی بکاپ یک‌بار انجام شد | بخش ۱۰.۴ |
| ☐ | SSH کلیدی + PasswordAuthentication no | `ssh deploy@SERVER_IP` |

وقتی همه تیک خورد: 🎉 ‏«هوش» روی `https://hoosh.nobatime.ir` زنده است — ثبت‌نام، تریال ۱۴ روزه، خرید پلن با زرین‌پال و همه ماژول‌ها فعال‌اند. **۱۰۰ کاربر همزمان روی این سرور با حاشیه امن قابل پشتیبانی است** (تحلیل کامل: `BENCHMARK-REPORT.md`).

---

## ۱۳. سؤالات پرتکرار (FAQ)

**۱) هزینه‌های جاری ماهانه چقدر است؟**

| قلم | مبلغ (IRR) |
|---|---|
| سرور مبین‌هاست | ~۱۵,۹۵۰,۰۰۰ / ماه (سالانه ≈ ۲۰M) |
| پیکربندی اولیه (یک‌باره، اختیاری) | ۲,۰۰۰,۰۰۰ |
| دامنه nobatime.ir | هزینه تمدید سالانه‌ی دامنه (طبق پنل ثبت‌نام‌دهنده) |
| SSL | ۰ (Let's Encrypt رایگان) |
| بکاپ ابری خارج سرور | از ۰ (طرح‌های کوچک مبین‌کلود/آروان) تا حداقلی ماهانه |
| گیت‌هاب خصوصی / Sentry / ایمیل | ۰ (طرح رایگان) |

**۲) اگر به ۵۰۰ کاربر برسم چه می‌خواهد؟**
طبق بنچمارک، همین سرور با بیلد prod + PostgreSQL + PM2 کلاستر تا ~۳۰۰-۶۰۰ کاربر همزمان جواب می‌دهد. برای ۵۰۰+: ‏(۱) instanceها را به ۴ برسانید؛ (۲) Redis برای کش/نشست/rate-limit مشترک؛ (۳) PgBouncer برای اتصال‌های DB؛ (۴) BullMQ برای ایمیل/گزارش‌های زمان‌بندی؛ (۵) در نهایت جداکردن PostgreSQL روی سرور دوم. فهرست کامل: `UPGRADE-SUGGESTIONS.md`.

**۳) اگر سرور قطع/ریبوت شود چه می‌شود؟**
PM2 با startup بعد از ریبوت خودکار اپ را بالا می‌آورد؛ PostgreSQL و Nginx سرویس systemd دارند و خودشان بالا می‌آیند. اگر پروسه کرش کند، PM2 فوراً ری‌استارتش می‌کند. اگر خود VPS از پنل مبین‌هاست خاموش شد: تیکت پشتیبانی + بعد از بالا آمدن `pm2 status` را چک کنید. (قطعی‌های کوتاه = چند درخواست fail، دیتا سالم می‌ماند چون تراکنش‌ها DB هستند.)

**۴) ترافیک ۱۰۰GB ماهانه کافی است؟**
برای اپ API-محور با صدها کاربر، بله (متن JSON سبک است؛ بنچمارک کل ~۵۰۰۰ درخواست را چند ده MB کرد). مصرف اصلی = دانلود گزارش‌های اکسل/پیوست‌ها + بازدید لندینگ. در Nginx gzip روشن است. اگر پنل مبین‌هاست هشدار داد، پلن ترافیک قابل توسعه است.

**۵) بعداً می‌توانم سرور را ارتقا دهم / جابه‌جا کنم؟**
بله — چون همه‌چیز نسخه‌دار (گیت) و دیتابیس قابل pg_dump است، مهاجرت به سرور بزرگ‌تر (یا حتی ارائه‌دهنده دیگر) یعنی: سرور جدید → همین راهنما از بخش ۳ → `pg_restore` از بکاپ → تغییر رکورد DNS. یک ساعت کار. اگر IP عوض شد: در زرین‌پال IP جدید را به‌روز کنید و اینماد را از پنل ویرایش کنید.

**۶) چرا PostgreSQL را به SQLite ترجیح دادید؟**
نویسنده‌ی همزمان (چند کاربر همزمان ذخیره کنند)، رفتار پایدارتر در فشار، پشتیبان‌گیری تراکنشی `pg_dump`، و آمادگی برای رشد — تحلیل کامل در `BENCHMARK-REPORT.md` بخش ۵.۳.

**۷) ۲ میلیون پیکربندی را دادم؛ دیگر چه چیزهایی از پشتیبان بخواهم؟**
گواهی کارهای انجام‌شده (فهرست ۱.۲)، رمز‌های موقت که تحویل گرفته (و بعد خودتان عوض کنید)، و روش ورود (کلید SSH). بعدش بقیه‌ی کار با این راهنما و `DEPLOYMENT-GUIDE.md` خودتان انجام می‌شود.

**۸) چطور بفهمم سایت کند شده؟**
`bunx pm2 monit` (RAM/CPU آنی) + Sentry + تست دوره‌ای: `bun scripts/load-test.ts` روی سرور در ساعت کم‌بار و مقایسه با `BENCHMARK-REPORT.md`. علامت‌ها: p95 داشبورد > ۵۰۰ms، load > ۴، RAM > ۷۰٪.

---

*این سند در تسک 3-c تهیه شد — مکمل‌های آن: `DEPLOYMENT-GUIDE.md` (مرجع کامل استقرار)، `BENCHMARK-REPORT.md` (ظرفیت سرور)، `UPGRADE-SUGGESTIONS.md` (نقشه راه). مقادیر پروژه (پورت ۳۰۰۰، مسیر `/home/deploy/hoosh`، اسکیمای `prisma/schema.postgres.prisma`، اسکریپت `scripts/migrate-to-postgres.sh`، تب‌های پنل سوپرادمین و مسیرهای API) با کد فعلی تطبیق داده شده‌اند.*
