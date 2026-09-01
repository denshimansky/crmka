/**
 * Проверка probe ВКонтакте на разметке-двойнике.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ ПРОВЕРКА У ИНСТРУМЕНТА, А НЕ У АДАПТЕРА. Адаптера ВК ещё нет:
 * сейчас идёт Шаг 1, и вся работа делается чужими руками — probe вставляют в
 * консоль в живом сообществе. Каждый такой заход стоит времени заказчика, а
 * упавший или молча пустой probe стоит целого захода. Первый прогон (01.09.2026)
 * это и показал: широкий селектор `[class*='Message__']` поймал не сообщения, а
 * выпадашки действий (`ConvoMessage__actions`), и весь инвентарь строк приехал
 * пустым.
 *
 * ЧТО ЭТО ЛОВИТ, А ЧТО НЕТ. Ловит регрессы НАШЕЙ логики: разбор адреса, поиск
 * ленты, отбраковку служебных узлов, чтение хвоста виртуализированного списка,
 * вставку текста. НЕ ловит изменения разметки ВК — она здесь наша же.
 *
 * РАЗМЕТКА-ДВОЙНИК ПОСТРОЕНА ПО ЖИВОМУ ПРОГОНУ 01.09.2026, а не по догадкам.
 * Отсюда воспроизведено ровно то, что видно в настоящем отчёте:
 *   • адрес `vk.ru/gim137130907/convo/335368817?entrypoint=list_all` — диалог
 *     назван сегментом пути после `convo`, никакого `sel`;
 *   • лента `.ConvoHistory__flow[role=list]`, внутри `.ConvoHistory__dateStack`
 *     с разделителем `span.DateSeparator[aria-label="25 апреля 2025"]` — полная
 *     дата с годом;
 *   • виртуализация: `.VirtualScrollItem[data-itemkey]`, и всё, что выше экрана,
 *     это пустые заглушки `height: 100px`;
 *   • у каждого сообщения есть `.ConvoMessage__actions` — та самая ловушка для
 *     широкого селектора;
 *   • поле ввода — `span.ComposerInput__input[contenteditable="true"]`.
 *
 * Запуск (playwright лежит в зависимостях приложения, как у wa-adapter-check):
 *   cd app && node ../extension/tools/vk-probe-check.mjs
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

/** Заглушка виртуального списка: узел есть, содержимого нет — как выше экрана. */
const placeholder = (key) => `
  <div class="ConvoHistory__dateStack">
    <div class="StickyDateSeparator" role="presentation">
      <span class="DateSeparator DateSeparator--visible" role="heading" aria-level="3"
            aria-label="25 апреля 2025">25 апреля 2025</span>
    </div>
    <div class="VirtualScrollItem" data-itemkey="${key}"><div style="height: 100px;"></div></div>
  </div>`

/**
 * Отрисованное сообщение. Внутри — блок действий с классом
 * `ConvoMessage__actions`: именно на него купился широкий селектор первой
 * версии probe, и двойник обязан эту ловушку сохранять.
 *
 * @param {object} o
 * @param {string} o.key   Значение data-itemkey (кандидат в id сообщения).
 * @param {"in"|"out"} o.dir
 * @param {string} o.text
 * @param {string} o.time
 */
/**
 * Строка ленты — точная копия живой структуры (прогон v3, 01.09.2026).
 *
 * Важные детали, ради которых копия и делалась дословной:
 *   • классов направления НЕТ: `--withoutBubbles` это про стиль, а не про
 *     сторону. Направление видно по peer id в маске аватара (у сообщества он
 *     отрицательный) и по галочкам статуса, которые бывают только у своих;
 *   • у сообщений подряд одного автора аватар и подпись скрыты
 *     (`--withoutAuthor`) — направление тогда наследуется от строки выше;
 *   • текст в `span.MessageText`, часы в `…__date`, дата — только в разделителе
 *     дня выше по ленте.
 *
 * @param {object} o
 * @param {number} o.key
 * @param {"in"|"out"} o.dir
 * @param {string} o.text
 * @param {string} o.time
 * @param {string|null} [o.authorPeer] Peer id автора; null — автор скрыт (серия).
 * @param {boolean} [o.reaction] Поставлена ли реакция (у «сердечка» класс
 *   `ReactionChip--incoming` — ложный признак направления, см. ниже).
 */
const message = ({ key, dir, text, time, authorPeer, reaction }) => `
  <div class="VirtualScrollItem" data-itemkey="${key}">
    <article class="ConvoHistory__messageBlock ConvoHistory__messageBlock--withContextMenu ConvoHistory__messageBlock--withoutBubbles ConvoHistory__messageBlockCanBeSelected--withoutBubbles"
             aria-labelledby=":r${key}:preview" tabindex="-1">
      <div class="ConvoHistory__selectToggler--withoutBubbles ConvoHistory__selectTogglerInActive--withoutBubbles"></div>
      <div class="ConvoHistory__messageWrapper ConvoHistory__messageWrapper--withoutBubbles">
        <div class="ConvoMessageWithoutBubble" id=":r${key}:preview">
          ${
            authorPeer
              ? `<a class="ConvoMessageWithoutBubble__avatar" aria-hidden="true" tabindex="-1" href="/umnyidd">
                   <figure class="MEAvatar MEAvatar--size-36">
                     <div class="MEAvatar__imgWrapper" style="clip-path: url(&quot;#mePeerFrameOffline36Mask${authorPeer}&quot;);"></div>
                     <svg class="MEAvatar__svg">
                       <clipPath id="mePeerFrameOffline36Mask${authorPeer}"></clipPath>
                       <use class="MEAvatar__shadow" clip-path="url(#mePeerFrameOffline36Mask${authorPeer})"></use>
                     </svg>
                   </figure>
                 </a>`
              : ""
          }
          <div class="ConvoMessageWithoutBubble__wrapper">
            <div class="ConvoMessageWithoutBubble__content">
              <span class="ConvoMessageWithoutBubble__text"><span class="MessageText">${text}</span></span>
            </div>
            <div class="ConvoMessageInfoWithoutBubbles${authorPeer ? "" : " ConvoMessageWithoutBubble__info--withoutAuthor"}">
              ${dir === "out" ? '<span class="ConvoMessageInfoWithoutBubbles__statusIcon"><span aria-label="Прочитано"></span></span>' : ""}
              <span class="ConvoMessageInfoWithoutBubbles__date" aria-disabled="true">${time}</span>
            </div>
          </div>
          ${
            reaction
              ? `<div class="ConvoMessageWithoutBubble__reactions">
                   <div class="ReactionChip ReactionChip--incoming ReactionChip--active" aria-label="Сердце"
                        data-testid="vkme_message_reaction_chip_1"></div>
                 </div>`
              : ""
          }
          <div class="DropdownReforged MessageActionsDropdown ConvoMessage__actions ConvoMessage__actions--withoutBubbles">
            <div class="DropdownReforged__trigger">
              <div class="MessageActionsButtonContainer" data-testid="vkme_messages_actions"></div>
            </div>
          </div>
        </div>
      </div>
    </article>
  </div>`

/**
 * Страница-двойник. Путь берётся из адреса запроса — так проверяется разбор
 * `/gim<сообщество>/convo/<собеседник>` ровно тем же кодом, что побежит вживую.
 */
const PAGE = () => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>ВКонтакте</title></head>
<body>
<div class="MEApp__route"><div class="MEApp__mainPanel">
<section class="ConvoList MEApp__convoList" data-testid="me_convo_list">
  <div class="ConvoList__header"><div class="vkmListHeader__title">
    <h1 class="ConvoList__headerGroup"><a href="/club137130907">УМНЫЙ Я / Олимпик / Димитровград</a></h1>
  </div></div>
  <!-- Строки СПИСКА диалогов помечены тем же классом, что и строки ленты, —
       и именно на этом споткнулась предыдущая версия probe. -->
  <div class="ConvoList__item VirtualScrollItem" data-itemkey="convo_335368817">
    <div class="ConvoListItem__name">Мама Пети</div>
  </div>
  <div class="ConvoList__item VirtualScrollItem" data-itemkey="convo_448075672">
    <div class="ConvoListItem__name">Анна Иванова</div>
  </div>
</section>
<header class="ConvoHeader">
  <button class="ConvoHeader__action ConvoHeader__back" aria-label="Закрыть"></button>
  <!-- У кого задано короткое имя, ВК ставит в шапку именно его, а не /id<N>. -->
  <a class="ConvoHeader__info" href="/mamapeti">Мама Пети<span>online</span></a>
</header>
<div class="ConvoHistory">
  <div class="ConvoHistory__flow" role="list" aria-label="Сообщения" tabindex="-1">
    ${placeholder(22)}
    ${placeholder(23)}
    <div class="ConvoHistory__dateStack">
      <div class="StickyDateSeparator" role="presentation">
        <span class="DateSeparator DateSeparator--visible" role="heading" aria-level="3"
              aria-label="21 августа 2026">21 августа 2026</span>
      </div>
      ${message({ key: 30, dir: "in", authorPeer: "335368817", text: "Здравствуйте! Завтра занятие будет?", time: "16:04" })}
      ${message({ key: 31, dir: "out", authorPeer: "-137130907", text: "Да, ждём вас в 17:00", time: "16:07" })}
      <!-- Продолжение серии у СВОИХ: аватара нет, но галочки остаются — этого
           уже достаточно, наследование не понадобится. -->
      ${message({ key: 32, dir: "out", authorPeer: null, text: "Кабинет 3", time: "16:08" })}
      <!-- Продолжение серии у ЧУЖИХ: ни аватара, ни галочек. Единственный
           случай, когда направление приходится наследовать от строки выше. -->
      ${message({ key: 33, dir: "in", authorPeer: null, text: "Спасибо!", time: "16:09" })}
      <!-- НАШЕ сообщение, на которое родитель поставил реакцию. Мина живой
           разметки: у «сердечка» класс ReactionChip--incoming, и наивный признак
           объявил бы нашу же реплику словами клиента. -->
      ${message({ key: 34, dir: "out", authorPeer: "-137130907", text: "Ждём вас!", time: "16:10", reaction: true })}
    </div>
  </div>
</div>
</div></div>
<div class="ConvoComposer">
  <span class="ComposerInput__input ConvoComposer__input ComposerInput__input--fixed"
        contenteditable="true" data-placeholder="Сообщение" inputmode="text" translate="no"
        role="textbox" aria-multiline="true" aria-label="Сообщение" aria-disabled="false"></span>
  <textarea tabindex="-1" style="width: 145px; height: 30px;"></textarea>
</div>
</body></html>`

const server = http.createServer((req, res) => {
  const [rawUrl] = decodeURI(req.url).split("?")
  const file = path.join(EXTENSION_ROOT, rawUrl)
  if ((rawUrl.startsWith("/src/") || rawUrl.startsWith("/tools/")) && fs.existsSync(file)) {
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "text/plain" })
    res.end(fs.readFileSync(file))
    return
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(PAGE())
})
await new Promise((resolve) => server.listen(0, resolve))
const origin = `http://localhost:${server.address().port}`

const browser = await chromium.launch({ executablePath: CHROMIUM })
const page = await browser.newPage()
const consoleErrors = []
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text())
})
page.on("pageerror", (e) => consoleErrors.push(String(e)))

const problems = []
let checks = 0
/** @param {string} name @param {boolean} ok @param {unknown} [details] */
function check(name, ok, details) {
  checks++
  if (!ok) problems.push({ name, details })
  console.log(`${ok ? "✔" : "✖"} ${name}`, ok ? "" : JSON.stringify(details, null, 2) ?? "")
}

// Живой адрес из отчёта прогона — путь тот же до сегмента.
await page.goto(`${origin}/gim137130907/convo/335368817?entrypoint=list_all`)
await page.addScriptTag({ url: `${origin}/tools/vk-probe.js` })
await page.waitForFunction(() => Boolean(window.crmkaVkProbe?.last), null, { timeout: 5000 })

const report = await page.evaluate(() => window.crmkaVkProbe.last)

check("probe поднялся без ошибок в консоли", consoleErrors.length === 0, consoleErrors)

// ── Адрес: главное, ради чего probe и переписывался ─────────────────────────
check("ключ чата — собеседник из /convo/, а не сообщество", report.адрес.ключЧата === "335368817", report.адрес)
check("источник id назван честно", report.адрес.источникId === "путь /convo/<id>", report.адрес.источникId)
check("сообщество из пути прочитано отдельно", report.адрес.сообществоВПути === "137130907", report.адрес)
check("вид диалога — человек", report.адрес.вид === "человек", report.адрес.вид)

// ── Кем ВК называет собеседника ─────────────────────────────────────────────
// Живой прогон показал: в шапке стоит короткое имя страницы, а не «/id<N>».
// Значит адаптеру нужно ОБА идентификатора — число как ключ и имя как алиас,
// иначе ссылка из карточки клиента с ключом диалога никогда не сойдётся.
check(
  "короткое имя собеседника прочитано из шапки",
  report.ссылкиНаПрофили.короткоеИмяСобеседника === "mamapeti",
  report.ссылкиНаПрофили,
)

// ── Лента: не попасться на выпадашки действий ───────────────────────────────
check(
  "селектор сообщений не цепляет ConvoMessage__actions",
  !String(report.сообщения.селектор ?? "").includes("Message__"),
  report.сообщения.селектор,
)
check("сообщения найдены", (report.сообщения.найдено ?? 0) >= 2, report.сообщения.найдено)
check(
  "у строки виден кандидат в идентификатор (data-itemkey)",
  report.сообщения.строки?.some((r) => Object.keys(r.идентификаторы ?? {}).length > 0),
  report.сообщения.строки?.[0]?.идентификаторы,
)
// Ложный признак направления опаснее отсутствующего: по нему пишется правило
// адаптера. У ВК половина классов — «…--withoutBubbles», и наивная проверка
// «содержит out» объявляла признаком слово «withOUT».
check(
  "слово «withoutBubbles» НЕ считается признаком направления",
  report.сообщения.строки?.every((r) =>
    [...(r.признакиНаправления?.классыСOut ?? []), ...(r.признакиНаправления?.вложенныеСOut ?? [])].every(
      (c) => !/withoutBubbles/i.test(c),
    ),
  ),
  report.сообщения.строки?.map((r) => r.признакиНаправления),
)
check(
  "автор строки виден — по нему и различается направление",
  report.сообщения.строки?.some((r) => r.признакиНаправления?.автор?.ссылка),
  report.сообщения.строки?.map((r) => r.признакиНаправления?.автор),
)
// Маска аватара несёт peer id автора — единственный машинный признак стороны:
// у сообщества он отрицательный, у человека положительный.
check(
  "peer id автора доступен из маски аватара",
  JSON.stringify(report.сообщения.строки?.map((r) => r.дерево)).includes("Mask-137130907"),
  null,
)
check(
  "часы строки попали в отчёт",
  JSON.stringify(report.сообщения.строки?.map((r) => r.дерево)).includes("16:07"),
  null,
)
check(
  "дерево строки доходит до текста и времени",
  JSON.stringify(report.сообщения.строки?.map((r) => r.дерево)).includes("ждём вас в 17:00"),
  null,
)

// ── Хвост ленты: смотреть надо снизу, лента виртуализируется ────────────────
const tailText = JSON.stringify(report.хвостЛенты ?? {})
// Контейнером ленты не должен оказаться весь экран приложения: строки СПИСКА
// диалогов помечены тем же `VirtualScrollItem`, и общий предок находок уезжал
// в `MEApp__route` — вместе с ним в «ленту» попадал поиск, вкладки и чужие
// диалоги.
check("контейнер ленты найден", report.лентаКонтейнер?.classes?.includes("ConvoHistory__flow"), report.лентаКонтейнер)
check(
  "строки списка диалогов не приняты за сообщения",
  !report.сообщения.строки?.some((r) => (r.classes ?? []).includes("ConvoList__item")),
  report.сообщения.селектор,
)
check("в хвосте ленты видно ОТРИСОВАННОЕ сообщение, а не заглушка", tailText.includes("ждём вас в 17:00"), {
  всегоУзловЛенты: report.хвостЛенты?.всегоУзловЛенты,
})
check("дата с годом доступна из разделителя", tailText.includes("21 августа 2026"), null)

// ── Поле ввода ──────────────────────────────────────────────────────────────
check(
  "поле ввода найдено (ComposerInput)",
  report.полеВвода?.some((c) => (c.classes ?? []).includes("ComposerInput__input")),
  report.полеВвода,
)

const inserted = await page.evaluate(() => window.crmkaVkProbe.tryInsert("exec"))
check("вставка текста работает и ничего не отправляет", inserted.вставилось === true, inserted)

// ── Направления: главное, что проверяется на живом чужом сообщении ──────────
const dirs = await page.evaluate(() => window.crmkaVkProbe.directions())
check(
  "входящее опознано по положительному peer id автора",
  dirs.строки?.some((r) => r.поПризнакам === "incoming" && r.peerIdАвтора === "335368817"),
  dirs.строки,
)
check(
  "исходящее опознано по отрицательному peer id (сообщество)",
  dirs.строки?.some((r) => r.поПризнакам === "outgoing" && r.peerIdАвтора === "-137130907"),
  dirs.строки,
)
// Своё продолжение серии узнаётся по галочкам — наследование там не нужно.
check(
  "своё продолжение серии опознано по галочкам, без аватара",
  dirs.строки?.some((r) => r.текст === "Кабинет 3" && r.поПризнакам === "outgoing" && !r.peerIdАвтора),
  dirs.строки,
)
// А вот чужое продолжение серии не даёт ни одного собственного признака —
// единственный случай, когда направление берётся у строки выше.
check(
  "чужое продолжение серии честно помечено как наследуемое",
  dirs.строки?.some((r) => r.текст === "Спасибо!" && r.поПризнакам === "наследуется от строки выше"),
  dirs.строки,
)
// Реакция родителя на НАШЕ сообщение не должна перевернуть направление: у
// «сердечка» класс ReactionChip--incoming, и наивный признак объявил бы реплику
// администратора словами клиента.
check(
  "реакция родителя не переворачивает направление нашего сообщения",
  dirs.строки?.some((r) => r.текст === "Ждём вас!" && r.поПризнакам === "outgoing"),
  dirs.строки?.filter((r) => r.текст === "Ждём вас!"),
)
check(
  "класс реакции не попал в признаки направления",
  report.сообщения.строки?.every((r) =>
    [...(r.признакиНаправления?.классыСOut ?? []), ...(r.признакиНаправления?.вложенныеСOut ?? [])].every(
      (c) => !/Reaction/i.test(c),
    ),
  ),
  report.сообщения.строки?.map((r) => r.признакиНаправления?.вложенныеСOut),
)
check(
  "срез компактный: текст и часы есть, деревьев нет",
  dirs.строки?.every((r) => !("дерево" in r)) && dirs.строки?.some((r) => r.часы),
  dirs.строки?.[0],
)

// ── keyCheck: не падает и честно сообщает, что сравнивать нечего ────────────
// Двойник историю не догружает и не виртуализируется по-настоящему, поэтому
// проверяем не вердикт, а что команда отрабатывает и возвращает понятный ответ.
const keys = await page.evaluate(() => window.crmkaVkProbe.keyCheck())
check("keyCheck отрабатывает и возвращает вердикт", typeof keys?.вердикт === "string" || keys?.ok === false, keys)

// ── Список диалогов: диалог не выбран ───────────────────────────────────────
await page.goto(`${origin}/gim137130907`)
await page.addScriptTag({ url: `${origin}/tools/vk-probe.js` })
const listReport = await page.evaluate(() => window.crmkaVkProbe.last)
check("без /convo/ probe честно говорит «диалог не выбран»", listReport.адрес.ключЧата === null, listReport.адрес)

await browser.close()
server.close()

console.log(`\nПроверок: ${checks}, проблем: ${problems.length}`)
if (problems.length > 0) process.exit(1)
