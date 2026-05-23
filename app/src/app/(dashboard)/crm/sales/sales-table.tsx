"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Settings2, Search } from "lucide-react"
import {
  EditableDateCell,
  EditableSelectCell,
  EditableTextCell,
} from "../_components/editable-cell"
import { ProcessApplicationDialog } from "../_components/process-application-dialog"

export type SalesTabKey = "application" | "trial" | "trial_done" | "awaiting_payment"

type WardLite = { id: string; firstName: string; lastName: string | null }

export interface SalesRow {
  // Технический id строки (application.id / trialLesson.id / client.id)
  rowId: string
  clientId: string
  applicationId?: string
  state: "lead" | "client"
  firstName: string | null
  lastName: string | null
  phone: string | null
  socialLink: string | null
  channelName: string | null
  ward: WardLite
  branchName: string | null
  directionName: string | null
  groupOrTimeLabel: string | null
  scheduledDate: string | null
  firstPaidLessonDate: string | null
  expectedSubscriptionAmount: string | null
  createdAt: string | null
  nextContactDate: string | null
  comment: string | null
  assignedTo: string | null
}

interface EmployeeOption {
  id: string
  firstName: string | null
  lastName: string | null
}

function fullName(r: { firstName: string | null; lastName: string | null }): string {
  return [r.lastName, r.firstName].filter(Boolean).join(" ") || "Без имени"
}

function wardName(w: WardLite): string {
  return [w.firstName, w.lastName].filter(Boolean).join(" ") || "—"
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("ru-RU")
}

export function SalesTable({
  tab,
  rows,
  employees,
}: {
  tab: SalesTabKey
  rows: SalesRow[]
  employees: EmployeeOption[]
}) {
  const [processing, setProcessing] = useState<SalesRow | null>(null)
  const [query, setQuery] = useState("")

  const employeeOptions = useMemo(
    () =>
      employees.map((e) => ({
        value: e.id,
        label: [e.lastName, e.firstName].filter(Boolean).join(" ") || "Без имени",
      })),
    [employees],
  )

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const parent = fullName(r).toLowerCase()
      if (parent.includes(q)) return true
      return wardName(r.ward).toLowerCase().includes(q)
    })
  }, [rows, query])

  const searchBar = (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск по ФИО родителя или ребёнка..."
        className="pl-9"
      />
    </div>
  )

  if (rows.length === 0) {
    return (
      <>
        {searchBar}
        <div className="flex items-center justify-center rounded-lg border bg-card p-12 text-sm text-muted-foreground">
          В этой категории пока пусто
        </div>
      </>
    )
  }

  if (visibleRows.length === 0) {
    return (
      <>
        {searchBar}
        <div className="flex items-center justify-center rounded-lg border bg-card p-12 text-sm text-muted-foreground">
          Никто не найден по запросу «{query}»
        </div>
      </>
    )
  }

  return (
    <>
      {searchBar}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Состояние</TableHead>
              {tab === "application" && <TableHead className="w-[40px]"></TableHead>}
              <TableHead>ФИО родителя</TableHead>
              <TableHead>Телефон</TableHead>
              <TableHead>Соцсети</TableHead>
              {tab === "application" && <TableHead>Канал</TableHead>}
              {tab === "application" && <TableHead>След. связь</TableHead>}
              <TableHead>Ребёнок</TableHead>
              {(tab === "trial" || tab === "trial_done" || tab === "awaiting_payment") && (
                <TableHead>Дата пробного</TableHead>
              )}
              <TableHead>Филиал</TableHead>
              <TableHead>Направление</TableHead>
              {(tab === "trial" || tab === "trial_done" || tab === "awaiting_payment") && (
                <TableHead>Группа</TableHead>
              )}
              {tab === "application" && <TableHead>Создана</TableHead>}
              {(tab === "trial_done" || tab === "awaiting_payment") && (
                <TableHead>Дата 1-го платного</TableHead>
              )}
              {tab === "awaiting_payment" && <TableHead>Стоимость абонемента</TableHead>}
              <TableHead>Комментарий</TableHead>
              <TableHead>Ответственный</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((r) => (
              <TableRow key={r.rowId}>
                <TableCell className="text-xs font-medium">
                  {r.state === "client" ? "Клиент" : "Лид"}
                </TableCell>
                {tab === "application" && (
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Обработать заявку"
                      onClick={() => setProcessing(r)}
                    >
                      <Settings2 className="size-4" />
                    </Button>
                  </TableCell>
                )}
                <TableCell>
                  <Link href={`/crm/clients/${r.clientId}`} className="font-medium hover:underline">
                    {fullName(r)}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">{r.phone || "—"}</TableCell>
                <TableCell className="text-sm">
                  {r.socialLink ? (
                    <a
                      href={r.socialLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline truncate max-w-[140px] inline-block"
                    >
                      {r.socialLink}
                    </a>
                  ) : (
                    "—"
                  )}
                </TableCell>
                {tab === "application" && <TableCell className="text-sm">{r.channelName || "—"}</TableCell>}
                {tab === "application" && (
                  <TableCell>
                    <EditableDateCell
                      initialValue={r.nextContactDate ? r.nextContactDate.slice(0, 10) : ""}
                      endpoint={{ url: `/api/clients/${r.clientId}`, field: "nextContactDate" }}
                    />
                  </TableCell>
                )}
                <TableCell className="text-sm">{wardName(r.ward)}</TableCell>
                {(tab === "trial" || tab === "trial_done" || tab === "awaiting_payment") && (
                  <TableCell className="text-sm">{fmtDate(r.scheduledDate)}</TableCell>
                )}
                <TableCell className="text-sm">{r.branchName || "—"}</TableCell>
                <TableCell className="text-sm">{r.directionName || "—"}</TableCell>
                {(tab === "trial" || tab === "trial_done" || tab === "awaiting_payment") && (
                  <TableCell className="text-sm">{r.groupOrTimeLabel || "—"}</TableCell>
                )}
                {tab === "application" && <TableCell className="text-sm">{fmtDate(r.createdAt)}</TableCell>}
                {(tab === "trial_done" || tab === "awaiting_payment") && (
                  <TableCell>
                    <EditableDateCell
                      initialValue={r.firstPaidLessonDate ? r.firstPaidLessonDate.slice(0, 10) : ""}
                      endpoint={{ url: `/api/clients/${r.clientId}`, field: "firstPaidLessonDate" }}
                    />
                  </TableCell>
                )}
                {tab === "awaiting_payment" && (
                  <TableCell className="text-sm">{r.expectedSubscriptionAmount || "—"}</TableCell>
                )}
                <TableCell>
                  <EditableTextCell
                    initialValue={r.comment}
                    endpoint={{ url: `/api/clients/${r.clientId}`, field: "comment" }}
                  />
                </TableCell>
                <TableCell>
                  <EditableSelectCell
                    initialValue={r.assignedTo}
                    options={employeeOptions}
                    endpoint={{ url: `/api/clients/${r.clientId}`, field: "assignedTo" }}
                    placeholder="Не назначен"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {processing && processing.applicationId && (
        <ProcessApplicationDialog
          applicationId={processing.applicationId}
          wardId={processing.ward.id}
          branchId={""}
          directionId={""}
          ward={processing.ward}
          open={true}
          onOpenChange={(v) => {
            if (!v) setProcessing(null)
          }}
        />
      )}
    </>
  )
}

