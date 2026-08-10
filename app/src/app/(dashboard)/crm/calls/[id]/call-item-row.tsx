"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { TableCell, TableRow } from "@/components/ui/table"
import { Phone, Check } from "lucide-react"
import Link from "next/link"
import { CreateApplicationDialog } from "@/app/(dashboard)/crm/_components/create-application-dialog"

export interface CallItem {
  id: string
  clientId: string
  clientName: string
  phone: string
  wardName: string
  /** Возраст в полных месяцах — ключ сортировки колонки «Возраст» (с точностью до месяца). */
  ageMonths: number | null
  /** Метка возраста с месяцами («5 лет 3 мес.») — для отображения. */
  ageLabel: string | null
  clientStatusLabel: string
  status: string
  comment: string | null
  result: string | null
  /** Дата фиксации результата (ISO) — колонка «Дата обработки». null, если не обзвонен. */
  processedAt: string | null
  /** Кто зафиксировал результат — колонка «Ответственный». Пусто, если не обзвонен. */
  responsibleName: string
  /** Подопечные клиента — для кнопки «Создать заявку» прямо из обзвона. */
  wards: { id: string; firstName: string; lastName: string | null }[]
}

export const CALL_STATUS_LABELS: Record<string, string> = {
  pending: "Не обзвонен",
  called: "Обзвонен",
  no_answer: "Не ответил",
  callback: "Перезвонить",
  // Исход «completed» — это отказ клиента (баг #117). Внутренний код статуса
  // оставлен прежним (completed), меняется только метка и оформление.
  completed: "Отказ",
}
const STATUS_LABELS = CALL_STATUS_LABELS

/** Коды результата обзвона → метки для отображения в строке. */
const RESULT_LABELS: Record<string, string> = {
  application: "Создана заявка",
  trial_scheduled: "Записан на пробное",
  sale: "Продажа",
  no_answer: "Не дозвонились",
  refused: "Отказ",
}

/**
 * Ключ сортировки колонки «Комментарий» — та же логика, что рисует ячейка
 * (commentText), но без плейсхолдера «—»: чтобы порядок строк совпадал с видимым
 * текстом (метка результата, а не сырой код), а пустые уходили в конец списка.
 */
export function commentSortKey(item: CallItem): string {
  if (item.comment) return item.comment
  if (item.result) return RESULT_LABELS[item.result] ?? item.result
  return ""
}

/** Текст ячейки «Комментарий»: сначала комментарий, иначе метка результата. */
function commentText(item: CallItem): string {
  return commentSortKey(item) || "—"
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  called: "secondary",
  no_answer: "destructive",
  callback: "default",
  // «Отказ» (баг #117) — нейтральное оформление, как у кнопок «Не ответил»/
  // «Перезвонить» (outline), а не акцентная заливка.
  completed: "outline",
}

export function CallItemRow({
  item,
  campaignId,
  readOnly = false,
}: {
  item: CallItem
  campaignId: string
  readOnly?: boolean
}) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [comment, setComment] = useState(item.comment || "")
  const [result, setResult] = useState("")
  // «Перезвонить» → выбор даты следующей связи (баг #82).
  const [callbackOpen, setCallbackOpen] = useState(false)
  const [callbackDate, setCallbackDate] = useState("")

  async function saveResult(status: string, extra?: Record<string, unknown>) {
    setLoading(true)
    try {
      await fetch(`/api/call-campaigns/${campaignId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, status, comment, result, ...extra }),
      })
      setShowForm(false)
      setCallbackOpen(false)
      router.refresh()
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  // По умолчанию предлагаем завтрашнюю дату для повторного звонка.
  function openCallback() {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    setCallbackDate(d.toISOString().slice(0, 10))
    setCallbackOpen(true)
  }

  // Заявка создана прямо из обзвона: помечаем контакт обработанным и ставим
  // result="application" — так звонок попадает в столбец «Заявки» отчёта
  // «Эффективность обзвонов». Существующий комментарий не трогаем (undefined в
  // PATCH → Prisma пропускает поле).
  async function markApplicationCreated() {
    setLoading(true)
    try {
      await fetch(`/api/call-campaigns/${campaignId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          status: item.status === "pending" ? "called" : item.status,
          comment: comment || undefined,
          result: "application",
        }),
      })
      setShowForm(false)
      router.refresh()
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  return (
    <>
      <TableRow className={item.status !== "pending" ? "opacity-60" : ""}>
        <TableCell>
          <Link href={`/crm/clients/${item.clientId}`} className="font-medium text-primary hover:underline">
            {item.clientName}
          </Link>
        </TableCell>
        <TableCell className="text-muted-foreground">{item.phone || "—"}</TableCell>
        <TableCell className="text-muted-foreground text-xs">{item.wardName || "—"}</TableCell>
        <TableCell className="text-muted-foreground text-xs">{item.ageLabel || "—"}</TableCell>
        <TableCell className="text-muted-foreground text-xs">{item.clientStatusLabel || "—"}</TableCell>
        <TableCell>
          <Badge variant={STATUS_VARIANTS[item.status] || "outline"}>
            {STATUS_LABELS[item.status] || item.status}
          </Badge>
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
          {item.processedAt ? new Date(item.processedAt).toLocaleDateString("ru-RU") : "—"}
        </TableCell>
        <TableCell className="text-muted-foreground text-xs">{item.responsibleName || "—"}</TableCell>
        <TableCell className="max-w-[200px] truncate text-muted-foreground">{commentText(item)}</TableCell>
        <TableCell>
          {item.status === "pending" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={readOnly}
              title={readOnly ? "Кампания в архиве — только просмотр" : undefined}
              onClick={() => setShowForm(!showForm)}
            >
              <Phone className="mr-1 size-3" />
              Результат
            </Button>
          ) : (
            <Check className="size-4 text-green-500" />
          )}
        </TableCell>
      </TableRow>
      {showForm && (
        <TableRow>
          <TableCell colSpan={10}>
            <div className="flex flex-wrap items-center gap-2 py-1">
              <Input
                placeholder="Комментарий"
                value={comment}
                onChange={e => setComment(e.target.value)}
                className="max-w-[200px]"
              />
              <Button size="sm" variant="outline" onClick={() => saveResult("no_answer")} disabled={loading}>Не ответил</Button>
              <Button size="sm" variant={callbackOpen ? "secondary" : "outline"} onClick={openCallback} disabled={loading}>Перезвонить</Button>
              <Button size="sm" variant="outline" onClick={() => saveResult("completed")} disabled={loading}>Отказ</Button>
              <span className="mx-1 h-5 w-px bg-border" aria-hidden />
              <CreateApplicationDialog
                clientId={item.clientId}
                wards={item.wards}
                callCampaignItemId={item.id}
                variant="default"
                size="sm"
                triggerLabel="Создать заявку"
                onCreated={markApplicationCreated}
              />
              {callbackOpen && (
                <div className="flex w-full flex-wrap items-center gap-2 border-t pt-2">
                  <span className="text-xs text-muted-foreground">Дата следующей связи:</span>
                  <Input
                    type="date"
                    value={callbackDate}
                    onChange={e => setCallbackDate(e.target.value)}
                    className="max-w-[170px]"
                  />
                  <Button
                    size="sm"
                    onClick={() => saveResult("callback", { callbackDate })}
                    disabled={loading || !callbackDate}
                  >
                    Сохранить
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCallbackOpen(false)} disabled={loading}>
                    Отмена
                  </Button>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
