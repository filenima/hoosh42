import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/platform-middleware";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// مدل‌های مهم پلتفرم برای نمایش در Schema Visualizer.
// این لیست دستی نگه داشته می‌شود تا ERD تمیز و مرتبط نمایش داده شود
// (تمام مدل‌های اصلی که سوپرادمین نیاز به دیدن روابط آن‌ها دارد).
const SCHEMA_MODELS = [
 {
 name: "Tenant",
 fields: [
 { name: "id", type: "String", pk: true },
 { name: "name", type: "String" },
 { name: "subdomain", type: "String?" },
 { name: "plan", type: "String" },
 { name: "status", type: "String" },
 { name: "contactName", type: "String?" },
 { name: "contactEmail", type: "String?" },
 { name: "totalRevenue", type: "Int?" },
 { name: "modianEnabled", type: "Boolean" },
 { name: "createdAt", type: "DateTime" },
 ],
 relations: [
 { to: "User", type: "1:N", field: "users" },
 { to: "Invoice", type: "1:N", field: "invoices" },
 { to: "License", type: "1:N", field: "licenses" },
 { to: "Product", type: "1:N", field: "products" },
 { to: "Party", type: "1:N", field: "parties" },
 { to: "CrmNote", type: "1:N", field: "crmNotes" },
 { to: "AuditLog", type: "1:N", field: "auditLogs" },
 ],
 },
 {
 name: "User",
 fields: [
 { name: "id", type: "String", pk: true },
 { name: "tenantId", type: "String", fk: "Tenant" },
 { name: "email", type: "String", unique: true },
 { name: "name", type: "String" },
 { name: "role", type: "String" },
 { name: "isActive", type: "Boolean" },
 { name: "isTrial", type: "Boolean" },
 { name: "trialEndsAt", type: "DateTime?" },
 { name: "lastLogin", type: "DateTime?" },
 { name: "lastLoginIp", type: "String?" },
 ],
 relations: [
 { to: "Tenant", type: "N:1", field: "tenant" },
 { to: "UserSession", type: "1:N", field: "sessions" },
 { to: "AuditLog", type: "1:N", field: "auditLogs" },
 ],
 },
 {
 name: "UserSession",
 fields: [
 { name: "id", type: "String", pk: true },
 { name: "userId", type: "String", fk: "User" },
 { name: "token", type: "String", unique: true },
 { name: "deviceFingerprint", type: "String" },
 { name: "ipAddress", type: "String?" },
 { name: "expiresAt", type: "DateTime" },
 { name: "isActive", type: "Boolean" },
 { name: "lastUsedAt", type: "DateTime" },
 ],
 relations: [{ to: "User", type: "N:1", field: "user" }],
 },
 {
 name: "Invoice",
 fields: [
 { name: "id", type: "String", pk: true },
 { name: "tenantId", type: "String", fk: "Tenant" },
 { name: "number", type: "String" },
 { name: "partyId", type: "String", fk: "Party" },
 { name: "total", type: "Decimal" },
 { name: "status", type: "String" },
 { name: "createdAt", type: "DateTime" },
 ],
 relations: [
 { to: "Tenant", type: "N:1", field: "tenant" },
 { to: "Party", type: "N:1", field: "party" },
 ],
 },
 {
 name: "License",
 fields: [
 { name: "id", type: "String", pk: true },
 { name: "key", type: "String", unique: true },
 { name: "tenantId", type: "String", fk: "Tenant" },
 { name: "plan", type: "String" },
 { name: "status", type: "String" },
 { name: "maxUsers", type: "Int" },
 { name: "maxInvoices", type: "Int" },
 { name: "endDate", type: "DateTime?" },
 ],
 relations: [{ to: "Tenant", type: "N:1", field: "tenant" }],
 },
 {
 name: "Party",
 fields: [
 { name: "id", type: "String", pk: true },
 { name: "tenantId", type: "String", fk: "Tenant" },
 { name: "name", type: "String" },
 { name: "type", type: "String" },
 { name: "phone", type: "String?" },
 { name: "email", type: "String?" },
 ],
 relations: [{ to: "Tenant", type: "N:1", field: "tenant" }],
 },
 {
 name: "Product",
 fields: [
 { name: "id", type: "String", pk: true },
 { name: "tenantId", type: "String", fk: "Tenant" },
 { name: "name", type: "String" },
 { name: "code", type: "String" },
 { name: "price", type: "Decimal" },
 { name: "stock", type: "Decimal?" },
 ],
 relations: [{ to: "Tenant", type: "N:1", field: "tenant" }],
 },
 {
 name: "AuditLog",
 fields: [
 { name: "id", type: "String", pk: true },
 { name: "tenantId", type: "String", fk: "Tenant" },
 { name: "userId", type: "String?", fk: "User" },
 { name: "action", type: "String" },
 { name: "entity", type: "String" },
 { name: "entityId", type: "String?" },
 { name: "ipAddress", type: "String?" },
 { name: "createdAt", type: "DateTime" },
 ],
 relations: [
 { to: "Tenant", type: "N:1", field: "tenant" },
 { to: "User", type: "N:1", field: "user" },
 ],
 },
 {
 name: "CrmNote",
 fields: [
 { name: "id", type: "String", pk: true },
 { name: "tenantId", type: "String", fk: "Tenant" },
 { name: "content", type: "String" },
 { name: "createdBy", type: "String?" },
 { name: "creatorName", type: "String?" },
 { name: "createdAt", type: "DateTime" },
 ],
 relations: [{ to: "Tenant", type: "N:1", field: "tenant" }],
 },
 {
 name: "ErrorLog",
 fields: [
 { name: "id", type: "String", pk: true },
 { name: "level", type: "String" },
 { name: "message", type: "String" },
 { name: "statusCode", type: "Int?" },
 { name: "tenantId", type: "String?" },
 { name: "userId", type: "String?" },
 { name: "createdAt", type: "DateTime" },
 ],
 relations: [],
 },
 {
 name: "BlogPost",
 fields: [
 { name: "id", type: "String", pk: true },
 { name: "slug", type: "String", unique: true },
 { name: "title", type: "String" },
 { name: "content", type: "String" },
 { name: "category", type: "String" },
 { name: "status", type: "String" },
 { name: "publishedAt", type: "DateTime?" },
 ],
 relations: [],
 },
 {
 name: "CmsPage",
 fields: [
 { name: "id", type: "String", pk: true },
 { name: "slug", type: "String", unique: true },
 { name: "title", type: "String" },
 { name: "content", type: "String" },
 { name: "status", type: "String" },
 { name: "category", type: "String?" },
 ],
 relations: [{ to: "CmsPageVersion", type: "1:N", field: "versions" }],
 },
 {
 name: "CmsPageVersion",
 fields: [
 { name: "id", type: "String", pk: true },
 { name: "pageId", type: "String", fk: "CmsPage" },
 { name: "pageType", type: "String" },
 { name: "title", type: "String" },
 { name: "content", type: "String" },
 { name: "authorName", type: "String?" },
 { name: "createdAt", type: "DateTime" },
 ],
 relations: [{ to: "CmsPage", type: "N:1", field: "page" }],
 },
 {
 name: "SuperAdmin",
 fields: [
 { name: "id", type: "String", pk: true },
 { name: "username", type: "String", unique: true },
 { name: "password", type: "String" },
 { name: "isActive", type: "Boolean" },
 { name: "lastLogin", type: "DateTime?" },
 ],
 relations: [{ to: "PlatformAuditLog", type: "1:N", field: "auditLogs" }],
 },
 {
 name: "PlatformAuditLog",
 fields: [
 { name: "id", type: "String", pk: true },
 { name: "superAdminId", type: "String?", fk: "SuperAdmin" },
 { name: "action", type: "String" },
 { name: "entity", type: "String" },
 { name: "entityId", type: "String?" },
 { name: "ipAddress", type: "String?" },
 { name: "createdAt", type: "DateTime" },
 ],
 relations: [{ to: "SuperAdmin", type: "N:1", field: "superAdmin" }],
 },
] as const;

/**
 * GET /api/platform/db/schema — Schema Visualizer
 * مدل‌ها + فیلدها + روابط را برای نمایش ERD برمی‌گرداند.
 */
export async function GET(req: NextRequest) {
 const auth = await requireSuperAdmin(req);
 if ("error" in auth) return auth.error;

 try {
 // تعداد رکورد هر مدل را هم برای اطلاع‌رسانی سریع برگردان
 const counts: Record<string, number> = {};
 const countable = ["Tenant", "User", "Invoice", "License", "Product", "Party", "AuditLog", "CrmNote", "ErrorLog", "BlogPost", "CmsPage", "CmsPageVersion", "PlatformAuditLog"];
 const modelToTable: Record<string, string> = {
 Tenant: "tenant",
 User: "user",
 Invoice: "invoice",
 License: "license",
 Product: "product",
 Party: "party",
 AuditLog: "auditLog",
 CrmNote: "crmNote",
 ErrorLog: "errorLog",
 BlogPost: "blogPost",
 CmsPage: "cmsPage",
 CmsPageVersion: "cmsPageVersion",
 PlatformAuditLog: "platformAuditLog",
 };
 for (const m of countable) {
 const table = modelToTable[m];
 try {
 // @ts-ignore — dynamic
 counts[m] = await (db as any)[table]?.count?.()?? 0;
 } catch {
 counts[m] = 0;
 }
 }

 // ساخت لیست یال‌ها (edges) برای ERD
 const edges: { from: string; to: string; type: string; field: string }[] = [];
 for (const m of SCHEMA_MODELS) {
 for (const r of m.relations) {
 if (SCHEMA_MODELS.some((x) => x.name === r.to)) {
 edges.push({ from: m.name, to: r.to, type: r.type, field: r.field });
 }
 }
 }

 return NextResponse.json({
 success: true,
 data: {
 models: SCHEMA_MODELS.map((m) => ({
 name: m.name,
 fields: m.fields,
 relations: m.relations,
 rowCount: counts[m.name]?? null,
 })),
 edges,
 stats: {
 modelCount: SCHEMA_MODELS.length,
 edgeCount: edges.length,
 },
 },
 });
 } catch (error) {
 console.error("[db-schema] error:", error);
 return NextResponse.json(
 { success: false, error: "خطا در دریافت schema" },
 { status: 500 }
 );
 }
}
