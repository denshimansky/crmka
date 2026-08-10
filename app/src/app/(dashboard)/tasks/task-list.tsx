"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Trash2 } from "lucide-react"
import Link from "next/link"

export interface TaskRow {
  id: string
  title: string
  description: string | null
  type: string
  autoTrigger: string | null
  status: string
  dueDate: string
  completedAt: string | null
  completedByName: string | null
  assigneeName: string
  clientId: string | null
  clientName: string | null
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const TRIGGER_LABELS: Record<string, string> = {
  contact_date: "Контакт",
  trial_reminder: "Пробное",
  payment_due: "Оплата",
  birthday: "ДР",
  absence: "Прогул",
  promised_payment: "Обещание",
  unmarked_lesson: "Отметка",
  no_show_review: "Не был",
  first_paid_reminder: "1-е платное",
  missed_makeup: "Отработка",
}

function typeLabel(t: TaskRow): string {
  if (t.type === "auto") return TRIGGER_LABELS[t.autoTrigger || ""] || "Авто"
  return "Ручная"
}

export function TaskList({
  tasks,
  canDelete = true,
  canViewClients = true,
  showCompletedColumns = false,
  emptyLabel = "Нет задач",
}: {
  tasks: TaskRow[]
  /** Удаление задач — только у управленческих ролей (инструктор не удаляет). */
  canDelete?: boolean
  /** Ссылка на карточку клиента — только у тех, кто видит клиентов (не инструктор). */
  canViewClients?: boolean
  /** Показывать колонки «Дата выполнения» и «Кто выполнил» (вкладка «Выполненные»). */
  showCompletedColumns?: boolean
  /** Текст, когда список пуст (зависит от активной вкладки). */
  emptyLabel?: string
}) {
  const router = useRouter()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmTitle, setConfirmTitle] = useState<string>("")
  const [deleting, setDeleting] = useState(false)
  const [detail, setDetail] = useState<TaskRow | null>(null)
  // Диалог результата при выполнении клиентской задачи (баг #117): результат
  // уходит в ленту коммуникаций клиента как «Результат задачи».
  const [completeTarget, setCompleteTarget] = useState<TaskRow | null>(null)
  const [resultText, setResultText] = useState("")
  const [completing, setCompleting] = useState(false)

  async function patchStatus(id: string, status: string, result?: string) {
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(result ? { result } : {}) }),
    })
    router.refresh()
  }

  function onToggle(t: TaskRow) {
    // Снять отметку «выполнено» — сразу, без диалога.
    if (t.status === "completed") {
      patchStatus(t.id, "pending")
      return
    }
    // Клиентская задача — предложить записать результат в коммуникацию клиента.
    if (t.clientId) {
      setResultText("")
      setCompleteTarget(t)
      return
    }
    // Задача без клиента — результату некуда попасть, закрываем сразу.
    patchStatus(t.id, "completed")
  }

  async function confirmComplete() {
    if (!completeTarget) return
    setCompleting(true)
    try {
      await patchStatus(completeTarget.id, "completed", resultText.trim() || undefined)
      setCompleteTarget(null)
    } finally {
      setCompleting(false)
    }
  }

  function askDelete(t: TaskRow) {
    setConfirmId(t.id)
    setConfirmTitle(t.title)
  }

  async function confirmDelete() {
    if (!confirmId) return
    setDeleting(true)
    try {
      await fetch(`/api/tasks/${confirmId}`, { method: "DELETE" })
      setConfirmId(null)
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  if (tasks.length === 0) {
    return <p className="py-8 text-center text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"></TableHead>
            <TableHead>Задача</TableHead>
            <TableHead>Тип</TableHead>
            <TableHead>Клиент</TableHead>
            <TableHead>Исполнитель</TableHead>
            <TableHead>Срок</TableHead>
            {showCompletedColumns && <TableHead>Дата выполнения</TableHead>}
            {showCompletedColumns && <TableHead>Кто выполнил</TableHead>}
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((t) => (
            <TableRow
              key={t.id}
              onClick={() => setDetail(t)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  setDetail(t)
                }
              }}
              tabIndex={0}
              className={`cursor-pointer ${t.status === "completed" ? "opacity-50" : ""}`}
            >
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={t.status === "completed"}
                  onCheckedChange={() => onToggle(t)}
                />
              </TableCell>
              <TableCell className={`font-medium ${t.status === "completed" ? "line-through" : ""}`}>
                <div className="max-w-[320px] truncate" title={t.title}>{t.title}</div>
              </TableCell>
              <TableCell>
                {t.type === "auto" ? (
                  <Badge variant="secondary" className="text-xs">
                    {typeLabel(t)}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">Ручная</Badge>
                )}
              </TableCell>
              <TableCell>
                {t.clientId && t.clientName ? (
                  canViewClients ? (
                    <Link
                      href={`/crm/clients/${t.clientId}`}
                      className="text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.clientName}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{t.clientName}</span>
                  )
                ) : "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">{t.assigneeName}</TableCell>
              <TableCell className="text-muted-foreground">{formatDate(t.dueDate)}</TableCell>
              {showCompletedColumns && (
                <TableCell className="text-muted-foreground">
                  {t.completedAt ? formatDateTime(t.completedAt) : "—"}
                </TableCell>
              )}
              {showCompletedColumns && (
                <TableCell className="text-muted-foreground">{t.completedByName || "—"}</TableCell>
              )}
              <TableCell onClick={(e) => e.stopPropagation()}>
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => askDelete(t)}
                    title="Удалить задачу"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Просмотр задачи (описание и детали) */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null) }}>
        <DialogContent className="sm:max-w-lg">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="break-words">{detail.title}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Описание</p>
                  <p className="whitespace-pre-wrap break-words">
                    {detail.description || <span className="text-muted-foreground">Без описания</span>}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Тип</p>
                    <p>{typeLabel(detail)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Срок</p>
                    <p>{new Date(detail.dueDate).toLocaleDateString("ru-RU")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Исполнитель</p>
                    <p>{detail.assigneeName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Клиент</p>
                    <p>
                      {detail.clientId && detail.clientName ? (
                        canViewClients ? (
                          <Link href={`/crm/clients/${detail.clientId}`} className="text-primary hover:underline">
                            {detail.clientName}
                          </Link>
                        ) : (
                          detail.clientName
                        )
                      ) : "—"}
                    </p>
                  </div>
                  {detail.status === "completed" && (
                    <>
                      <div>
                        <p className="text-xs text-muted-foreground">Дата выполнения</p>
                        <p>{detail.completedAt ? formatDateTime(detail.completedAt) : "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Кто выполнил</p>
                        <p>{detail.completedByName || "—"}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setDetail(null)}>Закрыть</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Результат при выполнении клиентской задачи → «Результат задачи» в ленте */}
      <Dialog
        open={!!completeTarget}
        onOpenChange={(o) => { if (!o && !completing) setCompleteTarget(null) }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Выполнить задачу</DialogTitle>
            <DialogDescription className="break-words text-foreground">
              {completeTarget?.title}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Результат (необязательно)</Label>
            <Textarea
              value={resultText}
              onChange={(e) => setResultText(e.target.value)}
              placeholder="Например: дозвонились, договорились о продлении…"
              rows={3}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Сохранится в истории коммуникаций клиента как «Результат задачи».
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setCompleteTarget(null)} disabled={completing}>
              Отмена
            </Button>
            <Button type="button" onClick={confirmComplete} disabled={completing}>
              {completing ? "Сохранение..." : "Готово"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmId}
        onOpenChange={(o) => {
          if (!o) setConfirmId(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить задачу?</DialogTitle>
            <DialogDescription>
              {confirmTitle ? (
                <>
                  Задача <span className="font-medium text-foreground">«{confirmTitle}»</span> будет удалена. Действие
                  необратимо.
                </>
              ) : (
                "Задача будет удалена."
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setConfirmId(null)} disabled={deleting}>
              Отмена
            </Button>
            <Button variant="destructive" type="button" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Удаление..." : "Удалить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
