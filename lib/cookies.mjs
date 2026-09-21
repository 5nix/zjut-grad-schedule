function defaultPath(pathname) {
  if (!pathname || pathname[0] !== "/") return "/";
  const slash = pathname.lastIndexOf("/");
  return slash <= 0 ? "/" : pathname.slice(0, slash);
}

function domainMatches(hostname, cookie) {
  return cookie.hostOnly
    ? hostname === cookie.domain
    : hostname === cookie.domain || hostname.endsWith(`.${cookie.domain}`);
}

function pathMatches(pathname, cookiePath) {
  if (pathname === cookiePath) return true;
  if (!pathname.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || pathname[cookiePath.length] === "/";
}

function parseSetCookie(raw, responseUrl) {
  const url = new URL(responseUrl);
  const parts = raw.split(";");
  const first = parts.shift() ?? "";
  const separator = first.indexOf("=");
  if (separator <= 0) return null;

  const cookie = {
    name: first.slice(0, separator).trim(),
    value: first.slice(separator + 1).trim(),
    domain: url.hostname,
    hostOnly: true,
    path: defaultPath(url.pathname),
    secure: false,
    expiresAt: null,
  };

  let maxAge = null;
  for (const part of parts) {
    const attribute = part.trim();
    const equal = attribute.indexOf("=");
    const rawName = (equal >= 0 ? attribute.slice(0, equal) : attribute).toLowerCase();
    const rawValue = equal >= 0 ? attribute.slice(equal + 1).trim() : "";
    if (rawName === "domain" && rawValue) {
      cookie.domain = rawValue.replace(/^\./, "").toLowerCase();
      cookie.hostOnly = false;
    } else if (rawName === "path" && rawValue.startsWith("/")) {
      cookie.path = rawValue;
    } else if (rawName === "max-age") {
      maxAge = Number(rawValue);
    } else if (rawName === "expires" && rawValue) {
      const timestamp = Date.parse(rawValue);
      if (Number.isFinite(timestamp)) cookie.expiresAt = timestamp;
    } else if (rawName === "secure") {
      cookie.secure = true;
    }
  }

  if (maxAge !== null && Number.isFinite(maxAge)) {
    cookie.expiresAt = Date.now() + maxAge * 1000;
    if (maxAge <= 0) cookie.expiresAt = 0;
  }
  return cookie;
}

function setCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const combined = response.headers.get("set-cookie");
  return combined ? [combined] : [];
}

export class CookieJar {
  #cookies = new Map();

  constructor(records = []) {
    if (!Array.isArray(records)) return;
    const now = Date.now();
    for (const record of records) {
      if (!record || typeof record !== "object") continue;
      if (!record.name || !record.domain || !record.path) continue;
      if (record.expiresAt !== null && record.expiresAt !== undefined
        && (!Number.isFinite(record.expiresAt) || record.expiresAt <= now)) continue;
      const cookie = {
        name: String(record.name),
        value: String(record.value ?? ""),
        domain: String(record.domain).toLowerCase(),
        hostOnly: record.hostOnly !== false,
        path: String(record.path).startsWith("/") ? String(record.path) : "/",
        secure: record.secure === true,
        expiresAt: record.expiresAt == null ? null : Number(record.expiresAt),
      };
      this.#cookies.set(`${cookie.name}\t${cookie.domain}\t${cookie.path}`, cookie);
    }
  }

  absorb(response, responseUrl) {
    for (const raw of setCookieHeaders(response)) {
      const cookie = parseSetCookie(raw, responseUrl);
      if (!cookie) continue;
      const key = `${cookie.name}\t${cookie.domain}\t${cookie.path}`;
      this.#cookies.delete(key);
      if (cookie.expiresAt !== 0) this.#cookies.set(key, cookie);
    }
  }

  headerFor(requestUrl) {
    const url = new URL(requestUrl);
    const now = Date.now();
    const values = [];
    this.#purgeExpired(now);
    for (const [key, cookie] of this.#cookies) {
      if (
        cookie.secure && url.protocol !== "https:" ||
        !domainMatches(url.hostname, cookie) ||
        !pathMatches(url.pathname || "/", cookie.path)
      ) continue;
      values.push(cookie);
    }
    values.sort((left, right) => right.path.length - left.path.length);
    return values.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }

  hasCookie(name, requestUrl) {
    return this.headerFor(requestUrl)
      .split(/;\s*/)
      .some((item) => item.startsWith(`${name}=`));
  }

  toJSON() {
    this.#purgeExpired(Date.now());
    return [...this.#cookies.values()].map((cookie) => ({ ...cookie }));
  }

  #purgeExpired(now) {
    for (const [key, cookie] of this.#cookies) {
      if (cookie.expiresAt !== null && cookie.expiresAt <= now) this.#cookies.delete(key);
    }
  }
}
