import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Building2, MapPin, Megaphone, Palette, Shield, UserX, CalendarDays, ListChecks, Bell, UserCog, Landmark, ArrowDownUp, Tag, Lock, Layers, LogOut } from "lucide-react"
import { getDirectionIcon } from "@/lib/direction-icons"
import Link from "next/link"
import { CreateDirectionDialog } from "./create-direction-dialog"
import { PackageTemplatesContent } from "./package-templates-content"
import { EditDirectionDialog } from "./edit-direction-dialog"
import { CreateBranchDialog } from "./create-branch-dialog"
import { PageHelp } from "@/components/page-help"
import { CreateRoomDialog } from "./create-room-dialog"
import { EditBranchDialog } from "./edit-branch-dialog"
import { EditRoomDialog } from "./edit-room-dialog"
import { UnpaidAutoCloseForm } from "./unpaid-auto-close-form"
import { AdminBonusContent } from "./admin-bonus/admin-bonus-content"
import { ProcessLeadsButton } from "./leads-import/process-button"
import { SyncBalanceButton } from "./leads-import/sync-button"
import { SyncBalancesButton } from "./leads-import/sync-balances-button"
import { WipeDatabaseButton } from "./leads-import/wipe-button"
import { isWipeAvailable } from "@/lib/leads-import/sync-leads"

export default async function SettingsPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const isOwner = session.user.role === "owner"
  const impersonatedBy = (session.user as unknown as { impersonatedBy?: string }).impersonatedBy
  const isImpersonatedOwner = isOwner && Boolean(impersonatedBy)
  const wipeGate = isImpersonatedOwner ? await isWipeAvailable(tenantId) : null

  const org = await db.organization.findUnique({
    where: { id: tenantId },
    include: {
      branches: {
        where: { deletedAt: null },
        orderBy: { name: "asc" },
        include: {
          rooms: { where: { deletedAt: null } },
        },
      },
      directions: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
      },
    },
  })

  if (!org) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Настройки</h1>
          <PageHelp pageKey="settings" />
        </div>
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Организация не найдена
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Настройки</h1>
        <PageHelp pageKey="settings" />
      </div>

      <Tabs defaultValue="org">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="org">Организация</TabsTrigger>
            <TabsTrigger value="subscription-type">Абонементы</TabsTrigger>
            {org.subscriptionType === "package" && (
              <TabsTrigger value="package-templates">Шаблоны пакетов</TabsTrigger>
            )}
            <TabsTrigger value="branches">Филиалы</TabsTrigger>
            <TabsTrigger value="directions">Направления</TabsTrigger>
            <TabsTrigger value="admin-bonus">Бонусы админов</TabsTrigger>
            <TabsTrigger value="refs">Справочники</TabsTrigger>
          </TabsList>
        </div>

        {/* Организация */}
        <TabsContent value="org">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardContent className="p-6">
                <h2 className="mb-4 text-lg font-semibold">Информация об организации</h2>
                <div className="space-y-4">
                  <InfoRow label="Название" value={org.name} />
                  <InfoRow label="Юрлицо" value={org.legalName} />
                  <InfoRow label="ИНН" value={org.inn} />
                  <InfoRow label="Телефон" value={org.phone} />
                  <InfoRow label="Email" value={org.email} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <h2 className="mb-4 text-lg font-semibold">Параметры системы</h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Оплата инструктору за прогул</span>
                    <Badge variant={org.payForAbsence ? "default" : "secondary"}>
                      {org.payForAbsence ? "Да" : "Нет"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Оплата пробных занятий педагогу</span>
                    <Badge variant={org.payForTrialLessons ? "default" : "secondary"}>
                      {org.payForTrialLessons ? "Только платные" : "Нет"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Дедлайн отметки посещений</span>
                    <span className="text-sm font-medium">{org.attendanceDeadline} дн.</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Лимит долга</span>
                    <span className="text-sm font-medium">
                      {org.debtLimit ? `${Number(org.debtLimit).toLocaleString("ru-RU")} \u20BD` : "Не задан"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Дни выплаты ЗП</span>
                    <span className="text-sm font-medium">
                      Аванс: {org.salaryDay1 ?? "---"} / Зарплата: {org.salaryDay2 ?? "---"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Срок отработки (дн.)</span>
                    <span className="text-sm font-medium">
                      {org.makeupDaysLimit ?? "Не задан"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Дедлайн отработки (дн.)</span>
                    <span className="text-sm font-medium">
                      {org.makeupDeadlineDays ?? "Не задан"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

        </TabsContent>

        {/* Тип абонемента */}
        <TabsContent value="subscription-type">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Tag className="size-5 text-primary" />
                  <h2 className="text-lg font-semibold">Модель работы с абонементами</h2>
                </div>

                <div className="rounded-md border bg-muted/40 p-4">
                  <div className="text-xs text-muted-foreground">Текущий тип</div>
                  <div className="mt-1 text-lg font-medium">
                    {org.subscriptionType === "calendar" && "Календарный"}
                    {org.subscriptionType === "package" && "Пакетный"}
                    {org.subscriptionType === "fixed" && "Фикс"}
                    {!org.subscriptionType && (
                      <span className="text-muted-foreground">Не выбран</span>
                    )}
                  </div>
                  {org.subscriptionType === "calendar" && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Каждый месяц — отдельный абонемент. Цена считается по числу
                      занятий в группе на месяц.
                    </p>
                  )}
                  {org.subscriptionType === "package" && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      N занятий на срок M дней. Клиент посещает в любое доступное
                      время в выбранной группе.
                    </p>
                  )}
                </div>

                {org.subscriptionTypeLockedAt ? (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="flex gap-2">
                      <Lock className="size-4 shrink-0 text-muted-foreground" />
                      <div className="space-y-1">
                        <div className="text-sm font-medium">Тип заблокирован</div>
                        <p className="text-xs text-muted-foreground">
                          С {new Date(org.subscriptionTypeLockedAt).toLocaleDateString("ru-RU")}.
                          Смена типа влияет на работу всей системы (отчёты, ЗП, биллинг)
                          — поэтому разблокировать может только техподдержка.
                          Напишите на <a href="mailto:support@umnayacrm.ru" className="text-primary hover:underline">support@umnayacrm.ru</a>.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Тип ещё не зафиксирован. Будет автоматически заблокирован после
                    создания первого абонемента.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <UnpaidAutoCloseForm initialValue={org.unpaidSubscriptionAutoCloseDays} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Шаблоны пакетов */}
        {org.subscriptionType === "package" && (
          <TabsContent value="package-templates">
            <PackageTemplatesContent
              initialDefaultValidDays={org.packageDefaultValidDays}
              initialNotifyDaysBefore={org.packageExpiryNotifyDaysBefore}
            />
          </TabsContent>
        )}

        {/* Филиалы */}
        <TabsContent value="branches">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Всего филиалов: {org.branches.length}
              </p>
              <div className="flex gap-2">
                <CreateRoomDialog branches={org.branches.map(b => ({ id: b.id, name: b.name }))} />
                <CreateBranchDialog />
              </div>
            </div>

            {org.branches.length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
                  Нет филиалов
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {org.branches.map((branch) => (
                  <Card key={branch.id}>
                    <CardContent className="relative p-5">
                      {isOwner && (
                        <div className="absolute right-3 top-3">
                          <EditBranchDialog
                            branch={{
                              id: branch.id,
                              name: branch.name,
                              address: branch.address,
                              workingHoursStart: branch.workingHoursStart,
                              workingHoursEnd: branch.workingHoursEnd,
                              hasRooms: branch.rooms.length > 0,
                            }}
                          />
                        </div>
                      )}
                      <div className="flex items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Building2 className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1 pr-8">
                          <h3 className="truncate font-medium">{branch.name}</h3>
                          {branch.address && (
                            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                              <MapPin className="size-3" />
                              {branch.address}
                            </p>
                          )}
                          <div className="mt-2 flex items-center gap-2">
                            <Badge variant="secondary">
                              {branch.rooms.length}{" "}
                              {pluralize(branch.rooms.length, "зал", "зала", "залов")}
                            </Badge>
                            {branch.workingHoursStart && branch.workingHoursEnd && (
                              <span className="text-xs text-muted-foreground">
                                {branch.workingHoursStart} -- {branch.workingHoursEnd}
                              </span>
                            )}
                          </div>
                          {branch.rooms.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {branch.rooms.map((room) =>
                                isOwner ? (
                                  <EditRoomDialog
                                    key={room.id}
                                    room={{
                                      id: room.id,
                                      name: room.name,
                                      capacity: room.capacity,
                                      branchId: branch.id,
                                    }}
                                    branches={org.branches.map((b) => ({ id: b.id, name: b.name }))}
                                  />
                                ) : (
                                  <Badge key={room.id} variant="outline" className="text-xs">
                                    {room.name} ({room.capacity} чел.)
                                  </Badge>
                                )
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Направления */}
        <TabsContent value="directions">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Всего направлений: {org.directions.length}
              </p>
              <CreateDirectionDialog />
            </div>

            {org.directions.length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
                  Нет направлений
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {org.directions.map((dir) => {
                  const DirIcon = getDirectionIcon(dir.icon)
                  return (
                  <Card key={dir.id}>
                    <CardContent className="relative p-5">
                      <div className="absolute right-3 top-3">
                        <EditDirectionDialog
                          direction={{
                            id: dir.id,
                            name: dir.name,
                            lessonPrice: String(dir.lessonPrice),
                            lessonDuration: dir.lessonDuration,
                            trialPrice: dir.trialPrice ? String(dir.trialPrice) : null,
                            trialFree: dir.trialFree,
                            singleVisitPrice: dir.singleVisitPrice ? String(dir.singleVisitPrice) : null,
                            color: dir.color,
                            icon: dir.icon,
                          }}
                        />
                      </div>
                      <div className="flex items-start gap-3">
                        <div
                          className="flex size-10 shrink-0 items-center justify-center rounded-lg"
                          style={{
                            backgroundColor: dir.color ? `${dir.color}20` : undefined,
                            color: dir.color ?? undefined,
                          }}
                        >
                          <DirIcon className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-medium">{dir.name}</h3>
                          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                            <p>
                              Цена: <span className="font-medium text-foreground">{Number(dir.lessonPrice).toLocaleString("ru-RU")} \u20BD</span>
                            </p>
                            <p>
                              Длительность: <span className="font-medium text-foreground">{dir.lessonDuration} мин.</span>
                            </p>
                            {dir.trialFree ? (
                              <p>
                                Пробное: <Badge variant="secondary" className="ml-1">Бесплатно</Badge>
                              </p>
                            ) : dir.trialPrice ? (
                              <p>
                                Пробное: <span className="font-medium text-foreground">{Number(dir.trialPrice).toLocaleString("ru-RU")} \u20BD</span>
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  )
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Бонусы админов */}
        <TabsContent value="admin-bonus">
          <AdminBonusContent />
        </TabsContent>

        {/* Справочники */}
        <TabsContent value="refs" className="space-y-6">
          {isOwner && (
            <Card>
              <CardContent className="p-5 space-y-3">
                <div>
                  <h3 className="font-medium">Импорт</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Двухэтапная миграция базы: сначала обработка выгрузки лидов, затем заливка
                    контактов в CRM. Если клиенты уже залиты без денег — обновите балансы
                    отдельной кнопкой «Синхронизировать остатки» (в ДДС не пишется).
                    Доступно только владельцу.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ProcessLeadsButton />
                  <SyncBalanceButton />
                  <SyncBalancesButton />
                  {wipeGate?.available && wipeGate.expiresAt && (
                    <WipeDatabaseButton
                      orgName={org.name}
                      expiresAt={wipeGate.expiresAt.toISOString()}
                    />
                  )}
                </div>
                {isImpersonatedOwner && wipeGate && !wipeGate.available && (
                  <p className="text-xs text-muted-foreground">
                    Кнопка «Очистить всю базу» появится после первого успешного импорта и
                    доступна 7 дней после него. Сейчас окно недоступно
                    {wipeGate.expiresAt
                      ? ` (истекло ${wipeGate.expiresAt.toLocaleString("ru-RU")})`
                      : " (импортов ещё не было)"}.
                    Для очистки после окончания окна — обратитесь в техподдержку.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Link href="/settings/channels" className="block">
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="flex items-start gap-3 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Megaphone className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">Каналы привлечения</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Откуда приходят клиенты: сайт, соцсети, рекомендация
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/settings/absence-reasons" className="block">
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="flex items-start gap-3 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <UserX className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">Причины пропусков</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Болезнь, отпуск, погода и другие причины отсутствия
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/settings/withdrawal-reasons" className="block">
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="flex items-start gap-3 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <LogOut className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">Причины отчисления</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Обязательный справочник при отчислении ученика
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/settings/attendance-matrix" className="block">
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="flex items-start gap-3 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ListChecks className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">Виды посещений</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Матрица статусов «Тип дня»: списания, ЗП, проценты
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/settings/discount-templates" className="block">
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="flex items-start gap-3 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Palette className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">Шаблоны скидок</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Готовые шаблоны для быстрого применения скидок
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/settings/segmentation" className="block">
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="flex items-start gap-3 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Layers className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">Сегментация клиентов</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Пороги «Новый/Стандартный/Постоянный/VIP» по сумме или времени
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/settings/role-permissions" className="block">
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="flex items-start gap-3 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Shield className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">Права ролей</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Настройка доступа для каждой роли: что видят и могут делать сотрудники
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/settings/production-calendar" className="block">
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="flex items-start gap-3 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <CalendarDays className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">Производственный календарь</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Праздничные и выходные дни — пропускаются при генерации занятий
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/settings/tasks" className="block">
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="flex items-start gap-3 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Bell className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">Автотриггеры задач</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Включение/выключение автоматических задач и старт «с N числа»
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/staff" className="block">
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="flex items-start gap-3 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <UserCog className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">Сотрудники</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Учётные записи, роли, ставки ЗП, филиалы и контакты сотрудников
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/finance/cash" className="block">
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="flex items-start gap-3 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Landmark className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">Касса</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Счета: наличные, расчётный, эквайринг, онлайн — балансы и операции
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/settings/finance-categories" className="block">
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="flex items-start gap-3 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ArrowDownUp className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">Статьи доходов и расходов</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Категории для ДДС и ОПИУ: проценты банка, продажа товаров, аренда, реклама и др.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value || "---"}</span>
    </div>
  )
}

function pluralize(n: number, one: string, few: string, many: string) {
  const abs = Math.abs(n) % 100
  const lastDigit = abs % 10
  if (abs > 10 && abs < 20) return many
  if (lastDigit > 1 && lastDigit < 5) return few
  if (lastDigit === 1) return one
  return many
}
