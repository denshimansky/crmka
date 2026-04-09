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
import { Plus, Trash2 } from "lucide-react"

interface Branch {
  id: string
  name: string
}

interface ChannelOption {
  id: string
  name: string
}

interface WardInput {
  firstName: string
  lastName: string
  birthDate: string
}

export function CreateClientDialog({ branches }: { branches: Branch[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [lastName, setLastName] = useState("")
  const [firstName, setFirstName] = useState("")
  const [patronymic, setPatronymic] = useState("")
  const [phone, setPhone] = useState("")
  const [phone2, setPhone2] = useState("")
  const [email, setEmail] = useState("")
  const [socialLink, setSocialLink] = useState("")
  const [branchId, setBranchId] = useState<string>("")
  const [channelId, setChannelId] = useState<string>("")
  const [channels, setChannels] = useState<ChannelOption[]>([])
  const [comment, setComment] = useState("")
  const [wards, setWards] = useState<WardInput[]>([])

  // Load channels on open
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
    setLastName("")
    setFirstName("")
    setPatronymic("")
    setPhone("")
    setPhone2("")
    setEmail("")
    setSocialLink("")
    setBranchId("")
    setChannelId("")
    setComment("")
    setWards([])
    setError(null)
  }

  function addWard() {
    setWards((prev) => [...prev, { firstName: "", lastName: "", birthDate: "" }])
  }

  function removeWard(index: number) {
    setWards((prev) => prev.filter((_, i) => i !== index))
  }

  function updateWard(index: number, field: keyof WardInput, value: string) {
    setWards((prev) =>
      prev.map((w, i) => (i === index ? { ...w, [field]: value } : w))
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!phone.trim() && !socialLink.trim()) {
      setError("Укажите телефон или ссылку на соцсеть")
      return
    }

    for (const w of wards) {
      if (!w.firstName.trim()) {
        setError("Укажите имя каждого подопечного")
        return
      }
    }

    setLoading(true)
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lastName: lastName.trim() || undefined,
          firstName: firstName.trim() || undefined,
          patronymic: patronymic.trim() || undefined,
          phone: phone.trim() || undefined,
          phone2: phone2.trim() || undefined,
          email: email.trim() || undefined,
          socialLink: socialLink.trim() || undefined,
          branchId: branchId || undefined,
          channelId: channelId || undefined,
          comment: comment.trim() || undefined,
          wards: wards
            .filter((w) => w.firstName.trim())
            .map((w) => ({
              firstName: w.firstName.trim(),
              lastName: w.lastName.trim() || undefined,
              birthDate: w.birthDate || undefined,
            })),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при создании клиента")
        return
      }

      setOpen(false)
      resetForm()
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
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        Клиент
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Новый клиент</DialogTitle>
            <DialogDescription>
              Заполните данные клиента. Телефон или соцсеть обязательны.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* ФИО */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label htmlFor="cl-lastName">Фамилия</Label>
                <Input
                  id="cl-lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Иванова"
                />
              </div>
              <div>
                <Label htmlFor="cl-firstName">Имя</Label>
                <Input
                  id="cl-firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Мария"
                />
              </div>
              <div>
                <Label htmlFor="cl-patronymic">Отчество</Label>
                <Input
                  id="cl-patronymic"
                  value={patronymic}
                  onChange={(e) => setPatronymic(e.target.value)}
                  placeholder="Ивановна"
                />
              </div>
            </div>

            {/* Телефоны */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="cl-phone">Телефон *</Label>
                <Input
                  id="cl-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+7 (999) 123-45-67"
                />
              </div>
              <div>
                <Label htmlFor="cl-phone2">Телефон 2</Label>
                <Input
                  id="cl-phone2"
                  value={phone2}
                  onChange={(e) => setPhone2(e.target.value)}
                  placeholder="+7 (999) 765-43-21"
                />
              </div>
            </div>

            {/* Email и соцсеть */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="cl-email">Email</Label>
                <Input
                  id="cl-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@example.com"
                />
              </div>
              <div>
                <Label htmlFor="cl-social">Соцсеть (VK/Telegram)</Label>
                <Input
                  id="cl-social"
                  value={socialLink}
                  onChange={(e) => setSocialLink(e.target.value)}
                  placeholder="vk.com/ivanova"
                />
              </div>
            </div>

            {/* Филиал */}
            {branches.length > 0 && (
              <div>
                <Label>Филиал</Label>
                <Select value={branchId} onValueChange={(v) => { if (v) setBranchId(v) }}>
                  <SelectTrigger className="w-full">
                    {branchId ? branches.find(b => b.id === branchId)?.name : <span className="text-muted-foreground">Выберите филиал</span>}
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Канал привлечения */}
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

            {/* Комментарий */}
            <div>
              <Label htmlFor="cl-comment">Комментарий</Label>
              <Textarea
                id="cl-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Дополнительная информация..."
              />
            </div>

            {/* Подопечные */}
            <div>
              <div className="flex items-center justify-between">
                <Label>Подопечные</Label>
                <Button type="button" variant="outline" size="sm" onClick={addWard}>
                  <Plus className="size-3" />
                  Подопечный
                </Button>
              </div>
              {wards.length > 0 && (
                <div className="mt-2 space-y-3">
                  {wards.map((w, i) => (
                    <div key={i} className="flex items-end gap-2 rounded-md border p-2">
                      <div className="flex-1">
                        <Label>Имя *</Label>
                        <Input
                          value={w.firstName}
                          onChange={(e) => updateWard(i, "firstName", e.target.value)}
                          placeholder="Имя"
                        />
                      </div>
                      <div className="flex-1">
                        <Label>Фамилия</Label>
                        <Input
                          value={w.lastName}
                          onChange={(e) => updateWard(i, "lastName", e.target.value)}
                          placeholder="Фамилия"
                        />
                      </div>
                      <div className="w-36">
                        <Label>Дата рождения</Label>
                        <Input
                          type="date"
                          value={w.birthDate}
                          onChange={(e) => updateWard(i, "birthDate", e.target.value)}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeWard(i)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <DialogClose render={<Button variant="outline" type="button" />}>
              Отмена
            </DialogClose>
            <Button type="submit" disabled={loading}>
              {loading ? "Создание..." : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
