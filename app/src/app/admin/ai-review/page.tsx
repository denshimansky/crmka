"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Download, MessagesSquare, RefreshCw, ArrowRight } from "lucide-react"

interface Dialog {
  id: string
  org: string
  userName: string | null
  userRole: string | null
  provider: string
  model: string
  message: string
  reply: string
  feedback: string | null
  createdAt: string
}
interface Stats { total: number; likes: number; dislikes: number }

// Локальная дата YYYY-MM-DD (без сдвига часового пояса).
function localISO(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

const roleLabel = (r: string | null) =>
  r === "owner" ? "владелец" : r === "manager" ? "управляющий" : r || "—"

export default function AdminAiReviewPage() {
  const router = useRouter()
  const today = localISO(new Date())
  const weekAgo = localISO(new Date(Date.now() - 6 * 24 * 3600 * 1000))

  const [from, setFrom] = useState(weekAgo)
  const [to, setTo] = useState(today)
  const [onlyDisliked, setOnlyDisliked] = useState(false)
  const [dialogs, setDialogs] = useState<Dialog[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [matched, setMatched] = useState(0)
  const [previewLimit, setPreviewLimit] = useState(300)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const queryString = useCallback(
    () => `from=${from}&to=${to}${onlyDisliked ? "&onlyDisliked=1" : ""}`,
    [from, to, onlyDisliked],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/admin/ai-review?${queryString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Ошибка запроса")
      setDialogs(Array.isArray(data.dialogs) ? data.dialogs : [])
      setStats(data.stats || null)
      setMatched(typeof data.matched === "number" ? data.matched : 0)
      setPreviewLimit(data.previewLimit || 300)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
    } finally {
      setLoading(false)
    }
  }, [queryString])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Перенос диалога в базу знаний ИИ — через sessionStorage, а не через URL:
  // длинные кириллические ответы (×6 при encodeURIComponent) не влезают в query
  // string и ловят 414 на nginx. Форму /admin/ai-faq предзаполняем при монтировании.
  const goToFaq = (d: Dialog) => {
    try {
      sessionStorage.setItem("ai-faq-prefill", JSON.stringify({ q: d.message, a: d.reply, log: d.id }))
    } catch {
      // приватный режим / переполнение — просто откроем пустую форму
    }
    router.push("/admin/ai-faq")
  }

  // Усечение и доступность экспорта — по matched (учитывает фильтр onlyDisliked),
  // а не по stats.total (это разбивка по всему периоду для сводки).
  const canDownload = !loading && matched > 0
  const truncated = matched > dialogs.length

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <MessagesSquare className="size-6 text-orange-600" />
          ИИ: разбор диалогов
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Вопросы и ответы ИИ-помощника за период. Скачайте выгрузку, разберите (верно/наврал),
          а факты перенесите в раздел «ИИ: база знаний» — кнопкой «В базу знаний» у диалога.
        </p>
      </div>

      {/* Фильтры */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="space-y-1.5">
          <Label className="text-xs">С</Label>
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">По</Label>
          <Input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <Checkbox checked={onlyDisliked} onCheckedChange={(v) => setOnlyDisliked(!!v)} />
          Только 👎 «не помогло»
        </label>
        <Button onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />
          Показать
        </Button>
        {canDownload ? (
          <a href={`/api/admin/ai-review/export?${queryString()}`}>
            <Button variant="outline">
              <Download className="mr-2 size-4" />
              Скачать .md
            </Button>
          </a>
        ) : (
          <Button variant="outline" disabled>
            <Download className="mr-2 size-4" />
            Скачать .md
          </Button>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {/* Сводка по всему периоду */}
      {stats && (
        <div className="mb-4 flex flex-wrap gap-3">
          <StatCard label="Всего диалогов" value={stats.total} />
          <StatCard label="👍 полезно" value={stats.likes} />
          <StatCard label="👎 не помогло" value={stats.dislikes} />
        </div>
      )}

      {truncated && (
        <p className="mb-3 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          На экране показаны первые {previewLimit} из {matched}. Полная выгрузка — в файле «Скачать .md».
        </p>
      )}

      {/* Список диалогов */}
      {loading ? (
        <div className="text-muted-foreground">Загрузка...</div>
      ) : dialogs.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          За выбранный период диалогов нет.
        </div>
      ) : (
        <div className="space-y-2">
          {dialogs.map((d) => (
            <div key={d.id} className="rounded-lg border p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{d.org}</Badge>
                <span>{roleLabel(d.userRole)}</span>
                <span>·</span>
                <span>{new Date(d.createdAt).toLocaleString("ru-RU")}</span>
                {d.feedback === "like" && <Badge className="bg-green-600">👍 полезно</Badge>}
                {d.feedback === "dislike" && <Badge variant="destructive">👎 не помогло</Badge>}
                <Button
                  variant="ghost" size="sm"
                  className="ml-auto h-7 gap-1 text-xs"
                  onClick={() => goToFaq(d)}
                >
                  В базу знаний <ArrowRight className="size-3" />
                </Button>
              </div>
              <p className="text-sm font-medium">В: {d.message}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">О: {d.reply}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="text-2xl font-bold">{value.toLocaleString("ru-RU")}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
