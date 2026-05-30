"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Plus, Pencil, Trash2, ListChecks, Check } from "lucide-react"
import { PageHelp } from "@/components/page-help"

interface AttendanceType {
  id: string
  tenantId: string | null
  code: string
  name: string
  chargesSubscription: boolean
  paysInstructor: boolean
  countsAsRevenue: boolean
  availableToInstructor: boolean
  availableToAdmin: boolean
  partOfPlan: boolean
  partOfFact: boolean
  partOfForecast: boolean
  chargePercent: number
  isSystem: boolean
  isFlagsLocked: boolean
  isActive: boolean
  sortOrder: number
}

type FlagKey =
  | "availableToInstructor"
  | "availableToAdmin"
  | "partOfPlan"
  | "partOfFact"
  | "partOfForecast"
  | "chargesSubscription"
  | "paysInstructor"
  | "isActive"

// Поля, которые остаются редактируемыми даже у заблокированных (системных) типов.
// Настройки доступа к ролям — на усмотрение каждого центра.
const LOCKED_ALLOWED: ReadonlySet<FlagKey> = new Set<FlagKey>([
  "availableToInstructor",
  "availableToAdmin",
])

const FLAG_COLUMNS: { key: FlagKey; label: string; hint: string }[] = [
  { key: "availableToInstructor", label: "Доступно педагогу", hint: "Педагог может сам выбрать этот статус в карточке занятия" },
  { key: "availableToAdmin", label: "Доступно админу", hint: "Администратор может выбрать этот статус в карточке занятия" },
  { key: "partOfPlan", label: "План", hint: "Учитывается в плановом расписании" },
  { key: "partOfFact", label: "Факт", hint: "Засчитывается как фактическое посещение" },
  { key: "partOfForecast", label: "Прогноз", hint: "Входит в прогноз выручки/списаний" },
  { key: "chargesSubscription", label: "Списание оплаты", hint: "Списывается занятие/деньги с клиента" },
  { key: "paysInstructor", label: "Начисление педагогу", hint: "Начисляется оплата инструктору" },
]

export default function AttendanceMatrixPage() {
  const router = useRouter()
  const [types, setTypes] = useState<AttendanceType[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editType, setEditType] = useState<AttendanceType | null>(null)
  const [form, setForm] = useState({
    code: "",
    name: "",
    chargesSubscription: false,
    paysInstructor: false,
    countsAsRevenue: false,
    availableToInstructor: false,
    availableToAdmin: true,
    partOfPlan: false,
    partOfFact: false,
    partOfForecast: false,
    chargePercent: 100,
    isActive: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/attendance-types")
      if (res.ok) {
        const all = (await res.json()) as AttendanceType[]
        // Ф7: скрываем internal-only типы (оба availableTo*=false) — они ставятся
        // программно (bulk safety-net), вручную не выбираются ни одной ролью.
        setTypes(all.filter((t) => t.availableToInstructor || t.availableToAdmin))
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function patchField(t: AttendanceType, patch: Partial<AttendanceType>) {
    setSavingId(t.id)
    try {
      const res = await fetch(`/api/attendance-types/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        const updated = await res.json()
        setTypes((prev) => prev.map((x) => (x.id === t.id ? updated : x)))
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Ошибка сохранения")
        load()
      }
    } catch {
      alert("Ошибка сети")
      load()
    } finally {
      setSavingId(null)
    }
  }

  function toggleFlag(t: AttendanceType, key: FlagKey) {
    patchField(t, { [key]: !t[key] } as Partial<AttendanceType>)
  }

  function commitPercent(t: AttendanceType, value: string) {
    const n = Math.max(0, Math.min(100, parseInt(value, 10) || 0))
    if (n === t.chargePercent) return
    patchField(t, { chargePercent: n })
  }

  function openCreate() {
    setEditType(null)
    setForm({
      code: "",
      name: "",
      chargesSubscription: false,
      paysInstructor: false,
      countsAsRevenue: false,
      availableToInstructor: false,
      availableToAdmin: true,
      partOfPlan: false,
      partOfFact: false,
      partOfForecast: false,
      chargePercent: 100,
      isActive: true,
    })
    setError(null)
    setDialogOpen(true)
  }

  function openEdit(t: AttendanceType) {
    setEditType(t)
    setForm({
      code: t.code,
      name: t.name,
      chargesSubscription: t.chargesSubscription,
      paysInstructor: t.paysInstructor,
      countsAsRevenue: t.countsAsRevenue,
      availableToInstructor: t.availableToInstructor,
      availableToAdmin: t.availableToAdmin,
      partOfPlan: t.partOfPlan,
      partOfFact: t.partOfFact,
      partOfForecast: t.partOfForecast,
      chargePercent: t.chargePercent,
      isActive: t.isActive,
    })
    setError(null)
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("Укажите название")
      return
    }
    if (!editType && !form.code.trim()) {
      setError("Укажите код (латиница, цифры, _)")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const url = editType ? `/api/attendance-types/${editType.id}` : "/api/attendance-types"
      const method = editType ? "PATCH" : "POST"
      const body = editType
        ? {
            name: form.name.trim(),
            chargesSubscription: form.chargesSubscription,
            paysInstructor: form.paysInstructor,
            countsAsRevenue: form.countsAsRevenue,
            availableToInstructor: form.availableToInstructor,
            availableToAdmin: form.availableToAdmin,
            partOfPlan: form.partOfPlan,
            partOfFact: form.partOfFact,
            partOfForecast: form.partOfForecast,
            chargePercent: form.chargePercent,
            isActive: form.isActive,
          }
        : {
            ...form,
            code: form.code.trim(),
            name: form.name.trim(),
          }
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при сохранении")
        return
      }
      setDialogOpen(false)
      load()
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(t: AttendanceType) {
    if (!confirm(`Удалить тип «${t.name}»?`)) return
    try {
      const res = await fetch(`/api/attendance-types/${t.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Не удалось удалить")
        return
      }
      load()
    } catch {
      alert("Ошибка сети")
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Виды посещений</h1>
            <PageHelp pageKey="settings/attendance-matrix" />
          </div>
          <p className="text-sm text-muted-foreground">
            Настройка матрицы статусов «Тип дня» в карточке занятия: что списывается с клиента и начисляется педагогу
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 size-4" />
          Тип посещения
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Загрузка...
          </CardContent>
        </Card>
      ) : types.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <ListChecks className="size-10 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">Нет видов посещений</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Создайте хотя бы один тип, чтобы отмечать посещения на занятиях
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  {FLAG_COLUMNS.map((c) => (
                    <TableHead key={c.key} className="text-center" title={c.hint}>
                      {c.label}
                    </TableHead>
                  ))}
                  <TableHead className="text-center" title="Процент списания при «Списание оплаты=да». 100% = полное списание занятия">
                    %
                  </TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((t) => (
                  <TableRow key={t.id} className={!t.isActive ? "opacity-50" : ""}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    {FLAG_COLUMNS.map((c) => {
                      const locked = t.isFlagsLocked && !LOCKED_ALLOWED.has(c.key)
                      const disabled = savingId === t.id || locked
                      const value = t[c.key]
                      return (
                        <TableCell key={c.key} className="text-center">
                          {locked ? (
                            <span
                              className={`inline-flex size-5 items-center justify-center rounded border ${
                                value
                                  ? "border-foreground/40 bg-foreground/10 text-foreground"
                                  : "border-muted-foreground/30 bg-transparent"
                              }`}
                              title="Системный — менять нельзя"
                            >
                              {value && <Check className="size-3.5" strokeWidth={3} />}
                            </span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={value}
                              disabled={disabled}
                              onChange={() => toggleFlag(t, c.key)}
                              className="size-4 rounded border cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          )}
                        </TableCell>
                      )
                    })}
                    <TableCell className="text-center">
                      {t.chargesSubscription ? (
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          defaultValue={t.chargePercent}
                          disabled={savingId === t.id || t.isFlagsLocked}
                          onBlur={(e) => commitPercent(t, e.target.value)}
                          className="h-7 w-16 text-center text-xs px-1"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {t.isSystem ? (
                        <Badge variant="outline" title={t.isFlagsLocked ? "Системный тип — менять можно только доступ к ролям и видимость" : undefined}>
                          Системный
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Свой</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {!t.isFlagsLocked && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => openEdit(t)}
                            title="Редактировать"
                          >
                            <Pencil className="size-4 text-muted-foreground" />
                          </Button>
                        )}
                        {!t.isSystem && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => handleDelete(t)}
                            title="Удалить"
                          >
                            <Trash2 className="size-4 text-muted-foreground" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editType ? `Редактировать «${editType.name}»` : "Новый вид посещения"}
            </DialogTitle>
            <DialogDescription>
              Появится в выпадашке «Тип дня» при отметке посещений
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label>Название</Label>
              <Input
                placeholder="Например: Болезнь"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            {!editType && (
              <div className="space-y-2">
                <Label>Код</Label>
                <Input
                  placeholder="latin_snake_case (например, sick_leave)"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Внутренний идентификатор. Латиница, цифры, подчёркивания. После создания не меняется.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {FLAG_COLUMNS.map((c) => (
                <Label key={c.key} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={form[c.key]}
                    onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.checked }))}
                    className="size-4 rounded border"
                  />
                  <span title={c.hint}>{c.label}</span>
                </Label>
              ))}
            </div>

            {form.chargesSubscription && (
              <div className="space-y-2">
                <Label>Процент списания (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.chargePercent}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      chargePercent: Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)),
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  100% — списать полное занятие. Меньше — частичное списание (штраф).
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Сохранение..." : editType ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
