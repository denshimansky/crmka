"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Settings2, Search, ArrowUpDown, ArrowDown, ArrowUp, Pencil, Trash2, ListChecks } from "lucide-react"
import {
  EditableDateCell,
  EditableSelectCell,
  EditableTextCell,
} from "../_components/editable-cell"
import { ProcessApplicationDialog } from "../_components/process-application-dialog"
import { TrialLessonDialog } from "../_components/trial-lesson-dialog"
import { AwaitingPaymentDialog } from "../_components/awaiting-payment-dialog"
import { formatWardName } from "@/lib/format-name"
import { EditSalesRowDialog } from "./edit-sales-row-dialog"

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
  /** HH:MM начала пробного (если задано) — для отображения «ДД.ММ.ГГГГ HH:MM» в столбце «Дата пробного». */
  startTime?: string | null
  /** lessonId привязанного занятия (если пробное в группе). Делает «Дату пробного» кликабельной → карточка занятия. */
  lessonId?: string | null
  /** TrialLesson.id «представительного» пробного — используется при редактировании. */
  trialLessonId?: string | null
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
  return formatWardName(w, "—")
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("ru-RU")
}

function fmtDateTime(iso: string | null, time: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso).toLocaleDateString("ru-RU")
  return time ? `${d} ${time}` : d
}

/** Все сортируемые колонки таблицы Продаж. */
type SortKey =
  | "state"
  | "parent"
  | "phone"
  | "channel"
  | "nextContact"
  | "ward"
  | "scheduled"
  | "branch"
  | "direction"
  | "group"
  | "createdAt"
  | "firstPaid"
  | "expected"
  | "comment"
  | "assigned"

type SortDir = "asc" | "desc"

export function SalesTable({
  tab,
  rows,
  employees,
}: {
  tab: SalesTabKey
  rows: SalesRow[]
  employees: EmployeeOption[]
}) {
  const router = useRouter()
  const [processing, setProcessing] = useState<SalesRow | null>(null)
  const [editing, setEditing] = useState<SalesRow | null>(null)
  // Открытие модалок «Пробное записано» / «Ожидание оплаты» из ПКМ.
  const [trialFor, setTrialFor] = useState<SalesRow | null>(null)
  const [awaitingFor, setAwaitingFor] = useState<SalesRow | null>(null)
  const [query, setQuery] = useState("")
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  // Из «Прошёл пробное»/«Ожидаем оплату» возврат в «Пробное записано» запрещён
  // (PRD). На вкладках trial_done и awaiting_payment пункт скрываем.
  const canScheduleTrial = tab === "application" || tab === "trial"

  async function removeFromFunnel(wardId: string) {
    if (!confirm("Вывести подопечного из воронки? Связанные пробные и заявки будут отменены.")) return
    const res = await fetch(`/api/wards/${wardId}/remove-from-funnel`, { method: "POST" })
    if (res.ok) router.refresh()
  }

  const employeeOptions = useMemo(
    () =>
      employees.map((e) => ({
        value: e.id,
        label: [e.lastName, e.firstName].filter(Boolean).join(" ") || "Без имени",
      })),
    [employees],
  )

  const employeeLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of employeeOptions) m.set(o.value, o.label)
    return (id: string | null) => (id ? m.get(id) || "" : "")
  }, [employeeOptions])

  /** Сравнимое значение для сортировки. Даты → ISO-строка (естественный порядок),
   *  остальное → строка в нижнем регистре. Пустые значения сортируются в конец. */
  function sortValue(r: SalesRow, key: SortKey): string {
    switch (key) {
      case "state":
        return r.state
      case "parent":
        return fullName(r).toLowerCase()
      case "phone":
        return (r.phone || "").toLowerCase()
      case "channel":
        return (r.channelName || "").toLowerCase()
      case "nextContact":
        return r.nextContactDate || ""
      case "ward":
        return wardName(r.ward).toLowerCase()
      case "scheduled":
        return (r.scheduledDate || "") + (r.startTime || "")
      case "branch":
        return (r.branchName || "").toLowerCase()
      case "direction":
        return (r.directionName || "").toLowerCase()
      case "group":
        return (r.groupOrTimeLabel || "").toLowerCase()
      case "createdAt":
        return r.createdAt || ""
      case "firstPaid":
        return r.firstPaidLessonDate || ""
      case "expected":
        return r.expectedSubscriptionAmount || ""
      case "comment":
        return (r.comment || "").toLowerCase()
      case "assigned":
        return employeeLabel(r.assignedTo).toLowerCase()
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir("asc")
    } else if (sortDir === "asc") {
      setSortDir("desc")
    } else {
      // Третий клик — сбросить сортировку
      setSortKey(null)
    }
  }

  const visibleRows = useMemo(() => {
    // Поиск-по-токенам: каждое слово запроса ищется в склейке «ФИО родителя +
    // ФИО ребёнка». Без этого порядок «Имя Фамилия» не работал, т.к. в строке
    // лежит «Фамилия Имя».
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const filtered = tokens.length
      ? rows.filter((r) => {
          const haystack = `${fullName(r).toLowerCase()} ${wardName(r.ward).toLowerCase()}`
          return tokens.every((t) => haystack.includes(t))
        })
      : rows
    if (!sortKey) return filtered
    const sign = sortDir === "asc" ? 1 : -1
    const copy = [...filtered]
    copy.sort((a, b) => {
      const va = sortValue(a, sortKey)
      const vb = sortValue(b, sortKey)
      // Пустые в конец независимо от направления
      const ae = va === ""
      const be = vb === ""
      if (ae && !be) return 1
      if (!ae && be) return -1
      if (va === vb) return 0
      return va.localeCompare(vb, "ru") * sign
    })
    return copy
    // sortValue зависит только от employeeLabel — он мемоизирован, поэтому
    // включаем именно его, а не функцию-обёртку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, sortKey, sortDir, employeeLabel])

  /** Прошло ли пробное (scheduledDate < сейчас). Используется только для tab=trial,
   *  где status=scheduled — соответственно ребёнок не отмечен (баг #41 продолж.). */
  const nowTs = Date.now()
  function isOverdueScheduled(r: SalesRow): boolean {
    if (tab !== "trial") return false
    if (!r.scheduledDate) return false
    const ts = new Date(r.scheduledDate).getTime()
    if (!Number.isFinite(ts)) return false
    return ts < nowTs
  }

  function SortableHead({ label, sortKey: k, className }: { label: string; sortKey: SortKey; className?: string }) {
    const active = sortKey === k
    const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown
    return (
      <TableHead className={className}>
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className="inline-flex items-center gap-1 hover:text-foreground"
          title="Сортировать"
        >
          <span>{label}</span>
          <Icon className={`size-3 ${active ? "text-foreground" : "text-muted-foreground/60"}`} />
        </button>
      </TableHead>
    )
  }

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
              <SortableHead label="Состояние" sortKey="state" />
              {tab === "application" && <TableHead className="w-[40px]"></TableHead>}
              <SortableHead label="ФИО родителя" sortKey="parent" />
              <SortableHead label="Телефон" sortKey="phone" />
              <TableHead>Соцсети</TableHead>
              {tab === "application" && <SortableHead label="Канал" sortKey="channel" />}
              {tab === "application" && <SortableHead label="След. связь" sortKey="nextContact" />}
              <SortableHead label="Ребёнок" sortKey="ward" />
              {(tab === "trial" || tab === "trial_done" || tab === "awaiting_payment") && (
                <SortableHead label="Дата пробного" sortKey="scheduled" />
              )}
              <SortableHead label="Филиал" sortKey="branch" />
              <SortableHead label="Направление" sortKey="direction" />
              {(tab === "trial" || tab === "trial_done" || tab === "awaiting_payment") && (
                <SortableHead label="Группа" sortKey="group" />
              )}
              {tab === "application" && <SortableHead label="Создана" sortKey="createdAt" />}
              {(tab === "trial_done" || tab === "awaiting_payment") && (
                <SortableHead label="Дата 1-го платного" sortKey="firstPaid" />
              )}
              {tab === "awaiting_payment" && (
                <SortableHead label="Стоимость абонемента" sortKey="expected" />
              )}
              <SortableHead label="Комментарий" sortKey="comment" />
              <SortableHead label="Ответственный" sortKey="assigned" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((r) => (
              <ContextMenu key={r.rowId}>
              <ContextMenuTrigger asChild>
              <TableRow
                className={
                  isOverdueScheduled(r)
                    ? "bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-900/40"
                    : undefined
                }
              >
                <TableCell className="text-xs font-medium">
                  {r.state === "client" ? "Клиент" : "Лид"}
                </TableCell>
                {tab === "application" && (
                  <TableCell>
                    {r.applicationId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Обработать заявку"
                        onClick={() => setProcessing(r)}
                      >
                        <Settings2 className="size-4" />
                      </Button>
                    ) : null}
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
                  <TableCell className="text-sm whitespace-nowrap">
                    {r.lessonId ? (
                      <Link
                        href={`/schedule/lessons/${r.lessonId}`}
                        className="text-primary hover:underline"
                        title="Открыть карточку занятия"
                      >
                        {fmtDateTime(r.scheduledDate, r.startTime)}
                      </Link>
                    ) : (
                      fmtDateTime(r.scheduledDate, r.startTime)
                    )}
                  </TableCell>
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
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => setEditing(r)}>
                  <Pencil className="size-3.5" />
                  Изменить
                </ContextMenuItem>
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <ListChecks className="size-3.5" />
                    Установить статус
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    {canScheduleTrial && (
                      <ContextMenuItem onClick={() => setTrialFor(r)}>
                        Пробное записано
                      </ContextMenuItem>
                    )}
                    <ContextMenuItem onClick={() => setAwaitingFor(r)}>
                      Ожидание оплаты
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onClick={() => removeFromFunnel(r.ward.id)}>
                  <Trash2 className="size-3.5" />
                  Удалить (вывести из воронки)
                </ContextMenuItem>
              </ContextMenuContent>
              </ContextMenu>
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

      {editing && (
        <EditSalesRowDialog
          row={editing}
          tab={tab}
          employees={employees}
          open={true}
          onOpenChange={(v) => {
            if (!v) setEditing(null)
          }}
        />
      )}

      {trialFor && (
        <TrialLessonDialog
          clientId={trialFor.clientId}
          wards={[trialFor.ward]}
          lockedWardId={trialFor.ward.id}
          open={true}
          onOpenChange={(v) => {
            if (!v) setTrialFor(null)
          }}
        />
      )}

      {awaitingFor && (
        <AwaitingPaymentDialog
          wardId={awaitingFor.ward.id}
          wardName={wardName(awaitingFor.ward)}
          open={true}
          onOpenChange={(v) => {
            if (!v) setAwaitingFor(null)
          }}
        />
      )}
    </>
  )
}

