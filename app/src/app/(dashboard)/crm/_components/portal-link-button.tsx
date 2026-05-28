"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Link2, Copy, Check, RefreshCw, ExternalLink } from "lucide-react"

export function PortalLinkButton({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")

  async function loadCurrent() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/clients/${clientId}/portal-link`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Ошибка загрузки")
      } else {
        setLink(data.link)
      }
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoaded(true)
      setLoading(false)
    }
  }

  async function generate() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/clients/${clientId}/portal-link`, {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Не удалось сгенерировать ссылку")
      } else {
        setLink(data.link)
      }
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  function copy() {
    if (!link) return
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next && !loaded) loadCurrent()
    if (!next) setCopied(false)
  }

  return (
    <>
      <Button variant="outline" onClick={() => handleOpenChange(true)}>
        <Link2 className="mr-2 size-4" />
        Личный кабинет
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ссылка на личный кабинет</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Отправьте эту ссылку родителю — по ней он войдёт в личный кабинет без логина и пароля.
              Ссылка действует, пока вы не сгенерируете новую (старая после этого перестанет работать).
            </p>

            {loading && !link ? (
              <div className="text-sm text-muted-foreground">Загрузка…</div>
            ) : link ? (
              <div className="flex gap-2">
                <Input value={link} readOnly className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copy}
                  title="Копировать"
                >
                  {copied ? (
                    <Check className="size-4 text-green-600" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => window.open(link, "_blank", "noreferrer")}
                  title="Открыть"
                >
                  <ExternalLink className="size-4" />
                </Button>
              </div>
            ) : (
              loaded && (
                <p className="text-sm text-muted-foreground">
                  Ссылка ещё не сгенерирована.
                </p>
              )
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Закрыть
            </Button>
            <Button onClick={generate} disabled={loading}>
              <RefreshCw className="mr-2 size-4" />
              {link ? "Обновить ссылку" : "Сгенерировать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
