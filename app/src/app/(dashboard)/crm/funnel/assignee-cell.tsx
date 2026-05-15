"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"

export interface EmployeeOption {
  id: string
  firstName: string | null
  lastName: string | null
}

function fmtName(e: EmployeeOption): string {
  return [e.lastName, e.firstName].filter(Boolean).join(" ") || "Без имени"
}

export function AssigneeCell({
  clientId,
  initialAssigneeId,
  employees,
}: {
  clientId: string
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
        {employees.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {fmtName(e)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
