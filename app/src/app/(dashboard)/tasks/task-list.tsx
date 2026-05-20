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
import { Trash2 } from "lucide-react"
import Link from "next/link"

interface TaskRow {
  id: string
  title: string
  type: string
  autoTrigger: string | null
  status: string
  dueDate: string
  assigneeName: string
  clientId: string | null
  clientName: string | null
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
}

const TRIGGER_LABELS: Record<string, string> = {
  contact_date: "Контакт",
  trial_reminder: "Пробное",
  payment_due: "Оплата",
  birthday: "ДР",
  absence: "Прогул",
  promised_payment: "Обещание",
  unmarked_lesson: "Отметка",
}

export function TaskList({ tasks }: { tasks: TaskRow[] }) {
  const router = useRouter()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmTitle, setConfirmTitle] = useState<string>("")
  const [deleting, setDeleting] = useState(false)

  async function toggleComplete(id: string, currentStatus: string) {
    const newStatus = currentStatus === "completed" ? "pending" : "completed"
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    })
    router.refresh()
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
    return <p className="py-8 text-center text-muted-foreground">Нет задач</p>
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
            <TableHead>Дата</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((t) => (
            <TableRow key={t.id} className={t.status === "completed" ? "opacity-50" : ""}>
              <TableCell>
                <Checkbox
                  checked={t.status === "completed"}
                  onCheckedChange={() => toggleComplete(t.id, t.status)}
                />
              </TableCell>
              <TableCell className={`font-medium ${t.status === "completed" ? "line-through" : ""}`}>
                {t.title}
              </TableCell>
              <TableCell>
                {t.type === "auto" ? (
                  <Badge variant="secondary" className="text-xs">
                    {TRIGGER_LABELS[t.autoTrigger || ""] || "Авто"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">Ручная</Badge>
                )}
              </TableCell>
              <TableCell>
                {t.clientId && t.clientName ? (
                  <Link href={`/crm/clients/${t.clientId}`} className="text-primary hover:underline">
                    {t.clientName}
                  </Link>
                ) : "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">{t.assigneeName}</TableCell>
              <TableCell className="text-muted-foreground">{formatDate(t.dueDate)}</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => askDelete(t)}
                  title="Удалить задачу"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

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
