import type { AdminPayload } from "@/lib/admin-auth"

// Хелперы базы знаний AI-ассистента (ai_faq).
//
// Редактируют — те же роли, что и базу знаний kb_* (superadmin/development).
// support/billing — не контент-роли, поэтому только просмотр в /admin.
const AI_FAQ_EDITOR_ROLES = new Set(["superadmin", "development"])

export function canEditAiFaq(admin: AdminPayload | null): boolean {
  return !!admin && AI_FAQ_EDITOR_ROLES.has(admin.role)
}

// Категории факта — определяют, ЧЕМ чинится ошибка ассистента:
//   navigation — «где/как сделать X» (лечится дополнением этой базы);
//   logic      — бизнес-правило/логика расчёта (тоже база);
//   data       — ответ зависит от цифр организации; часто это провал сборки
//                контекста (buildDynamicSlice), а не пробел в базе — помечаем,
//                чтобы такие случаи разбирались отдельно, кодом.
export const AI_FAQ_CATEGORIES = ["navigation", "logic", "data"] as const
export type AiFaqCategory = (typeof AI_FAQ_CATEGORIES)[number]

export const AI_FAQ_CATEGORY_LABELS: Record<AiFaqCategory, string> = {
  navigation: "Навигация (где/как)",
  logic: "Логика и правила",
  data: "Данные организации",
}
