"use client"

import { createContext, useContext } from "react"
import type { Role } from "@prisma/client"
import { DEFAULT_ROLE_DISPLAY_NAMES } from "@/lib/roles"

const RoleNamesContext = createContext<Record<Role, string>>(
  DEFAULT_ROLE_DISPLAY_NAMES,
)

/**
 * Прокидывает кастомные названия ролей организации в клиентские компоненты.
 * Значение готовит серверный layout через getRoleNames(tenantId).
 */
export function RoleNamesProvider({
  value,
  children,
}: {
  value: Record<Role, string>
  children: React.ReactNode
}) {
  return (
    <RoleNamesContext.Provider value={value}>
      {children}
    </RoleNamesContext.Provider>
  )
}

export function useRoleNames(): Record<Role, string> {
  return useContext(RoleNamesContext)
}
