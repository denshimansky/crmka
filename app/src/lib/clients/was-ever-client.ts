/**
 * «Бывший (или текущий) клиент» — кто хоть раз был активным. Долгоживущий
 * признак: занос в ЧС/Архив обнуляет clientStatus, но даты остаются. Никакой
 * миграции БД — сигнал берём из существующих полей.
 */
export function wasEverClient(c: {
  firstPaymentDate: Date | null
  firstPaidLessonDate: Date | null
  clientStatus: string | null
}): boolean {
  return (
    c.firstPaymentDate != null ||
    c.firstPaidLessonDate != null ||
    c.clientStatus === "active" ||
    c.clientStatus === "churned"
  )
}
