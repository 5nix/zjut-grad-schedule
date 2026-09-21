import { CookieJar } from "./cookies.mjs";
import { encryptCasPassword } from "./rsa.mjs";
import { fieldInventory } from "./field-inventory.mjs";

export const SERVICE_URL =
  process.env.SCHOOL_SERVICE_URL ??
  "https://yjsfw.zjut.edu.cn/gsapp/sys/wdkbapp/*default/index.do?THEME=indigo&EMAP_LANG=zh#/xskcb";
export const CAS_LOGIN_URL =
  process.env.CAS_LOGIN_URL ?? "https://oauth.zjut.edu.cn/cas/login";
export const COURSE_BASE_URL =
  process.env.COURSE_BASE_URL ?? "https://yjsfw.zjut.edu.cn/gsapp/sys/wdkbapp/";

export class HttpError extends Error {
  constructor(message, { status, url, body } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export class CaptchaRequiredError extends Error {
  constructor() {
    super("学校 CAS 当前要求验证码，服务端不会绕过验证码");
    this.name = "CaptchaRequiredError";
  }
}

function inputTags(form) {
  return [...form.matchAll(/<input\b[^>]*>/gi)].map((match) => match[0]);
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match?.[1] ?? "";
}

function formInput(form, name) {
  const tag = inputTags(form).find((item) => attribute(item, "name") === name);
  return tag ? attribute(tag, "value") : "";
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function responseLocation(response, currentUrl) {
  const location = response.headers.get("location");
  return location ? new URL(location, currentUrl).href : null;
}

export class ZjutClient {
  constructor({
    serviceUrl = SERVICE_URL,
    casLoginUrl = CAS_LOGIN_URL,
    courseBaseUrl = COURSE_BASE_URL,
    cookies = [],
  } = {}) {
    this.serviceUrl = serviceUrl;
    this.casLoginUrl = casLoginUrl;
    this.courseBaseUrl = courseBaseUrl;
    this.jar = new CookieJar(cookies);
    this.studentId = null;
  }

  async request(url, options = {}) {
    const headers = new Headers(options.headers ?? {});
    const cookies = this.jar.headerFor(url);
    if (cookies) headers.set("cookie", cookies);
    const configuredTimeout = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 20000);
    const timeoutMs = Number.isInteger(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : 20000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
      this.jar.absorb(response, url);
      return response;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new HttpError("学校服务请求超时", { status: 504, url });
      }
      throw new HttpError("学校服务请求失败", { status: 503, url });
    } finally {
      clearTimeout(timer);
    }
  }

  serializeCookies() {
    return this.jar.toJSON();
  }

  async login({ studentId, password, rememberMe = true }) {
    const loginUrl = new URL(this.casLoginUrl);
    loginUrl.searchParams.set("service", this.serviceUrl);

    const loginPage = await this.request(loginUrl.href, {
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    const loginHtml = await loginPage.text();
    if (loginPage.status !== 200) {
      throw new HttpError("CAS 登录页获取失败", {
        status: loginPage.status,
        url: loginUrl.href,
      });
    }
    const form = loginHtml.match(/<form\b[\s\S]*?<\/form>/i)?.[0] ?? "";
    const action = form.match(/action\s*=\s*["']([^"']+)["']/i)?.[1];
    const execution = formInput(form, "execution");
    if (!action || !execution) throw new Error("CAS 登录表单结构发生变化");

    const publicKeyUrl = new URL("v2/getPubKey", loginUrl);
    const publicKeyResponse = await this.request(publicKeyUrl.href, {
      headers: { accept: "application/json", referer: loginUrl.href },
    });
    const publicKey = await publicKeyResponse.json();
    if (!publicKey?.modulus || !publicKey?.exponent) {
      throw new Error("CAS 公钥获取失败");
    }

    const captchaResponse = await this.request(new URL("v2/getKaptchaStatus", loginUrl).href, {
      headers: { accept: "text/plain", referer: loginUrl.href },
    });
    const captchaRequired = (await captchaResponse.text()).trim().toLowerCase() === "true";
    if (captchaRequired) throw new CaptchaRequiredError();

    const body = new URLSearchParams({
      username: studentId,
      password: encryptCasPassword(password, publicKey.modulus, publicKey.exponent),
      execution,
      _eventId: "submit",
      authcode: "",
      mobileCode: "",
    });
    if (rememberMe) body.set("rememberMe", formInput(form, "rememberMe") || "true");

    let currentUrl = new URL(action, loginUrl).href;
    let response = await this.request(currentUrl, {
      method: "POST",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "content-type": "application/x-www-form-urlencoded",
        referer: loginUrl.href,
      },
      body: body.toString(),
    });

    for (let hop = 0; hop < 10 && isRedirect(response.status); hop += 1) {
      const nextUrl = responseLocation(response, currentUrl);
      if (!nextUrl) break;
      const previousUrl = currentUrl;
      currentUrl = nextUrl;
      response = await this.request(currentUrl, {
        headers: { accept: "text/html,application/xhtml+xml", referer: previousUrl },
      });
    }

    const finalHtml = await response.text();
    const onCourseHost = new URL(currentUrl).origin === new URL(this.courseBaseUrl).origin;
    const loginFailed = /用户名或密码错误|密码错误|登录失败|invalid credentials/i.test(finalHtml);
    if (!onCourseHost || loginFailed || response.status >= 400) {
      throw new HttpError("学校账号登录失败", {
        status: response.status === 200 ? 401 : response.status,
        url: new URL(currentUrl).origin + new URL(currentUrl).pathname,
      });
    }
    this.studentId = studentId;
    return { rememberMe, captchaRequired };
  }

  async fetchCourses(semester = process.env.DEFAULT_SEMESTER ?? "20261") {
    const url = new URL("modules/xskcb/xsjxrwcx.do", this.courseBaseUrl);
    const response = await this.request(url.href, {
      method: "POST",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        referer: this.serviceUrl,
      },
      body: new URLSearchParams({
        XNXQDM: semester,
        XH: "",
        pageNumber: "1",
        pageSize: "100",
      }).toString(),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new HttpError("课表接口返回的不是 JSON", {
        status: response.status,
        url: url.href,
      });
    }
    if (response.status >= 400 || data?.code !== "0") {
      throw new HttpError("课表接口请求失败", {
        status: response.status,
        url: url.href,
        body: data,
      });
    }
    const rows = data?.datas?.xsjxrwcx?.rows;
    if (!Array.isArray(rows)) throw new Error("课表 JSON 结构发生变化");
    return {
      semester,
      rowCount: rows.length,
      fields: fieldInventory(rows),
      rows,
    };
  }

  async fetchSemesters() {
    const url = new URL("modules/xskcb/kfdxnxqcx.do", this.courseBaseUrl);
    const response = await this.request(url.href, {
      method: "POST",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        referer: this.serviceUrl,
      },
      body: "",
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new HttpError("学期接口返回的不是 JSON", { status: response.status, url: url.href });
    }
    const rows = data?.datas?.kfdxnxqcx?.rows;
    if (response.status >= 400 || data?.code !== "0" || !Array.isArray(rows)) {
      throw new HttpError("学期列表请求失败", { status: response.status, url: url.href, body: data });
    }
    return rows;
  }

  async fetchPeriodTable(semester = "", studentId = this.studentId ?? "") {
    const url = new URL("modules/xskcb/xsskjccx.do", this.courseBaseUrl);
    const response = await this.request(url.href, {
      method: "POST",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        referer: this.serviceUrl,
      },
      body: new URLSearchParams({ XNXQDM: semester, XH: studentId }).toString(),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new HttpError("节次接口返回的不是 JSON", { status: response.status, url: url.href });
    }
    const rows = data?.datas?.xsskjccx?.rows;
    if (response.status >= 400 || data?.code !== "0" || !Array.isArray(rows)) {
      throw new HttpError("节次时间请求失败", { status: response.status, url: url.href, body: data });
    }
    return rows;
  }
}
