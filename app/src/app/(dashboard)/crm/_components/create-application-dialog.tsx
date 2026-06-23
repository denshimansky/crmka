"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { ClientCombobox, type ClientComboboxOption } from "@/components/client-combobox"
import { AlertTriangle, ClipboardPlus } from "lucide-react"
import { formatWardName } from "@/lib/format-name"

interface DuplicateApplication {
  id: string
  createdAt: string
  comment: string | null
  directionName: string
  branchName: string
}

interface WardLite {
  id: string
  firstName: string
  lastName: string | null
}

interface BranchOption {
  id: string
  name: string
}

interface DirectionOption {
  id: string
  name: string
}

const wardName = formatWardName

export function CreateApplicationDialog({
  clientId: fixedClientId,
  wards: fixedWards,
  clients,
  variant = "outline",
  size = "sm",
  buttonClassName,
  triggerLabel = "Создать заявку",
}: {
  /** Карточка клиента: клиент известен заранее, поле выбора клиента не показываем. */
  clientId?: string
  /** Подопечные известного клиента (режим карточки). */
  wards?: WardLite[]
  /** Режим «Продажи»: клиент не задан, выбираем поиском из этого списка. */
  clients?: ClientComboboxOption[]
  variant?: "default" | "outline" | "ghost" | "secondary"
  size?: "sm" | "default"
  buttonClassName?: string
  triggerLabel?: string
}) {
  const router = useRouter()
  // Режим поиска клиента: клиент заранее не задан, выбираем из списка.
  const pickClient = !fixedClientId
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [branches, setBranches] = useState<BranchOption[]>([])
  const [directions, setDirections] = useState<DirectionOption[]>([])
  const [pickedClientId, setPickedClientId] = useState("")
  // В режиме поиска подопечных подгружаем по выбранному клиенту, в режиме карточки — берём из props.
  const [pickedWards, setPickedWards] = useState<WardLite[]>([])
  const [wardId, setWardId] = useState("")
  const [branchId, setBranchId] = useState("")
  const [directionId, setDirectionId] = useState("")
  const [comment, setComment] = useState("")
  const [duplicates, setDuplicates] = useState<DuplicateApplication[]>([])

  const clientId = pickClient ? pickedClientId : fixedClientId
  const wards = pickClient ? pickedWards : (fixedWards ?? [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    setPickedClientId("")
    setPickedWards([])
    setWardId(!pickClient && fixedWards?.length === 1 ? fixedWards[0].id : "")
    setBranchId("")
    setDirectionId("")
    setComment("")
    setDuplicates([])
    ;(async () => {
      try {
        const [bRes, dRes] = await Promise.all([fetch("/api/branches"), fetch("/api/directions")])
        if (cancelled) return
        if (bRes.ok) setBranches(await bRes.json())
        if (dRes.ok) setDirections(await dRes.json())
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, pickClient, fixedWards])

  // Режим поиска: при выборе клиента подгружаем его подопечных и автоселектим единственного.
  useEffect(() => {
    if (!open || !pickClient) return
    setWardId("")
    if (!pickedClientId) {
      setPickedWards([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/clients/${pickedClientId}/wards`)
        if (cancelled) return
        if (res.ok) {
          const data: WardLite[] = await res.json()
          setPickedWards(data)
          if (data.length === 1) setWardId(data[0].id)
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, pickClient, pickedClientId])

  // Проверка дубля заявки: после выбора Ward + филиала + направления.
  // Дублем считаем активную заявку с теми же параметрами.
  useEffect(() => {
    if (!open || !wardId || !branchId || !directionId) {
      setDuplicates([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/applications/check-duplicate?wardId=${wardId}&directionId=${directionId}&branchId=${branchId}`,
        )
        if (cancelled) return
        if (res.ok) {
          const data = await res.json()
          setDuplicates(data.duplicates || [])
        }
      } catch {
        /* ignore */
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, wardId, branchId, directionId])

  // В режиме карточки блокируем кнопку, если у клиента нет подопечных. В режиме
  // поиска кнопка всегда активна — клиента (и его подопечных) выбирают в диалоге.
  const noWards = !pickClient && wards.length === 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (pickClient && !clientId) return setError("Выберите клиента")
    if (!wardId) return setError("Выберите подопечного")
    if (!branchId) return setError("Выберите филиал")
    if (!directionId) return setError("Выберите направление")

    setLoading(true)
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          wardId,
          branchId,
          directionId,
          comment: comment.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при создании заявки")
        return
      }
      setOpen(false)
      window.dispatchEvent(
        new CustomEvent("crm:applications-changed", { detail: { clientId } }),
      )
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const selectedWard = wards.find((w) => w.id === wardId)
  const selectedBranch = branches.find((b) => b.id === branchId)
  const selectedDirection = directions.find((d) => d.id === directionId)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant={variant}
            size={size}
            disabled={noWards}
            title={noWards ? "Сначала добавьте подопечного" : undefined}
            className={buttonClassName}
          />
        }
      >
        <ClipboardPlus className="size-3.5" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая заявка</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

          {duplicates.length > 0 && (
            <div className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-200">
              <div className="flex items-center gap-1.5 font-medium mb-1">
                <AlertTriangle className="size-4" />
                У ребёнка уже есть активная заявка
              </div>
              {duplicates.map((d) => (
                <div key={d.id} className="ml-5.5 text-xs">
                  {d.directionName} · {d.branchName} · от {new Date(d.createdAt).toLocaleDateString("ru-RU")}
                  {d.comment ? ` — ${d.comment}` : ""}
                </div>
              ))}
              <div className="ml-5.5 mt-1 text-xs">Можно продолжить — будет создана ещё одна.</div>
            </div>
          )}

          {pickClient && (
            <div className="space-y-1.5">
              <Label>Клиент *</Label>
              <ClientCombobox
                options={clients ?? []}
                value={pickedClientId}
                onChange={setPickedClientId}
                placeholder="Начните вводить ФИО..."
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Подопечный *</Label>
            <Select value={wardId} onValueChange={(v) => v && setWardId(v)} disabled={pickClient && !clientId}>
              <SelectTrigger className="w-full">
                {selectedWard ? (
                  wardName(selectedWard)
                ) : (
                  <span className="text-muted-foreground">
                    {pickClient && !clientId
                      ? "Сначала выберите клиента"
                      : pickClient && wards.length === 0
                        ? "У клиента нет подопечных"
                        : "Выберите подопечного"}
                  </span>
                )}
              </SelectTrigger>
              <SelectContent>
                {wards.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {wardName(w)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Филиал *</Label>
            <Select value={branchId} onValueChange={(v) => v && setBranchId(v)}>
              <SelectTrigger className="w-full">
                {selectedBranch ? selectedBranch.name : <span className="text-muted-foreground">Выберите филиал</span>}
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

          <div className="space-y-1.5">
            <Label>Направление *</Label>
            <Select value={directionId} onValueChange={(v) => v && setDirectionId(v)}>
              <SelectTrigger className="w-full">
                {selectedDirection ? selectedDirection.name : <span className="text-muted-foreground">Выберите направление</span>}
              </SelectTrigger>
              <SelectContent>
                {directions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Комментарий</Label>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Отмена</DialogClose>
            <Button type="submit" disabled={loading}>
              {loading ? "Создание..." : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
