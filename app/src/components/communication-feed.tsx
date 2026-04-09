"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { MessageSquare, Phone, PhoneIncoming, PhoneOutgoing, Mail, Send, StickyNote } from "lucide-react"

interface Communication {
  id: string
  type: string
  channel: string
  direction: string
  content: string | null
  metadata: any
  createdAt: string
  employee: { id: string; firstName: string; lastName: string } | null
}

const TYPE_CONFIG: Record<string, { label: string; icon: typeof StickyNote; color: string }> = {
  note: { label: "Заметка", icon: StickyNote, color: "text-blue-600 bg-blue-50" },
  call_incoming: { label: "Входящий звонок", icon: PhoneIncoming, color: "text-green-600 bg-green-50" },
  call_outgoing: { label: "Исходящий звонок", icon: PhoneOutgoing, color: "text-orange-600 bg-orange-50" },
  whatsapp_incoming: { label: "WhatsApp (входящее)", icon: MessageSquare, color: "text-green-600 bg-green-50" },
  whatsapp_outgoing: { label: "WhatsApp (исходящее)", icon: MessageSquare, color: "text-green-700 bg-green-50" },
  sms_outgoing: { label: "SMS", icon: Mail, color: "text-purple-600 bg-purple-50" },
  email_outgoing: { label: "Email", icon: Mail, color: "text-indigo-600 bg-indigo-50" },
  task_result: { label: "Результат задачи", icon: StickyNote, color: "text-gray-600 bg-gray-50" },
  call_campaign_result: { label: "Обзвон", icon: Phone, color: "text-amber-600 bg-amber-50" },
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
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

export function CommunicationFeed({ clientId }: { clientId: string }) {
  const [communications, setCommunications] = useState<Communication[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [noteText, setNoteText] = useState("")
  const [saving, setSaving] = useState(false)
  const [offset, setOffset] = useState(0)
  const limit = 20

  const load = useCallback(async (reset = false) => {
    const currentOffset = reset ? 0 : offset
    try {
      const res = await fetch(`/api/clients/${clientId}/communications?limit=${limit}&offset=${currentOffset}`)
      if (res.ok) {
        const data = await res.json()
        if (reset) {
          setCommunications(data.communications)
          setOffset(0)
        } else {
          setCommunications(data.communications)
        }
        setTotal(data.total)
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [clientId, offset])

  useEffect(() => { load(true) }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAddNote() {
    if (!noteText.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteText.trim() }),
      })
      if (res.ok) {
        setNoteText("")
        setOffset(0)
        load(true)
      }
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  const hasMore = offset + limit < total

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Коммуникации ({total})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add note */}
        <div className="space-y-2">
          <Textarea
            placeholder="Добавить заметку..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={2}
            className="resize-none"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleAddNote}
              disabled={saving || !noteText.trim()}
            >
              <Send className="mr-1 size-3.5" />
              {saving ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>

        {/* Feed */}
        {loading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Загрузка...</p>
        ) : communications.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Нет коммуникаций</p>
        ) : (
          <div className="space-y-3">
            {communications.map((c) => {
              const config = TYPE_CONFIG[c.type] || TYPE_CONFIG.note
              const Icon = config.icon
              const employeeName = c.employee
                ? [c.employee.lastName, c.employee.firstName].filter(Boolean).join(" ")
                : null
              const duration = c.metadata?.duration

              return (
                <div key={c.id} className="flex gap-3">
                  <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${config.color}`}>
                    <Icon className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{config.label}</span>
                      {employeeName && <span>· {employeeName}</span>}
                      <span>{formatDateTime(c.createdAt)}</span>
                      {duration != null && (
                        <span className="text-xs">· {formatDuration(duration)}</span>
                      )}
                    </div>
                    {c.content && (
                      <p className="mt-0.5 text-sm whitespace-pre-wrap">{c.content}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Load more */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOffset((prev) => prev + limit)
                load()
              }}
            >
              Показать ещё
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
