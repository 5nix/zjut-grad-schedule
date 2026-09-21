import fs from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function masterKey() {
  const value = process.env.CREDENTIAL_MASTER_KEY;
  if (!value) throw new Error("缺少 CREDENTIAL_MASTER_KEY（32 字节 Base64）");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("CREDENTIAL_MASTER_KEY 必须解码为 32 字节");
  return key;
}

function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

function decrypt(record) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    Buffer.from(record.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export class CredentialStore {
  constructor(file = process.env.CREDENTIAL_STORE_FILE ?? "./data/credentials.json") {
    this.file = path.resolve(file);
    this.writeQueue = Promise.resolve();
  }

  async read() {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return { version: 2, users: {} };
      throw error;
    }
  }

  async write(document) {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
      mode: 0o600,
    });
    await fs.rename(temporary, this.file);
  }

  async save(studentId, password) {
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      const document = await this.read();
      document.users[studentId] = {
        studentId,
        password: encrypt(password),
        updatedAt: new Date().toISOString(),
      };
      document.version = 2;
      await this.write(document);
    });
    return this.writeQueue;
  }

  async saveWithCookies(studentId, password, cookies) {
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      const document = await this.read();
      document.version = 2;
      document.users[studentId] = {
        studentId,
        password: encrypt(password),
        cookies: encrypt(JSON.stringify(cookies ?? [])),
        updatedAt: new Date().toISOString(),
        cookieUpdatedAt: new Date().toISOString(),
      };
      await this.write(document);
    });
    return this.writeQueue;
  }

  async saveCookies(studentId, cookies) {
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      const document = await this.read();
      const record = document.users?.[studentId];
      if (!record) throw new Error("找不到已保存的登录凭证");
      document.version = 2;
      record.cookies = encrypt(JSON.stringify(cookies ?? []));
      record.cookieUpdatedAt = new Date().toISOString();
      await this.write(document);
    });
    return this.writeQueue;
  }

  async load(studentId) {
    const document = await this.read();
    const record = document.users?.[studentId];
    if (!record) return null;
    let cookies = [];
    if (record.cookies) cookies = JSON.parse(decrypt(record.cookies));
    return {
      studentId: record.studentId,
      password: decrypt(record.password),
      cookies: Array.isArray(cookies) ? cookies : [],
      updatedAt: record.updatedAt ?? null,
      cookieUpdatedAt: record.cookieUpdatedAt ?? null,
    };
  }
}
