"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select"
import { Gift, AlertCircle } from "lucide-react"

interface EmployeeOpt {
  id: string
  firstName: string | null
  lastName: string | null
}
interface ChannelOpt {
  id: string
  name: string
}

function fullName(e: EmployeeOpt): string {
  return [e.lastName, e.firstName].filter(Boolean).join(" ") || "Без имени"
}

export function BonusDiscountDialog({
  clientId,
  defaultResponsibleId,
}: {
  clientId: string
  defaultResponsibleId: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState("")
  const [reason, setReason] = useState("")
  const [responsibleId, setResponsibleId] = useState<string>(defaultResponsibleId ?? "")
  const [isMarketing, setIsMarketing] = useState(false)
  const [channelId, setChannelId] = useState<string>("")
  const [employees, setEmployees] = useState<EmployeeOpt[]>([])
  const [channels, setChannels] = useState<ChannelOpt[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || loaded) return
    Promise.all([
      fetch("/api/employees").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/lead-channels?isActive=true").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([emps, chans]) => {
        setEmployees(Array.isArray(emps) ? emps : [])
        setChannels(Array.isArray(chans) ? chans : [])
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [open, loaded])

  function reset() {
    setAmount("")
    setDate(new Date().toISOString().slice(0, 10))
    setComment("")
    setReason("")
    setResponsibleId(defaultResponsibleId ?? "")
    setIsMarketing(false)
    setChannelId("")
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const num = Number(amount)
    if (!(num > 0)) { setError("Сумма должна быть больше 0"); return }
    if (!reason.trim()) { setError("Укажите причину"); return }
    if (isMarketing && !channelId) { setError("Выберите канал"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/bonus-discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          amount: num,
          date,
          comment: comment || undefined,
          reason,
          responsibleId: responsibleId || null,
          isMarketing,
          channelId: isMarketing ? channelId || null : null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Ошибка ${res.status}`)
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const responsibleLabel = employees.find((e) => e.id === responsibleId)
    ? fullName(employees.find((e) => e.id === responsibleId)!)
    : "Выберите ответственного"
  const channelLabel = channels.find((c) => c.id === channelId)?.name ?? "Выберите канал"

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Gift className="mr-2 size-4" />
        Сделать разовую скидку
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Разовая скидка-бонус</DialogTitle>
          <DialogDescription>
            Начисляется на баланс родителя — в ДДС не попадает. Потом можно
            погасить ею часть абонемента через кнопку «Оплатить».
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Сумма *</Label>
              <Input
                type="number" step="0.01" min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="500"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Дата *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Причина *</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Извинение за перенос, приведи друга и т.д."
            />
          </div>

          <div className="space-y-1.5">
            <Label>Ответственный</Label>
            <Select value={responsibleId} onValueChange={(v) => { if (v !== null) setResponsibleId(v) }}>
              <SelectTrigger className="w-full">
                <span className="truncate">{responsibleLabel}</span>
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{fullName(e)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Комментарий</Label>
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Необязательно" />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isMarketing}
              onCheckedChange={(v) => setIsMarketing(v === true)}
            />
            Учитывать в маркетинге
          </label>

          {isMarketing && (
            <div className="space-y-1.5">
              <Label>Канал *</Label>
              <Select value={channelId} onValueChange={(v) => { if (v) setChannelId(v) }}>
                <SelectTrigger className="w-full">
                  <span className="truncate">{channelLabel}</span>
                </SelectTrigger>
                <SelectContent>
                  {channels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-start gap-2">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Сохраняю…" : "Начислить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
