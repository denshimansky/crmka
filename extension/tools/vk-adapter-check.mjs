/**
 * Проверка адаптера ВКонтакте на синтетической разметке.
 *
 * Живой ВК это НЕ заменяет (для него есть TESTING.md и tools/vk-probe.js):
 * селекторы здесь наши же, и если ВК переименует класс, проверка останется
 * зелёной. Она ловит другое — регрессы в НАШЕЙ логике разбора: ключ чата,
 * направление, наследование в серии, время из двух половин, отбраковку реакций,
 * вставку без отправки, отказ от бесед.
 *
 * Разметка-двойник построена по ЧЕТЫРЁМ живым прогонам probe 01.09.2026
 * (docs/messenger-extension.md §8, Фаза 6), а не по догадкам. Отсюда
 * воспроизведено ровно то, что видно на настоящей странице:
 *   • адрес `vk.ru/gim<сообщество>/convo/<peer>`; путь — это САМО сообщество,
 *     идентификатор чата берётся после `convo`;
 *   • классов направления НЕТ: сторона видна по peer id в маске аватара
 *     (у сообщества он отрицательный) и по галочкам статуса у своих;
 *   • у сообщений подряд одного автора аватар и подпись скрыты — направление
 *     наследуется от строки выше;
 *   • реакция несёт класс `ReactionChip--incoming` — ложный признак стороны;
 *   • часы в `…__date` (рядом может стоять подпись администратора), дата — в
 *     разделителе дня выше по ленте;
 *   • строки СПИСКА диалогов помечены тем же `VirtualScrollItem`, что и лента.
 *
 * Запуск (playwright лежит в зависимостях приложения):
 *   cd app && node ../extension/tools/vk-adapter-check.mjs
 */
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const EXTENSION_ROOT = path.resolve(fileURLToPath(import.meta.url), "../..")
const require = createRequire(path.join(EXTENSION_ROOT, "..", "app", "package.json"))
const { chromium } = require("@playwright/test")
const CHROMIUM =
  process.env.CHROMIUM_PATH || "C:/Users/Cyberjinn/AppData/Local/Chromium/Application/chrome.exe"

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }

/** Разделитель дня — единственный источник ДАТЫ. */
const separator = (label) => `
  <div class="StickyDateSeparator" role="presentation">
    <span class="DateSeparator DateSeparator--visible" role="heading" aria-level="3"
          aria-label="${label}">${label}</span>
  </div>`

/**
 * Строка ленты.
 *
 * @param {object} o
 * @param {number} o.key
 * @param {"in"|"out"} o.dir
 * @param {string} o.text
 * @param {string} o.time Часы; у исходящих ВК дописывает имя администратора.
 * @param {string|null} [o.authorPeer] Peer id автора; null — серия, автор скрыт.
 * @param {boolean} [o.reaction] Реакция собеседника на это сообщение.
 * @param {boolean} [o.media] Медиа без подписи: текста нет вовсе.
 */
const row = ({ key, dir, text, time, authorPeer, authorHref, reaction, media }) => `
  <div class="VirtualScrollItem" data-itemkey="${key}">
    <article class="ConvoHistory__messageBlock ConvoHistory__messageBlock--withContextMenu ConvoHistory__messageBlock--withoutBubbles"
             aria-labelledby=":r${key}:preview" tabindex="-1">
      <div class="ConvoHistory__selectToggler--withoutBubbles"></div>
      <div class="ConvoHistory__messageWrapper ConvoHistory__messageWrapper--withoutBubbles">
        <div class="ConvoMessageWithoutBubble" id=":r${key}:preview">
          ${
            authorPeer
              ? `<a class="ConvoMessageWithoutBubble__avatar" aria-hidden="true" tabindex="-1" href="${authorHref ?? (authorPeer.startsWith("-") ? "/umnyidd" : "/id" + authorPeer)}">
                   <figure class="MEAvatar MEAvatar--size-36">
                     <div class="MEAvatar__imgWrapper" style="clip-path: url(&quot;#mePeerFrameOffline36Mask${authorPeer}&quot;);"></div>
                   </figure>
                 </a>`
              : ""
          }
          <div class="ConvoMessageWithoutBubble__wrapper">
            <div class="ConvoMessageWithoutBubble__content">
              ${media ? "" : `<span class="ConvoMessageWithoutBubble__text"><span class="MessageText">${text}</span></span>`}
            </div>
            <div class="ConvoMessageInfoWithoutBubbles${authorPeer ? "" : " ConvoMessageWithoutBubble__info--withoutAuthor"}">
              ${dir === "out" ? '<span class="ConvoMessageInfoWithoutBubbles__statusIcon"><span aria-label="Прочитано"></span></span>' : ""}
              <span class="ConvoMessageInfoWithoutBubbles__date" aria-disabled="true">${time}</span>
            </div>
          </div>
          ${
            reaction
              ? `<div class="ConvoMessageWithoutBubble__reactions">
                   <div class="ReactionChip ReactionChip--incoming ReactionChip--active" aria-label="Сердце"></div>
                 </div>`
              : ""
          }
          <div class="DropdownReforged MessageActionsDropdown ConvoMessage__actions ConvoMessage__actions--withoutBubbles">
            <div class="MessageActionsButtonContainer" data-testid="vkme_messages_actions"></div>
          </div>
        </div>
      </div>
    </article>
  </div>`

/**
 * Страница ЛИЧНОГО мессенджера (vk.ru/im). Отличия от сообщества, ради которых
 * двойник и разделён: шапка БЕЗ ссылки на профиль (ВК открывает его панелью
 * справа), а в ленте висят аватары обеих сторон — и нашей тоже.
 */
const PERSONAL_PAGE = () => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>ВКонтакте</title></head>
<body>
<div class="MEApp__route"><div class="MEApp__mainPanel">
<header class="ConvoHeader">
  <div class="ConvoHeader__infoContainer"><div class="PeerTitle">Анна Малафеева</div><span>online</span></div>
</header>
<div class="ConvoHistory">
  <div class="ConvoHistory__flow" role="list" aria-label="Сообщения" tabindex="-1">
    <div class="ConvoHistory__dateStack">
      ${separator("21 августа 2026")}
      ${row({ key: 5, dir: "in", authorPeer: "704773753", authorHref: "/annmalafeeva", text: "Добрый день!", time: "10:00" })}
      ${row({ key: 6, dir: "out", authorPeer: "53305026", authorHref: "/mypage", text: "Здравствуйте, записываю", time: "10:02" })}
    </div>
  </div>
</div>
<div class="ConvoComposer">
  <span class="ComposerInput__input" contenteditable="true" role="textbox"></span>
</div>
</div></div>
</body></html>`

const PAGE = () => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>ВКонтакте</title></head>
<body>
<div class="MEApp__route"><div class="MEApp__mainPanel">
<section class="ConvoList MEApp__convoList" data-testid="me_convo_list">
  <div class="ConvoList__header"><div class="vkmListHeader__title">
    <h1 class="ConvoList__headerGroup"><a href="/club137130907">УМНЫЙ Я / Олимпик / Димитровград</a></h1>
  </div></div>
  <!-- Строки СПИСКА диалогов: тот же VirtualScrollItem, что и в ленте, и своя
       PeerTitle с чужим именем. Ни то, ни другое лентой считаться не должно. -->
  <div class="ConvoList__item VirtualScrollItem" data-itemkey="convo_335368817">
    <div class="PeerTitle">Мама Пети</div>
  </div>
  <div class="ConvoList__item VirtualScrollItem" data-itemkey="convo_102594038">
    <div class="PeerTitle">Ольга Подфедько</div>
  </div>
</section>
<header class="ConvoHeader">
  <button class="ConvoHeader__action ConvoHeader__back" aria-label="Закрыть"></button>
  <a class="ConvoHeader__info" href="/olgapod">
    <div class="PeerTitle">Ольга Подфедько</div><span>заходила 12 минут назад</span>
  </a>
</header>
<div class="ConvoHistory">
  <div class="ConvoHistory__flow" role="list" aria-label="Сообщения" tabindex="-1">
    <div class="ConvoHistory__dateStack">
      ${separator("25 апреля 2025")}
      <!-- Виртуализация: всё выше экрана — пустые заглушки. -->
      <div class="VirtualScrollItem" data-itemkey="1"><div style="height: 100px;"></div></div>
    </div>
    <div class="ConvoHistory__dateStack">
      ${separator("Непрочитанные")}
      ${separator("21 августа 2026")}
      ${row({ key: 15, dir: "in", authorPeer: "102594038", text: "Здравствуйте! Завтра занятие будет?", time: "16:04" })}
      ${row({ key: 16, dir: "in", authorPeer: null, text: "Или уже отменили?", time: "16:05" })}
      ${row({ key: 17, dir: "out", authorPeer: "-137130907", text: "Да, ждём вас в 17:00", time: "16:07 (Анна И)" })}
      ${row({ key: 18, dir: "out", authorPeer: null, text: "Кабинет 3", time: "16:08" })}
      ${row({ key: 19, dir: "out", authorPeer: "-137130907", text: "Ждём вас!", time: "16:09 (Анна И)", reaction: true })}
      ${row({ key: 20, dir: "in", authorPeer: "102594038", text: "", time: "16:10", media: true })}
    </div>
  </div>
</div>
<div class="ConvoComposer">
  <span class="ComposerInput__input ConvoComposer__input" contenteditable="true"
        data-placeholder="Сообщение" role="textbox" aria-multiline="true"></span>
</div>
</div></div>
</body></html>`

const server = http.createServer((req, res) => {
  const [rawUrl] = decodeURI(req.url).split("?")
  const file = path.join(EXTENSION_ROOT, rawUrl)
  if (rawUrl.startsWith("/src/") && fs.existsSync(file)) {
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "text/plain" })
    res.end(fs.readFileSync(file))
    return
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(rawUrl.startsWith("/im/") ? PERSONAL_PAGE() : PAGE())
})
await new Promise((resolve) => server.listen(0, resolve))
const origin = `http://localhost:${server.address().port}`

const browser = await chromium.launch({ executablePath: CHROMIUM })
const page = await browser.newPage()
page.on("console", (m) => {
  if (m.type() === "error") console.log("  [консоль]", m.text())
})

// Подменяем chrome.* — адаптер тянет чистые модули через chrome.runtime.getURL.
await page.addInitScript((base) => {
  const sent = []
  window.__sentToWorker = sent
  window.chrome = {
    runtime: {
      id: "test",
      getURL: (p) => `${base}/${p}`,
      sendMessage: (message) => {
        sent.push(message)
        return Promise.resolve()
      },
      onMessage: { addListener: () => {} },
    },
    storage: {
      local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      onChanged: { addListener: () => {} },
    },
  }
}, origin)

const problems = []
let checks = 0
/** @param {string} name @param {boolean} ok @param {unknown} [details] */
function check(name, ok, details) {
  checks++
  if (!ok) problems.push({ name, details })
  console.log(`${ok ? "✔" : "✖"} ${name}`, ok ? "" : JSON.stringify(details, null, 2) ?? "")
}

/** Поднять страницу-двойник по нужному адресу и запустить на ней адаптер. */
async function load(pathname, _opts) {
  await page.goto(`${origin}${pathname}`)
  await page.addScriptTag({ url: `${origin}/src/content/adapter-core.js` })
  await page.evaluate(() => {
    const core = window.__crmkaAdapterCore
    const realStart = core.start
    core.start = (adapter) => {
      window.__adapter = adapter
      realStart(adapter)
    }
  })
  await page.addScriptTag({ url: `${origin}/src/content/vk.js` })
  await page.waitForFunction(() => Boolean(window.__adapter), null, { timeout: 5000 })
  // Адаптер выжидает окно «кадра перехода» (SETTLE_MS), прежде чем собирать.
  await page.waitForTimeout(900)
}

// ── Диалог в сообщениях сообщества ──────────────────────────────────────────
await load("/gim137130907/convo/102594038")

const chat = await page.evaluate(() => window.__adapter.readChat())
check("ключ чата — собеседник, а не сообщество из пути", chat?.chatId === "102594038", chat)
check("канал vk, чат обслуживается", chat?.channel === "vk" && !chat.unsupported, chat)
check(
  "второй идентификатор — короткое имя со страницы собеседника",
  chat?.altIds?.includes("olgapod"),
  chat?.altIds,
)
check("имя собеседника без прилипшего статуса", chat?.title === "Ольга Подфедько", chat?.title)
check("телефон не выдумываем: во ВКонтакте его нет", chat?.phone === null, chat)

const messages = await page.evaluate(() => window.__adapter.collectMessages())
check("собрано пять сообщений (медиа без подписи пропущено)", messages.length === 5, messages)
check(
  "направление по peer id автора: положительный — родитель, отрицательный — мы",
  messages[0]?.direction === "incoming" && messages[2]?.direction === "outgoing",
  messages.map((m) => `${m.text}:${m.direction}`),
)
check(
  "продолжение серии входящих наследует направление",
  messages[1]?.text === "Или уже отменили?" && messages[1]?.direction === "incoming",
  messages.map((m) => `${m.text}:${m.direction}`),
)
check(
  "продолжение серии исходящих опознано по галочкам",
  messages[3]?.text === "Кабинет 3" && messages[3]?.direction === "outgoing",
  messages.map((m) => `${m.text}:${m.direction}`),
)
check(
  "реакция родителя НЕ переворачивает наше сообщение во входящее",
  messages[4]?.text === "Ждём вас!" && messages[4]?.direction === "outgoing",
  messages.map((m) => `${m.text}:${m.direction}`),
)
check(
  "время собрано из разделителя дня и часов строки",
  messages[0]?.sentAt?.startsWith("2026-08-21T"),
  messages[0]?.sentAt,
)
check(
  "разделитель «Непрочитанные» не затёр дату",
  messages.every((m) => m.sentAt?.startsWith("2026-08-21T")),
  messages.map((m) => m.sentAt),
)
check(
  "часы и подпись администратора не приклеились к тексту",
  messages[2]?.text === "Да, ждём вас в 17:00",
  messages.map((m) => m.text),
)
check(
  "реакция не попала в текст сообщения",
  !messages.some((m) => m.text.includes("Сердце")),
  messages.map((m) => m.text),
)
check(
  "ключ дедупа детерминирован и несёт версию схемы",
  messages.every((m) => /^v1-[0-9a-f]{16}/.test(m.externalId)),
  messages.map((m) => m.externalId),
)
check(
  "ключи разных сообщений не совпадают",
  new Set(messages.map((m) => m.externalId)).size === messages.length,
  messages.map((m) => m.externalId),
)

const repeat = await page.evaluate(() => window.__adapter.collectMessages())
check(
  "повторный сбор даёт ТЕ ЖЕ ключи — иначе карточка копила бы дубли",
  JSON.stringify(repeat.map((m) => m.externalId)) === JSON.stringify(messages.map((m) => m.externalId)),
  { repeat: repeat.map((m) => m.externalId), messages: messages.map((m) => m.externalId) },
)

const diag = await page.evaluate(() => window.__adapter.diag())
check("счётчик пустых отработал (медиа без подписи)", diag?.сбор?.пустых === 1, diag?.сбор)
check("строки списка диалогов в ленту не попали", diag?.сбор?.всего === 6, diag?.сбор)

const latest = await page.evaluate(() => window.__adapter.latestMessageKey())
check("отпечаток последнего сообщения читается", typeof latest === "string" && latest.length > 0, latest)

// ── Вставка текста ──────────────────────────────────────────────────────────
const inserted = await page.evaluate(() => window.__adapter.insertText("строка один\nстрока два"))
const composerText = await page.evaluate(
  () => document.querySelector(".ComposerInput__input").innerText,
)
check("вставка через execCommand принята", inserted === true, { inserted, composerText })
check(
  "переносы строк сохранены — проверено и на живом ВК",
  composerText.includes("строка один") && composerText.includes("строка два"),
  composerText,
)
const sentAfterInsert = await page.evaluate(() => window.__sentToWorker.length)
check("вставка ничего не отправила собеседнику", typeof sentAfterInsert === "number", sentAfterInsert)

// ── ЛИЧНЫЕ сообщения: там наша сторона — обычный аккаунт ────────────────────
// Две мины живут именно здесь, и обе тихие. Первая: наш peer id такой же
// ПОЛОЖИТЕЛЬНЫЙ, как у родителя, и правило «минус — значит мы» перевернуло бы
// всю исходящую переписку. Вторая: в ленте висит и НАШ аватар со ссылкой на наш
// профиль — взяв его вторым идентификатором чата, мы получили бы один и тот же
// handle во всех диалогах и склеили бы их в одну карточку.
await load("/im/convo/704773753", { personal: true })

const dm = await page.evaluate(() => window.__adapter.readChat())
check("личный чат опознан по тому же /convo/", dm?.chatId === "704773753", dm)
check(
  "вторым идентификатором взят handle СОБЕСЕДНИКА, а не наш",
  dm?.altIds?.includes("annmalafeeva") && !dm.altIds.includes("mypage"),
  dm?.altIds,
)

const dmMessages = await page.evaluate(() => window.__adapter.collectMessages())
check(
  "в личке направление считается сравнением с собеседником, а не знаком",
  dmMessages[0]?.direction === "incoming" && dmMessages[1]?.direction === "outgoing",
  dmMessages.map((m) => `${m.text}:${m.direction}`),
)

// ── Беседа: панель её не ведёт ──────────────────────────────────────────────
await load("/gim137130907/convo/2000000045")
const multi = await page.evaluate(() => window.__adapter.readChat())
check("беседа отдана с признаком unsupported, а не спрятана", multi?.unsupported === "group", multi)
check("ключ беседы приведён к «c<N>»", multi?.chatId === "c45", multi)
const multiMessages = await page.evaluate(() => window.__adapter.collectMessages())
check("из беседы не собрано ни одного сообщения", multiMessages.length === 0, multiMessages)

// ── Диалог не выбран ────────────────────────────────────────────────────────
await load("/gim137130907")
const none = await page.evaluate(() => window.__adapter.readChat())
check("без /convo/ чата нет вовсе", none === null, none)

await browser.close()
server.close()

console.log(`\nПроверок: ${checks}, проблем: ${problems.length}`)
if (problems.length > 0) process.exit(1)
