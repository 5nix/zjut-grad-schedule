import { createHmac, timingSafeEqual } from "node:crypto";

function secret() {
  const value = process.env.APP_SESSION_SECRET;
  if (!value) throw new Error("缺少 APP_SESSION_SECRET（32 字节 Base64）");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("APP_SESSION_SECRET 必须解码为 32 字节");
  return key;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(value) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createSessionToken(studentId) {
  // 这是账号级订阅 token：同一学号在密钥不变时始终得到同一个值。
  const payload = encode({ sub: studentId });
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token) {
  const [payload, signature] = String(token ?? "").split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!/^\d{6,20}$/.test(String(data.sub))
    || (data.exp !== undefined
      && (!Number.isFinite(data.exp) || data.exp <= Date.now() / 1000))) return null;
  return data;
}
