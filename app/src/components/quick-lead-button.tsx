"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectTrigger, SelectContent, SelectItem,
} from "@/components/ui/select"
import { AlertTriangle, Plus } from "lucide-react"
import { useDuplicateCheck, getStatusLabel } from "@/hooks/use-duplicate-check"

interface ChannelOption {
  id: string
  name: string
}

export function QuickLeadButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [firstName, setFirstName] = useState("")
  const [phone, setPhone] = useState("")
  const [channelId, setChannelId] = useState<string>("")
  const [channels, setChannels] = useState<ChannelOption[]>([])
  const [comment, setComment] = useState("")

  const { duplicates } = useDuplicateCheck(phone)

  const loadChannels = async () => {
    try {
      const res = await fetch("/api/lead-channels")
      if (res.ok) {
        const data = await res.json()
        setChannels(data.filter((c: any) => c.isActive))
      }
    } catch { /* ignore */ }
  }

  function resetForm() {
    setFirstName("")
    setPhone("")
    setChannelId("")
    setComment("")
    setError(null)
    setSuccess(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!phone.trim()) {
      setError("Укажите телефон")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim() || undefined,
          phone: phone.trim(),
          channelId: channelId || undefined,
          comment: comment.trim() || undefined,
          funnelStatus: "new",
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при создании лида")
        return
      }

      const created = await res.json()
      setOpen(false)
      resetForm()
      router.push(`/crm/clients/${created.id}`)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) loadChannels()
        if (!nextOpen) resetForm()
      }}
    >
      <DialogTrigger render={
        <Button
          size="lg"
          className="fixed bottom-6 right-6 z-50 rounded-full shadow-lg h-14 px-6 gap-2"
        />
      }>
        <Plus className="size-5" />
        Новый лид
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Быстрое создание лида</DialogTitle>
            <DialogDescription>
              Минимальная информация для нового лида
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {duplicates.length > 0 && (
              <div className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-200">
                <div className="flex items-center gap-1.5 font-medium mb-1">
                  <AlertTriangle className="size-4" />
                  Найден похожий контакт
                </div>
                {duplicates.map((d) => {
                  const name = [d.lastName, d.firstName].filter(Boolean).join(" ") || "Без имени"
                  return (
                    <div key={d.id} className="ml-5.5">
                      <a
                        href={`/crm/clients/${d.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:no-underline"
                      >
                        {name}
                      </a>
                      {" "}({d.phone}) — {getStatusLabel(d)}
                    </div>
                  )
                })}
              </div>
            )}

            <div>
              <Label htmlFor="ql-firstName">Имя</Label>
              <Input
                id="ql-firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Имя клиента"
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="ql-phone">Телефон *</Label>
              <Input
                id="ql-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+7 (999) 123-45-67"
              />
            </div>

            {channels.length > 0 && (
              <div>
                <Label>Канал привлечения</Label>
                <Select value={channelId} onValueChange={(v) => { if (v) setChannelId(v) }}>
                  <SelectTrigger className="w-full">
                    {channelId ? channels.find(c => c.id === channelId)?.name : <span className="text-muted-foreground">Откуда узнал</span>}
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label htmlFor="ql-comment">Комментарий</Label>
              <Textarea
                id="ql-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Дополнительная информация..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <DialogClose render={<Button variant="outline" type="button" />}>
              Отмена
            </DialogClose>
            <Button type="submit" disabled={loading}>
              {loading ? "Создание..." : "Создать лида"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
