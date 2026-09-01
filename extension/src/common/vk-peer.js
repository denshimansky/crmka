/**
 * Разбор адреса ВКонтакте — какой диалог открыт.
 *
 * Собеседник в ВК назван прямо в адресе, и это редкая удача: ни MAX, ни WhatsApp
 * такого не дают.
 *
 * ЖИВОЙ ПРОГОН 01.09.2026 (probe, Шаг 1) дал главную форму — и опроверг ту,
 * которую мы взяли заочно. У сообщества открывается НЕ старый `vk.com/im`, а
 * новый VK Messenger, встроенный в страницу сообщества, и диалог назван в ПУТИ:
 *
 *   • сообщения СООБЩЕСТВА — `vk.ru/gim137130907/convo/335368817?entrypoint=…`
 *     (главная поверхность для детских центров: администратор отвечает от имени
 *     сообщества, `gim<id>` — само сообщество, сегмент после `convo` — родитель).
 *     ⚠️ Чем именно является это число — peer id пользователя или внутренний
 *     номер диалога — probe ещё не ответил. На безопасность это не влияет (ключ
 *     уникален на диалог в любом случае), влияет только на автоподсказку по
 *     ссылке из карточки клиента;
 *   • диалог не выбран     — `vk.ru/gim137130907` без `convo`.
 *
 * Формы СТАРОГО интерфейса оставлены — он никуда не делся, и в браузерах
 * сотрудников какое-то время живут обе разметки:
 *
 *   • личные сообщения     — `vk.com/im?sel=45678901`;
 *   • беседа               — `sel=c45` либо `sel=2000000045` (кодировка peer_id
 *     из VK API: 2 000 000 000 + номер беседы);
 *   • диалог с сообществом — `sel=-216789012`.
 *
 * ПОЧЕМУ ПРАВИЛО СТРОЖЕ СЕРВЕРНОГО. Серверный `normalizeVkChatId`
 * (`app/src/lib/ext/chat-identity.ts`) разбирает ЛЮБУЮ строку от любой сборки
 * расширения и обязан лишь не склеивать разные чаты в один ключ. Адаптер видит
 * ЖИВОЙ адрес открытой вкладки, и незнакомая форма здесь — сигнал «мы не
 * понимаем, что открыто», а не повод угадывать. Цена ошибки несимметрична: не
 * показать карточку — досадно и обратимо; показать чужую и залить в неё
 * переписку — необратимо, ключ дедупа не даст её оттуда убрать.
 *
 * Функция чистая: DOM не трогает, зовётся с `location`, покрыта тестами
 * (src/__tests__/vk-peer.test.js).
 */

/** С этого числа начинаются peer id бесед в VK API (2 000 000 000 + номер беседы). */
const CHAT_PEER_BASE = 2_000_000_000

/** Первый сегмент пути, за которым собеседник НЕ стоит: это сам мессенджер. */
const MESSENGER_ROUTE = /^(?:im|gim\d+|mail)$/i

/**
 * @typedef {object} VkLocation
 * @property {"chat"|"multi"|"chat-list"|"other"} kind Что открыто.
 *   chat — диалог с человеком (его и обслуживаем);
 *   multi — беседа или диалог с сообществом: за чатом НЕ один человек, панель
 *     его не ведёт, но причину показывает отдельным текстом;
 *   chat-list — мессенджер открыт, диалог не выбран;
 *   other — форма адреса, которую мы не понимаем (лента, профиль, настройки).
 * @property {string|null} chatId Ключ чата — ровно тот, что уйдёт на сервер.
 *   Всегда СТРОКА: id ВК короче предела точности чисел, но правило «никогда не
 *   превращать идентификатор в Number» держим общим для всех каналов.
 * @property {string|null} community Сообщество, от имени которого ведётся
 *   переписка («216789012»), либо null в личных сообщениях. Идентификатором
 *   чата НЕ является — здесь оно только для диагностики: по нему видно, что
 *   открыты именно сообщения сообщества.
 */

/**
 * Адрес ВК → что открыто.
 *
 * @param {{pathname?: string, search?: string, hash?: string}|string|null|undefined} input
 *   Обычно `location`. Строку тоже принимаем — так удобнее в тестах и в probe.
 * @returns {VkLocation}
 */
export function parseVkLocation(input) {
  const { pathname, query } = readParts(input)
  const segments = pathname.split("/").filter((part) => part.trim().length > 0)
  const segment = segments[0]?.trim() ?? ""
  const community = /^gim(\d+)$/i.exec(segment)?.[1] ?? null

  // Ни в одной форме идентификатором чата НЕ является путь целиком: в
  // сообщениях сообщества первый сегмент — это САМО СООБЩЕСТВО, одно на все
  // диалоги. Приняв его за ключ, мы сложили бы переписку всех родителей центра
  // в одну карточку.

  // Новый VK Messenger: «…/convo/<собеседник>» (подтверждено прогоном
  // 01.09.2026). Проверяем первым — это главная форма.
  const convoAt = segments.findIndex((part) => part.toLowerCase() === "convo")
  if (convoAt >= 0) {
    const peer = segments[convoAt + 1]?.trim()
    // «convo» без собеседника — открыт список диалогов, а не чат.
    if (!peer) return { kind: "chat-list", chatId: null, community }
    const classified = classifyPeer(peer)
    return { kind: classified.kind, chatId: classified.chatId, community }
  }

  // Старый интерфейс: собеседник параметром «sel».
  const selected = (query.get("sel") ?? query.get("peer") ?? "").trim()
  if (selected) {
    const peer = classifyPeer(selected)
    return { kind: peer.kind, chatId: peer.chatId, community }
  }

  if (!segment) return { kind: "chat-list", chatId: null, community }
  if (MESSENGER_ROUTE.test(segment)) return { kind: "chat-list", chatId: null, community }
  return { kind: "other", chatId: null, community }
}

/**
 * Кто стоит за значением `sel`.
 *
 * @param {string} raw
 * @returns {{kind: "chat"|"multi"|"other", chatId: string|null}}
 */
function classifyPeer(raw) {
  const value = raw.replace(/^@+/, "").trim()
  if (!value) return { kind: "other", chatId: null }

  // Беседа: «c45» в адресе и 2000000045 в терминах API — один и тот же чат,
  // поэтому приводим к одной записи. Панель беседы не ведёт, но ключ всё равно
  // должен быть однозначным: по нему сервер узнаёт, в чём отказывать.
  const named = /^c(\d+)$/i.exec(value)
  if (named) return { kind: "multi", chatId: `c${named[1]}` }
  if (/^\d+$/.test(value) && Number(value) >= CHAT_PEER_BASE) {
    return { kind: "multi", chatId: `c${Number(value) - CHAT_PEER_BASE}` }
  }

  // Сообщество как СОБЕСЕДНИК (сотрудник пишет другой организации): за ним тоже
  // не один человек. В рабочем сценарии его быть не должно — в сообщениях
  // сообщества `sel` всегда человек.
  const community = /^(?:-|club|public|event)(\d+)$/i.exec(value)
  if (community) return { kind: "multi", chatId: `-${community[1]}` }

  // Человек: «id12345» и «12345» — один и тот же, ключ голым числом. Ровно это
  // делает осмысленным поле «ВКонтакте» в карточке клиента: администратор
  // вписал туда ссылку на страницу — панель узнает диалог без ручной привязки.
  const user = /^(?:id)?([1-9]\d*)$/i.exec(value)
  if (user) return { kind: "chat", chatId: user[1] }

  // Короткое имя страницы. В адресе диалога оно не встречается (ВК ставит там
  // числа), но прийти может — от старой сборки или из ручной правки адреса.
  if (/^[a-z][a-z0-9_.]{1,60}$/i.test(value)) return { kind: "chat", chatId: value.toLowerCase() }

  return { kind: "other", chatId: null }
}

/**
 * Достаём путь и параметры из location или из строки.
 *
 * Параметры ищем и в query, и в хэше: у ВК исторически было и то, и другое
 * («vk.com/im#sel=123»), и стоить это может всей переписки — чат просто не
 * опознается.
 *
 * @param {{pathname?: string, search?: string, hash?: string}|string|null|undefined} input
 */
function readParts(input) {
  if (input && typeof input === "object") {
    const search = String(input.search ?? "").replace(/^\?/, "")
    const hash = String(input.hash ?? "").replace(/^#/, "")
    return {
      pathname: String(input.pathname ?? ""),
      query: new URLSearchParams([search, hash].filter(Boolean).join("&")),
    }
  }

  const raw = String(input ?? "")
  const withoutHost = raw.replace(/^https?:\/\//i, "").replace(/^(?:m\.|web\.)?vk\.(?:com|ru|me)/i, "")
  const [pathname = "", ...rest] = withoutHost.split(/[?#]/)
  return { pathname, query: new URLSearchParams(rest.filter(Boolean).join("&")) }
}

/**
 * Обслуживает ли панель то, что открыто.
 *
 * Беседы и диалоги с сообществами — НЕТ, по той же причине, что групповые чаты
 * MAX и WhatsApp: за таким чатом стоит не один человек, и его переписку нельзя
 * положить в карточку одного клиента.
 *
 * @param {VkLocation} location
 * @returns {boolean}
 */
export function isServiceableVkChat(location) {
  return location.kind === "chat"
}
