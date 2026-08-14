import { type NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"
import { checkLoginRateLimit, logLoginAttempt, recordFailedLogin } from "@/lib/login-guard"
import { getClientIp } from "@/lib/rate-limit"

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        login: { label: "Логин", type: "text" },
        password: { label: "Пароль", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.login || !credentials?.password) return null

        const ip = req?.headers?.["x-forwarded-for"]?.toString().split(",")[0]?.trim()
          || req?.headers?.["x-real-ip"]?.toString()
          || "unknown"
        const userAgent = req?.headers?.["user-agent"]?.toString()
        const loginCtx = { login: credentials.login, ip, userAgent }

        // Rate limit по IP — блокируем брутфорс
        const blocked = checkLoginRateLimit(ip)
        if (blocked) {
          logLoginAttempt({ ...loginCtx, success: false, reason: "blocked_brute_force" })
          throw new Error("Слишком много попыток. Попробуйте через 15 минут")
        }

        // Вход по логину/email — регистро- и пробелонезависимо (норм = trim+lower).
        // mode:"insensitive" сужает выборку в БД, а точный матч по lower(trim())
        // в JS убирает возможные ложные совпадения (ILIKE трактует '_'/'%' как
        // wildcard) и хвостовые пробелы в хранимом значении. Логин глобально
        // уникален (unique lower(login)); email уникален в рамках центра, поэтому
        // один email в разных центрах даёт неоднозначность — просим уточнить.
        const raw = credentials.login.trim()
        const norm = raw.toLowerCase()
        const isEmail = raw.includes("@")

        const candidates = await db.employee.findMany({
          where: {
            isActive: true,
            deletedAt: null,
            ...(isEmail
              ? { email: { equals: raw, mode: "insensitive" } }
              : { login: { equals: raw, mode: "insensitive" } }),
          },
          include: { organization: true },
        })
        const matches = candidates.filter((e) =>
          isEmail
            ? (e.email ?? "").trim().toLowerCase() === norm
            : e.login.trim().toLowerCase() === norm,
        )

        if (matches.length > 1) {
          logLoginAttempt({ ...loginCtx, success: false, reason: "ambiguous_login" })
          throw new Error(
            isEmail
              ? "Этот email используется в нескольких центрах — обратитесь в поддержку"
              : "Используйте email для входа",
          )
        }
        const employee = matches[0] || null

        if (!employee) {
          // Неизвестный логин — засчитываем в лимит брутфорса.
          recordFailedLogin(ip)
          logLoginAttempt({ ...loginCtx, success: false, reason: "user_not_found" })
          return null
        }

        const valid = await bcrypt.compare(credentials.password, employee.passwordHash)
        if (!valid) {
          // Неверный пароль — засчитываем в лимит брутфорса.
          recordFailedLogin(ip)
          logLoginAttempt({
            ...loginCtx,
            success: false,
            reason: "invalid_password",
            tenantId: employee.tenantId,
            employeeId: employee.id,
          })
          return null
        }

        // Успешный вход
        logLoginAttempt({
          ...loginCtx,
          success: true,
          tenantId: employee.tenantId,
          employeeId: employee.id,
        })

        return {
          id: employee.id,
          name: `${employee.lastName} ${employee.firstName}`,
          email: employee.email,
          role: employee.role,
          tenantId: employee.tenantId,
          orgName: employee.organization.name,
          billingStatus: employee.organization.billingStatus,
          instructorsSeePhones: employee.organization.instructorsSeePhones,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role
        token.tenantId = (user as any).tenantId
        token.employeeId = user.id
        token.orgName = (user as any).orgName
        token.billingStatus = (user as any).billingStatus
        token.instructorsSeePhones = (user as any).instructorsSeePhones
        token.allowedBranchIds = null
      }

      // Периодически обновляем настройки организации (billingStatus +
      // instructorsSeePhones) — каждые 5 минут, чтобы правки в настройках
      // подхватывались без релогина.
      const now = Math.floor(Date.now() / 1000)
      const lastCheck = (token.billingStatusCheckedAt as number) || 0
      if (token.tenantId && now - lastCheck > 300) {
        try {
          const org = await db.organization.findUnique({
            where: { id: token.tenantId as string },
            select: { billingStatus: true, instructorsSeePhones: true },
          })
          if (org) {
            token.billingStatus = org.billingStatus
            token.instructorsSeePhones = org.instructorsSeePhones
          }
          token.billingStatusCheckedAt = now
        } catch {
          // Не блокируем работу при ошибках БД
        }
      }

      // Считываем привязки к филиалам из EmployeeBranch (ADM-04).
      // null = доступ ко всем (owner/manager всегда; admin/instructor если пусто).
      // Кэшируем на 5 минут — чтобы изменения привязок в админке подхватывались
      // без релогина за разумное время.
      const lastBranchesCheck = token.allowedBranchesCheckedAt || 0
      const needsBranchesRefresh =
        token.allowedBranchIds === undefined || now - lastBranchesCheck > 300
      if (token.employeeId && token.tenantId && needsBranchesRefresh) {
        try {
          const role = token.role as string
          if (role === "owner" || role === "manager") {
            token.allowedBranchIds = null
          } else {
            const links = await db.employeeBranch.findMany({
              where: {
                tenantId: token.tenantId as string,
                employeeId: token.employeeId as string,
              },
              select: { branchId: true },
            })
            // Пусто = доступ ко всем (совместимо с текущей логикой селектора
            // инструкторов; для новых сотрудников UI требует ≥1 филиал).
            token.allowedBranchIds = links.length === 0
              ? null
              : links.map((l) => l.branchId)
          }
          token.allowedBranchesCheckedAt = now
        } catch {
          // Не блокируем сессию при ошибке БД — оставляем прежнее значение.
        }
      }

      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role
        ;(session.user as any).tenantId = token.tenantId
        ;(session.user as any).employeeId = token.employeeId
        ;(session.user as any).orgName = token.orgName
        ;(session.user as any).billingStatus = token.billingStatus
        ;(session.user as any).instructorsSeePhones = token.instructorsSeePhones ?? false
        ;(session.user as any).allowedBranchIds = token.allowedBranchIds ?? null
        if (token.impersonatedBy) {
          ;(session.user as any).impersonatedBy = token.impersonatedBy
        }
      }
      return session
    },
  },
}
