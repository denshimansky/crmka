"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Pencil } from "lucide-react"

interface BranchOption {
  id: string
  name: string
}

interface ClientData {
  id: string
  firstName: string | null
  lastName: string | null
  patronymic: string | null
  phone: string | null
  phone2: string | null
  email: string | null
  socialLink: string | null
  branchId: string | null
  comment: string | null
}

export function EditClientDialog({ client }: { client: ClientData }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [branches, setBranches] = useState<BranchOption[]>([])

  const [firstName, setFirstName] = useState(client.firstName || "")
  const [lastName, setLastName] = useState(client.lastName || "")
  const [patronymic, setPatronymic] = useState(client.patronymic || "")
  const [phone, setPhone] = useState(client.phone || "")
  const [phone2, setPhone2] = useState(client.phone2 || "")
  const [email, setEmail] = useState(client.email || "")
  const [socialLink, setSocialLink] = useState(client.socialLink || "")
  const [branchId, setBranchId] = useState(client.branchId || "")
  const [comment, setComment] = useState(client.comment || "")

  useEffect(() => {
    if (!open) return
    async function loadBranches() {
      try {
        const res = await fetch("/api/branches")
        if (res.ok) setBranches(await res.json())
      } catch {
        /* ignore */
      }
    }
    loadBranches()
  }, [open])

  function reset() {
    setFirstName(client.firstName || "")
    setLastName(client.lastName || "")
    setPatronymic(client.patronymic || "")
    setPhone(client.phone || "")
    setPhone2(client.phone2 || "")
    setEmail(client.email || "")
    setSocialLink(client.socialLink || "")
    setBranchId(client.branchId || "")
    setComment(client.comment || "")
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!firstName.trim() && !lastName.trim()) {
      setError("Укажите имя или фамилию")
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          patronymic: patronymic.trim() || null,
          phone: phone.trim() || null,
          phone2: phone2.trim() || null,
          email: email.trim() || null,
          socialLink: socialLink.trim() || null,
          branchId: branchId || null,
          comment: comment.trim() || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при обновлении клиента")
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

  const selectedBranch = branches.find((b) => b.id === branchId)

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" className="size-8 shrink-0" />
        }
      >
        <Pencil className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Редактировать клиента</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Фамилия</Label>
              <Input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Иванов"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Имя</Label>
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Иван"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Отчество</Label>
              <Input
                value={patronymic}
                onChange={(e) => setPatronymic(e.target.value)}
                placeholder="Иванович"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Телефон</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+7 (999) 123-45-67"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Телефон 2</Label>
              <Input
                value={phone2}
                onChange={(e) => setPhone2(e.target.value)}
                placeholder="+7 (999) 765-43-21"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Соцсеть</Label>
              <Input
                value={socialLink}
                onChange={(e) => setSocialLink(e.target.value)}
                placeholder="https://vk.com/..."
              />
            </div>
          </div>

          {branches.length > 0 && (
            <div className="space-y-1.5">
              <Label>Филиал</Label>
              <Select
                value={branchId}
                onValueChange={(v) => {
                  if (v !== null) setBranchId(v)
                }}
              >
                <SelectTrigger className="w-full">
                  {selectedBranch ? selectedBranch.name : "Не выбран"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Не выбран</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Комментарий</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Заметки о клиенте..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
