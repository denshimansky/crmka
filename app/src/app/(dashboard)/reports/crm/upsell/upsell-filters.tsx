"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { SimpleSelect } from "@/components/ui/simple-select"

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

  // SimpleSelect отдаёт "all" вместо пустой строки — в URL это отсутствие параметра.
  const groupOptions = groups.map((g) => ({
    id: g.id,
    name: g.directionName ? `${g.name} · ${g.directionName}` : g.name,
  }))

  return (
    <div className="flex flex-wrap gap-2">
      <SimpleSelect
        value={directionId ?? "all"}
        onValueChange={(v) => setParam("directionId", v === "all" ? "" : v)}
        options={directions}
        emptyLabel="Все направления"
        className="w-[200px]"
      />
      <SimpleSelect
        value={groupId ?? "all"}
        onValueChange={(v) => setParam("groupId", v === "all" ? "" : v)}
        options={groupOptions}
        emptyLabel="Все группы"
        className="w-[220px]"
      />
    </div>
  )
}
