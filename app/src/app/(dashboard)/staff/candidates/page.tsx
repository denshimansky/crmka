"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Plus, ArrowLeft } from "lucide-react"
import Link from "next/link"

interface Candidate {
  id: string
  firstName: string
  lastName: string
  middleName: string | null
  phone: string | null
  email: string | null
  candidateStatus: string | null
  interviewHistory: { date: string; comment: string }[] | null
  resumeUrl: string | null
  createdAt: string
}

const STATUS_LABELS: Record<string, string> = {
  NEW: "Новый",
  INTERVIEW: "Собеседование",
  TRIAL_DAY: "Пробный день",
  HIRED: "Принят",
  REJECTED: "Отклонён",
}

const STATUS_COLORS: Record<string, string> = {
  NEW: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  INTERVIEW: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  TRIAL_DAY: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  HIRED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export default function CandidatesPage() {
  const router = useRouter()
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>("")

  const load = useCallback(async () => {
    const url = filter ? `/api/candidates?status=${filter}` : "/api/candidates"
    const res = await fetch(url)
    if (res.ok) setCandidates(await res.json())
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    const res = await fetch("/api/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: fd.get("firstName"),
        lastName: fd.get("lastName"),
        phone: fd.get("phone"),
        email: fd.get("email"),
        comment: fd.get("comment"),
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Ошибка")
      setCreating(false)
      return
    }
    setCreateOpen(false)
    setCreating(false)
    load()
  }

  const filtered = candidates

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/staff">
            <Button variant="ghost" size="icon"><ArrowLeft className="size-4" /></Button>
          </Link>
          <h1 className="text-2xl font-bold">Кандидаты</h1>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4 mr-1" /> Новый кандидат
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button variant={filter === "" ? "default" : "outline"} size="sm" onClick={() => setFilter("")}>Все</Button>
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <Button key={key} variant={filter === key ? "default" : "outline"} size="sm" onClick={() => setFilter(key)}>
            {label}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Загрузка...</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет кандидатов
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ФИО</TableHead>
                  <TableHead>Телефон</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Дата создания</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/staff/candidates/${c.id}`)}
                  >
                    <TableCell className="font-medium">
                      {[c.lastName, c.firstName, c.middleName].filter(Boolean).join(" ")}
                    </TableCell>
                    <TableCell>{c.phone || "—"}</TableCell>
                    <TableCell>{c.email || "—"}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[c.candidateStatus || "NEW"]}`}>
                        {STATUS_LABELS[c.candidateStatus || "NEW"]}
                      </span>
                    </TableCell>
                    <TableCell>{formatDate(c.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Новый кандидат</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Фамилия *</Label>
                <Input name="lastName" required />
              </div>
              <div className="space-y-1.5">
                <Label>Имя *</Label>
                <Input name="firstName" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Телефон</Label>
                <Input name="phone" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input name="email" type="email" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Textarea name="comment" rows={3} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={creating}>{creating ? "Сохраняю..." : "Создать"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
