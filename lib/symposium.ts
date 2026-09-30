/**
 * Server-side client for simposiumtihulumigas2026.com.
 *
 * The upstream app is a Yii2 backend that guards the scan endpoint with a
 * session, and rotates the PHP session id on every authenticated request.
 * Rather than shipping session cookies to the browser, we log in once
 * server-side and keep the resulting cookie jar in memory, updating it after
 * every call. Cookies never leave the container.
 */

const BASE_URL = (
  process.env.SYMPOSIUM_BASE_URL ?? "https://simposiumtihulumigas2026.com"
).replace(/\/+$/, "");

const LOGIN_PATH = process.env.SYMPOSIUM_LOGIN_PATH ?? "/kitchen/default/login";
const LOGIN_FIELD_USER =
  process.env.SYMPOSIUM_LOGIN_FIELD_USER ?? "User[username]";
const LOGIN_FIELD_PASS =
  process.env.SYMPOSIUM_LOGIN_FIELD_PASS ?? "User[password]";
const SCAN_PATH = process.env.SYMPOSIUM_SCAN_PATH ?? "/kitchen/dson/scanbooth";
const SCAN_REFERER = `${BASE_URL}/kitchen/scan/booth`;

const USERNAME = process.env.SYMPOSIUM_USERNAME ?? "";
const PASSWORD = process.env.SYMPOSIUM_PASSWORD ?? "";

/** Upstream requests are slow on a flaky event Wi-Fi; be generous. */
const TIMEOUT_MS = 20_000;

export class SymposiumError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SymposiumError";
  }
}

type Jar = Map<string, string>;

type Session = { jar: Jar };

let cachedSession: Session | null = null;
/** De-duplicates concurrent logins when several scans land at once. */
let loginInFlight: Promise<Session> | null = null;

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

function readSetCookies(res: Response, jar: Jar): void {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(";");
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value === "" || /expires=thu, 01 jan 1970/i.test(line)) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
}

function cookieHeader(jar: Jar): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** Pull the Yii2 CSRF hidden field out of a login page. */
function findCsrfField(html: string): string | null {
  const match = html.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i);
  if (match) return match[1];
  const reversed = html.match(/value=["']([^"']+)["']\s+name=["']_csrf["']/i);
  return reversed ? reversed[1] : null;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function performLogin(): Promise<Session> {
  if (!USERNAME || !PASSWORD) {
    throw new SymposiumError(
      "SYMPOSIUM_USERNAME / SYMPOSIUM_PASSWORD belum diisi di .env",
      500,
    );
  }

  const jar: Jar = new Map();

  // Step 1 — load the login form to obtain a CSRF token and session cookie.
  const pageRes = await fetchWithTimeout(`${BASE_URL}${LOGIN_PATH}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  readSetCookies(pageRes, jar);
  const html = await pageRes.text();
  const csrf = findCsrfField(html);
  if (!csrf) {
    throw new SymposiumError(
      `CSRF token tidak ditemukan di ${LOGIN_PATH} — cek SYMPOSIUM_LOGIN_PATH`,
      502,
    );
  }

  // Step 2 — submit credentials.
  const body = new URLSearchParams({
    _csrf: csrf,
    [LOGIN_FIELD_USER]: USERNAME,
    [LOGIN_FIELD_PASS]: PASSWORD,
  });
  const authRes = await fetchWithTimeout(`${BASE_URL}${LOGIN_PATH}`, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html",
      Cookie: cookieHeader(jar),
    },
    body: body.toString(),
    redirect: "manual",
  });
  readSetCookies(authRes, jar);

  // A successful Yii2 login redirects; a rejected one re-renders the form.
  const isRedirect = authRes.status >= 300 && authRes.status < 400;
  if (!isRedirect) {
    const after = await authRes.text();
    if (findCsrfField(after) && /password/i.test(after)) {
      throw new SymposiumError(
        "Login ditolak — periksa SYMPOSIUM_USERNAME / SYMPOSIUM_PASSWORD",
        401,
      );
    }
  }
  if (!jar.has("PHPSESSID")) {
    throw new SymposiumError("Login tidak menghasilkan PHPSESSID", 502);
  }

  return { jar };
}

async function getSession(): Promise<Session> {
  if (cachedSession) return cachedSession;
  if (!loginInFlight) {
    loginInFlight = performLogin()
      .then((session) => {
        cachedSession = session;
        return session;
      })
      .finally(() => {
        loginInFlight = null;
      });
  }
  return loginInFlight;
}

function resetSession(): void {
  cachedSession = null;
}

export type ScanResult = {
  id: string;
  ok: boolean;
  status: number;
  data: unknown;
  raw: string;
};

/**
 * Call the upstream scan endpoint for `id`.
 *
 * The upstream rotates PHPSESSID on every authenticated request, so the jar
 * from each response is folded back into the cached session before the next
 * call — a stale jar reads as logged-out and gets redirected to /login.
 * Retries once with a fresh login when that happens.
 */
export async function scanId(id: string): Promise<ScanResult> {
  const attempt = async (fresh: boolean): Promise<Response> => {
    if (fresh) resetSession();
    const session = await getSession();
    const res = await fetchWithTimeout(
      `${BASE_URL}${SCAN_PATH}?id=${encodeURIComponent(id)}`,
      {
        headers: {
          Accept: "*/*",
          "User-Agent": USER_AGENT,
          "X-Requested-With": "XMLHttpRequest",
          Referer: SCAN_REFERER,
          Cookie: cookieHeader(session.jar),
        },
        redirect: "manual",
      },
    );
    // Fold the rotated session cookie back in for the next call.
    readSetCookies(res, session.jar);
    return res;
  };

  let res = await attempt(false);

  // A redirect (to /default/login) means the session died — force a fresh
  // login and retry once.
  if (res.status >= 300 && res.status < 400) {
    resetSession();
    res = await attempt(true);
  }

  const raw = await res.text();
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // Not JSON — keep the raw text so the UI can still show something useful.
  }

  const ok = res.status >= 200 && res.status < 300;
  return {
    id,
    ok,
    status: res.status,
    data,
    raw,
  };
}
