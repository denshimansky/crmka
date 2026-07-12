// Транслитерация кириллицы в латиницу — для автогенерации технических
// идентификаторов из русских названий (пароль сотрудника из фамилии,
// код вида посещения из названия и т.п.).

export const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
}

/** Транслит без разделителей: только [a-z0-9] (пароли, логины). */
export function transliterate(input: string): string {
  return input
    .toLowerCase()
    .split("")
    .map((ch) => CYR_TO_LAT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]/g, "")
}

/**
 * Технический код из названия: snake_case латиницей («Уваж. пропуск по болезни»
 * → uvazh_propusk_po_bolezni). Пустая строка, если в названии нет ни одного
 * транслитерируемого символа, — фоллбэк выбирает вызывающий код.
 */
export function slugCode(input: string, maxLen = 40): string {
  return input
    .toLowerCase()
    .split("")
    .map((ch) => CYR_TO_LAT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLen)
    .replace(/_+$/g, "")
}
