"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { EditableTextCell } from "../_components/editable-cell"

export type ChildState =
  | "lead"
  | "potential"
  | "nontarget"
  | "active"
  | "churned"
  | "archived"
  | "blacklist"

export interface ChildRow {
  id: string
  firstName: string
  lastName: string | null
  birthDate: string | null
  parentId: string
  parentName: string
  parentPhone: string | null
  parentComment: string | null
  branchName: string | null
  state: ChildState
}

const STATE_LABEL: Record<ChildState, string> = {
  lead: "Лид",
  potential: "Потенциал",
  nontarget: "Нецелевой",
  active: "Активный",
  churned: "Выбывший",
  archived: "Архив",
  blacklist: "Чёрный список",
}

function wardFullName(r: { firstName: string; lastName: string | null }): string {
  return [r.firstName, r.lastName].filter(Boolean).join(" ") || "Без имени"
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("ru-RU")
}

function ageLabel(iso: string | null): string {
  if (!iso) return "—"
  const birth = new Date(iso)
  const now = new Date()
  let years = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--
  if (years < 0) return "—"
  const mod10 = years % 10
  const mod100 = years % 100
  if (mod100 >= 11 && mod100 <= 19) return `${years} лет`
  if (mod10 === 1) return `${years} год`
  if (mod10 >= 2 && mod10 <= 4) return `${years} года`
  return `${years} лет`
}

export function ChildrenTable({ rows }: { rows: ChildRow[] }) {
  // По умолчанию все 3 категории показаны (чекбоксы ВКЛ → видимы).
  const [showArchived, setShowArchived] = useState(true)
  const [showBlacklist, setShowBlacklist] = useState(true)
  const [showNontarget, setShowNontarget] = useState(true)

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (!showArchived && r.state === "archived") return false
      if (!showBlacklist && r.state === "blacklist") return false
      if (!showNontarget && r.state === "nontarget") return false
      return true
    })
  }, [rows, showArchived, showBlacklist, showNontarget])

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-3 text-sm">
        <span className="text-muted-foreground">Показывать:</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={showArchived} onCheckedChange={(v) => setShowArchived(!!v)} />
          <span>Архив</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={showBlacklist} onCheckedChange={(v) => setShowBlacklist(!!v)} />
          <span>Чёрный список</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={showNontarget} onCheckedChange={(v) => setShowNontarget(!!v)} />
          <span>Нецелевой</span>
        </label>
        <span className="ml-auto text-muted-foreground">Всего: {filtered.length}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border bg-card p-12 text-sm text-muted-foreground">
          Нет подопечных, подходящих под фильтры
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Состояние</TableHead>
                <TableHead>Ребёнок</TableHead>
                <TableHead>Родитель</TableHead>
                <TableHead>Телефон</TableHead>
                <TableHead>Возраст</TableHead>
                <TableHead>Дата рождения</TableHead>
                <TableHead>Филиал посещения</TableHead>
                <TableHead>Комментарий</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs font-medium">{STATE_LABEL[r.state]}</TableCell>
                  <TableCell>
                    <Link href={`/crm/wards/${r.id}`} className="font-medium hover:underline">
                      {wardFullName(r)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/crm/clients/${r.parentId}`} className="hover:underline">
                      {r.parentName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{r.parentPhone || "—"}</TableCell>
                  <TableCell className="text-sm">{ageLabel(r.birthDate)}</TableCell>
                  <TableCell className="text-sm">{fmtDate(r.birthDate)}</TableCell>
                  <TableCell className="text-sm">{r.branchName || "—"}</TableCell>
                  <TableCell>
                    <EditableTextCell
                      initialValue={r.parentComment}
                      endpoint={{ url: `/api/clients/${r.parentId}`, field: "comment" }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
