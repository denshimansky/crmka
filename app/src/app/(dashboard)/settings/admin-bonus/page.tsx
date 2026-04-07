"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Save, Plus, Trash2, Building2, Users } from "lucide-react"

interface AdminBonusSettings {
  id: string | null
  trialBonus: number
  saleBonus: number
  upsaleBonus: number
}

interface BranchOverride {
  id: string
  branchId: string
  branchName: string
  trialBonus: number | null
  saleBonus: number | null
  upsaleBonus: number | null
}

interface EmployeeOverride {
  id: string
  employeeId: string
  employeeName: string
  trialBonus: number | null
  saleBonus: number | null
  upsaleBonus: number | null
}

interface Branch {
  id: string
  name: string
}

interface Employee {
  id: string
  name: string
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

export default function AdminBonusPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Global settings
  const [trialBonus, setTrialBonus] = useState("0")
  const [saleBonus, setSaleBonus] = useState("0")
  const [upsaleBonus, setUpsaleBonus] = useState("0")

  // Overrides
  const [branchOverrides, setBranchOverrides] = useState<BranchOverride[]>([])
  const [employeeOverrides, setEmployeeOverrides] = useState<EmployeeOverride[]>([])

  // Available entities for selects
  const [branches, setBranches] = useState<Branch[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])

  // New override state
  const [newBranchId, setNewBranchId] = useState("")
  const [newEmployeeId, setNewEmployeeId] = useState("")

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [settingsRes, branchesRes, employeesRes] = await Promise.all([
        fetch("/api/admin-bonus-settings"),
        fetch("/api/branches"),
        fetch("/api/employees?role=admin"),
      ])

      if (settingsRes.ok) {
        const data = await settingsRes.json()
        setTrialBonus(String(data.global?.trialBonus || 0))
        setSaleBonus(String(data.global?.saleBonus || 0))
        setUpsaleBonus(String(data.global?.upsaleBonus || 0))
        setBranchOverrides(data.branchOverrides || [])
        setEmployeeOverrides(data.employeeOverrides || [])
      }

      if (branchesRes.ok) setBranches(await branchesRes.json())
      if (employeesRes.ok) {
        const emps = await employeesRes.json()
        setEmployees(emps.map((e: { id: string; firstName: string; lastName: string }) => ({
          id: e.id,
          name: `${e.lastName} ${e.firstName}`,
        })))
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  async function handleSaveGlobal() {
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const res = await fetch("/api/admin-bonus-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trialBonus: Number(trialBonus) || 0,
          saleBonus: Number(saleBonus) || 0,
          upsaleBonus: Number(upsaleBonus) || 0,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при сохранении")
        return
      }

      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  async function addBranchOverride() {
    if (!newBranchId) return
    try {
      const res = await fetch("/api/admin-bonus-settings/branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: newBranchId }),
      })
      if (res.ok) {
        setNewBranchId("")
        loadData()
      }
    } catch { /* ignore */ }
  }

  async function addEmployeeOverride() {
    if (!newEmployeeId) return
    try {
      const res = await fetch("/api/admin-bonus-settings/employee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: newEmployeeId }),
      })
      if (res.ok) {
        setNewEmployeeId("")
        loadData()
      }
    } catch { /* ignore */ }
  }

  async function updateOverride(type: "branch" | "employee", id: string, field: string, value: string) {
    try {
      await fetch(`/api/admin-bonus-settings/${type}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value === "" ? null : Number(value) }),
      })
      loadData()
    } catch { /* ignore */ }
  }

  async function deleteOverride(type: "branch" | "employee", id: string) {
    if (!confirm("Удалить переопределение?")) return
    try {
      await fetch(`/api/admin-bonus-settings/${type}/${id}`, { method: "DELETE" })
      loadData()
    } catch { /* ignore */ }
  }

  const usedBranchIds = branchOverrides.map(o => o.branchId)
  const usedEmployeeIds = employeeOverrides.map(o => o.employeeId)
  const availableBranches = branches.filter(b => !usedBranchIds.includes(b.id))
  const availableEmployees = employees.filter(e => !usedEmployeeIds.includes(e.id))

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Бонусы администраторов</h1>
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Загрузка...
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Бонусы администраторов</h1>
        <p className="text-sm text-muted-foreground">
          Настройка вознаграждений за пробные, продажи и допродажи
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
          Настройки сохранены
        </div>
      )}

      {/* Global settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Базовые ставки (по умолчанию)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>За пробное занятие</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={trialBonus}
                  onChange={(e) => setTrialBonus(e.target.value)}
                  placeholder="0"
                />
                <span className="text-sm text-muted-foreground shrink-0">₽</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>За продажу (первый абонемент)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={saleBonus}
                  onChange={(e) => setSaleBonus(e.target.value)}
                  placeholder="0"
                />
                <span className="text-sm text-muted-foreground shrink-0">₽</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>За допродажу (повторный абонемент)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={upsaleBonus}
                  onChange={(e) => setUpsaleBonus(e.target.value)}
                  placeholder="0"
                />
                <span className="text-sm text-muted-foreground shrink-0">₽</span>
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button onClick={handleSaveGlobal} disabled={saving}>
              <Save className="mr-2 size-4" />
              {saving ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Branch overrides */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" />
              <CardTitle className="text-base">По филиалам</CardTitle>
            </div>
            {availableBranches.length > 0 && (
              <div className="flex items-center gap-2">
                <Select value={newBranchId} onValueChange={(v) => { if (v) setNewBranchId(v) }}>
                  <SelectTrigger className="w-[180px]">
                    {newBranchId
                      ? branches.find(b => b.id === newBranchId)?.name
                      : <span className="text-muted-foreground">Филиал</span>
                    }
                  </SelectTrigger>
                  <SelectContent>
                    {availableBranches.map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={addBranchOverride} disabled={!newBranchId}>
                  <Plus className="size-4" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {branchOverrides.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Нет переопределений по филиалам. Используются базовые ставки.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Филиал</TableHead>
                  <TableHead className="text-right">Пробное</TableHead>
                  <TableHead className="text-right">Продажа</TableHead>
                  <TableHead className="text-right">Допродажа</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {branchOverrides.map(o => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.branchName}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-[100px] ml-auto text-right"
                        defaultValue={o.trialBonus ?? ""}
                        placeholder={trialBonus}
                        onBlur={(e) => updateOverride("branch", o.id, "trialBonus", e.target.value)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-[100px] ml-auto text-right"
                        defaultValue={o.saleBonus ?? ""}
                        placeholder={saleBonus}
                        onBlur={(e) => updateOverride("branch", o.id, "saleBonus", e.target.value)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-[100px] ml-auto text-right"
                        defaultValue={o.upsaleBonus ?? ""}
                        placeholder={upsaleBonus}
                        onBlur={(e) => updateOverride("branch", o.id, "upsaleBonus", e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => deleteOverride("branch", o.id)}
                      >
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Employee overrides */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              <CardTitle className="text-base">По сотрудникам</CardTitle>
            </div>
            {availableEmployees.length > 0 && (
              <div className="flex items-center gap-2">
                <Select value={newEmployeeId} onValueChange={(v) => { if (v) setNewEmployeeId(v) }}>
                  <SelectTrigger className="w-[180px]">
                    {newEmployeeId
                      ? employees.find(e => e.id === newEmployeeId)?.name
                      : <span className="text-muted-foreground">Сотрудник</span>
                    }
                  </SelectTrigger>
                  <SelectContent>
                    {availableEmployees.map(e => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={addEmployeeOverride} disabled={!newEmployeeId}>
                  <Plus className="size-4" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {employeeOverrides.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Нет переопределений по сотрудникам. Используются базовые ставки (или ставки филиала).
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Сотрудник</TableHead>
                  <TableHead className="text-right">Пробное</TableHead>
                  <TableHead className="text-right">Продажа</TableHead>
                  <TableHead className="text-right">Допродажа</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {employeeOverrides.map(o => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.employeeName}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-[100px] ml-auto text-right"
                        defaultValue={o.trialBonus ?? ""}
                        placeholder={trialBonus}
                        onBlur={(e) => updateOverride("employee", o.id, "trialBonus", e.target.value)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-[100px] ml-auto text-right"
                        defaultValue={o.saleBonus ?? ""}
                        placeholder={saleBonus}
                        onBlur={(e) => updateOverride("employee", o.id, "saleBonus", e.target.value)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-[100px] ml-auto text-right"
                        defaultValue={o.upsaleBonus ?? ""}
                        placeholder={upsaleBonus}
                        onBlur={(e) => updateOverride("employee", o.id, "upsaleBonus", e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => deleteOverride("employee", o.id)}
                      >
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
