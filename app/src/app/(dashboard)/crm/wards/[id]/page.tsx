import Link from "next/link"
import { notFound } from "next/navigation"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Building2, GraduationCap, User as UserIcon, CalendarDays } from "lucide-react"
import { BackButton } from "@/components/back-button"
import { PageHelp } from "@/components/page-help"
import { EditWardForm } from "./edit-ward-form"
import { ClientHistory } from "../../clients/[id]/client-history"
import { TrialLessonDialog } from "../../_components/trial-lesson-dialog"
import { WardSalesStageActions } from "../../_components/ward-sales-stage-actions"
import { formatWardName } from "@/lib/format-name"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return "—"
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function ageLabel(birth: Date | null): string {
  if (!birth) return "—"
  const now = new Date()
  let years = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--
  if (years < 0) return "—"
  const mod10 = years % 10
  const mod100 = years % 100
  if (mod100 >= 11 && mod100 <= 19) return `${years} лет`
  if (mod10 === 1) return `${years} год`
  if (mod10 >= 2 && mod10 <= 4) return `${years} года`
  return `${years} лет`
}

export default async function WardPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const { id } = await params

  const ward = await db.ward.findFirst({
    where: { id, tenantId },
    include: {
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          patronymic: true,
          phone: true,
          email: true,
          deletedAt: true,
        },
      },
    },
  })
  if (!ward || ward.client.deletedAt) notFound()

  // Активные абонементы именно этого ребёнка: статус active/pending, не отчислён,
  // текущий или будущий месяц. (Логика — как в client-card-content.tsx.)
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  // Пробное на этого ребёнка доступно только при открытой заявке.
  const activeApplication = await db.application.findFirst({
    where: { tenantId, wardId: ward.id, status: "active", deletedAt: null },
    select: { id: true, branchId: true, directionId: true },
    orderBy: { createdAt: "desc" },
  })
  const hasActiveApplication =
    ward.salesStage === "application" || Boolean(activeApplication)
  const trialDisabledReason = hasActiveApplication
    ? undefined
    : "Сначала создайте заявку на ребёнка"

  // Подтягиваем филиал/направление/группу для предзаполнения формы «В ожидание
  // оплаты»: сперва из активной заявки, затем из последнего пробного (group/
  // direction). Group-id берём только из пробного.
  const lastTrial =
    ward.salesStage === "trial_attended" || !activeApplication
      ? await db.trialLesson.findFirst({
          where: {
            tenantId,
            wardId: ward.id,
            status: { in: ["attended", "scheduled"] },
          },
          select: {
            groupId: true,
            directionId: true,
            group: { select: { branchId: true, directionId: true } },
            room: { select: { branchId: true } },
          },
          orderBy: [{ status: "asc" }, { scheduledDate: "desc" }],
        })
      : null
  const defaultBranchId =
    activeApplication?.branchId ??
    lastTrial?.group?.branchId ??
    lastTrial?.room?.branchId ??
    null
  const defaultDirectionId =
    activeApplication?.directionId ??
    lastTrial?.group?.directionId ??
    lastTrial?.directionId ??
    null
  const defaultGroupId = lastTrial?.groupId ?? null

  const activeSubscriptions = await db.subscription.findMany({
    where: {
      tenantId,
      wardId: ward.id,
      deletedAt: null,
      withdrawalDate: null,
      status: { in: ["pending", "active"] },
      OR: [
        { periodYear: { gt: currentYear } },
        { periodYear: currentYear, periodMonth: { gte: currentMonth } },
      ],
    },
    include: {
      direction: { select: { name: true } },
      group: {
        select: {
          name: true,
          branch: { select: { name: true } },
          instructor: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
  })

  const parentName =
    [ward.client.lastName, ward.client.firstName, ward.client.patronymic].filter(Boolean).join(" ") || "Без имени"
  const wardName = formatWardName(ward)
  const parentPhone = maskPhone(ward.client.phone, session.user.role)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton fallbackHref="/crm/children" />
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{wardName}</h1>
            <Badge variant="secondary">{ageLabel(ward.birthDate)}</Badge>
            {activeSubscriptions.length > 0 ? (
              <Badge>Активных абонементов: {activeSubscriptions.length}</Badge>
            ) : (
              <Badge variant="outline">Нет активных абонементов</Badge>
            )}
            <PageHelp pageKey="crm/wards/[id]" />
          </div>
          <p className="text-sm text-muted-foreground">
            Родитель:{" "}
            <Link href={`/crm/clients/${ward.client.id}`} className="hover:underline">
              {parentName}
            </Link>
            {parentPhone ? ` · ${parentPhone}` : ""}
          </p>
        </div>
      </div>

      {/* Action buttons — слева, как у родителя (client-card-content.tsx) */}
      <div className="flex flex-wrap items-center gap-2">
        <WardSalesStageActions
          wardId={ward.id}
          wardName={wardName}
          currentStage={ward.salesStage}
          defaultBranchId={defaultBranchId}
          defaultDirectionId={defaultDirectionId}
          defaultGroupId={defaultGroupId}
          disabled={activeSubscriptions.length > 0}
        />
        <TrialLessonDialog
          clientId={ward.client.id}
          wards={[{ id: ward.id, firstName: ward.firstName, lastName: ward.lastName }]}
          lockedWardId={ward.id}
          disabledReason={trialDisabledReason}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* Активные абонементы */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <GraduationCap className="size-4 text-muted-foreground" />
                Активные занятия
                <Badge variant="secondary" className="ml-1 font-normal">
                  {activeSubscriptions.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {activeSubscriptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">У этого ребёнка нет активных абонементов.</p>
              ) : (
                activeSubscriptions.map((s) => {
                  const branch = s.group.branch?.name || "—"
                  const instr = s.group.instructor
                    ? [s.group.instructor.lastName, s.group.instructor.firstName].filter(Boolean).join(" ")
                    : "—"
                  return (
                    <div key={s.id} className="rounded-lg border bg-card p-3 text-sm space-y-2">
                      <div className="flex items-center gap-1.5 font-medium leading-snug">
                        <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-muted-foreground">{branch}</span>
                        <span className="text-muted-foreground">›</span>
                        <span>{s.direction.name}</span>
                        <span className="text-muted-foreground">›</span>
                        <span className="text-muted-foreground">{s.group.name}</span>
                      </div>
                      <div className="grid gap-1 text-xs sm:grid-cols-2">
                        <div className="flex items-center gap-1.5">
                          <UserIcon className="size-3 text-muted-foreground" />
                          <span className="text-muted-foreground">Педагог:</span>
                          <span>{instr}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CalendarDays className="size-3 text-muted-foreground" />
                          <span className="text-muted-foreground">С:</span>
                          <span>{formatDate(s.startDate)}</span>
                        </div>
                        <div className="col-span-2 flex items-center gap-1.5">
                          <span className="text-muted-foreground">Сумма:</span>
                          <span>{formatMoney(Number(s.finalAmount))}</span>
                          <span className="text-muted-foreground">· остаток</span>
                          <span className={Number(s.balance) > 0 ? "text-red-600" : "text-green-600"}>
                            {Number(s.balance) > 0 ? formatMoney(Number(s.balance)) : "оплачен"}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          {/* История событий ребёнка — только относящееся к этому wardId */}
          <ClientHistory clientId={ward.client.id} wardId={ward.id} />
        </div>

        {/* Sidebar — редактирование данных ребёнка */}
        <div className="space-y-4">
          <EditWardForm
            wardId={ward.id}
            initial={{
              firstName: ward.firstName,
              lastName: ward.lastName,
              birthDate: ward.birthDate ? ward.birthDate.toISOString().slice(0, 10) : "",
            }}
          />
        </div>
      </div>
    </div>
  )
}
