"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Calendar } from "@/components/ui/calendar"
import { AlertCircle, Loader2 } from "lucide-react"

interface BranchOption {
  id: string
  name: string
}

interface PackageTemplateOption {
  id: string
  lessonsCount: number
  validDays: number | null
}

interface DirectionOption {
  id: string
  name: string
  lessonPrice: string | number
}

interface GroupOption {
  id: string
  name: string
  branchId: string
  directionId: string
}

/**
 * Перевод подопечного в «Ожидание оплаты». Собирает 4 обязательных поля
 * (филиал, направление, группа, дата первого платного занятия) и вызывает
 * POST /api/wards/[wardId]/move-to-awaiting-payment, который атомарно:
 *  — выписывает абонемент (pending),
 *  — зачисляет в группу с «Ожидаем оплату»,
 *  — закрывает заявку,
 *  — двигает Ward.salesStage в 'awaiting_payment'.
 *
 * Автосписания с баланса родителя нет — даже если денег достаточно, абонемент
 * остаётся в статусе pending. Оплата делается отдельно: сначала фиксируется
 * поступление в /finance/payments, затем админ нажимает «Оплатить с баланса»
 * в карточке абонемента.
 */
export function AwaitingPaymentDialog({
  wardId,
  applicationId,
  wardName,
  defaultBranchId,
  defaultDirectionId,
  defaultGroupId,
  open,
  onOpenChange,
}: {
  wardId: string
  /** Заявка-строка «Продаж», которую переводим в «Ожидаем оплату». */
  applicationId?: string
  wardName: string
  defaultBranchId?: string | null
  defaultDirectionId?: string | null
  defaultGroupId?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()

  const [branches, setBranches] = useState<BranchOption[]>([])
  const [directions, setDirections] = useState<DirectionOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)

  const [branchId, setBranchId] = useState<string>(defaultBranchId ?? "")
  const [directionId, setDirectionId] = useState<string>(defaultDirectionId ?? "")
  const [groupId, setGroupId] = useState<string>(defaultGroupId ?? "")
  const [firstPaidDate, setFirstPaidDate] = useState<string>("")
  // Реальные даты занятий выбранной группы. null = ещё не загружено или
  // группа не выбрана; [] = группа выбрана, занятий нет (нужна перегенерация).
  const [groupLessonDates, setGroupLessonDates] = useState<string[] | null>(null)

  // Пакетное ценообразование (баг #89). Элементы показываем только пакетным орг.
  const [isPackageOrg, setIsPackageOrg] = useState(false)
  const [packageDefaultValidDays, setPackageDefaultValidDays] = useState(30)
  const [packageTemplates, setPackageTemplates] = useState<PackageTemplateOption[]>([])
  const [packageTemplateId, setPackageTemplateId] = useState<string>("")
  const [validDays, setValidDays] = useState<string>("")

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Загрузка справочников при открытии. Делаем параллельно — один UI-блокер.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingOptions(true)
    setError(null)
    Promise.all([
      fetch("/api/branches").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/directions").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/groups").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/organization").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/package-templates").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([b, d, g, org, tpls]) => {
        if (cancelled) return
        const o = org as {
          subscriptionType?: string | null
          packageDefaultValidDays?: number | null
        } | null
        setIsPackageOrg(o?.subscriptionType === "package")
        if (o?.packageDefaultValidDays != null) {
          setPackageDefaultValidDays(o.packageDefaultValidDays)
        }
        setPackageTemplates(
          (
            tpls as Array<{
              id: string
              lessonsCount: number
              validDays: number | null
            }>
          ).map((x) => ({
            id: x.id,
            lessonsCount: x.lessonsCount,
            validDays: x.validDays,
          })),
        )
        setBranches(
          (b as Array<{ id: string; name: string }>).map((x) => ({
            id: x.id,
            name: x.name,
          })),
        )
        setDirections(
          (
            d as Array<{ id: string; name: string; lessonPrice: string | number }>
          ).map((x) => ({
            id: x.id,
            name: x.name,
            lessonPrice: x.lessonPrice,
          })),
        )
        setGroups(
          (
            g as Array<{
              id: string
              name: string
              branchId: string
              directionId: string
            }>
          ).map((x) => ({
            id: x.id,
            name: x.name,
            branchId: x.branchId,
            directionId: x.directionId,
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить справочники")
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // Reset при закрытии — иначе при повторном открытии будут старые значения.
  // (При открытии defaults уже учтены в useState-инициализаторах; повторный
  // setState на тех же значениях безопасен.)
  useEffect(() => {
    if (!open) {
      setBranchId(defaultBranchId ?? "")
      setDirectionId(defaultDirectionId ?? "")
      setGroupId(defaultGroupId ?? "")
      setFirstPaidDate("")
      setGroupLessonDates(null)
      setPackageTemplateId("")
      setValidDays("")
      setError(null)
    }
  }, [open, defaultBranchId, defaultDirectionId, defaultGroupId])

  // Подгружаем реальные даты занятий выбранной группы — чтобы в календаре
  // первого платного были подсвечены и кликабельны только фактические даты.
  // includePast=1 — разрешаем выбирать дату задним числом (ребёнок мог
  // фактически уже отходить часть занятий до перевода в «Ожидание оплаты»).
  useEffect(() => {
    if (!groupId) {
      setGroupLessonDates(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/groups/${groupId}/lessons?includePast=1`)
        if (cancelled) return
        if (!res.ok) {
          setGroupLessonDates([])
          return
        }
        const lessons: { date: string }[] = await res.json()
        if (cancelled) return
        const dates = lessons.map((l) => l.date.slice(0, 10))
        setGroupLessonDates(dates)
        // Если уже выбранная дата вне списка — сдвигаем на ближайшее занятие.
        // dates по возрастанию: берём ближайшее предстоящее (в т.ч. сегодня),
        // а если все в прошлом — последнее (самое свежее), а не dates[0]
        // (самое раннее из 90 дней includePast).
        if (dates.length > 0 && firstPaidDate && !dates.includes(firstPaidDate)) {
          const todayIso = new Date().toISOString().slice(0, 10)
          const upcoming = dates.find((d) => d >= todayIso)
          setFirstPaidDate(upcoming ?? dates[dates.length - 1])
        }
      } catch {
        if (!cancelled) setGroupLessonDates([])
      }
    })()
    return () => {
      cancelled = true
    }
    // firstPaidDate намеренно не в deps: иначе ручной выбор даты юзером
    // (даже валидной) будет триггерить лишний фетч.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  // Валидация подставленных дефолтов после загрузки справочников: если
  // переданная группа/направление не существует в загруженных данных — чистим,
  // чтобы не отправить мусор. Запускается, когда справочники реально загружены
  // (groups.length > 0): иначе первый прогон на mount с пустым массивом затирал
  // переданный из строки defaultGroupId.
  useEffect(() => {
    if (loadingOptions) return
    if (groups.length === 0) return
    if (groupId) {
      const g = groups.find((x) => x.id === groupId)
      if (!g || g.branchId !== branchId || g.directionId !== directionId) {
        setGroupId("")
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingOptions, groups.length])

  const filteredDirections = useMemo(() => {
    if (!branchId) return directions
    // Направление считается доступным в филиале, если есть хотя бы одна
    // группа этого направления в этом филиале.
    const availableDirectionIds = new Set(
      groups
        .filter((g) => g.branchId === branchId)
        .map((g) => g.directionId),
    )
    return directions.filter((d) => availableDirectionIds.has(d.id))
  }, [directions, groups, branchId])

  const filteredGroups = useMemo(() => {
    if (!branchId || !directionId) return []
    return groups.filter(
      (g) => g.branchId === branchId && g.directionId === directionId,
    )
  }, [groups, branchId, directionId])

  // Пакетным орг пакет выбирается ЗДЕСЬ (заявка создаётся без пакета), поэтому
  // он обязателен для перехода — сервер иначе ответит «Выберите пакет».
  const packageOk = !isPackageOrg || packageTemplateId !== ""
  const canSubmit =
    branchId && directionId && groupId && firstPaidDate && packageOk && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        applicationId,
        branchId,
        directionId,
        groupId,
        firstPaidLessonDate: firstPaidDate,
      }
      // Пакетным орг — прокидываем выбранный пакет (обязателен, см. canSubmit)
      // и срок годности.
      if (isPackageOrg) {
        if (packageTemplateId) payload.packageTemplateId = packageTemplateId
        const days = Number(validDays)
        if (validDays.trim() !== "" && Number.isFinite(days) && days > 0) {
          payload.validDays = days
        }
      }
      const res = await fetch(
        `/api/wards/${wardId}/move-to-awaiting-payment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Не удалось перевести в ожидание оплаты")
        return
      }
      onOpenChange(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Перевод в «Ожидание оплаты»</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {wardName}: укажите данные абонемента. На подопечного будет выписан
          абонемент и он встанет в расписание группы с пометкой «Ожидаем
          оплату».
        </p>

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {loadingOptions ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Загрузка…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Филиал *</Label>
              <Select
                value={branchId}
                onValueChange={(v) => {
                  if (v) {
                    setBranchId(v)
                    setDirectionId("")
                    setGroupId("")
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  {branchId
                    ? branches.find((b) => b.id === branchId)?.name
                    : <span className="text-muted-foreground">Выберите филиал</span>}
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
              <Select
                value={directionId}
                onValueChange={(v) => {
                  if (v) {
                    setDirectionId(v)
                    setGroupId("")
                  }
                }}
                disabled={!branchId}
              >
                <SelectTrigger className="w-full">
                  {directionId
                    ? directions.find((d) => d.id === directionId)?.name
                    : (
                      <span className="text-muted-foreground">
                        {branchId ? "Выберите направление" : "Сначала выберите филиал"}
                      </span>
                    )}
                </SelectTrigger>
                <SelectContent>
                  {filteredDirections.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Группа *</Label>
              <Select
                value={groupId}
                onValueChange={(v) => {
                  if (v) setGroupId(v)
                }}
                disabled={!directionId}
              >
                <SelectTrigger className="w-full">
                  {groupId
                    ? filteredGroups.find((g) => g.id === groupId)?.name
                    : (
                      <span className="text-muted-foreground">
                        {directionId ? "Выберите группу" : "Сначала выберите направление"}
                      </span>
                    )}
                </SelectTrigger>
                <SelectContent>
                  {filteredGroups.length === 0 ? (
                    <SelectItem value="__empty__" disabled>
                      Нет групп в этом направлении
                    </SelectItem>
                  ) : (
                    filteredGroups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Дата первого платного занятия *</Label>
              <Calendar
                value={firstPaidDate}
                onChange={setFirstPaidDate}
                availableDates={
                  groupId && groupLessonDates
                    ? new Set(groupLessonDates)
                    : undefined
                }
                disabled={!groupId}
                emptyHint="У группы нет занятий. Перегенерируйте расписание группы."
              />
            </div>

            {isPackageOrg && (
              <div className="space-y-3">
                {packageTemplates.length === 0 ? (
                  <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                    <AlertCircle className="size-4 shrink-0 mt-0.5" />
                    <span>
                      Нет доступных пакетов. Создайте пакет в «Настройки →
                      Направления», чтобы выписать абонемент.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label>Шаблон пакета *</Label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {packageTemplates.map((tpl) => (
                        <button
                          type="button"
                          key={tpl.id}
                          onClick={() =>
                            setPackageTemplateId(
                              packageTemplateId === tpl.id ? "" : tpl.id,
                            )
                          }
                          className={[
                            "rounded-md border p-2 text-left text-xs transition-colors",
                            packageTemplateId === tpl.id
                              ? "border-primary bg-primary/5"
                              : "border-input hover:bg-muted/50",
                          ].join(" ")}
                        >
                          <div className="font-medium">
                            {tpl.lessonsCount} занятий
                          </div>
                          <div className="text-muted-foreground">
                            {tpl.validDays ?? packageDefaultValidDays} дн.
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>Срок (дн.)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="3650"
                    placeholder={String(
                      packageTemplates.find((t) => t.id === packageTemplateId)
                        ?.validDays ?? packageDefaultValidDays,
                    )}
                    value={validDays}
                    onChange={(e) => setValidDays(e.target.value)}
                  />
                </div>

                <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Истекает:{" "}
                  {(() => {
                    if (!firstPaidDate) return "—"
                    const days =
                      Number(validDays) ||
                      (packageTemplates.find((t) => t.id === packageTemplateId)
                        ?.validDays ??
                        packageDefaultValidDays)
                    const d = new Date(firstPaidDate)
                    if (Number.isNaN(d.getTime())) return "—"
                    d.setDate(d.getDate() + days)
                    return d.toLocaleDateString("ru-RU")
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>
            Отмена
          </DialogClose>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Выписка…
              </>
            ) : (
              "Подтвердить"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
