// Скидки v2 — общий словарь подписей скидки клиента.
// NO_AUTO/shortTitle используются селектором в окне «Редактировать клиента»;
// discountLabel — информационным лейблом в шапке карточки.
//
// Вручную выбирается только постоянная скидка (тип 2). Автоскидка «за второй
// абонемент» (тип 1) — руками не выбирается. Sentinel NO_AUTO (баг #50)
// запрещает любые автоскидки.

import { currencySymbol } from "@/lib/currency"

export const NO_AUTO = "no-auto"

export interface DiscountTemplateLite {
  name: string
  valueType: "percent" | "fixed"
  value: string | number
}

/** «Название (−50 ₽/занятие)» или «Название (10%)». */
export function shortTitle(
  t: DiscountTemplateLite,
  currencySym = currencySymbol("RUB"),
): string {
  const v = Number(t.value)
  const suffix =
    t.valueType === "percent" ? `${v}%` : `−${v.toLocaleString("ru-RU")} ${currencySym}/занятие`
  return `${t.name} (${suffix})`
}

/**
 * Read-only подпись ЭФФЕКТИВНОЙ скидки клиента для шапки карточки (не название
 * настройки из редактора): реальное имя применённой скидки — системной
 * «за второй абонемент» или ручного шаблона; «Скидки отключены» при запрете;
 * «Без скидки», когда сейчас ничего не применено. Считается из серверных данных.
 */
export function discountLabel(
  input: {
    autoDiscountDisabled?: boolean | null
    templateId?: string | null
    template?: DiscountTemplateLite | null
    hasType1Discount?: boolean
  },
  currencySym = currencySymbol("RUB"),
): string {
  if (input.autoDiscountDisabled) return "Скидки отключены"
  if (input.templateId && input.template) return shortTitle(input.template, currencySym)
  if (input.templateId) return "…" // шаблон выбран, но не передан серверу (редко)
  if (input.hasType1Discount) return "Скидка за второй абонемент (авто)"
  return "Без скидки"
}
