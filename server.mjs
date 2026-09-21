import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { CaptchaRequiredError, HttpError, ZjutClient } from "./lib/cas-client.mjs";
import { fetchAllCalendarData, renderCalendar } from "./lib/calendar.mjs";
import { CalendarStore } from "./lib/calendar-store.mjs";
import { CredentialStore } from "./lib/credential-store.mjs";
import { createSessionToken, verifySessionToken } from "./lib/session-token.mjs";

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const port = positiveInteger("PORT", 8787);
const credentialStore = new CredentialStore();
const calendarStore = new CalendarStore();

// 内存中的对象只服务于活跃请求；可恢复状态在磁盘中保存。
const clients = new Map();
const clientLoads = new Map();
const calendarCache = new Map();
const calendarRefreshes = new Map();
const loginFailures = new Map();
const authCooldowns = new Map();

const calendarCacheMs = positiveInteger("CALENDAR_CACHE_SECONDS", 600) * 1000;
const calendarStaleMs = positiveInteger("CALENDAR_STALE_SECONDS", 3 * 24 * 60 * 60) * 1000;
const calendarRetryMs = positiveInteger("CALENDAR_FAILURE_RETRY_SECONDS", 300) * 1000;
const activeClientMs = positiveInteger("ACTIVE_CLIENT_SECONDS", 60 * 60) * 1000;
const loginWindowMs = positiveInteger("LOGIN_RATE_WINDOW_SECONDS", 600) * 1000;
const maxIpLoginFailures = positiveInteger("LOGIN_IP_FAILURE_LIMIT", 20);
const maxStudentLoginFailures = positiveInteger("LOGIN_STUDENT_FAILURE_LIMIT", 6);
const maxConcurrentLogins = positiveInteger("MAX_CONCURRENT_LOGINS", 4);
const authCooldownMs = positiveInteger("AUTH_FAILURE_COOLDOWN_SECONDS", 60) * 1000;
let activeLogins = 0;

function json(response, status, value, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(),
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function corsHeaders() {
  const origin = process.env.CORS_ORIGIN?.trim();
  return origin ? {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "Origin",
  } : {};
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64 * 1024) throw new Error("请求体过大");
  }
  return body ? JSON.parse(body) : {};
}

function bearer(request) {
  const value = request.headers.authorization ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function rememberClient(studentId, client) {
  clients.set(studentId, { client, lastUsedAt: Date.now() });
  return client;
}

function touchClient(studentId, client) {
  const entry = clients.get(studentId);
  if (entry?.client === client) entry.lastUsedAt = Date.now();
}

async function getClient(studentId) {
  const cached = clients.get(studentId);
  if (cached && cached.lastUsedAt + activeClientMs > Date.now()) {
    cached.lastUsedAt = Date.now();
    return cached.client;
  }
  if (cached) clients.delete(studentId);

  const loading = clientLoads.get(studentId);
  if (loading) return loading;

  const promise = (async () => {
    const credential = await credentialStore.load(studentId);
    if (!credential) throw new Error("找不到已保存的登录凭证");
    const client = new ZjutClient({ cookies: credential.cookies });
    client.studentId = studentId;
    return rememberClient(studentId, client);
  })();
  clientLoads.set(studentId, promise);
  try {
    return await promise;
  } finally {
    if (clientLoads.get(studentId) === promise) clientLoads.delete(studentId);
  }
}

async function persistClientCookies(studentId, client) {
  await credentialStore.saveCookies(studentId, client.serializeCookies());
  touchClient(studentId, client);
}

async function withLoginSlot(task) {
  if (activeLogins >= maxConcurrentLogins) {
    throw new HttpError("登录请求过多", { status: 503 });
  }
  activeLogins += 1;
  try {
    return await task();
  } finally {
    activeLogins -= 1;
  }
}

async function reauthenticate(studentId) {
  const cooldownUntil = authCooldowns.get(studentId) ?? 0;
  if (cooldownUntil > Date.now()) {
    throw new HttpError("学校登录暂时冷却", { status: 503 });
  }

  const credential = await credentialStore.load(studentId);
  if (!credential) throw new Error("找不到已保存的登录凭证");
  const client = new ZjutClient();
  try {
    await withLoginSlot(() => client.login({
      studentId,
      password: credential.password,
      rememberMe: true,
    }));
    await credentialStore.saveCookies(studentId, client.serializeCookies());
  } catch (error) {
    clients.delete(studentId);
    authCooldowns.set(studentId, Date.now() + authCooldownMs);
    throw error;
  }
  authCooldowns.delete(studentId);
  return rememberClient(studentId, client);
}

function sessionInvalid(error) {
  return error instanceof HttpError && [401, 403].includes(error.status);
}

function loginPayload(studentId, token) {
  const publicBase = (process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, "");
  const calendarPath = `/calendar.ics?token=${encodeURIComponent(token)}`;
  return {
    token,
    studentId,
    calendarUrl: `${publicBase}${calendarPath}`,
    message: "登录成功",
  };
}

async function buildCalendar(studentId) {
  let client = await getClient(studentId);
  try {
    const data = await fetchAllCalendarData(client);
    await persistClientCookies(studentId, client);
    return data;
  } catch (error) {
    if (!sessionInvalid(error)) throw error;
    clients.delete(studentId);
    client = await reauthenticate(studentId);
    const data = await fetchAllCalendarData(client);
    await persistClientCookies(studentId, client);
    return data;
  }
}

async function refreshCalendar(studentId) {
  const data = await buildCalendar(studentId);
  const rendered = renderCalendar({ studentId, ...data });
  const fetchedAt = new Date();
  const feed = {
    ics: rendered.ics,
    eventCount: rendered.eventCount,
    warningCount: rendered.warnings.length,
    etag: `"${createHash("sha256").update(rendered.ics).digest("hex")}"`,
    lastModified: fetchedAt.toUTCString(),
    fetchedAt: fetchedAt.toISOString(),
    expiresAt: fetchedAt.getTime() + calendarCacheMs,
    stale: false,
  };
  calendarCache.set(studentId, feed);
  try {
    await calendarStore.save(studentId, feed);
  } catch (error) {
    console.error(JSON.stringify({
      event: "calendar_snapshot_save_failed",
      error: error.name,
    }));
  }
  if (rendered.warnings.length) {
    console.warn(JSON.stringify({
      event: "calendar_parse_warnings",
      warningCount: rendered.warnings.length,
    }));
  }
  return feed;
}

function staleFeed(snapshot, now) {
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(fetchedAt) || now - fetchedAt > calendarStaleMs) return null;
  const ics = String(snapshot.ics);
  return {
    ...snapshot,
    etag: snapshot.etag || `"${createHash("sha256").update(ics).digest("hex")}"`,
    lastModified: snapshot.lastModified || new Date(fetchedAt).toUTCString(),
    expiresAt: now + calendarRetryMs,
    stale: true,
  };
}

async function getCalendarFeed(studentId) {
  const now = Date.now();
  const cached = calendarCache.get(studentId);
  if (cached && cached.expiresAt > now) return cached;

  const pending = calendarRefreshes.get(studentId);
  if (pending) return pending;

  const refresh = (async () => {
    try {
      return await refreshCalendar(studentId);
    } catch (error) {
      const snapshot = await calendarStore.load(studentId);
      const fallback = snapshot ? staleFeed(snapshot, Date.now()) : null;
      if (!fallback) throw error;
      calendarCache.set(studentId, fallback);
      console.warn(JSON.stringify({
        event: "calendar_stale_fallback",
        ageSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(snapshot.fetchedAt)) / 1000)),
      }));
      return fallback;
    }
  })();
  calendarRefreshes.set(studentId, refresh);
  try {
    return await refresh;
  } finally {
    if (calendarRefreshes.get(studentId) === refresh) calendarRefreshes.delete(studentId);
  }
}

function requestAddress(request) {
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.split(",", 1)[0].trim();
    }
  }
  return request.socket.remoteAddress ?? "unknown";
}

function loginKeys(request, studentId) {
  return [`ip:${requestAddress(request)}`, `student:${studentId}`];
}

function pruneLoginFailures(now = Date.now()) {
  for (const [key, state] of loginFailures) {
    if (state.resetAt <= now) loginFailures.delete(key);
  }
}

function loginRetryAfter(request, studentId) {
  const now = Date.now();
  pruneLoginFailures(now);
  const keys = loginKeys(request, studentId);
  const limits = [
    [keys[0], maxIpLoginFailures],
    [keys[1], maxStudentLoginFailures],
  ];
  let retryAt = 0;
  for (const [key, limit] of limits) {
    const state = loginFailures.get(key);
    if (state?.count >= limit) retryAt = Math.max(retryAt, state.resetAt);
  }
  return retryAt > now ? Math.ceil((retryAt - now) / 1000) : 0;
}

function recordLoginFailure(request, studentId) {
  const now = Date.now();
  for (const key of loginKeys(request, studentId)) {
    const current = loginFailures.get(key);
    const state = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + loginWindowMs }
      : current;
    state.count += 1;
    loginFailures.set(key, state);
  }
  if (loginFailures.size > 10000) pruneLoginFailures(now);
}

function clearLoginFailures(request, studentId) {
  for (const key of loginKeys(request, studentId)) loginFailures.delete(key);
}

function cleanupRuntimeState() {
  const now = Date.now();
  for (const [studentId, entry] of clients) {
    if (entry.lastUsedAt + activeClientMs <= now) clients.delete(studentId);
  }
  for (const [studentId, feed] of calendarCache) {
    if (feed.expiresAt + calendarRetryMs <= now) calendarCache.delete(studentId);
  }
  pruneLoginFailures(now);
  for (const [studentId, until] of authCooldowns) {
    if (until <= now) authCooldowns.delete(studentId);
  }
}

const cleanupTimer = setInterval(cleanupRuntimeState, 60_000);
cleanupTimer.unref?.();

async function handle(request, response) {
  const requestUrl = new URL(request.url, "http://127.0.0.1");

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      ...corsHeaders(),
    });
    response.end();
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    json(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/login") {
    let input;
    try {
      input = await readJson(request);
    } catch {
      json(response, 400, { code: "invalid_json", message: "请求体不是有效 JSON" });
      return;
    }
    const studentId = String(input.studentId ?? "").trim();
    const password = String(input.password ?? "");
    if (!/^\d{6,20}$/.test(studentId) || !password || password.length > 256) {
      json(response, 400, { code: "invalid_input", message: "学号或密码格式不正确" });
      return;
    }

    const retryAfter = loginRetryAfter(request, studentId);
    if (retryAfter) {
      json(response, 429, { code: "rate_limited", message: "登录尝试过多，请稍后再试" }, {
        "retry-after": String(retryAfter),
      });
      return;
    }

    const previousCredential = await credentialStore.load(studentId);
    const previousSessionValid = previousCredential?.password === password;
    if (previousSessionValid) {
      try {
        const previousClient = await getClient(studentId);
        await previousClient.fetchSemesters();
        await persistClientCookies(studentId, previousClient);
        clearLoginFailures(request, studentId);
        rememberClient(studentId, previousClient);
        json(response, 200, loginPayload(studentId, createSessionToken(studentId)));
        return;
      } catch (error) {
        if (!sessionInvalid(error)) throw error;
        clients.delete(studentId);
      }
    }

    const client = await withLoginSlot(async () => {
      const nextClient = new ZjutClient();
      try {
        await nextClient.login({
          studentId,
          password,
          rememberMe: input.rememberMe !== false,
        });
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) {
          recordLoginFailure(request, studentId);
        }
        throw error;
      }
      return nextClient;
    });
    const token = createSessionToken(studentId);
    await credentialStore.saveWithCookies(studentId, password, client.serializeCookies());

    clearLoginFailures(request, studentId);
    rememberClient(studentId, client);
    json(response, 200, loginPayload(studentId, token));
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/calendar.ics") {
    const session = verifySessionToken(requestUrl.searchParams.get("token") || bearer(request));
    if (!session) {
      response.writeHead(401, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end("calendar token expired");
      return;
    }
    const feed = await getCalendarFeed(session.sub);
    const headers = {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, max-age=300",
      etag: feed.etag,
      "last-modified": feed.lastModified,
    };
    if (feed.stale) headers["x-calendar-stale"] = "true";
    if (request.headers["if-none-match"] === feed.etag) {
      response.writeHead(304, headers);
      response.end();
      return;
    }
    response.writeHead(200, headers);
    response.end(feed.ics);
    return;
  }

  // 原始课程接口只作为本进程内部的数据源，不通过 HTTP 暴露。
  json(response, 404, { code: "not_found", message: "接口不存在" });
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    if (response.headersSent) {
      response.end();
      return;
    }
    if (error instanceof CaptchaRequiredError) {
      json(response, 409, { code: "captcha_required", message: error.message });
      return;
    }
    if (error instanceof HttpError && error.status === 401) {
      json(response, 401, { code: "school_login_failed", message: "学校登录失败" });
      return;
    }
    if (error instanceof HttpError && [503, 504].includes(error.status)) {
      json(response, 503, { code: "school_unavailable", message: "学校服务暂时不可用，稍后会自动重试" }, {
        "retry-after": "60",
      });
      return;
    }
    console.error(JSON.stringify({
      event: "request_error",
      error: error.name,
      status: error.status ?? null,
      requestPath: new URL(request.url, "http://127.0.0.1").pathname,
    }));
    json(response, 502, { code: "upstream_error", message: "学校服务暂时不可用" });
  });
});

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.listen(port, "127.0.0.1", () => {
  console.log(`zjut-course-service listening on http://127.0.0.1:${port}`);
});

function shutdown() {
  clearInterval(cleanupTimer);
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
