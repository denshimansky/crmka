"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Plus } from "lucide-react"

interface BranchOption {
  id: string
  name: string
}

const TYPE_OPTIONS = [
  { value: "cash", label: "Касса наличных" },
  { value: "bank_account", label: "Расчётный счёт" },
  { value: "acquiring", label: "Эквайринг" },
  { value: "online", label: "Онлайн-оплата" },
]

export interface CreatedAccount {
  id: string
  name: string
  type: string
  branchId?: string | null
  branch?: { id: string; name: string } | null
}

interface Props {
  branches: BranchOption[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSuccess?: (account: CreatedAccount) => void
  hideTrigger?: boolean
  refreshOnSuccess?: boolean
}

export function AddAccountDialog({
  branches,
  open: openProp,
  onOpenChange,
  onSuccess,
  hideTrigger,
  refreshOnSuccess = true,
}: Props) {
  const router = useRouter()
  const [openInternal, setOpenInternal] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp! : openInternal
  const setOpen = (v: boolean) => {
    if (!isControlled) setOpenInternal(v)
    onOpenChange?.(v)
  }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [type, setType] = useState("")
  const [branchId, setBranchId] = useState("")

  function reset() {
    setName("")
    setType("")
    setBranchId("")
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) { setError("Введите название счёта"); return }
    if (!type) { setError("Выберите тип счёта"); return }

    setLoading(true)
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          branchId: branchId || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при создании счёта")
        return
      }

      const account = (await res.json()) as CreatedAccount
      reset()
      setOpen(false)
      onSuccess?.(account)
      if (refreshOnSuccess) router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const selectedType = TYPE_OPTIONS.find(t => t.value === type)
  const selectedBranch = branches.find(b => b.id === branchId)

  return (
    <>
    {!hideTrigger && (
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 size-4" />
        Счёт
      </Button>
    )}
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Новый счёт</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Название *</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Например: Касса филиала на Ленина"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Тип *</Label>
            <Select value={type} onValueChange={(v) => { if (v) setType(v) }}>
              <SelectTrigger className="w-full">
                {selectedType ? selectedType.label : "Выберите тип"}
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {branches.length > 0 && (
            <div className="space-y-1.5">
              <Label>Филиал</Label>
              <Select value={branchId} onValueChange={(v) => { if (v !== null) setBranchId(v) }}>
                <SelectTrigger className="w-full">
                  {selectedBranch ? selectedBranch.name : "Все филиалы"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Все филиалы</SelectItem>
                  {branches.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Сохранение..." : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  )
}
