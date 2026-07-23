"use client"

import { createContext, useCallback, useContext } from "react"
import {
  DEFAULT_CURRENCY,
  currencySymbol,
  formatMoney as fmt,
  type FormatMoneyOptions,
} from "@/lib/currency"

const CurrencyContext = createContext<string>(DEFAULT_CURRENCY)

/**
 * Прокидывает валюту организации в клиентские компоненты. Значение готовит
 * серверный layout из organization.currency (getOrgUiSettings).
 */
export function CurrencyProvider({
  value,
  children,
}: {
  value: string
  children: React.ReactNode
}) {
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

/** Код валюты организации (например «RUB», «KZT»). */
export function useCurrency(): string {
  return useContext(CurrencyContext)
}

/** Символ валюты организации (₽, ₸, …). */
export function useCurrencySymbol(): string {
  return currencySymbol(useContext(CurrencyContext))
}

/**
 * Готовая функция форматирования суммы в валюте организации: `formatMoney(1234)`
 * → «1 234 ₽». Заменяет локальные formatMoney в клиентских компонентах —
 * сигнатура (amount, opts?) совместима с прежними вызовами по одному аргументу.
 */
export function useMoneyFormat(): (amount: number, opts?: FormatMoneyOptions) => string {
  const currency = useContext(CurrencyContext)
  return useCallback(
    (amount: number, opts?: FormatMoneyOptions) => fmt(amount, currency, opts),
    [currency],
  )
}
