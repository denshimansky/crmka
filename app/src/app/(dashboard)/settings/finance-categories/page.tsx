"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
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
import { Plus, Pencil, Trash2, ArrowDownUp } from "lucide-react"
import { PageHelp } from "@/components/page-help"

interface ExpenseCategory {
  id: string
  tenantId: string | null
  name: string
  isSystem: boolean
  isActive: boolean
  isVariable: boolean
  isSalary: boolean
  sortOrder: number
}

interface IncomeCategory {
  id: string
  tenantId: string | null
  name: string
  isSystem: boolean
  isActive: boolean
  sortOrder: number
}

type CategoryKind = "expense" | "income"

interface CategoryFormState {
  name: string
  isActive: boolean
  // null = пользователь ещё не выбрал «Постоянный/Переменный».
  // Для новых категорий стартуем с null, чтобы выбор был осознанным;
  // у существующих подставляем фактическое значение из БД.
  isVariable: boolean | null
  isSalary: boolean
}

export default function FinanceCategoriesPage() {
  const router = useRouter()
  const [expenses, setExpenses] = useState<ExpenseCategory[]>([])
  const [incomes, setIncomes] = useState<IncomeCategory[]>([])
  const [loading, setLoading] = useState(true)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogKind, setDialogKind] = useState<CategoryKind>("expense")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingIsSystem, setEditingIsSystem] = useState(false)
  const [form, setForm] = useState<CategoryFormState>({
    name: "",
    isActive: true,
    isVariable: null,
    isSalary: false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [eRes, iRes] = await Promise.all([
        fetch("/api/expense-categories?includeInactive=true"),
        fetch("/api/income-categories?includeInactive=true"),
      ])
      if (eRes.ok) setExpenses(await eRes.json())
      if (iRes.ok) setIncomes(await iRes.json())
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openCreate(kind: CategoryKind) {
    setDialogKind(kind)
    setEditingId(null)
    setEditingIsSystem(false)
    setForm({ name: "", isActive: true, isVariable: null, isSalary: false })
    setError(null)
    setDialogOpen(true)
  }

  function openEditExpense(c: ExpenseCategory) {
    setDialogKind("expense")
    setEditingId(c.id)
    setEditingIsSystem(c.isSystem)
    setForm({
      name: c.name,
      isActive: c.isActive,
      isVariable: c.isVariable,
      isSalary: c.isSalary,
    })
    setError(null)
    setDialogOpen(true)
  }

  function openEditIncome(c: IncomeCategory) {
    setDialogKind("income")
    setEditingId(c.id)
    setEditingIsSystem(c.isSystem)
    setForm({
      name: c.name,
      isActive: c.isActive,
      isVariable: null,
      isSalary: false,
    })
    setError(null)
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim() && !editingIsSystem) {
      setError("Укажите название")
      return
    }
    if (dialogKind === "expense" && form.isVariable === null) {
      setError("Выберите тип затрат: постоянный или переменный")
      return
    }

    setSaving(true)
    setError(null)

    const apiBase = dialogKind === "expense" ? "/api/expense-categories" : "/api/income-categories"
    const url = editingId ? `${apiBase}/${editingId}` : apiBase
    const method = editingId ? "PATCH" : "POST"

    const body: Record<string, unknown> = {
      isActive: form.isActive,
    }
    if (!editingIsSystem) body.name = form.name.trim()
    if (dialogKind === "expense") {
      body.isVariable = form.isVariable
      body.isSalary = form.isSalary
    }

    try {
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

  async function handleDelete(kind: CategoryKind, id: string) {
    if (!confirm("Деактивировать категорию?")) return
    const apiBase = kind === "expense" ? "/api/expense-categories" : "/api/income-categories"
    try {
      await fetch(`${apiBase}/${id}`, { method: "DELETE" })
      load()
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Статьи доходов и расходов</h1>
            <PageHelp pageKey="settings/finance-categories" />
          </div>
          <p className="text-sm text-muted-foreground">
            Категории для журнала ДДС и отчёта ОПИУ. Системные категории видны всем тенантам и не редактируются.
          </p>
        </div>
      </div>

      <Tabs defaultValue="expense">
        <TabsList>
          <TabsTrigger value="expense">Расходы ({expenses.length})</TabsTrigger>
          <TabsTrigger value="income">Доходы ({incomes.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="expense" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => openCreate("expense")}>
              <Plus className="mr-2 size-4" />
              Категория расхода
            </Button>
          </div>

          {loading ? (
            <Card>
              <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
                Загрузка...
              </CardContent>
            </Card>
          ) : expenses.length === 0 ? (
            <EmptyState text="Нет категорий расходов" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Источник</TableHead>
                  <TableHead>ЗП</TableHead>
                  <TableHead>Тип затрат</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((c) => (
                  <TableRow key={c.id} className={c.isActive ? "" : "opacity-60"}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      {c.isSystem ? (
                        <Badge variant="outline">Системная</Badge>
                      ) : (
                        <Badge variant="secondary">Пользовательская</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.isSalary && <Badge variant="outline">ЗП</Badge>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.isVariable ? "default" : "outline"}>
                        {c.isVariable ? "Переменный" : "Постоянный"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {c.isActive ? (
                        <Badge variant="default">Активна</Badge>
                      ) : (
                        <Badge variant="secondary">Архивная</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEditExpense(c)}
                        >
                          <Pencil className="size-4 text-muted-foreground" />
                        </Button>
                        {!c.isSystem && c.isActive && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => handleDelete("expense", c.id)}
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
          )}
        </TabsContent>

        <TabsContent value="income" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => openCreate("income")}>
              <Plus className="mr-2 size-4" />
              Категория дохода
            </Button>
          </div>

          {loading ? (
            <Card>
              <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
                Загрузка...
              </CardContent>
            </Card>
          ) : incomes.length === 0 ? (
            <EmptyState text="Нет категорий доходов" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Источник</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {incomes.map((c) => (
                  <TableRow key={c.id} className={c.isActive ? "" : "opacity-60"}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      {c.isSystem ? (
                        <Badge variant="outline">Системная</Badge>
                      ) : (
                        <Badge variant="secondary">Пользовательская</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.isActive ? (
                        <Badge variant="default">Активна</Badge>
                      ) : (
                        <Badge variant="secondary">Архивная</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {!c.isSystem && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() => openEditIncome(c)}
                            >
                              <Pencil className="size-4 text-muted-foreground" />
                            </Button>
                            {c.isActive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => handleDelete("income", c.id)}
                              >
                                <Trash2 className="size-4 text-muted-foreground" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? dialogKind === "expense"
                  ? "Редактировать статью расхода"
                  : "Редактировать статью дохода"
                : dialogKind === "expense"
                  ? "Новая статья расхода"
                  : "Новая статья дохода"}
            </DialogTitle>
            <DialogDescription>
              {dialogKind === "expense"
                ? "Используется при внесении расходов и в отчёте ОПИУ"
                : "Используется для прочих поступлений (проценты банка, продажа товаров и т.п.)"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}

            <div className="space-y-2">
              <Label>Название</Label>
              <Input
                placeholder={dialogKind === "expense" ? "Аренда зала" : "Проценты банка"}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={editingIsSystem}
              />
              {editingIsSystem && (
                <p className="text-xs text-muted-foreground">
                  Имя системной категории нельзя менять.
                </p>
              )}
            </div>

            {dialogKind === "expense" && (
              <>
                <div className="space-y-2">
                  <Label>Тип затрат *</Label>
                  <div className="flex flex-col gap-2">
                    <Label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        name="cost-type"
                        checked={form.isVariable === false}
                        onChange={() => setForm({ ...form, isVariable: false })}
                        className="mt-0.5 size-4"
                      />
                      <span className="flex flex-col">
                        <span>Постоянный</span>
                        <span className="text-xs font-normal text-muted-foreground">
                          Не зависит от выручки (аренда, коммуналка). В ОПИУ распределяется
                          по направлениям пропорционально выручке.
                        </span>
                      </span>
                    </Label>
                    <Label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        name="cost-type"
                        checked={form.isVariable === true}
                        onChange={() => setForm({ ...form, isVariable: true })}
                        className="mt-0.5 size-4"
                      />
                      <span className="flex flex-col">
                        <span>Переменный</span>
                        <span className="text-xs font-normal text-muted-foreground">
                          Зависит от объёма (расходники, эквайринг). В ОПИУ вычитается до маржи.
                        </span>
                      </span>
                    </Label>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.isSalary}
                      onChange={(e) => setForm({ ...form, isSalary: e.target.checked })}
                      className="size-4 rounded border"
                    />
                    <span>Категория ЗП</span>
                  </Label>
                </div>
              </>
            )}

            <div className="flex items-center gap-3">
              <Label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="size-4 rounded border"
                />
                <span>Активна</span>
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Сохранение..." : editingId ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <ArrowDownUp className="size-10 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">{text}</h2>
        </div>
      </CardContent>
    </Card>
  )
}
