import { ArrowLeft, ArrowRight } from "lucide-react"
import Link from "next/link"
import { PageHelp } from "@/components/page-help"
import { BackButton } from "@/components/back-button"
import { ExtensionTokensContent } from "./extension-tokens-content"

/**
 * «Настройки → Расширение для мессенджеров»: выпуск персональных токенов для
 * браузерной панели (docs/messenger-extension.md).
 *
 * Страница СОЗНАТЕЛЬНО скрыта: плитки в /settings нет и пункта меню нет — роут
 * доступен по прямой ссылке, пока расширение не готово к раздаче партнёрам
 * (тот же приём, что у «Интеграций»: плитка с show: false). Когда расширение
 * выйдет — добавить плитку в settings/page.tsx одним коммитом.
 *
 * Прав отдельных не заводим: /settings/* уже требует settings.view
 * (lib/route-permissions.ts), а сам токен не даёт сотруднику ничего сверх того,
 * что у него и так есть — эффективные права считаются на каждый запрос
 * в requireExtAuth.
 */
export default function ExtensionSettingsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </BackButton>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Расширение для мессенджеров</h1>
            <PageHelp pageKey="settings/extension" />
          </div>
          <p className="text-sm text-muted-foreground">
            Токены доступа для панели CRM рядом с чатом
          </p>
        </div>
      </div>

      {/*
        Ссылка на инструкцию стоит ПЕРЕД списком токенов сознательно: человек
        приходит сюда за токеном, но токен бесполезен, пока расширение не
        установлено. Справка этой страницы обещает инструкцию — вот она.
      */}
      <Link
        href="/settings/extension/install"
        className="flex items-center justify-between rounded-lg border p-4 hover:bg-accent"
      >
        <div>
          <div className="font-medium">Как установить расширение</div>
          <div className="text-sm text-muted-foreground">
            Пошагово: установка в браузер, подключение к CRM, запись переписки
          </div>
        </div>
        <ArrowRight className="size-4 text-muted-foreground" />
      </Link>

      <ExtensionTokensContent />
    </div>
  )
}
