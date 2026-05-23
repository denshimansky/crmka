"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"

/**
 * Превращает свободный ввод даты в строку формата YYYY-MM-DD (которую принимает <input type="date">).
 * Поддерживает разделители . - / пробел, форматы DD.MM.YYYY, YYYY-MM-DD, DD.MM.YY (XX→20XX если <50, иначе 19XX).
 * Возвращает null, если строку не удалось распознать как валидную дату.
 */
export function parseFlexibleDateISO(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const parts = trimmed.split(/[.\-/\s]+/).filter(Boolean)
  if (parts.length !== 3) return null

  let yyyy: number, mm: number, dd: number

  if (parts[0].length === 4) {
    // YYYY-MM-DD
    yyyy = Number(parts[0])
    mm = Number(parts[1])
    dd = Number(parts[2])
  } else if (parts[2].length === 4) {
    // DD-MM-YYYY
    dd = Number(parts[0])
    mm = Number(parts[1])
    yyyy = Number(parts[2])
  } else if (parts[2].length === 2) {
    // DD-MM-YY → 20YY (если YY<50) или 19YY
    dd = Number(parts[0])
    mm = Number(parts[1])
    const yy = Number(parts[2])
    yyyy = yy < 50 ? 2000 + yy : 1900 + yy
  } else {
    return null
  }

  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null
  if (yyyy < 1900 || yyyy > new Date().getFullYear()) return null
  if (mm < 1 || mm > 12) return null
  if (dd < 1 || dd > 31) return null

  // Проверка валидности (отбросит 31.02 и т.п.)
  const date = new Date(yyyy, mm - 1, dd)
  if (
    date.getFullYear() !== yyyy ||
    date.getMonth() !== mm - 1 ||
    date.getDate() !== dd
  ) {
    return null
  }

  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
}

interface BirthDateInputProps
  extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> {
  value: string
  onChange: (value: string) => void
}

/**
 * <input type="date"> с поддержкой вставки даты в любом распространённом формате
 * (Ctrl+V из Excel/Word/чатов): «23.05.2020», «23/05/2020», «23-05-20» и т.п.
 */
export function BirthDateInput({ value, onChange, ...props }: BirthDateInputProps) {
  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text/plain")
    const iso = parseFlexibleDateISO(text)
    if (iso) {
      e.preventDefault()
      onChange(iso)
    }
  }

  return (
    <Input
      {...props}
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPaste={handlePaste}
    />
  )
}
