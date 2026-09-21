#!/usr/bin/env bash
# ============================================================================
# start-dev.sh — استارت/نگهدار سرور توسعه هوش با watchdog ضد-OOM (v3)
# ============================================================================
# واقعیت سندباکس ۴GB: next-server با Turbopack برای این اپ بزرگ حتی در حالت
# گرم ~۳.۲GB RSS نگه می‌دارد. اگر مرورگر QA (Chrome) هم باز باشد، کرنل
# next-server را با OOM می‌کشد و کاربر «خطا در ساخت حساب» می‌بیند.
#
# استراتژی «قربانی‌کردن مرورگر»:
#   - oom_score_adj پروسه‌های chrome را 1000 می‌گذاریم (بدون نیاز به root؛
#     مقادیر مثتی مجازند) تا OOM-killer همیشه اول Chrome را بکشد نه سرور را
#   - اگر available memory < 350MB شد، proactive همه chrome ها را می‌کشیم
#     (agent-browser دوباره باز می‌شود — سرور هرگز نمی‌میرد)
#   - هر خروج next dev (حتی exit 0 = خروج graceful Turbopack روی سقف حافظه)
#     ری‌استارت می‌شود مگر فلگ توقف دستی باشد
#   - سقف ۲۰ ری‌استارت در هر ۱۰ دقیقه (ضد حلقه بی‌نهایت)
# توقف دستی:  touch /tmp/hoosh_dev_stop && pkill -f "next dev"
# ============================================================================
set -u

cd "$(dirname "$0")"
mkdir -p .next

export NODE_OPTIONS="--max-old-space-size=1024"
export TURBOPACK_MAX_WORKERS=1
export NEXT_TELEMETRY_DISABLED=1

STOP_FLAG="/tmp/hoosh_dev_stop"
RESTARTS_FILE="/tmp/hoosh_dev_restarts.txt"
MAX_RESTARTS_10MIN=20

# ---- محافظ OOM: مرورگر قربانی، سرور زنده بماند ----
protect_server_from_oom() {
  # ۱) chrome ها را در اولویت کشتن قرار بده (مقدار مثبت بدون root مجاز است)
  for pid in $(pgrep -f "chrome" 2>/dev/null); do
    [ -w "/proc/$pid/oom_score_adj" ] && echo 1000 > "/proc/$pid/oom_score_adj" 2>/dev/null
  done
  # ۲) محافظت در سطح کافی: next-server در پایین‌ترین اولویت کشتن (۰ = پیش‌فرض؛
  #    مقادیر منفی نیاز به root دارند)
  for pid in $(pgrep -f "next-server" 2>/dev/null); do
    [ -w "/proc/$pid/oom_score_adj" ] && echo 0 > "/proc/$pid/oom_score_adj" 2>/dev/null
  done
  # ۳) اگر حافظهٔ آزاد بحرانی شد (زیر ۲۰۰MB — مرز کرنل OOM)، chrome ها را
  #    پیش‌دستی‌انه بکش. آستانهٔ پایین‌تر تا QA مرورگری ممکن بماند؛ انتخاب
  #    نهایی قربانی را oom_score_adj انجام می‌دهد (chrome=1000، next-server=0)
  local avail
  avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  if [ "${avail:-4096}" -lt 200 ]; then
    echo "[watchdog $(date '+%H:%M:%S')] low memory (${avail}MB avail) — killing chrome to save server" >> dev.log
    pkill -f "chrome" 2>/dev/null
  fi
}

count_recent_restarts() {
  local cutoff=$(( $(date +%s) - 600 ))
  touch "$RESTARTS_FILE"
  awk -v c="$cutoff" '$1 >= c' "$RESTARTS_FILE" | wc -l
}

record_restart() {
  echo "$(date +%s)" >> "$RESTARTS_FILE"
}

run_once() {
  bunx next dev -p 3000 >> dev.log 2>&1 &
  local pid=$!
  echo "[watchdog $(date '+%H:%M:%S')] next dev started (pid=$pid)" >> dev.log
  # محافظ OOM را همزمان اجرا کن (هر ۵ ثانیه)
  local guard_pid
  (
    while kill -0 $pid 2>/dev/null; do
      protect_server_from_oom
      sleep 5
    done
  ) &
  guard_pid=$!
  wait $pid
  local code=$?
  kill $guard_pid 2>/dev/null
  echo "[watchdog $(date '+%H:%M:%S')] next dev exited (code=$code)" >> dev.log
  return $code
}

# پاک‌سازی فلگ توقف قدیمی — این اجرا عمدی است
rm -f "$STOP_FLAG"

# اگر از قبل روی ۳۰۰۰ چیزی گوش می‌دهد، اول بکش
fuser -k 3000/tcp 2>/dev/null || true
sleep 1

while true; do
  run_once
  if [ -f "$STOP_FLAG" ]; then
    echo "[watchdog] stop flag detected — stopping supervisor" >> dev.log
    break
  fi
  n=$(count_recent_restarts)
  if [ "$n" -ge $MAX_RESTARTS_10MIN ]; then
    echo "[watchdog] restart limit ($MAX_RESTARTS_10MIN/10min) reached — pausing 120s" >> dev.log
    sleep 120
  fi
  record_restart
  echo "[watchdog] restarting in 5s..." >> dev.log
  sleep 5
done
