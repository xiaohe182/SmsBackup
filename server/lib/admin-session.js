import { randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "sms_admin_session";

function constantTimeEquals(left, right) {
  const leftBuffer = Buffer.from(String(left), "utf8");
  const rightBuffer = Buffer.from(String(right), "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    // 长度不同时仍执行一次比较，避免明显的早返回时序差异。
    timingSafeEqual(leftBuffer, leftBuffer);
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function cookieValue(request) {
  const header = request.headers.cookie;
  if (typeof header !== "string") return "";
  for (const part of header.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === COOKIE_NAME) return valueParts.join("=");
  }
  return "";
}

export class AdminSessionManager {
  constructor(password, { clock = Date.now, ttlMilliseconds = 8 * 60 * 60 * 1000 } = {}) {
    if (typeof password !== "string" || !password) throw new TypeError("admin password is required");
    this.password = password;
    this.clock = clock;
    this.ttlMilliseconds = ttlMilliseconds;
    this.sessions = new Map();
  }

  create(password) {
    if (!constantTimeEquals(password, this.password)) return null;
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.clock() + this.ttlMilliseconds;
    this.sessions.set(token, expiresAt);
    return { token, expiresAt };
  }

  authorize(request) {
    const token = cookieValue(request);
    const expiresAt = this.sessions.get(token);
    if (!expiresAt) return false;
    if (expiresAt <= this.clock()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  delete(request) {
    const token = cookieValue(request);
    if (token) this.sessions.delete(token);
  }

  cookie(token) {
    const maxAge = Math.max(0, Math.floor(this.ttlMilliseconds / 1000));
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
  }

  expiredCookie() {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
  }
}
