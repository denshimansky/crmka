/**
 * Test helpers for CRMka unit/integration tests.
 * Uses node:test + node:assert (built-in, no extra deps).
 */

// ── Типы ────────────────────────────────────────────────────
export type Role = "owner" | "manager" | "admin" | "instructor" | "readonly"

export interface MockUser {
  id: string
  name: string
  email: string
  role: Role
  tenantId: string
  employeeId: string
  orgName: string
}

// ── Фикстуры ───────────────────────────────────────────────
const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

export const tenants = { A: TENANT_A, B: TENANT_B } as const

// Demo-аккаунты из seed.ts
export const DEMO_ACCOUNTS = {
  owner: { login: "owner", password: "demo123" },
  manager: { login: "manager", password: "demo123" },
  admin: { login: "admin", password: "demo123" },
  instructor: { login: "instructor", password: "demo123" },
  readonly: { login: "viewer", password: "demo123" },
} as const

export function mockUser(role: Role, tenantId: string = TENANT_A): MockUser {
  return {
    id: `emp-${role}-${tenantId.slice(0, 8)}`,
    name: `Test ${role}`,
    email: `${role}@test.local`,
    role,
    tenantId,
    employeeId: `emp-${role}-${tenantId.slice(0, 8)}`,
    orgName: `Org ${tenantId.slice(0, 8)}`,
  }
}

// ── Mock session для next-auth ──────────────────────────────
export function mockSession(user: MockUser) {
  return {
    user: {
      ...user,
      tenantId: user.tenantId,
      role: user.role,
      employeeId: user.employeeId,
      orgName: user.orgName,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  }
}

// ── HTTP helpers (тестируем API через HTTP на dev-сервере) ──
const BASE_URL = process.env.TEST_BASE_URL || "https://dev.umnayacrm.ru"

export interface ApiResponse<T = any> {
  status: number
  data: T
  ok: boolean
}

export async function apiCall<T = any>(
  method: string,
  path: string,
  options: {
    body?: any
    cookie?: string
    headers?: Record<string, string>
  } = {}
): Promise<ApiResponse<T>> {
  const url = `${BASE_URL}${path}`
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  }
  if (options.cookie) headers["Cookie"] = options.cookie

  const res = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: "manual",
  })

  let data: any
  try {
    data = await res.json()
  } catch {
    data = null
  }

  return { status: res.status, data, ok: res.ok }
}

// ── Auth helper ─────────────────────────────────────────────
export async function login(
  loginStr: string,
  password: string
): Promise<string | null> {
  try {
    // Step 1: получаем CSRF token + cookies
    const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`)
    const { csrfToken } = await csrfRes.json()
    const csrfCookies = csrfRes.headers.getSetCookie()

    // Step 2: логинимся (redirect: manual — ловим 302 с set-cookie)
    const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: csrfCookies.join("; "),
      },
      body: new URLSearchParams({
        csrfToken,
        login: loginStr,
        password,
        callbackUrl: BASE_URL,
      }),
      redirect: "manual",
    })

    // Собираем все cookies (CSRF + session)
    const loginCookies = loginRes.headers.getSetCookie()
    if (loginCookies.length === 0) return null

    // Объединяем все cookies
    const allCookies = [...csrfCookies, ...loginCookies]
      .map((c) => c.split(";")[0])
      .join("; ")

    // Step 3: проверяем что сессия работает
    const sessionRes = await fetch(`${BASE_URL}/api/auth/session`, {
      headers: { Cookie: allCookies },
    })
    const session = await sessionRes.json()
    if (!session?.user) return null

    return allCookies
  } catch {
    return null
  }
}

// ── Skip helper ─────────────────────────────────────────────
let _authCache: Map<string, string | null> = new Map()

/**
 * Логин с кешированием. Если не удаётся — возвращает null.
 * Используй с requireAuth() для пропуска тестов.
 */
export async function getAuthCookie(role: Role = "owner"): Promise<string | null> {
  const key = role
  if (_authCache.has(key)) return _authCache.get(key)!
  const account = DEMO_ACCOUNTS[role]
  const cookie = await login(account.login, account.password)
  _authCache.set(key, cookie)
  return cookie
}

/**
 * Проверяет авторизацию. Если нет — тест пропускается (не фейлится).
 */
export function requireAuth(cookie: string | null): asserts cookie is string {
  if (!cookie) {
    throw new Error("SKIP: Нет авторизации (seed не применён на dev-сервере?)")
  }
}

// ── UUID helper ─────────────────────────────────────────────
export function uuid(): string {
  return crypto.randomUUID()
}
