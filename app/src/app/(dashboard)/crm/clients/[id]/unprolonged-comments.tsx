"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, MessageSquare, Send } from "lucide-react"

interface UnprolongedSubscription {
  id: string
  directionName: string
  groupName: string
  periodMonth: number
  periodYear: number
}

interface UnprolongedComment {
  id: string
  subscriptionId: string
  comment: string
  authorName: string
  createdAt: string
}

const MONTH_NAMES = [
  "", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function UnprolongedCommentsSection({ clientId }: { clientId: string }) {
  const [subscriptions, setSubscriptions] = useState<UnprolongedSubscription[]>([])
  const [comments, setComments] = useState<UnprolongedComment[]>([])
  const [loading, setLoading] = useState(true)
  const [newComment, setNewComment] = useState("")
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/unprolonged`)
      if (res.ok) {
        const data = await res.json()
        setSubscriptions(data.subscriptions || [])
        setComments(data.comments || [])
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [clientId])

  useEffect(() => { loadData() }, [loadData])

  async function handleSubmit() {
    if (!newComment.trim() || !selectedSubId) return

    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/unprolonged-comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriptionId: selectedSubId,
          comment: newComment.trim(),
        }),
      })

      if (res.ok) {
        setNewComment("")
        loadData()
      }
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  if (loading) return null
  if (subscriptions.length === 0) return null

  return (
    <Card className="border-orange-200 dark:border-orange-800">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-orange-500" />
          <CardTitle className="text-base">Непродлённые абонементы</CardTitle>
          <Badge variant="destructive" className="ml-auto">
            {subscriptions.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* List of unprolonged subscriptions */}
        <div className="space-y-2">
          {subscriptions.map(sub => (
            <div
              key={sub.id}
              className={`flex items-center justify-between rounded-md border p-3 cursor-pointer transition-colors ${
                selectedSubId === sub.id
                  ? "border-primary bg-primary/5"
                  : "hover:bg-accent"
              }`}
              onClick={() => setSelectedSubId(sub.id === selectedSubId ? null : sub.id)}
            >
              <div>
                <span className="font-medium">{sub.directionName}</span>
                <span className="text-muted-foreground"> · {sub.groupName}</span>
              </div>
              <Badge variant="outline">
                {MONTH_NAMES[sub.periodMonth]} {sub.periodYear}
              </Badge>
            </div>
          ))}
        </div>

        {/* Comments */}
        {comments.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <MessageSquare className="size-3.5" />
              <span>Комментарии ({comments.length})</span>
            </div>
            <div className="space-y-2">
              {comments.map(c => (
                <div key={c.id} className="rounded-md bg-muted/50 p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{c.authorName}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(c.createdAt)}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{c.comment}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add comment */}
        {selectedSubId && (
          <div className="flex gap-2">
            <textarea
              className="flex-1 min-h-[60px] rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              placeholder="Комментарий к непродлённому абонементу..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
            />
            <Button
              size="icon"
              className="shrink-0 self-end"
              onClick={handleSubmit}
              disabled={saving || !newComment.trim()}
            >
              <Send className="size-4" />
            </Button>
          </div>
        )}

        {!selectedSubId && (
          <p className="text-xs text-muted-foreground text-center">
            Выберите абонемент, чтобы добавить комментарий
          </p>
        )}
      </CardContent>
    </Card>
  )
}
