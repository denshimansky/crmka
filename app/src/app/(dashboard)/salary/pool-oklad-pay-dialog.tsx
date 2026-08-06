"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Banknote } from "lucide-react"
import { OkladPayBody } from "./instructor/[employeeId]/oklad-pay-dialog"
import type { InstructorDetailData } from "./instructor/[employeeId]/instructor-detail-client"

// Окладная выплата из общего пула /salary (вкладка «Оклады»): та же форма, что в
// карточке (OkladPayBody: сумма + ОПИУ + корректировки), но первым полем — выбор
// сотрудника. По выбору подтягиваем окладную детализацию (kind=salary).
export function PoolOkladPayDialog({
  employees, periodYear, periodMonth,
}: {
  employees: { id: string; name: string }[]
  periodYear: number
  periodMonth: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [employeeId, setEmployeeId] = useState("")
  const [data, setData] = useState<InstructorDetailData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleOpen(v: boolean) {
    setOpen(v)
    if (v) {
      setEmployeeId("")
      setData(null)
      setError(null)
    }
  }

  async function selectEmployee(id: string) {
    setEmployeeId(id)
    setData(null)
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/salary/instructor/${id}?periodYear=${periodYear}&periodMonth=${periodMonth}&kind=salary`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Не удалось загрузить начисления")
        return
      }
      setData(await res.json())
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const selectedName = employees.find((e) => e.id === employeeId)?.name

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={<Button />}>
        <Banknote className="mr-2 size-4" />
        Провести выплату
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Выплата оклада</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Сотрудник *</Label>
            <Select value={employeeId} onValueChange={(v) => { if (v) selectEmployee(v) }}>
              <SelectTrigger className="w-full">{selectedName ?? "Выберите сотрудника"}</SelectTrigger>
              <SelectContent>
                {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          {loading && <p className="text-sm text-muted-foreground">Загрузка…</p>}

          {data && !loading && (
            <OkladPayBody
              key={employeeId}
              mode="remainder"
              data={data}
              onCancel={() => setOpen(false)}
              onPaid={() => { setOpen(false); router.refresh() }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
