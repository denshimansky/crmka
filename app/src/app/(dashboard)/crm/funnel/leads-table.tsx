"use client"

import { useMemo } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table"
import { RotateCcw } from "lucide-react"
import { SortableTableHead } from "@/components/sortable-table-head"
import { useTablePrefs } from "@/hooks/use-table-prefs"
import { AssigneeCell, type EmployeeOption } from "./assignee-cell"

export interface LeadRow {
  id: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  branchId: string | null
  branchName: string | null
  assignedTo: string | null
  /** ISO-строки — сериализуемы из server-компонента */
  nextContactDate: string | null
  createdAt: string
}

type SortVal = string | number | null

interface ColumnDef {
  key: string
  label: string
  align?: "left" | "right" | "center"
  getValue: (row: LeadRow, ctx: Context) => SortVal
  render: (row: LeadRow, ctx: Context) => React.ReactNode
}

interface Context {
  employees: EmployeeOption[]
  today: number
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

function employeeName(emp: EmployeeOption | undefined): string {
  if (!emp) return ""
  return [emp.lastName, emp.firstName].filter(Boolean).join(" ").toLowerCase()
}

const COLUMNS: ColumnDef[] = [
  {
    key: "name",
    label: "Лид",
    getValue: (l) =>
      [l.lastName, l.firstName].filter(Boolean).join(" ").toLowerCase() || null,
    render: (l) => {
      const name =
        [l.lastName, l.firstName].filter(Boolean).join(" ") || "Без имени"
      return (
        <Link
          href={`/crm/funnel/${l.id}`}
          className="font-medium text-primary hover:underline"
        >
          {name}
        </Link>
      )
    },
  },
  {
    key: "phone",
    label: "Телефон",
    getValue: (l) => l.phone?.toLowerCase() || null,
    render: (l) => (
      <span className="text-muted-foreground">{l.phone || "—"}</span>
    ),
  },
  {
    key: "branch",
    label: "Филиал",
    getValue: (l) => l.branchName?.toLowerCase() || null,
    render: (l) => (
      <span className="text-muted-foreground">{l.branchName || "—"}</span>
    ),
  },
  {
    key: "assignee",
    label: "Ответственный",
    getValue: (l, ctx) => {
      const emp = ctx.employees.find((e) => e.id === l.assignedTo)
      return employeeName(emp) || null
    },
    render: (l, ctx) => (
      <AssigneeCell
        clientId={l.id}
        clientBranchId={l.branchId}
        initialAssigneeId={l.assignedTo}
        employees={ctx.employees}
      />
    ),
  },
  {
    key: "nextContact",
    label: "След. контакт",
    getValue: (l) => (l.nextContactDate ? new Date(l.nextContactDate).getTime() : null),
    render: (l, ctx) => {
      const overdue =
        l.nextContactDate && new Date(l.nextContactDate).getTime() < ctx.today
      return (
        <span
          className={
            overdue ? "font-medium text-destructive" : "text-muted-foreground"
          }
        >
          {formatDate(l.nextContactDate)}
        </span>
      )
    },
  },
  {
    key: "createdAt",
    label: "Создан",
    getValue: (l) => new Date(l.createdAt).getTime(),
    render: (l) => (
      <span className="text-muted-foreground">{formatDate(l.createdAt)}</span>
    ),
  },
]

const DEFAULT_ORDER = COLUMNS.map((c) => c.key)
const STORAGE_KEY = "table-prefs:leads"

export function LeadsTable({
  leads,
  employees,
}: {
  leads: LeadRow[]
  employees: EmployeeOption[]
}) {
  const { columnOrder, sortBy, sortDir, handleSortClick, moveColumn, resetPrefs } =
    useTablePrefs({
      storageKey: STORAGE_KEY,
      defaultOrder: DEFAULT_ORDER,
    })

  const ctx = useMemo<Context>(() => {
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return { employees, today: t.getTime() }
  }, [employees])

  const orderedCols = useMemo(
    () =>
      columnOrder
        .map((k) => COLUMNS.find((c) => c.key === k))
        .filter((c): c is ColumnDef => Boolean(c)),
    [columnOrder],
  )

  const sorted = useMemo(() => {
    if (!sortBy) return leads
    const col = COLUMNS.find((c) => c.key === sortBy)
    if (!col) return leads
    return [...leads].sort((a, b) => {
      const av = col.getValue(a, ctx)
      const bv = col.getValue(b, ctx)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (av < bv) return sortDir === "asc" ? -1 : 1
      if (av > bv) return sortDir === "asc" ? 1 : -1
      return 0
    })
  }, [leads, sortBy, sortDir, ctx])

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={resetPrefs}
          title="Вернуть исходный порядок столбцов и сбросить сортировку"
        >
          <RotateCcw className="mr-1 size-3.5" />
          Сбросить
        </Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {orderedCols.map((col) => (
                <SortableTableHead
                  key={col.key}
                  columnKey={col.key}
                  label={col.label}
                  activeSortKey={sortBy}
                  sortDir={sortDir}
                  onSortClick={handleSortClick}
                  onMove={moveColumn}
                  align={col.align}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((lead) => (
              <TableRow key={lead.id}>
                {orderedCols.map((col) => (
                  <TableCell
                    key={col.key}
                    className={col.align === "right" ? "text-right" : undefined}
                  >
                    {col.render(lead, ctx)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
