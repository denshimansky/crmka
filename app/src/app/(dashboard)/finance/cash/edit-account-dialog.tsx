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
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Archive, Pencil } from "lucide-react"

interface BranchOption {
  id: string
  name: string
}

interface AccountData {
  id: string
  name: string
  type: string
  branchId: string | null
  balance: number
}

const TYPE_OPTIONS = [
  { value: "cash", label: "Касса наличных" },
  { value: "bank_account", label: "Расчётный счёт" },
  { value: "acquiring", label: "Эквайринг" },
  { value: "online", label: "Онлайн-оплата" },
]

export function EditAccountDialog({
  account,
  branches,
  userRole,
}: {
  account: AccountData
  branches: BranchOption[]
  userRole: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(account.name)
  const [type, setType] = useState(account.type)
  const [branchId, setBranchId] = useState(account.branchId || "")

  const canArchive = userRole === "owner"
  const balanceIsZero = Math.abs(account.balance) < 0.005

  function reset() {
    setName(account.name)
    setType(account.type)
    setBranchId(account.branchId || "")
    setError(null)
  }

  async function handleArchive() {
    setError(null)
    if (!confirm(`Архивировать счёт «${account.name}»? История операций сохранится, но счёт исчезнет из активного списка.`)) {
      return
    }
    setArchiving(true)
    try {
      const res = await fetch(`/api/accounts/${account.id}/archive`, {
        method: "POST",
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось архивировать счёт")
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setArchiving(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError("Введите название счёта")
      return
    }
    if (!type) {
      setError("Выберите тип счёта")
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          branchId: branchId || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при обновлении счёта")
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

  const selectedType = TYPE_OPTIONS.find((t) => t.value === type)
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
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Редактировать счёт</DialogTitle>
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
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Касса филиала на Ленина"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Тип *</Label>
            <Select
              value={type}
              onValueChange={(v) => {
                if (v) setType(v)
              }}
            >
              <SelectTrigger className="w-full">
                {selectedType ? selectedType.label : "Выберите тип"}
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                  {selectedBranch ? selectedBranch.name : "Все филиалы"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Все филиалы</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
            <div>
              {canArchive && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={handleArchive}
                  disabled={archiving || loading || !balanceIsZero}
                  title={balanceIsZero ? "Архивировать счёт" : "Архивировать можно только при нулевом балансе"}
                >
                  <Archive className="mr-1 size-4" />
                  {archiving ? "Архивация..." : "Архивировать"}
                </Button>
              )}
            </div>
            <Button type="submit" disabled={loading || archiving}>
              {loading ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
