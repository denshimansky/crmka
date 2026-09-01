import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { BackButton } from "@/components/back-button"
import { PageHelp } from "@/components/page-help"

/**
 * «Настройки → Расширение → Как установить» (docs/messenger-extension.md §7).
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ СТРАНИЦА. Справка CRM уже обещает сотруднику ссылку на
 * установку («Установите расширение в браузер по ссылке, которую даёт CRMka» —
 * page-help-content.ts), а ссылки не было. Это один из шести блокеров раздачи
 * расширения партнёрам.
 *
 * ПОЧЕМУ ЗДЕСЬ ДВА СЦЕНАРИЯ. Пока расширение не опубликовано в Chrome Web Store,
 * поставить его можно только распакованной папкой — и делать вид, что это
 * «временная мелочь», нельзя: человеку нужно знать, что он делает и почему у
 * него включается режим разработчика. Когда публикация состоится, достаточно
 * заполнить STORE_URL, и страница сама переключится на сценарий в одну кнопку,
 * а инструкция для разработчика уедет под спойлер.
 *
 * Прав отдельных не заводим: /settings/* уже требует settings.view.
 */

/**
 * Ссылка на расширение в Chrome Web Store.
 *
 * ЗАПОЛНИТЬ ПОСЛЕ ПУБЛИКАЦИИ (режим unlisted — расширения не будет ни в
 * каталоге, ни в поиске, только по прямой ссылке). Пустая строка означает
 * «ещё не опубликовано», и страница показывает сценарий с распакованной папкой.
 */
const STORE_URL = ""

/** Где сотрудник берёт архив, пока публикации нет. Собирается `tools/pack.mjs`. */
const ZIP_HINT = "crmka-extension-<версия>.zip"

export default function ExtensionInstallPage() {
  const published = STORE_URL.length > 0

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BackButton
          fallbackHref="/settings/extension"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </BackButton>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Как установить расширение</h1>
            <PageHelp pageKey="settings/extension/install" />
          </div>
          <p className="text-sm text-muted-foreground">
            Панель CRM рядом с чатом в веб-мессенджере
          </p>
        </div>
      </div>

      <section className="rounded-lg border p-4 text-sm leading-relaxed space-y-2">
        <h2 className="font-semibold">Что это</h2>
        <p>
          Расширение показывает карточку клиента рядом с открытым чатом в веб-версии
          мессенджера: дети, занятия, абонементы, баланс и переписка по всем каналам. Оттуда
          же можно поставить задачу, оставить комментарий и вставить справку в поле ввода.
        </p>
        <p className="text-muted-foreground">
          Работает в Google Chrome, Яндекс Браузере и Microsoft Edge на компьютере. Мобильные
          версии и настольные приложения мессенджеров не поддерживаются.
        </p>
      </section>

      {published ? (
        <Step num="1" title="Установить расширение">
          <p>
            Откройте страницу расширения и нажмите «Установить»:{" "}
            <a href={STORE_URL} target="_blank" rel="noreferrer" className="underline">
              {STORE_URL}
            </a>
          </p>
          <p className="text-muted-foreground">
            Расширения нет в каталоге магазина — оно ставится только по этой ссылке.
          </p>
        </Step>
      ) : (
        <Step num="1" title="Установить расширение (пока вручную)">
          <p>
            Расширение ещё не опубликовано в магазине, поэтому ставится папкой. Это
            безопасно, но браузер попросит включить режим разработчика — так он поступает с
            любым расширением не из магазина.
          </p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Получите у нас архив <code>{ZIP_HINT}</code> и распакуйте его в постоянную
              папку — например <code>C:\CRMka\extension</code>. Если папку потом удалить или
              переместить, расширение перестанет работать.</li>
            <li>Откройте в браузере адрес <code>chrome://extensions</code>.</li>
            <li>Включите переключатель «Режим разработчика» в правом верхнем углу.</li>
            <li>Нажмите «Загрузить распакованное расширение» и выберите распакованную папку.</li>
            <li>В панели браузера появится иконка со звёздочкой — закрепите её, нажав на
              значок пазла рядом с адресной строкой.</li>
          </ol>
          <p className="text-muted-foreground">
            После публикации в магазине установка станет установкой в одну кнопку, а
            обновления будут приходить сами.
          </p>
        </Step>
      )}

      <Step num="2" title="Выпустить токен доступа">
        <p>
          Токен — это ваш личный ключ: расширение работает от вашего имени и видит ровно то,
          что видите в CRM вы. Выпустить его можно на странице{" "}
          <Link href="/settings/extension" className="underline">
            Расширение для мессенджеров
          </Link>
          .
        </p>
        <p className="text-muted-foreground">
          Токен показывается один раз — скопируйте его сразу. Потерянный токен не
          восстанавливают, а выпускают заново; старый при этом стоит отозвать.
        </p>
      </Step>

      <Step num="3" title="Подключить расширение к CRM">
        <ol className="list-decimal pl-5 space-y-1">
          <li>Откройте веб-версию мессенджера и нажмите иконку расширения — справа
            откроется панель.</li>
          <li>При первом запуске панель покажет, какие данные она собирает. Прочитайте и
            нажмите «Понятно, продолжить».</li>
          <li>Вставьте адрес вашей CRM и токен, нажмите «Сохранить».</li>
        </ol>
      </Step>

      <Step num="4" title="Включить запись переписки — если центр этого хочет">
        <p>
          Отдельный переключатель «Записывать переписку в историю клиента». По умолчанию он
          <strong> выключен</strong>: сохранение переписки — это обработка персональных
          данных, и включать её нужно осознанно.
        </p>
        <p className="text-muted-foreground">
          Включайте, только если у центра есть согласие родителей на обработку переписки в
          мессенджерах. Что именно сохраняется и что не сохраняется никогда — в{" "}
          <a href="/extension/privacy" target="_blank" rel="noreferrer" className="underline">
            политике конфиденциальности расширения
          </a>
          .
        </p>
      </Step>

      <section className="rounded-lg border p-4 text-sm leading-relaxed space-y-2">
        <h2 className="font-semibold">Если панель не видит чат</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Вкладка была открыта до установки.</strong> Обновите её — панель сама
            предложит кнопку «Обновить вкладку».
          </li>
          <li>
            <strong>Открыт групповой чат.</strong> Панель работает только с личной
            перепиской: за групповым чатом стоит не один человек, и его переписку нельзя
            положить в карточку одного клиента.
          </li>
          <li>
            <strong>В чате ещё нет сообщений.</strong> В WhatsApp собеседник определяется по
            самим сообщениям — в пустом диалоге определить его неоткуда.
          </li>
          <li>
            <strong>Ничего из перечисленного.</strong> Откройте в панели шестерёнку: внизу
            есть строка диагностики — пришлите её нам, по ней видно, что именно видит
            расширение.
          </li>
        </ul>
      </section>
    </div>
  )
}

function Step({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-4">
      <h2 className="font-semibold mb-2">
        Шаг {num}. {title}
      </h2>
      <div className="text-sm leading-relaxed space-y-2">{children}</div>
    </section>
  )
}
