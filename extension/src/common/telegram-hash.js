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
 *
 * Хэш — НЕ канонический идентификатор собеседника: в /k он зависит от того, есть
 * ли у человека ник, и меняется вместе с ником. Канон (числовой peer id) живёт в
 * common/telegram-peer.js; здесь только «что открыто прямо сейчас».
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
  //
  // Числовой «p» здесь значит НЕ то же, что число в хэше: tweb трактует его как
  // p.toPeerId(true), то есть как ЧАТ (со знаком минус), а не как пользователя.
  // Приняв его за peer id собеседника, мы выдали бы группу за человека и
  // привязали к клиенту чужую переписку — поэтому числа отсюда не берём вовсе.
  // Канон в этом случае приедет из DOM (common/telegram-peer.js), а @username
  // работает как и работал.
  if (raw.startsWith("/")) {
    const queryStart = raw.indexOf("?")
    if (queryStart === -1) return null
    const peer = new URLSearchParams(raw.slice(queryStart + 1)).get("p")
    if (!peer) return null
    return normalizePeer(peer, { allowNumeric: false })
  }

  // Служебное «?tgaddr=tg://…» — не про открытый чат.
  if (raw.startsWith("?")) return null

  // WebA складывает части через «_»: «#<chatId>_<threadId>_<type>» — нужен
  // только первый сегмент.
  //
  // ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ: сохранённые диалоги («Избранное», разложенное по
  // собеседникам) имеют ту же форму «#<мой_id>_<peerId>», где первый сегмент —
  // id ТЕКУЩЕГО пользователя. Отличить их от обычного треда по одному хэшу
  // нельзя: threadId тоже число. Схлопывание здесь оставлено сознательно —
  // отказ от формы «число_число» ломал бы узнавание обычных чатов с суффиксом
  // (см. тест «части через подчёркивание»), а привязка своего «Избранного» к
  // клиенту требует отдельного осознанного действия человека.
  return normalizePeer(raw.split("_")[0])
}

/**
 * @param {string} value
 * @param {{allowNumeric?: boolean}} [options] allowNumeric:false — источник, где
 *   число значит не peer id собеседника (см. форму «/im?p=»).
 * @returns {string|null}
 */
function normalizePeer(value, options = {}) {
  const peer = value.replace(/^@/, "").trim()
  if (!peer) return null
  // Число (в т.ч. отрицательное — группы и каналы) либо @username.
  if (/^-?\d+$/.test(peer)) return options.allowNumeric === false ? null : peer
  if (/^[a-zA-Z0-9_]{3,}$/.test(peer)) return peer
  return null
}
