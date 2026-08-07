// Метаданные шаблона импорта клиентов. Обычный модуль (без «use client»), чтобы
// серверный page.tsx мог использовать эти строки напрямую — импорт значений из
// «use client»-модуля превращает их в client-reference и падает при рендере на
// сервере (см. инцидент 04.08: buttonVariants/константы из клиентского модуля).
export const TEMPLATE_HREF = "/templates/client-import-template.xlsx"
export const TEMPLATE_FILENAME = "Шаблон импорта клиентов.xlsx"

// Шаблон для «Обновить остатки» (Шаг 3): минимум — телефон + баланс.
export const BALANCES_TEMPLATE_HREF = "/templates/client-balances-template.xlsx"
export const BALANCES_TEMPLATE_FILENAME = "Шаблон остатков.xlsx"
