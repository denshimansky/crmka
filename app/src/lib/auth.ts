import { type NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"
import { checkLoginRateLimit, logLoginAttempt } from "@/lib/login-guard"
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

        let employee

        if (credentials.login.includes("@")) {
          // Email — глобально уникален, ищем напрямую
          employee = await db.employee.findFirst({
            where: {
              email: credentials.login,
              isActive: true,
              deletedAt: null,
            },
            include: { organization: true },
          })
        } else {
          // Login — может совпадать между тенантами
          const employees = await db.employee.findMany({
            where: {
              login: credentials.login,
              isActive: true,
              deletedAt: null,
            },
            include: { organization: true },
          })

          if (employees.length > 1) {
            logLoginAttempt({ ...loginCtx, success: false, reason: "ambiguous_login" })
            throw new Error("Используйте email для входа")
          }
          employee = employees[0] || null
        }

        if (!employee) {
          logLoginAttempt({ ...loginCtx, success: false, reason: "user_not_found" })
          return null
        }

        const valid = await bcrypt.compare(credentials.password, employee.passwordHash)
        if (!valid) {
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
        token.allowedBranchIds = null
      }

      // Периодически обновляем billingStatus (каждые 5 минут)
      const now = Math.floor(Date.now() / 1000)
      const lastCheck = (token.billingStatusCheckedAt as number) || 0
      if (token.tenantId && now - lastCheck > 300) {
        try {
          const org = await db.organization.findUnique({
            where: { id: token.tenantId as string },
            select: { billingStatus: true },
          })
          if (org) {
            token.billingStatus = org.billingStatus
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
        ;(session.user as any).allowedBranchIds = token.allowedBranchIds ?? null
        if (token.impersonatedBy) {
          ;(session.user as any).impersonatedBy = token.impersonatedBy
        }
      }
      return session
    },
  },
}
