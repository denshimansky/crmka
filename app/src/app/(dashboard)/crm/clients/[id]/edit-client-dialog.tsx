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
import { filterEmployeesByBranch, isEmployeeAvailableInBranch } from "@/lib/employee-branch-filter"
import { NO_AUTO, PER_SUB, shortTitle, type DiscountTemplateLite } from "../../_components/discount-label"

interface BranchOption {
  id: string
  name: string
}

interface ChannelOption {
  id: string
  name: string
  isActive: boolean
}

interface EmployeeOption {
  id: string
  firstName: string | null
  lastName: string | null
  employeeBranches?: { branchId: string }[]
}

interface TemplateOption {
  id: string
  name: string
  valueType: "percent" | "fixed"
  value: string | number
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
  channelId: string | null
  branchId: string | null
  assignedTo: string | null
  comment: string | null
  // Скидки v2: выбор перенесён сюда из шапки карточки (там теперь информационно).
  discountTemplateId: string | null
  autoDiscountDisabled: boolean
  // Скидки v3: режим «Шаблоны скидок на абонементы».
  perSubDiscountMode: boolean
  discountTemplate: DiscountTemplateLite | null
  /** Действует ли на абонементах клиента автоскидка «за второй абонемент». */
  hasType1Discount?: boolean
}

export function EditClientDialog({ client }: { client: ClientData }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [branches, setBranches] = useState<BranchOption[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [channels, setChannels] = useState<ChannelOption[]>([])

  const [firstName, setFirstName] = useState(client.firstName || "")
  const [lastName, setLastName] = useState(client.lastName || "")
  const [patronymic, setPatronymic] = useState(client.patronymic || "")
  const [phone, setPhone] = useState(client.phone || "")
  const [phone2, setPhone2] = useState(client.phone2 || "")
  const [email, setEmail] = useState(client.email || "")
  const [socialLink, setSocialLink] = useState(client.socialLink || "")
  const [channelId, setChannelId] = useState(client.channelId || "")
  const [branchId, setBranchId] = useState(client.branchId || "")
  const [assignedTo, setAssignedTo] = useState(client.assignedTo || "")
  const [comment, setComment] = useState(client.comment || "")
  // Скидка: sentinel-значение поля (templateId | "none" | NO_AUTO | PER_SUB).
  const initialDiscountValue = client.autoDiscountDisabled
    ? NO_AUTO
    : client.perSubDiscountMode
      ? PER_SUB
      : client.discountTemplateId ?? "none"
  const [discountValue, setDiscountValue] = useState(initialDiscountValue)
  const [discountTemplates, setDiscountTemplates] = useState<TemplateOption[]>([])

  useEffect(() => {
    if (!open) return
    async function load() {
      try {
        const [bRes, eRes, cRes, dRes] = await Promise.all([
          fetch("/api/branches"),
          fetch("/api/employees"),
          fetch("/api/lead-channels"),
          // Вручную выбирается только постоянная скидка (тип 2), активная.
          fetch("/api/discount-templates?isActive=true&kind=permanent"),
        ])
        if (bRes.ok) setBranches(await bRes.json())
        if (eRes.ok) setEmployees(await eRes.json())
        if (cRes.ok) setChannels(await cRes.json())
        if (dRes.ok) {
          const data = await dRes.json()
          setDiscountTemplates(Array.isArray(data) ? data : [])
        }
      } catch {
        /* ignore */
      }
    }
    load()
  }, [open])

  function reset() {
    setFirstName(client.firstName || "")
    setLastName(client.lastName || "")
    setPatronymic(client.patronymic || "")
    setPhone(client.phone || "")
    setPhone2(client.phone2 || "")
    setEmail(client.email || "")
    setSocialLink(client.socialLink || "")
    setChannelId(client.channelId || "")
    setBranchId(client.branchId || "")
    setAssignedTo(client.assignedTo || "")
    setComment(client.comment || "")
    setDiscountValue(initialDiscountValue)
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
      const body: Record<string, unknown> = {
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        patronymic: patronymic.trim() || null,
        phone: phone.trim() || null,
        phone2: phone2.trim() || null,
        email: email.trim() || null,
        socialLink: socialLink.trim() || null,
        channelId: channelId || null,
        branchId: branchId || null,
        assignedTo: assignedTo || null,
        comment: comment.trim() || null,
      }
      // Скидку шлём ТОЛЬКО если её изменили: наличие discountTemplateId/
      // autoDiscountDisabled в теле триггерит пересчёт скидок клиента (с флагом
      // «тип 1 в текущем месяце»). Без этого гарда правка телефона запускала бы
      // recalc и могла случайно применить автоскидку за второй абонемент.
      if (discountValue !== initialDiscountValue) {
        if (discountValue === PER_SUB) {
          // Скидки v3: режим «на абонемент» — эксклюзивно, без пересчёта живых.
          body.perSubDiscountMode = true
          body.discountTemplateId = null
          body.autoDiscountDisabled = false
        } else if (discountValue === NO_AUTO) {
          body.perSubDiscountMode = false
          body.discountTemplateId = null
          body.autoDiscountDisabled = true
        } else {
          body.perSubDiscountMode = false
          body.discountTemplateId = discountValue === "none" ? null : discountValue
          body.autoDiscountDisabled = false
        }
      }
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
  const selectedChannel = channels.find((c) => c.id === channelId)
  const selectedAssignee = employees.find((e) => e.id === assignedTo)
  const assigneeLabel = selectedAssignee
    ? [selectedAssignee.lastName, selectedAssignee.firstName].filter(Boolean).join(" ") || "Без имени"
    : "Не назначен"

  // Подпись триггера отражает выбранную НАСТРОЙКУ (не эффективную скидку):
  // индикатор действующей автоскидки «за второй абонемент» живёт в шапке карточки.
  const selectedTpl = discountTemplates.find((t) => t.id === discountValue)
  let discountTriggerLabel: string
  if (discountValue === NO_AUTO) {
    discountTriggerLabel = "Отключить все скидки"
  } else if (discountValue === PER_SUB) {
    discountTriggerLabel = "Шаблоны скидок на абонементы"
  } else if (selectedTpl) {
    discountTriggerLabel = shortTitle(selectedTpl)
  } else if (discountValue !== "none" && client.discountTemplate) {
    // Выбран шаблон, ещё не подгруженный в список (или деактивированный).
    discountTriggerLabel = shortTitle(client.discountTemplate)
  } else if (discountValue !== "none") {
    discountTriggerLabel = "…"
  } else {
    discountTriggerLabel = "Применять автоматические скидки"
  }

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

          <div className="space-y-1.5">
            <Label>Скидка</Label>
            <Select
              value={discountValue}
              onValueChange={(v) => {
                if (v !== null) setDiscountValue(v)
              }}
            >
              <SelectTrigger className="w-full">
                {discountTriggerLabel}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Применять автоматические скидки</SelectItem>
                <SelectItem value={NO_AUTO}>Отключить все скидки</SelectItem>
                {/* Скидки v3: режим пер-абонементных скидок. Включает выбор
                    шаблона scope=subscription в форме абонемента. */}
                <SelectItem value={PER_SUB}>Шаблоны скидок на абонементы</SelectItem>
                {discountTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {shortTitle(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Автоскидка «за второй абонемент» (тип 1) руками не выбирается —
                управляется тумблером в настройках организации. */}
          </div>

          {channels.length > 0 && (
            <div className="space-y-1.5">
              <Label>Канал привлечения</Label>
              <Select
                value={channelId}
                onValueChange={(v) => {
                  if (v !== null) setChannelId(v)
                }}
              >
                <SelectTrigger className="w-full">
                  {selectedChannel ? selectedChannel.name : "Не выбран"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Не выбран</SelectItem>
                  {/* Активные каналы + текущий канал клиента, даже если он выключен
                      в справочнике — иначе его нельзя увидеть/оставить как есть. */}
                  {channels
                    .filter((c) => c.isActive || c.id === client.channelId)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
            <Label>Ответственный</Label>
            <Select
              value={assignedTo}
              onValueChange={(v) => {
                if (v !== null) setAssignedTo(v)
              }}
            >
              <SelectTrigger className="w-full">
                {assigneeLabel}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Не назначен</SelectItem>
                {(() => {
                  const filtered = filterEmployeesByBranch(employees, branchId)
                  const showSelectedOutOfBranch =
                    selectedAssignee && !isEmployeeAvailableInBranch(selectedAssignee, branchId)
                  const visible = showSelectedOutOfBranch
                    ? [selectedAssignee!, ...filtered.filter((e) => e.id !== selectedAssignee!.id)]
                    : filtered
                  return visible.map((e) => {
                    const name = [e.lastName, e.firstName].filter(Boolean).join(" ") || "Без имени"
                    return (
                      <SelectItem key={e.id} value={e.id}>
                        {name}
                      </SelectItem>
                    )
                  })
                })()}
              </SelectContent>
            </Select>
          </div>

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
