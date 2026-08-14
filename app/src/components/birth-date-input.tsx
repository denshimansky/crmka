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
  /** Значение в ISO (YYYY-MM-DD) или "" — как хранит/шлёт форма. */
  value: string
  onChange: (value: string) => void
}

/** ISO (YYYY-MM-DD) → отображение ДД.ММ.ГГГГ; прочее возвращаем как есть. */
function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

/**
 * Ввод даты рождения как ТЕКСТ (ДД.ММ.ГГГГ), а не <input type="date">. Причина:
 * нативный date-пикер на macOS при пустом value показывал сегодняшнюю дату
 * (на Windows — ок), и админ, не зная даты, вынужденно сохранял некорректную.
 * Текстовое поле стартует гарантированно пустым на всех платформах, а гибкий
 * парсинг (parseFlexibleDateISO) сохраняет и ручной ввод, и вставку из
 * Excel/чатов в любом формате: «23.05.2020», «23/05/2020», «23-05-20», ISO.
 * Наружу отдаём ISO (YYYY-MM-DD) или "" — контракт value/onChange не изменился.
 */
export function BirthDateInput({ value, onChange, ...props }: BirthDateInputProps) {
  // Локальный текст ввода (в формате отображения). Наружу — ISO.
  const [text, setText] = React.useState(() => isoToDisplay(value))

  // Внешняя смена value (сброс формы, подстановка при загрузке карточки) →
  // синхронизируем текст. Только если ISO реально отличается от уже введённого —
  // иначе перебивали бы набор пользователя на каждый ре-рендер.
  React.useEffect(() => {
    const currentIso = parseFlexibleDateISO(text) ?? ""
    if (value !== currentIso) setText(isoToDisplay(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function handleChange(next: string) {
    setText(next)
    // Пусто → ""; распознанная дата → ISO; недобранная (ещё печатают) → "" наружу,
    // но текст сохраняем, чтобы ввод не сбрасывался.
    onChange(next.trim() ? parseFlexibleDateISO(next.trim()) ?? "" : "")
  }

  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      placeholder="ДД.ММ.ГГГГ"
      value={text}
      onChange={(e) => handleChange(e.target.value)}
    />
  )
}
