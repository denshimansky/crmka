"use client"

import { useMemo, useState } from "react"
import { ExportButton } from "@/components/export-button"
import { useRoleNames } from "@/components/role-names-provider"
import type { ContactRow, ContactsTabKey } from "./contacts-table"
import {
  columnsForTab,
  exportCell,
  readStoredSort,
  sortRows,
  type ContactsCellCtx,
} from "./contacts-export"

/**
 * «Скачать Excel» в шапке страницы «Клиенты» — выгрузка АКТИВНОЙ вкладки.
 *
 * Файл повторяет то, что на экране: столбцы вкладки в том же порядке, те же
 * фильтры (вкладка/поиск/филиал уходят в эндпоинт теми же параметрами, что
 * стоят в URL) и выбранная сортировка — её таблица держит в sessionStorage,
 * см. readStoredSort. Строки — ВСЕ строки вкладки: пагинации на странице нет.
 *
 * Данные берём отдельным запросом, а не из пропсов страницы: гейт «только
 * владелец» живёт на сервере (/api/clients/contacts-export отдаёт 403 остальным),
 * и заодно список не едет в HTML страницы вторым экземпляром — у крупных
 * тенантов вкладка «Все» это тысячи строк.
 */
export function ContactsExportButton({
  tab,
  tabLabel,
  employees,
  orgName,
  filterNote,
}: {
  tab: ContactsTabKey
  tabLabel: string
  employees: { id: string; firstName: string | null; lastName: string | null }[]
  orgName: string
  filterNote?: string
}) {
  const roleNames = useRoleNames()
  const [loading, setLoading] = useState(false)

  const ctx: ContactsCellCtx = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of employees) {
      m.set(e.id, [e.lastName, e.firstName].filter(Boolean).join(" ") || "Без имени")
    }
    return {
      employeeLabel: (id: string | null) => (id ? m.get(id) || "" : ""),
      instructorLabel: roleNames.instructor,
    }
  }, [employees, roleNames.instructor])

  async function handleExport() {
    setLoading(true)
    try {
      // Те же параметры, что стоят в адресной строке: вкладка, поиск, филиал.
      const pageParams = new URLSearchParams(window.location.search)
      const params = new URLSearchParams({ tab })
      const q = pageParams.get("q")
      const branchId = pageParams.get("branchId")
      if (q) params.set("q", q)
      if (branchId) params.set("branchId", branchId)

      const res = await fetch(`/api/clients/contacts-export?${params.toString()}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Не удалось сформировать файл")
        return
      }
      const { rows } = (await res.json()) as { rows: ContactRow[] }
      if (!rows.length) {
        alert("В этой вкладке нет строк для выгрузки")
        return
      }

      // xlsx весит сотни килобайт и нужен только в момент клика — тянем его
      // динамически, чтобы библиотека не висела в бандле страницы «Клиенты».
      const { exportToExcel } = await import("@/lib/export-excel")

      const columns = columnsForTab(tab, roleNames.instructor)
      const stored = readStoredSort(tab)
      const ordered = sortRows(rows, stored.key, stored.dir, ctx)

      exportToExcel({
        title: `Клиенты — ${tabLabel}`,
        // key совпадает с ColId: exportToExcel читает row[c.key].
        columns: columns.map((c) => ({ header: c.header, key: c.id, width: c.width })),
        rows: ordered.map((r) => {
          const out: Record<string, string> = {}
          for (const c of columns) out[c.id] = exportCell(r, c.id, ctx)
          return out
        }),
        // Дата в имени — чтобы выгрузки за разные дни не перетирали друг друга
        // в папке «Загрузки».
        filename: `klienty-${tab}-${new Date().toISOString().slice(0, 10)}.xlsx`,
        // Лист Excel: до 31 символа, без : \ / ? * [ ] — метки вкладок этому
        // удовлетворяют.
        sheetName: tabLabel,
        metadata: {
          org: orgName,
          filters: filterNote,
          generated: new Date().toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      })
    } catch {
      alert("Не удалось сформировать файл")
    } finally {
      setLoading(false)
    }
  }

  return <ExportButton onClick={handleExport} loading={loading} />
}
