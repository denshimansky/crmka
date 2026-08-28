/**
 * Разбор адресной строки Telegram Web — самый стабильный сигнал «какой чат
 * открыт» (docs/messenger-extension.md §2).
 *
 * Вынесено из content script отдельно и без обращений к DOM, чтобы покрыть
 * тестами: формат хэша — главный хрупкий стык с мессенджером, и молчаливая
 * поломка здесь означает «панель просто перестала находить клиентов».
 *
 * Два клиента пишут хэш по-разному:
 *   • WebK (/k): «#@username», либо «#<peerId>» (число, у групп со знаком «-»),
 *     либо внутренний вид «#/im?p=@username&post=123»;
 *   • WebA (/a): всегда числовой «#<chatId>», части через «_»:
 *     «#<chatId>_<threadId>_<type>».
 */

/**
 * @param {string} pathname
 * @returns {"k"|"a"} Какой клиент Telegram открыт.
 */
export function detectTelegramClient(pathname) {
  return pathname.startsWith("/a") ? "a" : "k"
}

/**
 * Идентификатор открытого чата из хэша.
 *
 * @param {string} hash Значение window.location.hash (с «#» или без).
 * @returns {string|null} @username без «собаки», числовой id либо null,
 *   если чат не открыт (список диалогов) или в хэше служебное значение.
 */
export function parseTelegramChatId(hash) {
  let raw = (hash || "").trim()
  try {
    raw = decodeURIComponent(raw)
  } catch {
    // Битая последовательность %-кодирования — работаем с исходной строкой.
  }
  raw = raw.replace(/^#/, "").trim()
  if (!raw) return null

  // Внутренний вид WebK: «/im?p=@username&post=…».
  if (raw.startsWith("/")) {
    const queryStart = raw.indexOf("?")
    if (queryStart === -1) return null
    const peer = new URLSearchParams(raw.slice(queryStart + 1)).get("p")
    if (!peer) return null
    return normalizePeer(peer)
  }

  // Служебное «?tgaddr=tg://…» — не про открытый чат.
  if (raw.startsWith("?")) return null

  // WebA складывает части через «_» — нужен только первый сегмент.
  return normalizePeer(raw.split("_")[0])
}

/**
 * @param {string} value
 * @returns {string|null}
 */
function normalizePeer(value) {
  const peer = value.replace(/^@/, "").trim()
  if (!peer) return null
  // Число (в т.ч. отрицательное — группы и каналы) либо @username.
  if (/^-?\d+$/.test(peer)) return peer
  if (/^[a-zA-Z0-9_]{3,}$/.test(peer)) return peer
  return null
}
