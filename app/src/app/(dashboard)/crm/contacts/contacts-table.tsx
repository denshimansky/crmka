"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react"
import {
  ResizableHead,
  RESIZABLE_TABLE_CLASS,
  useColumnWidths,
} from "@/components/resizable-columns"
import { CreateApplicationDialog } from "../_components/create-application-dialog"
import { StickyHScroll } from "@/components/sticky-h-scroll"
import { useRoleNames } from "@/components/role-names-provider"
import {
  SEGMENT_LABELS,
  firstWardBirth,
  fmtDate,
  fullName,
  sortRows,
  sortStorageKey,
  stateLabel,
  wardsLabel,
  type ColId,
  type ContactsCellCtx,
  type SortDir,
} from "./contacts-export"
import {
  EditableDateCell,
  EditableSelectCell,
  EditableTextCell,
} from "../_components/editable-cell"

export type ContactsTabKey =
  | "leads"
  | "potential"
  | "nontarget"
  | "active"
  | "churned"
  | "archived"
  | "blacklist"
  | "all"

type WardLite = { id: string; firstName: string; lastName: string | null; birthDate: string | null }

export interface ContactRow {
  id: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  socialLink: string | null
  segment: string
  channelName: string | null
  branchName: string | null
  funnelStatus: string
  clientStatus: string | null
  comment: string | null
  nextContactDate: string | null
  assignedTo: string | null
  createdAt: string
  wards: WardLite[]
  activeSubscription?: {
    directionName: string
    groupName: string
    branchName: string | null
    instructor: { id: string | null; name: string }
  } | null
  hasActiveSubscription: boolean
  /** Самая продвинутая стадия воронки среди подопечных (для бажа в строке).
   *  null = ни один подопечный не в воронке (salesStage='none' у всех). */
  topSalesStage: "application" | "trial_scheduled" | "trial_attended" | "awaiting_payment" | null
}

const SALES_STAGE_BADGE: Record<
  NonNullable<ContactRow["topSalesStage"]>,
  { label: string; href: string; className: string; title: string }
> = {
  application: {
    label: "Заявка",
    href: "/crm/sales?tab=application",
    className:
      "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200",
    title: "У подопечного есть активная заявка",
  },
  trial_scheduled: {
    label: "Пробное",
    href: "/crm/sales?tab=trial",
    className:
      "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200",
    title: "Подопечный записан на пробное",
  },
  trial_attended: {
    label: "Прошёл пробное",
    href: "/crm/sales?tab=trial_done",
    className:
      "border-indigo-300 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200",
    title: "Подопечный прошёл пробное",
  },
  awaiting_payment: {
    label: "Ожидаем оплату",
    href: "/crm/sales?tab=awaiting_payment",
    className:
      "border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-200",
    title: "Ждём оплату от родителя",
  },
}

interface EmployeeOption {
  id: string
  firstName: string | null
  lastName: string | null
}

// Стартовые ширины (px) по ColId (идентификаторы столбцов — в contacts-export.ts,
// общие для сортировки, ресайза и выгрузки): table-fixed требует явных ширин,
// иначе браузер делит место поровну и узкие колонки («Телефон») расползаются.
const DEFAULT_WIDTHS: Record<ColId, number> = {
  state: 110,
  parent: 220,
  phone: 130,
  social: 140,
  birth: 120,
  wards: 200,
  segment: 110,
  channel: 130,
  branch: 140,
  direction: 150,
  group: 220,
  instructor: 160,
  created: 120,
  // 160 = инпут даты (w-[140px]) + паддинги ячейки, иначе правый край клипается
  nextContact: 160,
  comment: 220,
  assigned: 170,
}

const ALL_VALUE = "__all__"

// Заголовок с сортировкой и ручкой ресайза. Вынесен на модульный уровень:
// компонент, объявленный внутри ContactsTable, пересоздавался бы как новый
// тип на каждый рендер — React ремоунтил бы все th (потеря фокуса кнопки
// сортировки, лишний DOM-черн на каждый mousemove при ресайзе).
function Th({
  label,
  k,
  width,
  sortKey,
  sortDir,
  onSort,
  onResizeStart,
}: {
  label: string
  k: ColId
  width: number
  sortKey: ColId | null
  sortDir: SortDir
  onSort: (k: ColId) => void
  onResizeStart: (id: string, e: ReactMouseEvent) => void
}) {
  const active = sortKey === k
  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <ResizableHead id={k} width={width} onResizeStart={onResizeStart}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className="inline-flex max-w-full items-center gap-1 overflow-hidden hover:text-foreground"
        title="Сортировать"
      >
        <span className="truncate">{label}</span>
        <Icon className={`size-3 shrink-0 ${active ? "text-foreground" : "text-muted-foreground/60"}`} />
      </button>
    </ResizableHead>
  )
}

export function ContactsTable({
  tab,
  rows,
  employees,
  initialQuery = "",
  branches,
  branchId,
}: {
  tab: ContactsTabKey
  rows: ContactRow[]
  employees: EmployeeOption[]
  initialQuery?: string
  branches: { id: string; name: string }[]
  branchId: string | null
}) {
  const roleNames = useRoleNames()
  const router = useRouter()
  const pathname = usePathname()
  const [query, setQuery] = useState(initialQuery)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced sync ввода с URL ?q=… — серверный поиск по всей базе.
  // Параметры читаются из window.location в момент срабатывания (не из
  // searchParams рендера): устаревшее замыкание таймера иначе стирало бы
  // branchId, выбранный в течение 350 мс после набора текста (и наоборот).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(window.location.search)
      const current = params.toString()
      const trimmed = query.trim()
      if (trimmed) params.set("q", trimmed)
      else params.delete("q")
      const next = params.toString()
      if (next !== current) router.replace(`${pathname}?${next}`, { scroll: false })
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  function setBranchParam(value: string | null) {
    const params = new URLSearchParams(window.location.search)
    if (value) params.set("branchId", value)
    else params.delete("branchId")
    router.push(`${pathname}?${params.toString()}`)
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

  // --- Сортировка (как в «Продажах»): клик — asc, второй — desc, третий —
  // сброс; хранится в sessionStorage per-вкладка, чтобы не соскакивала при
  // уходе в карточку клиента и обратно.
  const [sortKey, setSortKey] = useState<ColId | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const storageKey = sortStorageKey(tab)
  const skipNextSave = useRef(true)
  useEffect(() => {
    let key: ColId | null = null
    let dir: SortDir = "asc"
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) {
        const s = JSON.parse(raw) as { key?: ColId | null; dir?: SortDir }
        if (s?.key) {
          key = s.key
          dir = s.dir === "desc" ? "desc" : "asc"
        }
      }
    } catch {
      /* приватный режим / недоступный storage — игнорируем */
    }
    setSortKey(key)
    setSortDir(dir)
    skipNextSave.current = true
  }, [storageKey])
  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false
      return
    }
    try {
      if (sortKey) sessionStorage.setItem(storageKey, JSON.stringify({ key: sortKey, dir: sortDir }))
      else sessionStorage.removeItem(storageKey)
    } catch {
      /* недоступный storage — игнорируем */
    }
  }, [storageKey, sortKey, sortDir])

  function toggleSort(key: ColId) {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir("asc")
    } else if (sortDir === "asc") {
      setSortDir("desc")
    } else {
      setSortKey(null)
    }
  }

  // Контекст ячейки — общий с выгрузкой в Excel (подпись сотрудника, название
  // роли инструктора).
  const cellCtx: ContactsCellCtx = useMemo(
    () => ({ employeeLabel, instructorLabel: roleNames.instructor }),
    [employeeLabel, roleNames.instructor],
  )

  // Сервер уже отфильтровал по q и филиалу — здесь только сортировка (та же
  // функция, что у кнопки «Скачать Excel», чтобы файл шёл в порядке экрана).
  const visibleRows = useMemo(
    () => sortRows(rows, sortKey, sortDir, cellCtx),
    [rows, sortKey, sortDir, cellCtx],
  )

  // --- Ширина столбцов: тянется за полоску на правом крае заголовка,
  // хранится в localStorage per-вкладка (общий модуль resizable-columns).
  const { widthOf, startResize } = useColumnWidths(`contacts-colw:${tab}`, DEFAULT_WIDTHS)

  const thProps = { sortKey, sortDir, onSort: toggleSort, onResizeStart: startResize }

  const filterBar = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по ФИО родителя или ребёнка..."
          className="pl-9"
        />
      </div>
      {branches.length > 1 && (
        <div className="space-y-1">
          <Label className="text-xs">Филиал</Label>
          <Select
            value={branchId || ALL_VALUE}
            onValueChange={(v) => setBranchParam(v === ALL_VALUE ? null : v)}
          >
            <SelectTrigger className="w-[200px]">
              {branchId ? branches.find((b) => b.id === branchId)?.name || "—" : "Все филиалы"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Все филиалы</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )

  if (rows.length === 0) {
    return (
      <>
        {filterBar}
        <div className="flex items-center justify-center rounded-lg border bg-card p-12 text-sm text-muted-foreground">
          {query
            ? `Никто не найден по запросу «${query}»`
            : branchId
              ? "В выбранном филиале никого нет — выберите другой или «Все филиалы»"
              : "В этой категории пока пусто"}
        </div>
      </>
    )
  }

  return (
    <>
    {filterBar}
    <StickyHScroll className="rounded-lg border bg-card">
      <Table className={RESIZABLE_TABLE_CLASS}>
        <TableHeader>
          <TableRow>
            {tab === "leads" && <TableHead className="w-[40px]"></TableHead>}
            {tab === "potential" && <TableHead className="w-[40px]"></TableHead>}
            {tab === "all" && <Th label="Состояние" k="state" width={widthOf("state")} {...thProps} />}
            <Th label="ФИО родителя" k="parent" width={widthOf("parent")} {...thProps} />
            <Th label="Телефон" k="phone" width={widthOf("phone")} {...thProps} />
            <Th label="Соцсети" k="social" width={widthOf("social")} {...thProps} />
            {(tab === "churned" || tab === "archived" || tab === "blacklist") && (
              <Th label="Дата рождения" k="birth" width={widthOf("birth")} {...thProps} />
            )}
            {(tab === "leads" ||
              tab === "potential" ||
              tab === "nontarget" ||
              tab === "active" ||
              tab === "all") && <Th label="Дети" k="wards" width={widthOf("wards")} {...thProps} />}
            {tab === "active" && <Th label="Сегмент" k="segment" width={widthOf("segment")} {...thProps} />}
            <Th label="Филиал" k="branch" width={widthOf("branch")} {...thProps} />
            {tab === "active" && <Th label="Направление" k="direction" width={widthOf("direction")} {...thProps} />}
            {tab === "active" && <Th label="Группа" k="group" width={widthOf("group")} {...thProps} />}
            {tab === "active" && (
              <Th label={roleNames.instructor} k="instructor" width={widthOf("instructor")} {...thProps} />
            )}
            {(tab === "leads" || tab === "potential" || tab === "active" || tab === "churned") && (
              <Th label="След. связь" k="nextContact" width={widthOf("nextContact")} {...thProps} />
            )}
            {(tab === "leads" || tab === "potential" || tab === "nontarget" || tab === "active" || tab === "all") && (
              <Th label="Комментарий" k="comment" width={widthOf("comment")} {...thProps} />
            )}
            {tab === "leads" && <Th label="Канал" k="channel" width={widthOf("channel")} {...thProps} />}
            {tab === "leads" && <Th label="Дата создания" k="created" width={widthOf("created")} {...thProps} />}
            {(tab === "leads" || tab === "potential" || tab === "nontarget" || tab === "active") && (
              <Th label="Ответственный" k="assigned" width={widthOf("assigned")} {...thProps} />
            )}
            {(tab === "active" || tab === "churned") && <TableHead className="w-[40px]"></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((r) => (
            <TableRow key={r.id}>
              {(tab === "leads" || tab === "potential") && (
                <TableCell>
                  <CreateApplicationDialog clientId={r.id} wards={r.wards} variant="ghost" size="sm" triggerLabel="" />
                </TableCell>
              )}
              {tab === "all" && <TableCell className="text-xs">{stateLabel(r)}</TableCell>}
              <TableCell>
                {/* Бадж стадии — actionable-индикатор: он не должен клипаться
                    при узкой колонке, обрезается ФИО (flex + shrink-0). */}
                <div className="flex items-center gap-2 overflow-hidden">
                  <Link
                    href={`/crm/clients/${r.id}`}
                    className="truncate font-medium hover:underline"
                    title={fullName(r)}
                  >
                    {fullName(r)}
                  </Link>
                  {r.topSalesStage && (() => {
                    const b = SALES_STAGE_BADGE[r.topSalesStage]
                    return (
                      <Link
                        href={b.href}
                        title={b.title}
                        className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${b.className}`}
                      >
                        {b.label}
                      </Link>
                    )
                  })()}
                </div>
              </TableCell>
              <TableCell className="text-sm">{r.phone || "—"}</TableCell>
              <TableCell className="text-sm">
                {r.socialLink ? (
                  <a
                    href={r.socialLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {r.socialLink}
                  </a>
                ) : (
                  "—"
                )}
              </TableCell>
              {(tab === "churned" || tab === "archived" || tab === "blacklist") && (
                <TableCell className="text-sm">{firstWardBirth(r.wards)}</TableCell>
              )}
              {(tab === "leads" ||
                tab === "potential" ||
                tab === "nontarget" ||
                tab === "active" ||
                tab === "all") && (
                <TableCell className="text-sm" title={wardsLabel(r.wards)}>{wardsLabel(r.wards)}</TableCell>
              )}
              {tab === "active" && <TableCell className="text-xs">{SEGMENT_LABELS[r.segment] || "—"}</TableCell>}
              <TableCell className="text-sm">{r.branchName || "—"}</TableCell>
              {tab === "active" && (
                <TableCell className="text-sm">{r.activeSubscription?.directionName || "—"}</TableCell>
              )}
              {tab === "active" && (
                <TableCell className="text-sm" title={r.activeSubscription?.groupName || undefined}>
                  {r.activeSubscription?.groupName || "—"}
                </TableCell>
              )}
              {tab === "active" && (
                <TableCell className="text-sm">{r.activeSubscription?.instructor.name || "—"}</TableCell>
              )}
              {(tab === "leads" || tab === "potential" || tab === "active" || tab === "churned") && (
                <TableCell>
                  <EditableDateCell
                    initialValue={r.nextContactDate ? r.nextContactDate.slice(0, 10) : ""}
                    endpoint={{ url: `/api/clients/${r.id}`, field: "nextContactDate" }}
                  />
                </TableCell>
              )}
              {(tab === "leads" || tab === "potential" || tab === "nontarget" || tab === "active" || tab === "all") && (
                <TableCell>
                  <EditableTextCell
                    initialValue={r.comment}
                    endpoint={{ url: `/api/clients/${r.id}`, field: "comment" }}
                  />
                </TableCell>
              )}
              {tab === "leads" && <TableCell className="text-sm">{r.channelName || "—"}</TableCell>}
              {tab === "leads" && <TableCell className="text-sm">{fmtDate(r.createdAt)}</TableCell>}
              {(tab === "leads" || tab === "potential" || tab === "nontarget" || tab === "active") && (
                <TableCell>
                  <EditableSelectCell
                    initialValue={r.assignedTo}
                    options={employeeOptions}
                    endpoint={{ url: `/api/clients/${r.id}`, field: "assignedTo" }}
                    placeholder="Не назначен"
                  />
                </TableCell>
              )}
              {(tab === "active" || tab === "churned") && (
                <TableCell>
                  <CreateApplicationDialog clientId={r.id} wards={r.wards} variant="ghost" size="sm" triggerLabel="" />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </StickyHScroll>
    </>
  )
}
