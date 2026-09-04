import type { Prisma } from "@prisma/client"
import { isUnscoped, scopeTrialLesson, type BranchScope } from "@/lib/branch-scope"

// ЕДИНАЯ точка расчёта «каких подопечных видно в фильтре расписания».
// Держите её общей для страницы расписания и GET /api/wards/search, иначе
// видимость детей разъедется между полем поиска и самой сеткой (ADM-04).
//
//  - владелец/управляющий (unscoped) — без ограничения (undefined);
//  - админ с ограниченным scope — дети своих филиалов;
//  - инструктор — дети своих групп (включая группы, где он выходил на замену)
//    и свои пробные.
//
// Ребёнок «свой» не только по зачислению в группу: он может стоять на занятии
// пробником. Отработки отдельной веткой не проверяем — у Ward нет связи с
// Attendance, а отработка всегда идёт от абонемента, то есть зачисление у
// такого ребёнка уже есть.
export function wardVisibilityWhere(
  role: string,
  employeeId: string | null | undefined,
  scope: BranchScope,
): Prisma.WardWhereInput | undefined {
  const branchGroup: Prisma.GroupWhereInput = isUnscoped(scope)
    ? {}
    : { branchId: { in: scope.branchIds } }
  const liveTrial: Prisma.TrialLessonWhereInput = {
    status: { in: ["scheduled", "attended"] },
    NOT: { application: { deletedAt: { not: null } } },
  }

  if (role === "instructor") {
    return {
      OR: [
        {
          enrollments: {
            some: {
              isActive: true,
              deletedAt: null,
              group: {
                OR: [
                  { instructorId: employeeId ?? undefined },
                  { lessons: { some: { substituteInstructorId: employeeId ?? undefined } } },
                ],
                ...branchGroup,
              },
            },
          },
        },
        {
          trialLessons: {
            some: {
              AND: [
                liveTrial,
                {
                  OR: [
                    { instructorId: employeeId ?? undefined },
                    { group: { instructorId: employeeId ?? undefined } },
                  ],
                },
              ],
            },
          },
        },
      ],
    }
  }

  if (isUnscoped(scope)) return undefined

  return {
    OR: [
      {
        enrollments: {
          some: { isActive: true, deletedAt: null, group: branchGroup },
        },
      },
      { trialLessons: { some: { AND: [liveTrial, scopeTrialLesson(scope)] } } },
    ],
  }
}

/** Подпись подопечного в фильтре: «Фамилия Имя · ФИО родителя» (тёзки различимы). */
export function formatWardOptionLabel(w: {
  firstName: string
  lastName: string | null
  client: { firstName: string | null; lastName: string | null }
}): string {
  const own = [w.lastName, w.firstName].filter(Boolean).join(" ") || "Без имени"
  const parent =
    [w.client.lastName, w.client.firstName].filter(Boolean).join(" ") || "Без имени"
  return `${own} · ${parent}`
}
