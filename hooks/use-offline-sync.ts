"use client";

/**
 * useOfflineSync — hook همگام‌سازی آفلاین
 *
 * - وضعیت آنلاین/آفلاین را پیگیری می‌کند (navigator.onLine + 'online'/'offline' events)
 * - FIX(v8/H2): تعداد اکشن‌های در صف آفلاین را از «صف واقعی Service Worker»
 *   (IndexedDB hoosh-sync-queue — پیام GET_QUEUE_COUNT) می‌پرسد؛ صف قدیمی اپ
 *   (hoshhesab-offline) فقط fallback است. قبلاً queueAction هیچ caller نداشت و
 *   شمارنده همیشه صفر بود و دکمه «همگام‌سازی» هرگز ظاهر نمی‌شد.
 * - هنگام اتصال مجدد، صف SW (FORCE_SYNC) + صف اپ را replay می‌کند
 * - FIX(v8/H4): رویداد سفارشی «hoosh:offline-cache» (dispatch شده در
 *   lib/auth-fetch.ts وقتی SW پاسخ کش‌شده با هدر X-Hoosh-Offline سرو می‌کند)
 *   گوش داده می‌شود → حالت «سرور در دسترس نیست / داده ذخیره‌شده»
 * - تابع syncNow برای همگام‌سازی دستی
 *
 * @param token توکن احراز هویت برای ارسال در header درخواست‌های replay
 */

import * as React from "react";
import {
  getOfflineActions,
  replayQueuedActions,
  saveOfflineAction,
  type QueuedAction,
} from "@/lib/offline-db";

interface UseOfflineSyncReturn {
  isOnline: boolean;
  /** FIX(v8/H4): مرورگر آنلاین است اما سرور پاسخ نمی‌دهد (داده کش‌شده سرو می‌شود) */
  serverOffline: boolean;
  pendingCount: number;
  syncing: boolean;
  lastSyncAt: number | null;
  lastSyncResult: { succeeded: number; failed: number } | null;
  queueAction: (
    action: Omit<QueuedAction, "id" | "queuedAt" | "attempts">
  ) => Promise<void>;
  syncNow: () => Promise<void>;
}

export function useOfflineSync(token: string | null): UseOfflineSyncReturn {
  const [isOnline, setIsOnline] = React.useState(true);
  const [pendingCount, setPendingCount] = React.useState(0);
  const [syncing, setSyncing] = React.useState(false);
  const [serverOffline, setServerOffline] = React.useState(false);
  const [lastSyncAt, setLastSyncAt] = React.useState<number | null>(null);
  const [lastSyncResult, setLastSyncResult] = React.useState<{
    succeeded: number;
    failed: number;
  } | null>(null);

  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // FIX(v8/H2): شمارش صف واقعی SW (hoosh-sync-queue) با پیام GET_QUEUE_COUNT
  const getSwQueueCount = React.useCallback(async (): Promise<number> => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return -1;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const worker = reg?.active;
      if (!worker) return -1;
      return await new Promise<number>((resolve) => {
        const channel = new MessageChannel();
        // تایم‌اوت — SW جواب نداد → −1 → fallback به صف اپ
        const timer = setTimeout(() => resolve(-1), 3000);
        channel.port1.onmessage = (ev) => {
          clearTimeout(timer);
          resolve(Number(ev.data?.count ?? 0));
        };
        worker.postMessage({ type: "GET_QUEUE_COUNT" }, [channel.port2]);
      });
    } catch {
      return -1;
    }
  }, []);

  // شمارش صف: اول صف واقعی SW؛ اگر در دسترس نبود (−1) صف اپ به‌عنوان fallback
  const refreshPendingCount = React.useCallback(async () => {
    try {
      const swCount = await getSwQueueCount();
      if (swCount >= 0) {
        if (mountedRef.current) setPendingCount(swCount);
        return;
      }
      const actions = await getOfflineActions();
      if (mountedRef.current) setPendingCount(actions.length);
    } catch {
      /* ignore */
    }
  }, [getSwQueueCount]);

  const doSync = React.useCallback(async () => {
    setSyncing(true);
    try {
      // FIX(v8): اول صف SW را با FORCE_SYNC بازپخش کن (صف اصلیِ آفلاین)
      try {
        if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          reg?.active?.postMessage({ type: "FORCE_SYNC" });
        }
      } catch {
        /* SW در دسترس نیست — ادامه با صف اپ */
      }
      // سپس صف قدیمی اپ (اگر آیتمی دارد)
      const result = await replayQueuedActions(token);
      setLastSyncAt(Date.now());
      setLastSyncResult({
        succeeded: result.succeeded,
        failed: result.failed,
      });
      // شمارش دوباره از صف واقعی SW — فرصت کوتاه برای پردازش async پیام
      await new Promise((r) => setTimeout(r, 600));
      await refreshPendingCount();
    } catch {
      /* ignore */
    } finally {
      setSyncing(false);
    }
  }, [token, refreshPendingCount]);

  // FIX(H4): همیشه آخرین نسخه‌ی doSync (با توکن تازه) در دسترس listener های قدیمی
  const doSyncRef = React.useRef<() => Promise<void>>(async () => {});
  React.useEffect(() => {
    doSyncRef.current = doSync;
  }, [doSync]);

  // مقداردهی اولیه + event listeners
  React.useEffect(() => {
    if (typeof navigator !== "undefined") {
      setIsOnline(navigator.onLine);
    }

    refreshPendingCount().catch(() => {
      /* ignore */
    });

    const handleOnline = () => {
      setIsOnline(true);
      setServerOffline(false);
      // FIX(H4): از ref استفاده می‌کنیم — قبلاً effect با deps [] نسخه‌ی اولیه‌ی doSync
      // (با token=null قبل از لاگین) را می‌بست و replay صف همیشه بدون Authorization بود
      void doSyncRef.current();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    // FIX(v8/H4): SW پاسخ کش‌شده سرو می‌کند → auth-fetch رویداد می‌فرستد
    const handleServerOffline = (ev: Event) => {
      setServerOffline(Boolean((ev as CustomEvent).detail?.offline));
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("hoosh:offline-cache", handleServerOffline as EventListener);

    // refresh هر ۳۰ ثانیه — FIX(21-C — PERF): وقتی تب مخفی است ردیف صف را
    // نخوان (خواندن محلی SW است اما بیدارکردن بی‌دلیل موتور JS بی‌مصرف است)
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refreshPendingCount();
    }, 30_000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("hoosh:offline-cache", handleServerOffline as EventListener);
      clearInterval(interval);
    };
  }, [refreshPendingCount]);

  // FIX(H4): وقتی توکن بعد از mount در دسترس آمد و صف پُر است، همگام‌سازی خودکار
  React.useEffect(() => {
    if (token && isOnline && pendingCount > 0) {
      void doSyncRef.current();
    }
  }, [token, isOnline, pendingCount]);

  const queueAction = React.useCallback(
    async (action: Omit<QueuedAction, "id" | "queuedAt" | "attempts">) => {
      await saveOfflineAction(action);
      await refreshPendingCount();
    },
    [refreshPendingCount]
  );

  const syncNow = React.useCallback(async () => {
    await doSync();
  }, [doSync]);

  return {
    isOnline,
    serverOffline,
    pendingCount,
    syncing,
    lastSyncAt,
    lastSyncResult,
    queueAction,
    syncNow,
  };
}
