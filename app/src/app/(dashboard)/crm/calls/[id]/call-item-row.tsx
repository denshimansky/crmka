"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { TableCell } from "@/components/ui/table"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Phone, Check } from "lucide-react"
import { CreateApplicationDialog } from "@/app/(dashboard)/crm/_components/create-application-dialog"

export interface CallItem {
  id: string
  clientId: string
  clientName: string
  phone: string
  wardName: string
  /** Возраст в полных месяцах — на будущее (сортировка колонки убрана). */
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
  /** Подопечные для кнопки «Создать заявку» (для строки — обычно один этот подопечный). */
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

/** Коды результата обзвона → метки для отображения в строке. */
const RESULT_LABELS: Record<string, string> = {
  application: "Создана заявка",
  // Дозвонились, но клиент/ребёнок уже записан — новую заявку не оформляем.
  enrolled_earlier: "Записан ранее",
  trial_scheduled: "Записан на пробное",
  sale: "Продажа",
  no_answer: "Не дозвонились",
  refused: "Отказ",
}

/** Текст ячейки «Комментарий»: сначала комментарий, иначе метка результата. */
function commentText(item: CallItem): string {
  if (item.comment) return item.comment
  if (item.result) return RESULT_LABELS[item.result] ?? item.result
  return "—"
}

/**
 * Метка колонки «Статус». Исходы «Создать заявку» и «Записан ранее» технически
 * сохраняются с одним статусом called (метка «Обзвонен»), а различаются только
 * полем result. Чтобы в колонке была видна реальная выбранная отметка (а не общее
 * «Обзвонен»), для обработанных строк с известным result предпочитаем метку исхода.
 */
function statusLabel(item: CallItem): string {
  if (item.status === "called" && item.result) {
    return RESULT_LABELS[item.result] ?? "Обзвонен"
  }
  return CALL_STATUS_LABELS[item.status] || item.status
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  called: "secondary",
  no_answer: "destructive",
  callback: "default",
  // «Отказ» (баг #117) — нейтральное оформление (outline), а не акцентная заливка.
  completed: "outline",
}

/**
 * Ячейки строки-подопечного внутри кампании обзвона (без ячеек клиента — их
 * рисует группа с rowSpan). Каждый подопечный обрабатывается независимо;
 * фиксация результата — во всплывающем Popover над кнопкой «Результат» (форма
 * больше НЕ разворачивается отдельной строкой, чтобы не рвать rowSpan клиента).
 */
export function WardResultCells({
  item,
  campaignId,
  readOnly = false,
}: {
  item: CallItem
  campaignId: string
  readOnly?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [comment, setComment] = useState(item.comment || "")
  // «Перезвонить» → выбор даты следующей связи (баг #82).
  const [callbackOpen, setCallbackOpen] = useState(false)
  const [callbackDate, setCallbackDate] = useState("")

  const done = item.status !== "pending"
  const dim = done ? "opacity-60" : ""

  async function saveResult(status: string, extra?: Record<string, unknown>) {
    setLoading(true)
    try {
      await fetch(`/api/call-campaigns/${campaignId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, status, comment, ...extra }),
      })
      setOpen(false)
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
  // «Эффективность обзвонов». Существующий комментарий не трогаем.
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
      setOpen(false)
      router.refresh()
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  return (
    <>
      <TableCell className={`text-muted-foreground text-xs ${dim}`}>{item.wardName || "—"}</TableCell>
      <TableCell className={`text-muted-foreground text-xs ${dim}`}>{item.ageLabel || "—"}</TableCell>
      <TableCell className={dim}>
        <Badge variant={STATUS_VARIANTS[item.status] || "outline"}>
          {statusLabel(item)}
        </Badge>
      </TableCell>
      <TableCell className={`whitespace-nowrap text-muted-foreground text-xs ${dim}`}>
        {item.processedAt ? new Date(item.processedAt).toLocaleDateString("ru-RU") : "—"}
      </TableCell>
      <TableCell className={`text-muted-foreground text-xs ${dim}`}>{item.responsibleName || "—"}</TableCell>
      <TableCell className={`max-w-[220px] truncate text-muted-foreground ${dim}`}>{commentText(item)}</TableCell>
      <TableCell>
        {item.status !== "pending" ? (
          <Check className="size-4 text-green-500" />
        ) : readOnly ? (
          <Button size="sm" variant="outline" disabled title="Кампания в архиве — только просмотр">
            <Phone className="mr-1 size-3" />
            Результат
          </Button>
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={<Button size="sm" variant="outline" />}>
              <Phone className="mr-1 size-3" />
              Результат
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">
                  {item.wardName ? `Подопечный: ${item.wardName}` : "Результат звонка"}
                </div>
                <Input
                  placeholder="Комментарий"
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  className="h-8"
                />
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => saveResult("no_answer")} disabled={loading}>Не ответил</Button>
                  <Button size="sm" variant={callbackOpen ? "secondary" : "outline"} onClick={openCallback} disabled={loading}>Перезвонить</Button>
                  <Button size="sm" variant="outline" onClick={() => saveResult("completed")} disabled={loading}>Отказ</Button>
                </div>
                <div className="flex flex-wrap gap-1.5 border-t pt-2">
                  <CreateApplicationDialog
                    clientId={item.clientId}
                    wards={item.wards}
                    callCampaignItemId={item.id}
                    variant="default"
                    size="sm"
                    triggerLabel="Создать заявку"
                    onCreated={markApplicationCreated}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => saveResult("called", { result: "enrolled_earlier" })}
                    disabled={loading}
                  >
                    Записан ранее
                  </Button>
                </div>
                {callbackOpen && (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                    <span className="text-xs text-muted-foreground">Дата следующей связи:</span>
                    <Input
                      type="date"
                      value={callbackDate}
                      onChange={e => setCallbackDate(e.target.value)}
                      className="h-8 max-w-[160px]"
                    />
                    <Button size="sm" onClick={() => saveResult("callback", { callbackDate })} disabled={loading || !callbackDate}>
                      Сохранить
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCallbackOpen(false)} disabled={loading}>
                      Отмена
                    </Button>
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </TableCell>
    </>
  )
}
