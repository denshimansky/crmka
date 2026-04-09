import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Building2, MapPin, Megaphone, Palette, Plus, UserX } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { CreateDirectionDialog } from "./create-direction-dialog"
import { EditDirectionDialog } from "./edit-direction-dialog"
import { CreateBranchDialog } from "./create-branch-dialog"
import { PageHelp } from "@/components/page-help"
import { CreateRoomDialog } from "./create-room-dialog"
import { RoleDisplayNamesForm } from "./role-display-names-form"

export default async function SettingsPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

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
        <TabsList>
          <TabsTrigger value="org">Организация</TabsTrigger>
          <TabsTrigger value="branches">Филиалы</TabsTrigger>
          <TabsTrigger value="directions">Направления</TabsTrigger>
          <TabsTrigger value="refs">Справочники</TabsTrigger>
        </TabsList>

        {/* Организация */}
        <TabsContent value="org">
          <div className="grid gap-6 md:grid-cols-2">
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

          <div className="mt-6">
            <RoleDisplayNamesForm
              initialValues={(org.roleDisplayNames as Record<string, string>) ?? {}}
            />
          </div>
        </TabsContent>

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
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {org.branches.map((branch) => (
                  <Card key={branch.id}>
                    <CardContent className="p-5">
                      <div className="flex items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Building2 className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
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
                              {branch.rooms.map((room) => (
                                <Badge key={room.id} variant="outline" className="text-xs">
                                  {room.name} ({room.capacity} чел.)
                                </Badge>
                              ))}
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
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {org.directions.map((dir) => (
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
                            color: dir.color,
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
                          <Palette className="size-5" />
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
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Справочники */}
        <TabsContent value="refs">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
            <Link href="/settings/admin-bonus" className="block">
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="flex items-start gap-3 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Plus className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">Мотивация администратора</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Бонусная система для администраторов
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
