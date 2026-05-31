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
import { ClipboardPlus } from "lucide-react"
import { formatWardName } from "@/lib/format-name"

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
  clientId,
  wards,
  variant = "outline",
  size = "sm",
  buttonClassName,
  triggerLabel = "Создать заявку",
}: {
  clientId: string
  wards: WardLite[]
  variant?: "default" | "outline" | "ghost" | "secondary"
  size?: "sm" | "default"
  buttonClassName?: string
  triggerLabel?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [branches, setBranches] = useState<BranchOption[]>([])
  const [directions, setDirections] = useState<DirectionOption[]>([])
  const [wardId, setWardId] = useState(wards.length === 1 ? wards[0].id : "")
  const [branchId, setBranchId] = useState("")
  const [directionId, setDirectionId] = useState("")
  const [comment, setComment] = useState("")

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    setWardId(wards.length === 1 ? wards[0].id : "")
    setBranchId("")
    setDirectionId("")
    setComment("")
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
  }, [open, wards])

  const noWards = wards.length === 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
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

          <div className="space-y-1.5">
            <Label>Подопечный *</Label>
            <Select value={wardId} onValueChange={(v) => v && setWardId(v)}>
              <SelectTrigger className="w-full">
                {selectedWard ? wardName(selectedWard) : <span className="text-muted-foreground">Выберите подопечного</span>}
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
