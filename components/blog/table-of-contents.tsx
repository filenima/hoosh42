"use client";

import * as React from "react";
import { List, ChevronLeft } from "lucide-react";

export interface TocItem {
 id: string;
 text: string;
 level: number; // 2 = h2, 3 = h3
}

interface TableOfContentsProps {
 items: TocItem[];
}

/**
 * TableOfContents — فهرست مطالب مقاله با scroll-spy
 *
 * برای مقالات طولانی، یک فهرست چسبان (sticky) در کنار محتوا نمایش می‌دهد
 * که با اسکرول کاربر، بخش فعال را هایلایت می‌کند.
 */
export function TableOfContents({ items }: TableOfContentsProps) {
 const [activeId, setActiveId] = React.useState<string>("");

 React.useEffect(() => {
 if (items.length === 0) return;

 const observer = new IntersectionObserver(
 (entries) => {
 for (const entry of entries) {
 if (entry.isIntersecting) {
 setActiveId(entry.target.id);
 }
 }
 },
 {
 rootMargin: "0px 0px -70% 0px",
 threshold: 0,
 }
 );

 for (const item of items) {
 const el = document.getElementById(item.id);
 if (el) observer.observe(el);
 }

 return () => observer.disconnect();
 }, [items]);

 if (items.length === 0) return null;

 return (
 <nav
 aria-label="فهرست مطالب"
 className="rounded-xl border border-border bg-card p-4"
 >
 <div className="flex items-center gap-1.5 mb-3">
 <List className="h-4 w-4 text-primary" />
 <h2 className="text-sm font-semibold">فهرست مطالب</h2>
 </div>
 <ul className="space-y-1">
 {items.map((item, i) => (
 <li
 key={item.id}
 style={{ paddingInlineStart: `${(item.level - 2) * 12}px` }}
 >
 <a
 href={`#${item.id}`}
 className={`flex items-start gap-1 py-1 text-xs leading-relaxed transition-colors ${
 activeId === item.id
? "font-semibold text-primary"
: "text-muted-foreground hover:text-foreground"
 }`}
 >
 <ChevronLeft className="h-3 w-3 mt-0.5 shrink-0 opacity-50" />
 <span className="flex-1">
 <span className="text-muted-foreground/60 ml-1 tnum">{toPersian(i + 1)}.</span>
 {item.text}
 </span>
 </a>
 </li>
 ))}
 </ul>
 </nav>
 );
}

function toPersian(n: number): string {
 return String(n).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}
