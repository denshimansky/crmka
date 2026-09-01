"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react"

interface ApiTokenRow {
  id: string
  name: string
  prefix: string
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
  isMine: boolean
  employeeName: string | null
}

function formatDateTime(value: string | null): string {
  if (!value) return "—"
  const d = new Date(value)
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function ExtensionTokensContent() {
  const [tokens, setTokens] = useState<ApiTokenRow[]>([])
  const [canManageOthers, setCanManageOthers] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)

  // Секрет живёт только в стейте и только до закрытия диалога: в БД лежит
  // sha256, показать повторно физически невозможно.
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/api-tokens")
      if (!res.ok) throw new Error("Не удалось загрузить токены")
      const data = await res.json()
      setTokens(data.tokens ?? [])
      setCanManageOthers(Boolean(data.canManageOthers))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCreate() {
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      const res = await fetch("/api/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Не удалось выпустить токен")
      setIssuedSecret(data.secret)
      setCreateOpen(false)
      setNewName("")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка выпуска токена")
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: string, name: string) {
    if (!confirm(`Отозвать токен «${name}»? Расширение с ним перестанет работать сразу.`)) return
    try {
      const res = await fetch("/api/api-tokens", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Не удалось отозвать токен")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка отзыва токена")
    }
  }

  async function copySecret() {
    if (!issuedSecret) return
    try {
      await navigator.clipboard.writeText(issuedSecret)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Буфер обмена недоступен (нет https / отказ пользователя) — секрет
      // всё равно виден на экране, скопируют вручную.
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" />
            Как это работает
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Расширение показывает карточку клиента рядом с чатом в веб-версии мессенджера:
            подопечные, ближайшее и прошедшее занятие, абонементы, баланс, платежи и переписку
            по всем каналам.
          </p>
          <p>
            Чтобы связать браузер с CRM, выпустите токен и вставьте его в расширение. Права и
            филиалы у панели ровно те же, что у сотрудника, выпустившего токен: лишнего она не
            покажет.
          </p>
          <p>
            Токен — это рабочее место. Дайте ему название компьютера, за которым будут работать
            («ПК Филиал 1», «Ноутбук администратора»): именно оно подписывает сообщения и
            заметки в карточке клиента. Так потом видно, с какого места вели общение, — а на
            один компьютер можно посадить и разные смены.
          </p>
          <p>
            Если браузер потерян или сотрудник уволен — отзовите токен, доступ пропадёт сразу.
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {canManageOthers ? "Токены сотрудников организации" : "Ваши токены"}: {tokens.length}
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 size-4" />
          Выпустить токен
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : tokens.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Токенов пока нет. Выпустите первый — он понадобится при подключении расширения.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tokens.map((token) => (
            <Card key={token.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{token.name}</span>
                    {!token.isMine && token.employeeName && (
                      <Badge variant="secondary">{token.employeeName}</Badge>
                    )}
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">{token.prefix}…</p>
                  <p className="text-xs text-muted-foreground">
                    Создан: {formatDateTime(token.createdAt)} · Последнее использование:{" "}
                    {formatDateTime(token.lastUsedAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleRevoke(token.id, token.name)}
                >
                  <Trash2 className="mr-2 size-4" />
                  Отозвать
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Выпустить токен</DialogTitle>
            <DialogDescription>
              Назовите рабочее место — этим названием подписываются сообщения и заметки,
              отправленные из панели.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="token-name">Название рабочего места</Label>
            <Input
              id="token-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Например: ПК Филиал 1"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              В карточке клиента будет видно: «ВКонтакте (исходящее) ·{" "}
              {newName.trim() || "ПК Филиал 1"}».
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating ? "Выпускаем…" : "Выпустить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(issuedSecret)} onOpenChange={(open) => !open && setIssuedSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Токен выпущен</DialogTitle>
            <DialogDescription>
              Скопируйте его сейчас — показать повторно нельзя. Если потеряете, выпустите новый.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2">
            {/* min-w-0 обязателен: без него flex-элемент не сжимается уже своего
                содержимого, и длинный токен растягивал диалог за края экрана.
                break-all переносит строку — токен виден целиком, без прокрутки. */}
            <code className="min-w-0 flex-1 break-all rounded bg-muted px-3 py-2 font-mono text-xs">
              {issuedSecret}
            </code>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={copySecret}
              title="Скопировать"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Токен — как пароль: не передавайте его другим и не сохраняйте в общих документах.
          </p>
          <DialogFooter>
            <Button onClick={() => setIssuedSecret(null)}>Готово</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
