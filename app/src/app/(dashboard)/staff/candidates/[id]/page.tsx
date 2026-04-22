"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select"
import { ArrowLeft, Plus, UserCheck, X } from "lucide-react"
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
  NEW: "bg-gray-100 text-gray-800",
  INTERVIEW: "bg-yellow-100 text-yellow-800",
  TRIAL_DAY: "bg-blue-100 text-blue-800",
  HIRED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
}

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

export default function CandidateCardPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [loading, setLoading] = useState(true)
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [meetingComment, setMeetingComment] = useState("")
  const [saving, setSaving] = useState(false)
  const [hireOpen, setHireOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectComment, setRejectComment] = useState("")
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])

  const load = useCallback(async () => {
    const res = await fetch(`/api/candidates/${id}`)
    if (res.ok) setCandidate(await res.json())
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  async function changeStatus(status: string) {
    await fetch(`/api/candidates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateStatus: status }),
    })
    load()
  }

  async function addMeeting() {
    if (!meetingComment.trim()) return
    setSaving(true)
    await fetch(`/api/candidates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: meetingComment }),
    })
    setMeetingComment("")
    setMeetingOpen(false)
    setSaving(false)
    load()
  }

  async function reject() {
    setSaving(true)
    await fetch(`/api/candidates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateStatus: "REJECTED", comment: rejectComment || "Отклонён" }),
    })
    setRejectOpen(false)
    setSaving(false)
    load()
  }

  async function handleHire(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    const fd = new FormData(e.currentTarget)
    const res = await fetch(`/api/candidates/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: fd.get("login"),
        password: fd.get("password"),
        role: fd.get("role"),
        branchIds: fd.get("branchId") ? [fd.get("branchId")] : [],
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(data.error || "Ошибка")
      setSaving(false)
      return
    }
    setSaving(false)
    router.push("/staff")
  }

  function openHireDialog() {
    fetch("/api/branches").then(r => r.ok ? r.json() : []).then(setBranches)
    setHireOpen(true)
  }

  if (loading) return <p className="text-center text-muted-foreground py-12">Загрузка...</p>
  if (!candidate) return <p className="text-center text-muted-foreground py-12">Кандидат не найден</p>

  const fullName = [candidate.lastName, candidate.firstName, candidate.middleName].filter(Boolean).join(" ")
  const status = candidate.candidateStatus || "NEW"
  const history = (candidate.interviewHistory as { date: string; comment: string }[]) || []
  const isTerminal = status === "HIRED" || status === "REJECTED"

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/staff/candidates">
          <Button variant="ghost" size="icon"><ArrowLeft className="size-4" /></Button>
        </Link>
        <h1 className="text-2xl font-bold">{fullName}</h1>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[status]}`}>
          {STATUS_LABELS[status]}
        </span>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Контакты</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Телефон:</span>
            <p className="font-medium">{candidate.phone || "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Email:</span>
            <p className="font-medium">{candidate.email || "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Создан:</span>
            <p className="font-medium">{formatDateTime(candidate.createdAt)}</p>
          </div>
        </CardContent>
      </Card>

      {!isTerminal && (
        <div className="flex gap-2 flex-wrap">
          <Label className="self-center text-sm text-muted-foreground mr-2">Статус:</Label>
          {(["NEW", "INTERVIEW", "TRIAL_DAY"] as const).map(s => (
            <Button
              key={s}
              variant={status === s ? "default" : "outline"}
              size="sm"
              onClick={() => changeStatus(s)}
            >
              {STATUS_LABELS[s]}
            </Button>
          ))}
          <div className="flex-1" />
          <Button variant="default" size="sm" className="bg-green-600 hover:bg-green-700" onClick={openHireDialog}>
            <UserCheck className="size-4 mr-1" /> Принять
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setRejectOpen(true)}>
            <X className="size-4 mr-1" /> Отклонить
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">История встреч ({history.length})</CardTitle>
            {!isTerminal && (
              <Button variant="outline" size="sm" onClick={() => setMeetingOpen(true)}>
                <Plus className="size-4 mr-1" /> Добавить встречу
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет записей</p>
          ) : (
            <div className="space-y-3">
              {[...history].reverse().map((h, i) => (
                <div key={i} className="border-l-2 border-muted pl-3 py-1">
                  <p className="text-xs text-muted-foreground">{formatDateTime(h.date)}</p>
                  <p className="text-sm mt-0.5">{h.comment}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Добавить встречу */}
      <Dialog open={meetingOpen} onOpenChange={setMeetingOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Добавить встречу</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={meetingComment}
              onChange={e => setMeetingComment(e.target.value)}
              placeholder="Комментарий..."
              rows={4}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMeetingOpen(false)}>Отмена</Button>
              <Button onClick={addMeeting} disabled={saving || !meetingComment.trim()}>
                {saving ? "Сохраняю..." : "Сохранить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Отклонить */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Отклонить кандидата</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={rejectComment}
              onChange={e => setRejectComment(e.target.value)}
              placeholder="Причина отказа..."
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejectOpen(false)}>Отмена</Button>
              <Button variant="destructive" onClick={reject} disabled={saving}>
                {saving ? "..." : "Отклонить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Принять в сотрудники */}
      <Dialog open={hireOpen} onOpenChange={setHireOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Принять в сотрудники</DialogTitle></DialogHeader>
          <form onSubmit={handleHire} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Логин *</Label>
                <Input name="login" required pattern="[a-zA-Z0-9._-]+" title="Только латиница" />
              </div>
              <div className="space-y-1.5">
                <Label>Пароль *</Label>
                <PasswordInput name="password" required minLength={6} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Роль *</Label>
              <Select name="role" defaultValue="instructor">
                <SelectTrigger className="w-full">Выберите роль</SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">Управляющий</SelectItem>
                  <SelectItem value="admin">Администратор</SelectItem>
                  <SelectItem value="instructor">Инструктор</SelectItem>
                  <SelectItem value="readonly">Только чтение</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {branches.length > 0 && (
              <div className="space-y-1.5">
                <Label>Филиал</Label>
                <Select name="branchId">
                  <SelectTrigger className="w-full">Выберите филиал</SelectTrigger>
                  <SelectContent>
                    {branches.map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setHireOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={saving} className="bg-green-600 hover:bg-green-700">
                {saving ? "..." : "Принять"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
