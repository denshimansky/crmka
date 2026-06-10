// ADM-04: серверный enforcement доступа по филиалам.
//
// Концепция:
//  - В JWT хранится `allowedBranchIds: string[] | null`.
//    `null` = доступ ко всем филиалам (owner/manager всегда; admin/instructor,
//    если у них нет ни одной записи в `EmployeeBranch`).
//    Непустой массив = ограниченный набор UUID.
//  - Хелперы возвращают Prisma `WhereInput`-фрагменты, готовые к интерполяции
//    в WHERE-условия запросов через spread `{ ...scopeFoo(scope), ...rest }`.
//  - Для `mode: "all"` каждый хелпер возвращает пустой объект `{}` — это
//    no-op WHERE и не меняет существующее поведение для владельцев и
//    обратно-совместимых случаев.

import type { Prisma } from "@prisma/client"

export type BranchScope =
  | { mode: "all" }
  | { mode: "limited"; branchIds: string[] }

// Строит scope из значения, которое лежит в `session.user.allowedBranchIds`.
// `null` → "all"; пустой массив → "limited" с пустым списком (т.е. доступа
// ни к одному филиалу). Это нужно для будущей жёсткой deny-политики; пока
// эта ветка недостижима, потому что в auth.ts мы пишем `null` при пустом
// EmployeeBranch — но лучше иметь честную семантику.
export function branchScopeFromSession(
  allowed: string[] | null | undefined,
): BranchScope {
  if (allowed === null || allowed === undefined) return { mode: "all" }
  return { mode: "limited", branchIds: allowed }
}

export function isUnscoped(scope: BranchScope): scope is { mode: "all" } {
  return scope.mode === "all"
}

// Group, Branch — прямое поле branchId.
export function scopeGroup(scope: BranchScope): Prisma.GroupWhereInput {
  if (isUnscoped(scope)) return {}
  return { branchId: { in: scope.branchIds } }
}

export function scopeBranch(scope: BranchScope): Prisma.BranchWhereInput {
  if (isUnscoped(scope)) return {}
  return { id: { in: scope.branchIds } }
}

// Lesson → через group.branchId.
export function scopeLesson(scope: BranchScope): Prisma.LessonWhereInput {
  if (isUnscoped(scope)) return {}
  return { group: { branchId: { in: scope.branchIds } } }
}

// Lesson для инструктора: scope-филиалы + «моё или замена».
// Замена (substituteInstructorId) включается, потому что заменяющий получает
// ЗП за это занятие (см. salary-calculation) — значит, должен видеть и
// отмечать посещение.
export function scopeLessonForInstructor(
  employeeId: string,
  scope: BranchScope,
): Prisma.LessonWhereInput {
  const own: Prisma.LessonWhereInput = {
    OR: [
      { instructorId: employeeId },
      { substituteInstructorId: employeeId },
    ],
  }
  if (isUnscoped(scope)) return own
  return {
    AND: [
      { group: { branchId: { in: scope.branchIds } } },
      own,
    ],
  }
}

// Group для инструктора: только его группы (он ведущий) ИЛИ группы, где он
// заменяет на каком-то занятии. Та же логика, что scopeLessonForInstructor, но
// на уровне группы — для страниц/селекторов, работающих по группам (посещаемость).
export function scopeGroupForInstructor(
  employeeId: string,
): Prisma.GroupWhereInput {
  return {
    OR: [
      { instructorId: employeeId },
      { lessons: { some: { substituteInstructorId: employeeId } } },
    ],
  }
}

// Subscription → через group.branchId. У Subscription нет своего branchId.
export function scopeSubscription(
  scope: BranchScope,
): Prisma.SubscriptionWhereInput {
  if (isUnscoped(scope)) return {}
  return { group: { branchId: { in: scope.branchIds } } }
}

// Application — branchId обязательное.
export function scopeApplication(
  scope: BranchScope,
): Prisma.ApplicationWhereInput {
  if (isUnscoped(scope)) return {}
  return { branchId: { in: scope.branchIds } }
}

// FinancialAccount — branchId опциональный. NULL означает «общий счёт
// организации» (например, расчётный счёт). Такие счета видят все.
export function scopeFinancialAccount(
  scope: BranchScope,
): Prisma.FinancialAccountWhereInput {
  if (isUnscoped(scope)) return {}
  return {
    OR: [
      { branchId: { in: scope.branchIds } },
      { branchId: null },
    ],
  }
}

// Payment — оплата абонемента (subscription.group.branchId) или прочее
// поступление на счёт (account.branchId). Если оба пусты — видят все.
export function scopePayment(scope: BranchScope): Prisma.PaymentWhereInput {
  if (isUnscoped(scope)) return {}
  return {
    OR: [
      { subscription: { group: { branchId: { in: scope.branchIds } } } },
      { account: { branchId: { in: scope.branchIds } } },
      // Оплаты без подписки и с общим счётом (branch=null у счёта) — видят все.
      { AND: [{ subscriptionId: null }, { account: { branchId: null } }] },
    ],
  }
}

// Expense — связь ExpenseBranch (M:N через join). У ExpenseBranch филиал
// опциональный. Если у расхода нет ни одной привязки — это «общий» расход,
// видят все.
export function scopeExpense(scope: BranchScope): Prisma.ExpenseWhereInput {
  if (isUnscoped(scope)) return {}
  return {
    OR: [
      { branches: { some: { branchId: { in: scope.branchIds } } } },
      // Расход «общий» (нет ни одной привязки или все привязки с branchId=null)
      { branches: { none: { branchId: { not: null } } } },
    ],
  }
}

// AccountOperation — выемки/инкассации/переводы. Привязан к счетам, у которых
// может быть branchId. Видим, если хотя бы один из счетов в scope или общий.
export function scopeAccountOperation(
  scope: BranchScope,
): Prisma.AccountOperationWhereInput {
  if (isUnscoped(scope)) return {}
  return {
    OR: [
      { fromAccount: { branchId: { in: scope.branchIds } } },
      { toAccount: { branchId: { in: scope.branchIds } } },
      { fromAccount: { branchId: null } },
      { toAccount: { branchId: null } },
    ],
  }
}

// Room — через Branch.
export function scopeRoom(scope: BranchScope): Prisma.RoomWhereInput {
  if (isUnscoped(scope)) return {}
  return { branchId: { in: scope.branchIds } }
}

// Employee — для списков сотрудников и ЗП: видим сотрудников, привязанных
// хотя бы к одному из scope-филиалов, ИЛИ кросс-филиальных (без привязок).
export function scopeEmployee(
  scope: BranchScope,
): Prisma.EmployeeWhereInput {
  if (isUnscoped(scope)) return {}
  return {
    OR: [
      { employeeBranches: { some: { branchId: { in: scope.branchIds } } } },
      { employeeBranches: { none: {} } },
    ],
  }
}

// Runtime-проверки доступа к конкретному объекту, когда мы уже его загрузили
// (например, в карточке/деталке или перед write-операцией). Возвращают true,
// если объект попадает в scope.
export function canAccessLessonAsInstructor(
  lesson: { instructorId: string; substituteInstructorId: string | null },
  employeeId: string,
): boolean {
  return (
    lesson.instructorId === employeeId ||
    lesson.substituteInstructorId === employeeId
  )
}

export function canAccessBranch(
  branchId: string,
  scope: BranchScope,
): boolean {
  if (isUnscoped(scope)) return true
  return scope.branchIds.includes(branchId)
}

// TrialLesson — у пробного есть groupId (опц.) или direction+room. Привязка
// к филиалу — через group.branchId либо через room.branchId. Если ни группы,
// ни кабинета — считаем «общим» (видят все).
export function scopeTrialLesson(
  scope: BranchScope,
): Prisma.TrialLessonWhereInput {
  if (isUnscoped(scope)) return {}
  return {
    OR: [
      { group: { branchId: { in: scope.branchIds } } },
      { room: { branchId: { in: scope.branchIds } } },
      { AND: [{ groupId: null }, { roomId: null }] },
    ],
  }
}
