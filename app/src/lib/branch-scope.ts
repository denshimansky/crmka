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
// Видимость оплат теперь идёт по филиалу КЛИЕНТА (scopeClientByBranch), а не по
// филиалу счёта. Импорт функции (не только типа) создаёт циклическую зависимость
// с client-segments (он тянет isUnscoped/BranchScope отсюда), но она безопасна:
// обе стороны — чистые построители WHERE, вызываются только в рантайме запроса,
// на верхнем уровне модулей друг друга не дёргают (function hoisting).
import { scopeClientByBranch } from "@/lib/client-segments"

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
// организации на все филиалы» (например, единый расчётный счёт под безнал).
//
// ВИДИМОСТЬ БАЛАНСОВ (решение владельца 23.07.2026): общие (branchId=NULL)
// счета — общеорганизационная информация. Админ с привязкой к филиалу(-ам)
// их балансы/карточки видеть НЕ должен — только счета/кассы своих филиалов.
// Поэтому для ограниченного scope отдаём СТРОГО branchId IN [...], без NULL.
// Это «scope на ОТОБРАЖЕНИЕ»: Касса, ДДС, отчёты (остатки касс/P&L), виджет
// «Остатки денег», операции между счетами.
//
// Для СЕЛЕКТОРОВ, где нужно провести оплату/расход/возврат на общий счёт
// (админ записывает безнал клиента), используйте scopeBookableAccount —
// он оставляет общие счета выбираемыми, не показывая их балансы.
export function scopeFinancialAccount(
  scope: BranchScope,
): Prisma.FinancialAccountWhereInput {
  if (isUnscoped(scope)) return {}
  return { branchId: { in: scope.branchIds } }
}

// «Счета, на которые роль может ПРОВЕСТИ операцию» (селекторы форм оплаты/
// возврата/расхода). В отличие от scopeFinancialAccount, оставляет общий счёт
// (branchId=NULL) выбираемым: админ филиала должен уметь записать безналичную/
// онлайн-оплату клиента на общий счёт, даже если его баланс ему не виден.
export function scopeBookableAccount(
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

// Payment — видимость по филиалу КЛИЕНТА оплаты (решение 23.07.2026), НЕ по
// филиалу счёта. Админ филиала видит оплаты СВОИХ клиентов (мультифилиальная
// логика scopeClientByBranch), даже если деньги ушли на общий счёт, который
// сам по себе ему не виден. Оплата без клиента («прочий доход» — проценты
// банка, продажа товаров) привязки к филиалу не имеет и скоуп-админу НЕ видна
// (её видят только владелец/управляющий и роли с доступом ко всем филиалам).
//
// Для отчётов ПО СЧЕТАМ (ДДС, помесячные итоги по кассам) фильтруйте оплаты по
// видимому счёту: `{ account: scopeFinancialAccount(scope) }` — там нужна
// денежно-потоковая семантика (движения по видимым счетам), а не «мои клиенты».
export function scopePayment(scope: BranchScope): Prisma.PaymentWhereInput {
  if (isUnscoped(scope)) return {}
  return {
    OR: [
      // Клиент оплаты — в «моих» филиалах (сегментная видимость, баг #79).
      { client: scopeClientByBranch(scope) },
      // Страховка: оплата абонемента в группе scope-филиала. У оплаты обычно
      // есть clientId (правило выше её и покроет), но привязка через абонемент
      // надёжнее для исторических/пограничных записей.
      { subscription: { group: { branchId: { in: scope.branchIds } } } },
    ],
  }
}

// Оплаты по ВИДИМОМУ счёту — для денежно-потоковых представлений (ДДС,
// помесячные итоги по кассам, «прочий доход» в P&L). В отличие от scopePayment
// (по клиенту), здесь семантика движения денег: показываем только движения по
// счетам, которые роль видит, и потому СКРЫВАЕМ движения по общим счетам у
// скоуп-админа. accountId у Payment обязателен, поэтому связь всегда есть.
export function scopePaymentByAccount(
  scope: BranchScope,
): Prisma.PaymentWhereInput {
  if (isUnscoped(scope)) return {}
  return { account: { branchId: { in: scope.branchIds } } }
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
// может быть branchId. Видим, только если хотя бы ОДИН из счетов операции — в
// «моих» филиалах. Операции целиком по общим счетам (оба счёта branchId=NULL)
// скоуп-админу НЕ видны — согласовано с видимостью общих счетов (23.07.2026).
export function scopeAccountOperation(
  scope: BranchScope,
): Prisma.AccountOperationWhereInput {
  if (isUnscoped(scope)) return {}
  return {
    OR: [
      { fromAccount: { branchId: { in: scope.branchIds } } },
      { toAccount: { branchId: { in: scope.branchIds } } },
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
