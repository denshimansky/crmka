"use client"

import { useRouter, useSearchParams } from "next/navigation"

interface DirectionOption {
  id: string
  name: string
}

interface GroupOption {
  id: string
  name: string
  directionName: string
}

/**
 * Верхние фильтры отчёта «Допродажи»: направление и группа. Меняют URL-параметры
 * (directionId/groupId), сохраняя остальные (месяц, филиал). Смена направления
 * сбрасывает группу — она могла относиться к другому направлению.
 */
export function UpsellFilters({
  directions,
  groups,
  directionId,
  groupId,
}: {
  directions: DirectionOption[]
  groups: GroupOption[]
  directionId?: string
  groupId?: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function setParam(key: "directionId" | "groupId", value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    if (key === "directionId") params.delete("groupId")
    router.push(`?${params.toString()}`)
  }

  const selectCls =
    "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

  return (
    <div className="flex flex-wrap gap-2">
      <select
        value={directionId ?? ""}
        onChange={(e) => setParam("directionId", e.target.value)}
        className={selectCls}
      >
        <option value="">Все направления</option>
        {directions.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <select
        value={groupId ?? ""}
        onChange={(e) => setParam("groupId", e.target.value)}
        className={selectCls}
      >
        <option value="">Все группы</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.directionName ? `${g.name} · ${g.directionName}` : g.name}
          </option>
        ))}
      </select>
    </div>
  )
}
