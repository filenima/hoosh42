"use client";

/**
 * PriceWidget — ویجت قیمت زنده طلا و ارز برای داشبورد قابل‌تنظیم
 *
 * - هر ۶۰ ثانیه نرخ‌ها را از /api/currency/fetch-tgju (GET) دریافت می‌کند
 * - نمایش چهار قلم اصلی: طلا ۱۸، دلار، یورو، درهم با روند (Trend arrows)
 * - اسپارک‌لاین مینی برای هر قلم (آخرین ۱۰ نقطه داده)
 * - دکمه‌ی «به‌روزرسانی» برای دریافت دستی
 * - بدون emoji — فقط آیکون‌های Lucide
 */

import * as React from "react";
import {
 RefreshCw,
 TrendingUp,
 TrendingDown,
 Minus,
 Coins,
 type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toPersianDigits, formatNumber } from "@/lib/persian";

interface PriceData {
 price: number;
 name: string;
 fetchedAt?: string;
}

interface PriceResponse {
 success: boolean;
 data?: Record<string, PriceData>;
}

const WIDGET_ITEMS = [
 { key: "gold:GERAM18", label: "طلای ۱۸ عیار", short: "طلا", symbol: "ریال" },
 { key: "currency:USD", label: "دلار آمریکا", short: "دلار", symbol: "ریال" },
 { key: "currency:EUR", label: "یورو", short: "یورو", symbol: "ریال" },
 { key: "currency:AED", label: "درهم امارات", short: "درهم", symbol: "ریال" },
];

const REFRESH_INTERVAL_MS = 60_000;
const SPARKLINE_POINTS = 10;

function formatPrice(p: number | null | undefined): string {
 if (p == null ||!Number.isFinite(p)) return "—";
 if (p >= 1_000_000_000) {
 return `${toPersianDigits((p / 1_000_000_000).toFixed(2))} میلیارد`;
 }
 if (p >= 1_000_000) {
 return `${toPersianDigits((p / 1_000_000).toFixed(1))} میلیون`;
 }
 return toPersianDigits(formatNumber(Math.round(p)));
}

function Sparkline({ points, accent }: { points: number[]; accent: string }) {
 if (!points || points.length < 2) {
 return (
 <svg viewBox="0 0 100 24" className="w-full h-6" preserveAspectRatio="none">
 <line
 x1="0"
 y1="12"
 x2="100"
 y2="12"
 stroke="currentColor"
 strokeOpacity="0.2"
 strokeWidth="1"
 strokeDasharray="3 3"
 className="text-muted-foreground"
 />
 </svg>
 );
 }
 const min = Math.min(...points);
 const max = Math.max(...points);
 const range = max - min || 1;
 const w = 100;
 const h = 24;
 const step = w / (points.length - 1);
 const coords = points.map((p, i) => {
 const x = i * step;
 const y = h - ((p - min) / range) * (h - 4) - 2;
 return `${x.toFixed(2)},${y.toFixed(2)}`;
 });
 const path = `M ${coords.join(" L ")}`;
 const isUp = points[points.length - 1] >= points[0];
 const stroke = accent || (isUp? "#ef4444": "#10b981");
 return (
 <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-6" preserveAspectRatio="none">
 <path
 d={path}
 fill="none"
 stroke={stroke}
 strokeWidth="1.5"
 strokeLinecap="round"
 strokeLinejoin="round"
 />
 </svg>
 );
}

export function PriceWidget() {
 const [data, setData] = React.useState<Record<string, PriceData>>({});
 const [history, setHistory] = React.useState<Record<string, number[]>>({});
 const [loading, setLoading] = React.useState(false);
 const [updatedAt, setUpdatedAt] = React.useState<string | null>(null);

 const fetchPrices = React.useCallback(async () => {
 try {
 setLoading(true);
 const res = await fetch("/api/currency/fetch-tgju", { cache: "no-store" });
 const json: PriceResponse = await res.json();
 if (json.success && json.data) {
 setData(json.data);
 setUpdatedAt(new Date().toISOString());
 setHistory((prev) => {
 const next: Record<string, number[]> = {...prev };
 for (const item of WIDGET_ITEMS) {
 const price = json.data?.[item.key]?.price;
 if (typeof price === "number" && price > 0) {
 const arr = next[item.key]?? [];
 const updated = [...arr, price].slice(-SPARKLINE_POINTS);
 next[item.key] = updated;
 }
 }
 return next;
 });
 }
 } catch {
 // خطای خاموش
 } finally {
 setLoading(false);
 }
 }, []);

 React.useEffect(() => {
 fetchPrices();
 // FIX(21-C — PERF): poll قیمت‌ها وقتی تب مخفی است متوقف می‌شود؛ در بازگشت
 // به تب یک بار بی‌صدا تازه می‌شود (هرگز ناوبری/رندر را بلاک نمی‌کند).
 const id = setInterval(() => {
 if (typeof document === "undefined" || document.hidden) return;
 void fetchPrices();
 }, REFRESH_INTERVAL_MS);
 const onVisible = () => {
 if (document.visibilityState === "visible") void fetchPrices();
 };
 document.addEventListener("visibilitychange", onVisible);
 return () => {
 clearInterval(id);
 document.removeEventListener("visibilitychange", onVisible);
 };
 }, [fetchPrices]);

 return (
 <div className="space-y-3">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
 <Coins className="h-3.5 w-3.5" />
 </div>
 <div>
 <p className="text-xs font-semibold text-foreground leading-tight">
 قیمت زنده طلا و ارز
 </p>
 <p className="text-[10px] text-muted-foreground leading-tight">
 {updatedAt
? `به‌روزرسانی: ${new Intl.DateTimeFormat("fa-IR", {
 hour: "2-digit",
 minute: "2-digit",
 }).format(new Date(updatedAt))}`
: "در حال بارگذاری..."}
 </p>
 </div>
 </div>
 <Button
 variant="ghost"
 size="icon"
 className="h-7 w-7"
 onClick={fetchPrices}
 disabled={loading}
 aria-label="به‌روزرسانی"
 >
 <RefreshCw className={`h-3.5 w-3.5 ${loading? "animate-spin": ""}`} />
 </Button>
 </div>

 <div className="grid grid-cols-2 gap-2">
 {WIDGET_ITEMS.map((item) => {
 const d = data[item.key];
 const points = history[item.key]?? [];
 const trend: "up" | "down" | "stable" =
 points.length >= 2
? points[points.length - 1] > points[points.length - 2]
? "up"
: points[points.length - 1] < points[points.length - 2]
? "down"
: "stable"
: "stable";
 const TrendIcon: LucideIcon =
 trend === "up"? TrendingUp: trend === "down"? TrendingDown: Minus;
 const trendColor =
 trend === "up"
? "text-red-600"
: trend === "down"
? "text-emerald-600"
: "text-muted-foreground";
 return (
 <div
 key={item.key}
 className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-1"
 >
 <div className="flex items-center justify-between">
 <span className="text-[10px] text-muted-foreground truncate">
 {item.short}
 </span>
 <TrendIcon className={`h-3 w-3 ${trendColor}`} />
 </div>
 <p className="text-sm font-bold text-foreground tnum leading-tight truncate">
 {formatPrice(d?.price)}
 </p>
 <Sparkline
 points={points}
 accent={
 trend === "up"? "#ef4444": trend === "down"? "#10b981": "#6b7280"
 }
 />
 </div>
 );
 })}
 </div>

 <div className="flex items-center justify-between pt-1 border-t border-border">
 <Badge variant="outline" className="text-[10px] gap-1">
 <RefreshCw className="h-2.5 w-2.5" />
 هر ۶۰ ثانیه
 </Badge>
 <span className="text-[10px] text-muted-foreground">
 منبع: تگ‌جو
 </span>
 </div>
 </div>
 );
}

export default PriceWidget;
