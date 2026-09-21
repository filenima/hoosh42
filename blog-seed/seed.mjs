/**
 * Blog Seeder — درج ۲۷ مقاله SEO از blog-seed/posts به دیتابیس
 * اجرا: bun blog-seed/seed.mjs
 * Idempotent: بر اساس slug عمل upsert انجام می‌دهد.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../lib/db.js";

const DIR = new URL(".", import.meta.url).pathname + "posts";

function countPersianWords(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.split(" ").filter((w) => w.length > 0).length : 0;
}

async function main() {
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".json")).sort();
  let created = 0;
  let updated = 0;

  for (const jf of files) {
    const base = jf.replace(/\.json$/, "");
    const meta = JSON.parse(await readFile(join(DIR, jf), "utf8"));
    const htmlFile = join(DIR, `${base}.html`);
    let content = "";
    try {
      content = await readFile(join(DIR, `${base}.html`), "utf8");
    } catch {
      console.error(`✗ HTML یافت نشد: ${base}.html — رد شد`);
      continue;
    }

    const words = countPersianWords(content);
    const readingTime = Math.max(4, Math.round(words / 220));
    const daysAgo = Number(meta.publishedDaysAgo ?? 1);
    const publishedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

    const data = {
      title: meta.title,
      excerpt: meta.excerpt ?? null,
      content,
      coverImage: meta.coverImage ?? null,
      category: meta.category ?? "TUTORIAL",
      tags: JSON.stringify(meta.tags ?? []),
      status: "PUBLISHED",
      publishedAt,
      readingTime,
      metaTitle: meta.metaTitle ?? null,
      metaDescription: meta.metaDescription ?? null,
      focusKeyword: meta.focusKeyword ?? null,
      ogImage: meta.coverImage ?? null,
    };

    const existing = await db.blogPost.findUnique({ where: { slug: meta.slug }, select: { id: true } });
    if (existing) {
      await db.blogPost.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await db.blogPost.create({ data: { slug: meta.slug, ...data } });
      created++;
    }
    console.log(`${existing ? "↻" : "✓"} ${meta.slug} — ${words} کلمه، ${readingTime} دقیقه`);
  }

  console.log(`\nتمام: ${created} ایجاد، ${updated} به‌روزرسانی شد.`);
  const total = await db.blogPost.count({ where: { status: "PUBLISHED" } });
  console.log(`کل مقالات منتشرشده در دیتابیس: ${total}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error("Seed error:", e);
  process.exit(1);
});
