"use client";

import * as React from "react";
import type { SiteContentOverrides } from "@/lib/site-content";

/**
 * use-site-content — محتوای داینامیک صفحه فرود در کلاینت
 *
 * منبع داده: /api/site-content (عمومی، Cache-Control: no-store).
 * همان الگوی hooks/use-branding.ts:
 *  - کش ماژول‌سطحی (فقط یک fetch بین همه‌ی مصرف‌کننده‌ها)
 *  - in-flight dedupe (درخواست‌های موازی به یک Promise واحد می‌رسند)
 *  - مشترکین (subscribers) — پس از ذخیره در ویرایشگر، setSiteContentCache()
 *    مقدار جدید را هم‌زمان در همه‌ی مصرف‌کننده‌های باز اعمال می‌کند.
 *
 * رندر اول همیشه با DEFAULT_SITE_CONTENT انجام می‌شود (بدون override —
 * خروجی ۱:۱ با کد فعلی) و پس از mount مقدار واقعی جایگزین می‌شود.
 */

const LS_EDITOR_FLAG = "hoosh_site_editor";
const LS_EDITOR_TOKEN = "hoosh_site_editor_token";

export const DEFAULT_SITE_CONTENT_CLIENT: SiteContentOverrides = {
  fields: {},
  hidden: [],
  order: [],
  custom: [],
};

// کش ماژول‌سطحی — فقط یک fetch بین همه‌ی مصرف‌کننده‌ها
let cachedContent: SiteContentOverrides | null = null;
let inflight: Promise<SiteContentOverrides> | null = null;
const subscribers = new Set<(c: SiteContentOverrides) => void>();

function normalize(data: unknown): SiteContentOverrides {
  if (!data || typeof data !== "object") return DEFAULT_SITE_CONTENT_CLIENT;
  const d = data as Partial<SiteContentOverrides>;
  return {
    fields:
      d.fields && typeof d.fields === "object" && !Array.isArray(d.fields)
        ? (d.fields as Record<string, string>)
        : {},
    hidden: Array.isArray(d.hidden)
      ? d.hidden.filter((x): x is string => typeof x === "string")
      : [],
    order: Array.isArray(d.order)
      ? d.order.filter((x): x is string => typeof x === "string")
      : [],
    custom: Array.isArray(d.custom)
      ? d.custom.filter(
          (c): c is SiteContentOverrides["custom"][number] =>
            !!c && typeof c === "object" && typeof c.id === "string"
        )
      : [],
  };
}

function notify(data: SiteContentOverrides): void {
  subscribers.forEach((fn) => {
    try {
      fn(data);
    } catch {
      // subscriber خطا خورد — بقیه ادامه می‌دهند
    }
  });
}

/** خواندن محتوای سایت از /api/site-content — single-flight. */
async function fetchSiteContent(force = false): Promise<SiteContentOverrides> {
  if (!force && cachedContent) return cachedContent;
  if (inflight) return inflight;
  inflight = fetch("/api/site-content")
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      const data = normalize(json?.success ? json.data : null);
      cachedContent = data;
      notify(data);
      return data;
    })
    .catch(() => cachedContent || DEFAULT_SITE_CONTENT_CLIENT)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * به‌روزرسانی دستی کش محتوا (پس از ذخیره در ویرایشگر) —
 * مقدار جدید را در حافظه می‌نویسد و همه‌ی useSiteContent های فعال
 * و همه‌ی صفحه‌های باز را مطلع می‌کند.
 */
export function setSiteContentCache(data: SiteContentOverrides): void {
  const normalized = normalize(data);
  cachedContent = normalized;
  notify(normalized);
}

/** مقدار کش‌شده فعلی (بدون fetch) */
export function getSiteContentCache(): SiteContentOverrides {
  return cachedContent || DEFAULT_SITE_CONTENT_CLIENT;
}

/** پرچم فعال‌بودن حالت ویرایشگر (sessionStorage) */
export function isSiteEditorFlagActive(): boolean {
  try {
    return window.sessionStorage.getItem(LS_EDITOR_FLAG) === "1";
  } catch {
    return false;
  }
}

/** توکن سوپرادمین ذخیره‌شده برای ویرایشگر */
export function getSiteEditorToken(): string | null {
  try {
    return window.sessionStorage.getItem(LS_EDITOR_TOKEN);
  } catch {
    return null;
  }
}

/** فعال‌سازی حالت ویرایش (از پنل سوپرادمین صدا زده می‌شود) */
export function activateSiteEditor(token: string): void {
  try {
    window.sessionStorage.setItem(LS_EDITOR_FLAG, "1");
    window.sessionStorage.setItem(LS_EDITOR_TOKEN, token);
  } catch {
    // private mode — نادیده گرفته می‌شود
  }
}

/** خروج از حالت ویرایش */
export function deactivateSiteEditor(): void {
  try {
    window.sessionStorage.removeItem(LS_EDITOR_FLAG);
    window.sessionStorage.removeItem(LS_EDITOR_TOKEN);
  } catch {
    // نادیده گرفته می‌شود
  }
}

export function useSiteContent(): {
  content: SiteContentOverrides;
  loading: boolean;
} {
  // رندر اول: پیش‌فرض خالی — بدون override، خروجی ۱:۱ با کد فعلی
  const [content, setContent] = React.useState<SiteContentOverrides>(
    cachedContent || DEFAULT_SITE_CONTENT_CLIENT
  );
  const [loading, setLoading] = React.useState(!cachedContent);

  React.useEffect(() => {
    let cancelled = false;
    const apply = (c: SiteContentOverrides) => {
      if (!cancelled) setContent((prev) => (prev === c ? prev : c));
    };

    fetchSiteContent().then((c) => {
      apply(c);
      if (!cancelled) setLoading(false);
    });

    subscribers.add(apply);
    return () => {
      cancelled = true;
      subscribers.delete(apply);
    };
  }, []);

  return { content, loading };
}
