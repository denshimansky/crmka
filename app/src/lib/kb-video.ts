// Разбор ссылок RuTube → URL для встраивания (iframe). Чистый модуль без
// серверных зависимостей — используется и в клиентском плеере, и при валидации
// на сохранении. Поддерживает форматы:
//   https://rutube.ru/video/<id>/
//   https://rutube.ru/video/private/<id>/?p=<token>
//   https://rutube.ru/play/embed/<id>
//   <id>  (голый идентификатор)

const ID_RE = /^[a-f0-9]{16,40}$/i

/** Возвращает embed-URL RuTube или null, если ссылка не распознана. */
export function rutubeEmbedUrl(input: string): string | null {
  const raw = (input || "").trim()
  if (!raw) return null

  // Голый id
  if (ID_RE.test(raw)) return `https://rutube.ru/play/embed/${raw}`

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!/(^|\.)rutube\.ru$/i.test(url.hostname)) return null

  const m =
    url.pathname.match(/\/play\/embed\/([a-f0-9]{16,40})/i) ||
    url.pathname.match(/\/video\/(?:private\/)?([a-f0-9]{16,40})/i)
  if (!m) return null

  const id = m[1]
  const p = url.searchParams.get("p") // токен доступа для приватных видео
  return `https://rutube.ru/play/embed/${id}${p ? `?p=${encodeURIComponent(p)}` : ""}`
}

export function isValidRutube(input: string): boolean {
  return rutubeEmbedUrl(input) !== null
}
