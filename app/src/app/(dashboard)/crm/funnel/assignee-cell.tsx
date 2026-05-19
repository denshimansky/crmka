"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { filterEmployeesByBranch, isEmployeeAvailableInBranch } from "@/lib/employee-branch-filter"

export interface EmployeeOption {
  id: string
  firstName: string | null
  lastName: string | null
  employeeBranches?: { branchId: string }[]
}

function fmtName(e: EmployeeOption): string {
  return [e.lastName, e.firstName].filter(Boolean).join(" ") || "Без имени"
}

export function AssigneeCell({
  clientId,
  clientBranchId,
  initialAssigneeId,
  employees,
}: {
  clientId: string
  clientBranchId: string | null
  initialAssigneeId: string | null
  employees: EmployeeOption[]
}) {
  const router = useRouter()
  const [value, setValue] = useState<string>(initialAssigneeId || "")
  const [loading, setLoading] = useState(false)

  async function handleChange(newId: string | null) {
    if (newId === null) return
    if (newId === value) return
    setValue(newId)
    setLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedTo: newId || null }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        setValue(initialAssigneeId || "")
      }
    } catch {
      setValue(initialAssigneeId || "")
    } finally {
      setLoading(false)
    }
  }

  const selected = employees.find((e) => e.id === value)
  const availableEmployees = filterEmployeesByBranch(employees, clientBranchId)
  // Текущий назначенный показываем даже если он не в филиале лида, иначе пользователь не поймёт, кто стоит
  const showSelectedOutOfBranch =
    selected && !isEmployeeAvailableInBranch(selected, clientBranchId)
  const visibleEmployees = showSelectedOutOfBranch
    ? [selected, ...availableEmployees.filter((e) => e.id !== selected.id)]
    : availableEmployees

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger
        className="h-8 w-full max-w-[180px] text-xs"
        disabled={loading}
      >
        {selected ? (
          fmtName(selected)
        ) : (
          <span className="text-muted-foreground">— Не назначен</span>
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">— Не назначен</SelectItem>
        {visibleEmployees.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {fmtName(e)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
