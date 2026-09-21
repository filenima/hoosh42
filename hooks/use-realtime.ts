"use client";

/**
 * useRealtime — hook همگام‌سازی بلادرنگ هوش
 *
 * به socket.io mini-service روی پورت ۳۰۰۳ وصل می‌شود (از طریق Caddy gateway
 * با XTransformPort=3003 در query string).
 *
 * کارهایی که انجام می‌دهد:
 * - اتصال به socket.io با auth token
 * - join به room مربوط به tenant کاربر
 * - ردیابی presence کاربران آنلاین همان tenant
 * - ارسال edit/lock/unlock و دریافت broadcast از سایر کاربران
 * - دریافت notification‌ها
 *
 * استفاده:
 * const { socket, onlineUsers, emitEdit, lockDoc, unlockDoc, onNotification } =
 * useRealtime(token);
 */

import * as React from "react";
import { io, type Socket } from "socket.io-client";

const REALTIME_URL = "/?XTransformPort=3003";

export interface PresenceUser {
 userId: string;
 name: string;
 module: string;
 lastSeen: number;
}

export interface DocumentEditPayload {
 entity: string;
 entityId: string;
 field: string;
 value: unknown;
 userId: string;
}

export interface DocumentLockPayload {
 entity: string;
 entityId: string;
 userId: string;
}

export interface RealtimeNotification {
 id: string;
 title: string;
 body?: string;
 type?: string;
 link?: string;
 createdAt: string;
}

interface JwtPayload {
 type?: string;
 id?: string;
 tenantId?: string;
 role?: string;
}

function decodeJwt(token: string): JwtPayload | null {
 try {
 const parts = token.split(".");
 if (parts.length!== 3) return null;
 const body = parts[1];
 const json = Buffer
? Buffer.from(body, "base64url").toString("utf8")
: atob(body.replace(/-/g, "+").replace(/_/g, "/"));
 return JSON.parse(json) as JwtPayload;
 } catch {
 return null;
 }
}

const DEFAULT_USER_NAME = "کاربر هوش";

interface UseRealtimeReturn {
 socket: Socket | null;
 connected: boolean;
 onlineUsers: PresenceUser[];
 emitEdit: (
 payload: Omit<DocumentEditPayload, "userId">
 ) => void;
 lockDoc: (
 payload: Omit<DocumentLockPayload, "userId">
 ) => void;
 unlockDoc: (
 payload: { entity: string; entityId: string }
 ) => void;
 onEdit: (cb: (payload: DocumentEditPayload) => void) => () => void;
 onLock: (
 cb: (payload: DocumentLockPayload & { denied?: boolean }) => void
 ) => () => void;
 onUnlock: (
 cb: (payload: { entity: string; entityId: string }) => void
 ) => () => void;
 onNotification: (cb: (n: RealtimeNotification) => void) => () => void;
 pushNotification: (n: Omit<RealtimeNotification, "id" | "createdAt"> & {
 tenantId: string;
 userId?: string;
 }) => void;
 updateModule: (module: string) => void;
}

/**
 * Hook همگام‌سازی بلادرنگ
 * @param token JWT کاربر (اگر null باشد، اتصال برقرار نمی‌شود)
 * @param moduleName ماژول فعلی کاربر (برای presence)
 */
export function useRealtime(
 token: string | null,
 moduleName?: string
): UseRealtimeReturn {
 const [socket, setSocket] = React.useState<Socket | null>(null);
 const [connected, setConnected] = React.useState(false);
 const [onlineUsers, setOnlineUsers] = React.useState<PresenceUser[]>([]);

 // استخراج tenantId و userId از token
 const { tenantId, userId } = React.useMemo(() => {
 if (!token) return { tenantId: "", userId: "" };
 const p = decodeJwt(token);
 return {
 tenantId: p?.tenantId?? "",
 userId: p?.id?? "",
 };
 }, [token]);

 const moduleRef = React.useRef(moduleName?? "app");
 React.useEffect(() => {
 if (moduleName) moduleRef.current = moduleName;
 }, [moduleName]);

 // اتصال به socket.io وقتی token و tenantId موجودند
 React.useEffect(() => {
 if (!token ||!tenantId ||!userId) return;

 const sock = io(REALTIME_URL, {
 transports: ["websocket", "polling"],
 auth: { token },
 reconnection: true,
 reconnectionAttempts: Infinity,
 reconnectionDelay: 1000,
 reconnectionDelayMax: 10000,
 timeout: 10000,
 forceNew: true,
 });

 setSocket(sock);

 const onConnect = () => {
 setConnected(true);
 sock.emit("join-tenant", tenantId);
 sock.emit("presence", {
 userId,
 name: DEFAULT_USER_NAME,
 module: moduleRef.current,
 });
 };
 const onDisconnect = () => {
 setConnected(false);
 };
 const onPresenceUpdate = (users: PresenceUser[]) => {
 if (!Array.isArray(users)) return;
 // فیلتر خود کاربر
 setOnlineUsers(users.filter((u) => u.userId!== userId));
 };
 const onPresenceList = (users: PresenceUser[]) => {
 if (!Array.isArray(users)) return;
 setOnlineUsers(users.filter((u) => u.userId!== userId));
 };

 sock.on("connect", onConnect);
 sock.on("disconnect", onDisconnect);
 sock.on("presence-update", onPresenceUpdate);
 sock.on("presence-list", onPresenceList);

 // بروزرسانی presence — FIX(21-C — PERF موبایل): هر ۶۰ ثانیه روی موبایل
 // (۳۰ ثانیه دسکتاپ) و وقتی تب مخفی است heartbeat نزن (battery/GPU).
 const HEARTBEAT_MS =
 typeof window !== "undefined" &&
 typeof window.matchMedia === "function" &&
 window.matchMedia("(max-width: 768px)").matches
 ? 60_000
 : 30_000;
 const heartbeat = setInterval(() => {
 if (typeof document !== "undefined" && document.hidden) return;
 if (sock.connected) {
 sock.emit("presence", {
 userId,
 name: DEFAULT_USER_NAME,
 module: moduleRef.current,
 });
 }
 }, HEARTBEAT_MS);

 return () => {
 clearInterval(heartbeat);
 sock.off("connect", onConnect);
 sock.off("disconnect", onDisconnect);
 sock.off("presence-update", onPresenceUpdate);
 sock.off("presence-list", onPresenceList);
 sock.disconnect();
 setSocket(null);
 setConnected(false);
 setOnlineUsers([]);
 };
 }, [token, tenantId, userId]);

 // به‌روزرسانی module در presence وقتی moduleName تغییر کرد
 React.useEffect(() => {
 if (!socket ||!connected ||!userId) return;
 socket.emit("presence", {
 userId,
 name: DEFAULT_USER_NAME,
 module: moduleRef.current,
 });
 }, [moduleName, socket, connected, userId]);

 const emitEdit = React.useCallback(
 (payload: Omit<DocumentEditPayload, "userId">) => {
 if (!socket ||!userId) return;
 socket.emit("document-edit", {...payload, userId });
 },
 [socket, userId]
 );

 const lockDoc = React.useCallback(
 (payload: Omit<DocumentLockPayload, "userId">) => {
 if (!socket ||!userId) return;
 socket.emit("document-lock", {...payload, userId });
 },
 [socket, userId]
 );

 const unlockDoc = React.useCallback(
 (payload: { entity: string; entityId: string }) => {
 if (!socket) return;
 socket.emit("document-unlock", payload);
 },
 [socket]
 );

 const onEdit = React.useCallback(
 (cb: (payload: DocumentEditPayload) => void) => {
 if (!socket) return () => {};
 const handler = (p: DocumentEditPayload) => cb(p);
 socket.on("document-edit", handler);
 return () => {
 socket.off("document-edit", handler);
 };
 },
 [socket]
 );

 const onLock = React.useCallback(
 (cb: (payload: DocumentLockPayload & { denied?: boolean }) => void) => {
 if (!socket) return () => {};
 const handler = (p: DocumentLockPayload & { denied?: boolean }) => cb(p);
 socket.on("document-locked", handler);
 return () => {
 socket.off("document-locked", handler);
 };
 },
 [socket]
 );

 const onUnlock = React.useCallback(
 (cb: (payload: { entity: string; entityId: string }) => void) => {
 if (!socket) return () => {};
 const handler = (p: { entity: string; entityId: string }) => cb(p);
 socket.on("document-unlocked", handler);
 return () => {
 socket.off("document-unlocked", handler);
 };
 },
 [socket]
 );

 const onNotification = React.useCallback(
 (cb: (n: RealtimeNotification) => void) => {
 if (!socket) return () => {};
 const handler = (n: RealtimeNotification) => cb(n);
 socket.on("notification", handler);
 return () => {
 socket.off("notification", handler);
 };
 },
 [socket]
 );

 const pushNotification = React.useCallback(
 (n: Omit<RealtimeNotification, "id" | "createdAt"> & {
 tenantId: string;
 userId?: string;
 }) => {
 if (!socket) return;
 socket.emit("notification", {
 tenantId: n.tenantId,
 userId: n.userId,
 notification: {
 id:
 typeof crypto!== "undefined" && crypto.randomUUID
? crypto.randomUUID()
: Math.random().toString(36).slice(2),
 title: n.title,
 body: n.body,
 type: n.type,
 link: n.link,
 createdAt: new Date().toISOString(),
 },
 });
 },
 [socket]
 );

 const updateModule = React.useCallback(
 (module: string) => {
 moduleRef.current = module;
 if (socket && connected && userId) {
 socket.emit("presence", {
 userId,
 name: DEFAULT_USER_NAME,
 module,
 });
 }
 },
 [socket, connected, userId]
 );

 return {
 socket,
 connected,
 onlineUsers,
 emitEdit,
 lockDoc,
 unlockDoc,
 onEdit,
 onLock,
 onUnlock,
 onNotification,
 pushNotification,
 updateModule,
 };
}
