"use client"

import { useRouter, useSearchParams } from "next/navigation"

const SORT_OPTIONS = [
  { value: "nextContactDate", label: "По дате контакта" },
  { value: "createdAt", label: "По дате создания" },
  { value: "name", label: "По имени" },
] as const

export function FunnelSortSelect() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const current = searchParams.get("sort") || "nextContactDate"

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("sort", e.target.value)
    router.push(`?${params.toString()}`)
  }

  return (
    <select
      value={current}
      onChange={handleChange}
      className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {SORT_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
