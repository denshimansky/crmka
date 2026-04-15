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

      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role
        ;(session.user as any).tenantId = token.tenantId
        ;(session.user as any).employeeId = token.employeeId
        ;(session.user as any).orgName = token.orgName
        ;(session.user as any).billingStatus = token.billingStatus
        if (token.impersonatedBy) {
          ;(session.user as any).impersonatedBy = token.impersonatedBy
        }
      }
      return session
    },
  },
}
