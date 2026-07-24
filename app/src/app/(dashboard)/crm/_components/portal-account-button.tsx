"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { KeyRound, Copy, Check, RefreshCw, Ban, AlertTriangle } from "lucide-react"

// Выдача родителю доступа в ЛК (/p/<slug>): логин = телефон из карточки,
// пароль генерируется и показывается ОДИН раз. Заменяет старую магическую ссылку.

type AccountInfo = {
  loginPhone: string
  isActive: boolean
  passwordIssuedAt: string
  lastLoginAt: string | null
}

type Checks = {
  phoneMissing: boolean
  phoneInvalid: boolean
  phoneDuplicate: boolean
  docsMissing: boolean
}

type IssueResult = {
  loginPhone: string
  password: string
  portalUrl: string
  message: string
}

export function PortalAccountButton({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [checks, setChecks] = useState<Checks | null>(null)
  const [portalUrl, setPortalUrl] = useState<string | null>(null)
  const [result, setResult] = useState<IssueResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")

  async function loadStatus() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/clients/${clientId}/portal-account`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Ошибка загрузки")
      } else {
        setAccount(data.account)
        setChecks(data.checks)
        setPortalUrl(data.portalUrl)
      }
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  async function issue(reissue: boolean) {
    if (
      reissue &&
      !window.confirm(
        "Перевыпустить пароль? Старый пароль перестанет работать, родитель будет разлогинен на всех устройствах."
      )
    ) {
      return
    }
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/clients/${clientId}/portal-account`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Не удалось выдать доступ")
      } else {
        setResult(data)
      }
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  async function deactivate() {
    if (!window.confirm("Отключить доступ родителя в личный кабинет? Все его сессии закроются.")) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/clients/${clientId}/portal-account`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Не удалось отключить доступ")
      } else {
        await loadStatus()
      }
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  function copyMessage() {
    if (!result) return
    navigator.clipboard.writeText(result.message)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setResult(null)
      setCopied(false)
      loadStatus()
    }
  }

  const blockers: { text: string; href?: string; hrefLabel?: string }[] = []
  if (checks?.phoneMissing || checks?.phoneInvalid) {
    blockers.push({
      text: checks.phoneMissing
        ? "У клиента не указан телефон — он нужен как логин."
        : "Телефон клиента не похож на российский номер — логином может быть только телефон формата +7…",
    })
  }
  if (checks?.phoneDuplicate) {
    blockers.push({
      text: "Этот телефон встречается ещё у одного клиента. Сначала разберитесь с дублями.",
      href: "/crm/duplicates",
      hrefLabel: "Открыть дубли",
    })
  }
  if (checks?.docsMissing) {
    blockers.push({
      text: "Не заполнены ссылки на обязательные документы (оферта, политика, согласия на ПДн).",
      href: "/settings/organization",
      hrefLabel: "Открыть настройки",
    })
  }

  const canIssue = !loading && checks !== null && blockers.length === 0

  return (
    <>
      <Button variant="outline" onClick={() => handleOpenChange(true)}>
        <KeyRound className="mr-2 size-4" />
        Личный кабинет
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Доступ в личный кабинет</DialogTitle>
          </DialogHeader>

          {result ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Передайте родителю логин и пароль. Вход — по ссылке кабинета вашего центра.
              </p>
              <div className="rounded-md border p-3 space-y-1 text-sm">
                <div className="break-words">
                  Кабинет:{" "}
                  <a
                    href={result.portalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline break-all"
                  >
                    {result.portalUrl}
                  </a>
                </div>
                <div>
                  Логин: <span className="font-mono font-medium">{result.loginPhone}</span>
                </div>
                <div>
                  Пароль: <span className="font-mono text-lg font-semibold">{result.password}</span>
                </div>
              </div>
              <p className="flex items-start gap-2 text-sm text-amber-600">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                Пароль показывается один раз — скопируйте сообщение сейчас. Если пароль потеряется,
                его можно перевыпустить.
              </p>
              <Button onClick={copyMessage} className="w-full">
                {copied ? <Check className="mr-2 size-4 text-green-600" /> : <Copy className="mr-2 size-4" />}
                {copied ? "Скопировано" : "Копировать сообщение целиком"}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {loading && checks === null ? (
                <div className="text-sm text-muted-foreground">Загрузка…</div>
              ) : (
                <>
                  {account ? (
                    <div className="rounded-md border p-3 space-y-1 text-sm">
                      <div>
                        Логин: <span className="font-mono font-medium">{account.loginPhone}</span>{" "}
                        <span className="text-muted-foreground">(телефон на момент выдачи)</span>
                      </div>
                      <div>
                        Статус:{" "}
                        {account.isActive ? (
                          <span className="text-green-600">доступ включён</span>
                        ) : (
                          <span className="text-destructive">доступ отключён</span>
                        )}
                      </div>
                      <div className="text-muted-foreground">
                        Пароль выдан {new Date(account.passwordIssuedAt).toLocaleDateString("ru-RU")}
                        {" · "}
                        {account.lastLoginAt
                          ? `последний вход ${new Date(account.lastLoginAt).toLocaleDateString("ru-RU")}`
                          : "ещё не входил"}
                      </div>
                      {portalUrl && (
                        <div className="break-words">
                          Кабинет:{" "}
                          <a
                            href={portalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline break-all"
                          >
                            {portalUrl}
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    checks !== null && (
                      <p className="text-sm text-muted-foreground">
                        Родитель входит в кабинет по логину (его телефон) и паролю. Пароль
                        генерируется автоматически и показывается один раз.
                      </p>
                    )
                  )}

                  {blockers.map((b, i) => (
                    <p key={i} className="flex items-start gap-2 text-sm text-amber-600">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <span>
                        {b.text}{" "}
                        {b.href && (
                          <Link href={b.href} className="underline" onClick={() => setOpen(false)}>
                            {b.hrefLabel}
                          </Link>
                        )}
                      </span>
                    </p>
                  ))}
                </>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}

          <DialogFooter className="sm:flex-wrap">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Закрыть
            </Button>
            {!result && account?.isActive && (
              <Button variant="outline" onClick={deactivate} disabled={loading}>
                <Ban className="mr-2 size-4" />
                Отключить
              </Button>
            )}
            {!result && checks !== null && (
              <Button onClick={() => issue(Boolean(account))} disabled={!canIssue}>
                <RefreshCw className="mr-2 size-4" />
                {account
                  ? account.isActive
                    ? "Перевыпустить пароль"
                    : "Включить и перевыпустить пароль"
                  : "Выдать доступ"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
