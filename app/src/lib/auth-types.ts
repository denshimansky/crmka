import { type Role } from "@prisma/client"

declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null
      email?: string | null
      image?: string | null
      role: Role
      tenantId: string
      employeeId: string
      orgName: string
      // null — доступ ко всем филиалам (owner/manager всегда; admin/instructor
      // если EmployeeBranch пуст). Массив — ограниченный набор UUID. См. ADM-04.
      allowedBranchIds: string[] | null
    }
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: Role
    tenantId: string
    employeeId: string
    orgName: string
    allowedBranchIds: string[] | null
    allowedBranchesCheckedAt?: number
  }
}
