import { type NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"

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
      async authorize(credentials) {
        if (!credentials?.login || !credentials?.password) return null

        // Ищем сотрудника по логину (может быть email владельца или login сотрудника)
        const employee = await db.employee.findFirst({
          where: {
            OR: [
              { login: credentials.login },
              { email: credentials.login },
            ],
            isActive: true,
            deletedAt: null,
          },
          include: { organization: true },
        })

        if (!employee) return null

        const valid = await bcrypt.compare(credentials.password, employee.passwordHash)
        if (!valid) return null

        return {
          id: employee.id,
          name: `${employee.lastName} ${employee.firstName}`,
          email: employee.email,
          role: employee.role,
          tenantId: employee.tenantId,
          orgName: employee.organization.name,
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
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role
        ;(session.user as any).tenantId = token.tenantId
        ;(session.user as any).employeeId = token.employeeId
        ;(session.user as any).orgName = token.orgName
      }
      return session
    },
  },
}
