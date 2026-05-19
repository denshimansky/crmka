// Правило доступности сотрудника в филиале:
// — если контекст филиала не задан → доступен везде (нет ограничения),
// — если у сотрудника нет привязок к филиалам → работает кросс-филиально,
// — иначе должен быть привязан к этому филиалу.

export interface EmployeeWithBranches {
  employeeBranches?: { branchId: string }[]
}

export function isEmployeeAvailableInBranch<T extends EmployeeWithBranches>(
  employee: T,
  branchId: string | null | undefined,
): boolean {
  if (!branchId) return true
  const branches = employee.employeeBranches
  if (!branches || branches.length === 0) return true
  return branches.some((eb) => eb.branchId === branchId)
}

export function filterEmployeesByBranch<T extends EmployeeWithBranches>(
  employees: T[],
  branchId: string | null | undefined,
): T[] {
  if (!branchId) return employees
  return employees.filter((e) => isEmployeeAvailableInBranch(e, branchId))
}
