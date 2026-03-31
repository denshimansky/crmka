"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { TableCell, TableRow } from "@/components/ui/table"
import { Phone, Check } from "lucide-react"
import Link from "next/link"

interface CallItem {
  id: string
  clientId: string
  clientName: string
  phone: string
  wardInfo: string
  status: string
  comment: string | null
  result: string | null
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Не обзвонен",
  called: "Обзвонен",
  no_answer: "Не ответил",
  callback: "Перезвонить",
  completed: "Завершён",
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  called: "secondary",
  no_answer: "destructive",
  callback: "default",
  completed: "default",
}

export function CallItemRow({ item, campaignId }: { item: CallItem; campaignId: string }) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [comment, setComment] = useState(item.comment || "")
  const [result, setResult] = useState("")

  async function saveResult(status: string) {
    setLoading(true)
    try {
      await fetch(`/api/call-campaigns/${campaignId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, status, comment, result }),
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
        <TableCell className="text-muted-foreground">{item.phone}</TableCell>
        <TableCell className="text-muted-foreground text-xs">{item.wardInfo}</TableCell>
        <TableCell>
          <Badge variant={STATUS_VARIANTS[item.status] || "outline"}>
            {STATUS_LABELS[item.status] || item.status}
          </Badge>
        </TableCell>
        <TableCell className="max-w-[200px] truncate text-muted-foreground">{item.comment || item.result || "—"}</TableCell>
        <TableCell>
          {item.status === "pending" ? (
            <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
              <Phone className="mr-1 size-3" />
              Позвонить
            </Button>
          ) : (
            <Check className="size-4 text-green-500" />
          )}
        </TableCell>
      </TableRow>
      {showForm && (
        <TableRow>
          <TableCell colSpan={6}>
            <div className="flex items-center gap-2 py-1">
              <Input
                placeholder="Комментарий"
                value={comment}
                onChange={e => setComment(e.target.value)}
                className="max-w-[200px]"
              />
              <Button size="sm" onClick={() => saveResult("called")} disabled={loading}>Обзвонен</Button>
              <Button size="sm" variant="outline" onClick={() => saveResult("no_answer")} disabled={loading}>Не ответил</Button>
              <Button size="sm" variant="outline" onClick={() => saveResult("callback")} disabled={loading}>Перезвонить</Button>
              <Button size="sm" variant="secondary" onClick={() => saveResult("completed")} disabled={loading}>Завершён</Button>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
