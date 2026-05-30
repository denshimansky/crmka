"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Building2, MapPin, BookOpen, UserCog, Wallet, PartyPopper,
  ChevronLeft, ChevronRight, SkipForward, Loader2, Check,
  Plus, DoorOpen,
} from "lucide-react"
import {
  CreateBranchDialog, type CreatedBranch,
} from "@/app/(dashboard)/settings/create-branch-dialog"
import {
  CreateRoomDialog, type CreatedRoom,
} from "@/app/(dashboard)/settings/create-room-dialog"
import {
  CreateDirectionDialog, type CreatedDirection,
} from "@/app/(dashboard)/settings/create-direction-dialog"
import {
  CreateEmployeeDialog, type CreatedEmployee,
} from "@/app/(dashboard)/staff/create-employee-dialog"
import { SalaryRatesDialog } from "@/app/(dashboard)/staff/salary-rates-dialog"
import {
  AddAccountDialog, type CreatedAccount,
} from "@/app/(dashboard)/finance/cash/add-account-dialog"

interface OnboardingWizardProps {
  orgName: string
  orgInn: string | null
}

const STEPS = [
  { title: "Добро пожаловать", icon: Building2 },
  { title: "Филиалы", icon: MapPin },
  { title: "Направления", icon: BookOpen },
  { title: "Сотрудники", icon: UserCog },
  { title: "Кассы", icon: Wallet },
  { title: "Готово!", icon: PartyPopper },
] as const

interface BranchItem {
  id: string
  name: string
  address?: string | null
  workingHoursStart?: string | null
  workingHoursEnd?: string | null
  rooms: { id: string; name: string; capacity: number }[]
}

interface DirectionItem {
  id: string
  name: string
  lessonPrice: number | string
  color?: string | null
  icon?: string | null
}

interface EmployeeItem {
  id: string
  firstName: string
  lastName: string
  middleName?: string | null
  role: string
  login: string
  salaryRatesCount?: number
}

interface AccountItem {
  id: string
  name: string
  type: string
  branchId?: string | null
  branch?: { id: string; name: string } | null
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Владелец",
  manager: "Управляющий",
  admin: "Администратор",
  instructor: "Инструктор",
  readonly: "Только чтение",
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  cash: "Касса",
  bank_account: "Р/с",
  acquiring: "Эквайринг",
  online: "Онлайн",
}

export function OnboardingWizard({ orgName, orgInn }: OnboardingWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const [name, setName] = useState(orgName)
  const [inn, setInn] = useState(orgInn ?? "")

  const [branches, setBranches] = useState<BranchItem[]>([])
  const [directions, setDirections] = useState<DirectionItem[]>([])
  const [employees, setEmployees] = useState<EmployeeItem[]>([])
  const [accounts, setAccounts] = useState<AccountItem[]>([])

  const [branchDialogOpen, setBranchDialogOpen] = useState(false)
  const [roomDialogFor, setRoomDialogFor] = useState<string | null>(null)
  const [directionDialogOpen, setDirectionDialogOpen] = useState(false)
  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false)
  const [salaryDialogFor, setSalaryDialogFor] = useState<{ id: string; name: string } | null>(null)
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)

  const loadAll = useCallback(async () => {
    try {
      const [bRes, dRes, eRes, aRes] = await Promise.all([
        fetch("/api/branches"),
        fetch("/api/directions"),
        fetch("/api/employees"),
        fetch("/api/accounts"),
      ])
      if (bRes.ok) setBranches(await bRes.json())
      if (dRes.ok) setDirections(await dRes.json())
      if (eRes.ok) {
        const data = await eRes.json()
        setEmployees(
          data.map((e: { id: string; firstName: string; lastName: string; middleName?: string | null; role: string; login: string; salaryRates?: unknown[] }) => ({
            id: e.id,
            firstName: e.firstName,
            lastName: e.lastName,
            middleName: e.middleName,
            role: e.role,
            login: e.login,
            salaryRatesCount: Array.isArray(e.salaryRates) ? e.salaryRates.length : 0,
          })),
        )
      }
      if (aRes.ok) setAccounts(await aRes.json())
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  async function saveOrganization() {
    if (!name.trim()) {
      setError("Укажите название организации")
      return
    }
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), inn: inn.trim() || undefined }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось сохранить")
        return
      }
      setStep(1)
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  async function finishOnboarding() {
    setSaving(true)
    try {
      await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingCompleted: true }),
      })
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  function handleBranchCreated(b: CreatedBranch) {
    setBranches((prev) => [...prev, { ...b, rooms: [] }])
  }

  function handleRoomCreated(branchId: string, r: CreatedRoom) {
    setBranches((prev) =>
      prev.map((b) =>
        b.id === branchId
          ? { ...b, rooms: [...b.rooms, { id: r.id, name: r.name, capacity: r.capacity }] }
          : b,
      ),
    )
  }

  function handleDirectionCreated(d: CreatedDirection) {
    setDirections((prev) => [...prev, d])
  }

  function handleEmployeeCreated(e: CreatedEmployee) {
    const fullName = [e.lastName, e.firstName].filter(Boolean).join(" ") || e.login
    setEmployees((prev) => [...prev, { ...e, salaryRatesCount: 0 }])
    setEmployeeDialogOpen(false)
    if (e.role === "instructor") {
      setSalaryDialogFor({ id: e.id, name: fullName })
    }
  }

  function handleSalaryDialogChange(open: boolean) {
    if (!open && salaryDialogFor) {
      // обновим число ставок у этого сотрудника
      const targetId = salaryDialogFor.id
      fetch(`/api/employees/${targetId}/salary-rates`)
        .then((res) => (res.ok ? res.json() : []))
        .then((rates: unknown[]) => {
          setEmployees((prev) =>
            prev.map((emp) =>
              emp.id === targetId ? { ...emp, salaryRatesCount: rates.length } : emp,
            ),
          )
        })
        .catch(() => { /* ignore */ })
      setSalaryDialogFor(null)
    }
  }

  function handleAccountCreated(a: CreatedAccount) {
    setAccounts((prev) => [...prev, a])
  }

  const progress = Math.round((step / (STEPS.length - 1)) * 100)
  const currentStep = STEPS[step]
  const Icon = currentStep.icon

  return (
    <div className="mx-auto max-w-2xl">
      {/* Прогресс */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
          <span>Шаг {step + 1} из {STEPS.length}</span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon className="size-5 text-primary" />
            {currentStep.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Шаг 0: Организация */}
          {step === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Давайте начнём с базовой информации о вашей организации. Эти данные
                можно будет изменить позже в настройках.
              </p>
              <div className="space-y-1.5">
                <Label>Название организации *</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Детский центр «Звёздочка»"
                />
              </div>
              <div className="space-y-1.5">
                <Label>ИНН (опционально)</Label>
                <Input
                  value={inn}
                  onChange={(e) => setInn(e.target.value)}
                  placeholder="1234567890"
                />
              </div>
            </div>
          )}

          {/* Шаг 1: Филиалы */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Добавьте все ваши филиалы и кабинеты в них. Кабинеты используются
                в расписании групп.
              </p>

              {branches.length === 0 ? (
                <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                  Пока нет ни одного филиала
                </div>
              ) : (
                <div className="space-y-3">
                  {branches.map((b) => (
                    <div key={b.id} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <MapPin className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate font-medium">{b.name}</span>
                          </div>
                          {b.address && (
                            <div className="ml-6 mt-0.5 text-xs text-muted-foreground">
                              {b.address}
                            </div>
                          )}
                          {(b.workingHoursStart || b.workingHoursEnd) && (
                            <div className="ml-6 mt-0.5 text-xs text-muted-foreground">
                              {b.workingHoursStart ?? "—"} — {b.workingHoursEnd ?? "—"}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Кабинеты */}
                      <div className="ml-6 mt-2 space-y-1">
                        {b.rooms.length === 0 ? (
                          <div className="text-xs text-muted-foreground">Нет кабинетов</div>
                        ) : (
                          b.rooms.map((r) => (
                            <div key={r.id} className="flex items-center gap-2 text-xs">
                              <DoorOpen className="size-3 text-muted-foreground" />
                              <span>{r.name}</span>
                              <span className="text-muted-foreground">· до {r.capacity} мест</span>
                            </div>
                          ))
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setRoomDialogFor(b.id)}
                        >
                          <Plus className="mr-1 size-3" />
                          Добавить кабинет
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={() => setBranchDialogOpen(true)}
                className="w-full"
              >
                <Plus className="mr-1 size-4" />
                Добавить филиал
              </Button>

              <CreateBranchDialog
                open={branchDialogOpen}
                onOpenChange={setBranchDialogOpen}
                hideTrigger
                refreshOnSuccess={false}
                onSuccess={handleBranchCreated}
              />
              {roomDialogFor && (
                <CreateRoomDialog
                  branches={branches.map((b) => ({ id: b.id, name: b.name }))}
                  fixedBranchId={roomDialogFor}
                  open={!!roomDialogFor}
                  onOpenChange={(open) => { if (!open) setRoomDialogFor(null) }}
                  hideTrigger
                  refreshOnSuccess={false}
                  onSuccess={(r) => handleRoomCreated(roomDialogFor, r)}
                />
              )}
            </div>
          )}

          {/* Шаг 2: Направления */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Направления — это услуги, которые вы предлагаете (например, «Развивайка
                3-4», «Английский», «Танцы»). У каждого своя цена и длительность.
              </p>

              {directions.length === 0 ? (
                <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                  Пока нет ни одного направления
                </div>
              ) : (
                <div className="space-y-2">
                  {directions.map((d) => (
                    <div key={d.id} className="flex items-center gap-3 rounded-md border p-3">
                      <div
                        className="size-8 shrink-0 rounded-md"
                        style={{ backgroundColor: d.color ?? "#3b82f6" }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{d.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {Number(d.lessonPrice)} ₽ за занятие
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={() => setDirectionDialogOpen(true)}
                className="w-full"
              >
                <Plus className="mr-1 size-4" />
                Добавить направление
              </Button>

              <CreateDirectionDialog
                open={directionDialogOpen}
                onOpenChange={setDirectionDialogOpen}
                hideTrigger
                refreshOnSuccess={false}
                onSuccess={handleDirectionCreated}
              />
            </div>
          )}

          {/* Шаг 3: Сотрудники */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Добавьте сотрудников: администраторов, инструкторов, управляющих.
                После создания инструктора откроется окно для указания его ставок ЗП.
              </p>

              {employees.length === 0 ? (
                <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                  Пока нет ни одного сотрудника
                </div>
              ) : (
                <div className="space-y-2">
                  {employees.map((e) => {
                    const fullName = [e.lastName, e.firstName, e.middleName]
                      .filter(Boolean)
                      .join(" ")
                    return (
                      <div key={e.id} className="flex items-center gap-3 rounded-md border p-3">
                        <UserCog className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{fullName || e.login}</div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline" className="text-[10px]">
                              {ROLE_LABELS[e.role] || e.role}
                            </Badge>
                            {e.role === "instructor" && (
                              <span>
                                {e.salaryRatesCount ? `${e.salaryRatesCount} ставок ЗП` : "ставок ЗП не задано"}
                              </span>
                            )}
                          </div>
                        </div>
                        {e.role === "instructor" && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => setSalaryDialogFor({ id: e.id, name: fullName || e.login })}
                          >
                            <Wallet className="mr-1 size-3" />
                            Ставки
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={() => setEmployeeDialogOpen(true)}
                className="w-full"
                disabled={branches.length === 0}
              >
                <Plus className="mr-1 size-4" />
                Добавить сотрудника
              </Button>
              {branches.length === 0 && (
                <p className="text-center text-xs text-muted-foreground">
                  Сначала добавьте хотя бы один филиал, чтобы привязать к нему сотрудника.
                </p>
              )}

              <CreateEmployeeDialog
                branches={branches.map((b) => ({ id: b.id, name: b.name }))}
                open={employeeDialogOpen}
                onOpenChange={setEmployeeDialogOpen}
                hideTrigger
                refreshOnSuccess={false}
                onSuccess={handleEmployeeCreated}
              />
              {salaryDialogFor && (
                <SalaryRatesDialog
                  employeeId={salaryDialogFor.id}
                  employeeName={salaryDialogFor.name}
                  directions={directions.map((d) => ({ id: d.id, name: d.name }))}
                  open
                  onOpenChange={handleSalaryDialogChange}
                  hideTrigger
                  refreshOnSuccess={false}
                />
              )}
            </div>
          )}

          {/* Шаг 4: Кассы */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Касса — это любое место, где появляются деньги: наличная касса в филиале,
                расчётный счёт, эквайринг, онлайн-оплата. Без касс не получится принимать платежи.
              </p>

              {accounts.length === 0 ? (
                <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                  Пока нет ни одной кассы
                </div>
              ) : (
                <div className="space-y-2">
                  {accounts.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 rounded-md border p-3">
                      <Wallet className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{a.name}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-[10px]">
                            {ACCOUNT_TYPE_LABELS[a.type] || a.type}
                          </Badge>
                          {a.branch?.name && <span>· {a.branch.name}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={() => setAccountDialogOpen(true)}
                className="w-full"
              >
                <Plus className="mr-1 size-4" />
                Добавить кассу
              </Button>

              <AddAccountDialog
                branches={branches.map((b) => ({ id: b.id, name: b.name }))}
                open={accountDialogOpen}
                onOpenChange={setAccountDialogOpen}
                hideTrigger
                refreshOnSuccess={false}
                onSuccess={handleAccountCreated}
              />
            </div>
          )}

          {/* Шаг 5: Готово */}
          {step === 5 && (
            <div className="space-y-4 text-center">
              <PartyPopper className="mx-auto size-12 text-primary" />
              <div>
                <h3 className="text-lg font-semibold">Всё готово!</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Базовая настройка завершена. Теперь можно завести клиентов, собрать
                  группы и начать работу.
                </p>
              </div>

              <div className="mx-auto max-w-sm space-y-2 text-left text-sm">
                <SummaryLine
                  done={branches.length > 0}
                  text={`${branches.length} ${pl(branches.length, "филиал", "филиала", "филиалов")} (${branches.reduce((s, b) => s + b.rooms.length, 0)} ${pl(branches.reduce((s, b) => s + b.rooms.length, 0), "кабинет", "кабинета", "кабинетов")})`}
                />
                <SummaryLine
                  done={directions.length > 0}
                  text={`${directions.length} ${pl(directions.length, "направление", "направления", "направлений")}`}
                />
                <SummaryLine
                  done={employees.length > 0}
                  text={`${employees.length} ${pl(employees.length, "сотрудник", "сотрудника", "сотрудников")}`}
                />
                <SummaryLine
                  done={accounts.length > 0}
                  text={`${accounts.length} ${pl(accounts.length, "касса", "кассы", "касс")}`}
                />
              </div>

              <Button onClick={finishOnboarding} disabled={saving} className="w-full">
                {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Перейти к дашборду
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Навигация */}
      {step < STEPS.length - 1 && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep(step - 1)}
            disabled={step === 0}
          >
            <ChevronLeft className="mr-1 size-4" />
            Назад
          </Button>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button type="button" variant="ghost" onClick={() => setStep(step + 1)}>
                <SkipForward className="mr-1 size-4" />
                Пропустить
              </Button>
            )}
            <Button
              type="button"
              onClick={() => {
                if (step === 0) {
                  saveOrganization()
                } else {
                  setStep(step + 1)
                }
              }}
              disabled={saving || (step === 0 && !name.trim())}
            >
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Далее
              <ChevronRight className="ml-1 size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryLine({ done, text }: { done: boolean; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <Check className={done ? "size-4 text-primary" : "size-4 text-muted-foreground/30"} />
      <span className={done ? "" : "text-muted-foreground"}>{text}</span>
    </div>
  )
}

function pl(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}
