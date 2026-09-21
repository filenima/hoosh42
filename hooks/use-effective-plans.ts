"use client";

import * as React from "react";
import { PLANS, type Plan } from "@/lib/plans";

/**
 * useEffectivePlans — پلن‌های مؤثر را از /api/plans می‌خواند
 * ============================================================================
 * FIX(9-a — ویرایش قیمت پلن‌ها): تمام کامپوننت‌های کلاینت که قیمت/ویژگی
 * پلن‌ها را «نمایش» می‌دهند (صفحه قیمت، لندینگ، مودال چک‌اوت) از این هوک
 * استفاده می‌کنند تا ویرایش‌های سوپرادمین بدون deploy اعمال شود.
 *
 * - مقدار اولیه = PLANS استاتیک → هیچ صفحه‌ای بدون داده نمی‌ماند (SSR/رندر فوری)
 * - در صورت خطای fetch / پاسخ نامعتبر → fallback استاتیک باقی می‌ماند
 * - plans شامل همه پلن‌ها است؛ مصرف‌کننده خودش hidden/free را فیلتر می‌کند
 */
export function useEffectivePlans(): {
  /** همه پلن‌های مؤثر (شامل hidden برای منطق داخلی مثل چک‌اوت) */
  plans: Plan[];
  /** پلن‌های قابل نمایش عمومی */
  visiblePlans: Plan[];
  /** در حال واکشی از API؟ (fallback استاتیک همیشه موجود است) */
  loading: boolean;
  /** جستجوی سریع پلن با id (مؤثر، وگرنه استاتیک) */
  getEffectiveById: (id: string) => Plan | undefined;
} {
  const [plans, setPlans] = React.useState<Plan[]>(PLANS);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/plans")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { success?: boolean; data?: Plan[] } | null) => {
        if (cancelled) return;
        // فقط داده معتبر جایگزین می‌شود — وگرنه fallback استاتیک می‌ماند
        if (j?.success && Array.isArray(j.data) && j.data.length > 0) {
          setPlans(j.data);
        }
      })
      .catch(() => {
        /* آفلاین/خطا → fallback استاتیک */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visiblePlans = React.useMemo(() => plans.filter((p) => !p.hidden), [plans]);

  const getEffectiveById = React.useCallback(
    (id: string) => plans.find((p) => p.id === id),
    [plans]
  );

  return { plans, visiblePlans, loading, getEffectiveById };
}
