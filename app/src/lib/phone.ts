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
