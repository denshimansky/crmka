"use client"

import { useRouter } from "next/navigation"

// Селектор филиала на вкладке «Связь». Фильтр (?branchId=...) общий для всей
// страницы «Продажи» и переживает переключение вкладок — без селектора здесь
// он применялся бы к списку невидимо. Семантика та же, что на вкладках этапов:
// по активным заявкам клиента (см. contactWhere в page.tsx).
export function ContactBranchFilter({
  branches,
  branchId,
}: {
  branches: { id: string; name: string }[]
  branchId: string | null
}) {
  const router = useRouter()
  if (branches.length <= 1) return null
  return (
    <div className="flex justify-end">
      <select
        value={branchId ?? "all"}
        onChange={(e) => {
          const params = new URLSearchParams(window.location.search)
          if (e.target.value === "all") params.delete("branchId")
          else params.set("branchId", e.target.value)
          router.push(`?${params.toString()}`)
        }}
        className="h-9 rounded-md border bg-background px-3 text-sm"
      >
        <option value="all">Все филиалы</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </div>
  )
}
