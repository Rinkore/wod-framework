import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { SECURE_COOKIES, SESSION_TTL_MS } from "./config.js";
import { db } from "./db.js";
import { ApiError, unauthorized } from "./errors.js";
import type { UserRow } from "./types.js";

export const SESSION_COOKIE = "wod_session";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(hashToken(token), userId, now, now + SESSION_TTL_MS);
  return token;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE_COOKIES,
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function destroySession(req: Request): void {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function findUserBySession(req: Request): UserRow | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = db
    .prepare(
      "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
    )
    .get(hashToken(token), Date.now()) as unknown as UserRow | undefined;
  return row ?? null;
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  const user = findUserBySession(req);
  if (!user) {
    next(unauthorized());
    return;
  }
  req.user = user;
  next();
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

/** 极简内存限流，足够挡住脚本化的密码尝试。 */
export function authRateLimit(req: Request, _res: Response, next: NextFunction): void {
  const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }
  entry.count += 1;
  if (entry.count > 30) {
    next(new ApiError(429, "尝试过于频繁，请稍后再试", "rate_limited"));
    return;
  }
  next();
}
