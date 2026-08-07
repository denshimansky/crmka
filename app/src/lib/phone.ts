// Нормализация телефонов = логин ЛК родителя.
// Российские номера сводятся к канону «7XXXXXXXXXX» (11 цифр, первая «7»),
// чтобы «+7 999…», «8 999…» и «999…» давали один логин.
// Нероссийские номера (партнёры не из РФ) логином становятся «как есть» —
// только цифры входного значения. Нужна хотя бы одна цифра.
// Функция детерминирована и используется и при выдаче учётки, и при входе,
// поэтому логин, сохранённый в карточке, всегда совпадает с введённым при входе.

export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null
  const digits = input.replace(/\D/g, "")
  if (!digits) return null
  if (digits.length === 10 && digits.startsWith("9")) return `7${digits}`
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`
  if (digits.length === 11 && digits.startsWith("7")) return digits
  return digits
}

export function formatPhone(canonical: string): string {
  if (!/^7\d{10}$/.test(canonical)) return canonical
  return `+7 (${canonical.slice(1, 4)}) ${canonical.slice(4, 7)}-${canonical.slice(7, 9)}-${canonical.slice(9)}`
}

// Ключ сравнения телефонов «это один и тот же номер»: последние 10 цифр входа.
// Гасит формат (скобки/пробелы/дефисы/плюс) и код страны 8/7 — у «+79991112233»,
// «89991112233», «79991112233» и «голого» 10-значного мобильного «9991112233»
// последние 10 цифр совпадают («9991112233»). null, если во входе меньше 7 цифр
// (слишком коротко для надёжного совпадения — не блокируем и не подсказываем).
// Используется для запрета дублей клиентов и живой подсказки в форме создания.
export function phoneMatchKey(input: string | null | undefined): string | null {
  if (!input) return null
  const digits = input.replace(/\D/g, "")
  if (digits.length < 7) return null
  return digits.slice(-10)
}
