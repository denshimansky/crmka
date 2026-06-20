import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EditableDateCell, EditableTextCell } from "../_components/editable-cell"

// Ярлыки статусов совпадают с табами «Клиенты» (/crm/contacts) и подсказкой дублей.
const STATUS_LABELS: Record<string, string> = {
  new: "Лид",
  trial_scheduled: "Пробное записано",
  trial_attended: "Пробное пройдено",
  awaiting_payment: "Ожидание оплаты",
  active_client: "Активный",
  potential: "Потенциал",
  non_target: "Нецелевой",
  blacklisted: "Чёрный список",
  archived: "Архив",
}

export interface ContactWard {
  id: string
  name: string
}

export interface ContactRow {
  clientId: string
  name: string
  phone: string | null
  funnelStatus: string
  clientStatus: string | null
  nextContactDate: string // ISO
  comment: string | null
  wards: ContactWard[]
  assigneeName: string | null
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function statusLabel(funnelStatus: string, clientStatus: string | null): string {
  if (clientStatus === "churned") return "Выбывший"
  return STATUS_LABELS[funnelStatus] ?? funnelStatus
}

/** Вкладка «Связь» раздела «Продажи»: клиенты/лиды с назначенной датой связи.
 *  «След. связь» и «Комментарий» редактируются инлайн (PATCH /api/clients/[id]),
 *  кроме роли «только чтение». Очистка даты связи убирает клиента из вкладки. */
export function ContactTable({ rows, canEdit }: { rows: ContactRow[]; canEdit: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border p-12 text-center text-sm text-muted-foreground">
        Нет клиентов с назначенной датой связи
      </div>
    )
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Статус</TableHead>
            <TableHead>ФИО родителя</TableHead>
            <TableHead>Телефон</TableHead>
            <TableHead>Дети</TableHead>
            <TableHead>След. связь</TableHead>
            <TableHead>Комментарий</TableHead>
            <TableHead>Ответственный</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const overdue = new Date(r.nextContactDate) < today
            return (
              <TableRow key={r.clientId}>
                <TableCell>
                  <Badge variant="outline">{statusLabel(r.funnelStatus, r.clientStatus)}</Badge>
                </TableCell>
                <TableCell>
                  <Link href={`/crm/clients/${r.clientId}`} className="font-medium text-primary hover:underline">
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{r.phone || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.wards.length === 0
                    ? "—"
                    : r.wards.map((w, i) => (
                        <span key={w.id}>
                          {i > 0 && ", "}
                          <Link href={`/crm/wards/${w.id}`} className="text-primary hover:underline">
                            {w.name}
                          </Link>
                        </span>
                      ))}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {canEdit ? (
                    <div className="flex items-center gap-2">
                      <EditableDateCell
                        initialValue={r.nextContactDate.slice(0, 10)}
                        endpoint={{ url: `/api/clients/${r.clientId}`, field: "nextContactDate" }}
                      />
                      {overdue && <Badge variant="destructive" className="text-xs">просрочено</Badge>}
                    </div>
                  ) : (
                    <span className={overdue ? "font-medium text-red-600" : ""}>{fmtDate(r.nextContactDate)}</span>
                  )}
                </TableCell>
                <TableCell>
                  {canEdit ? (
                    <EditableTextCell
                      initialValue={r.comment}
                      endpoint={{ url: `/api/clients/${r.clientId}`, field: "comment" }}
                      rows={1}
                      className="min-h-[32px] w-[200px] resize-none text-xs"
                    />
                  ) : (
                    <span className="text-sm text-muted-foreground">{r.comment || "—"}</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.assigneeName || "—"}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
