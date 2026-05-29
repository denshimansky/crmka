"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Trash2, AlertTriangle, ShieldAlert, Skull } from "lucide-react"

type Step = null | 1 | 2 | 3

export function WipeDatabaseButton({
  orgName,
  expiresAt,
}: {
  orgName: string
  expiresAt: string // ISO-строка, когда окно для удаления истечёт
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>(null)
  const [agree1, setAgree1] = useState(false)
  const [agree2, setAgree2] = useState(false)
  const [confirmation, setConfirmation] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)

  function reset() {
    setStep(null); setAgree1(false); setAgree2(false); setConfirmation("")
    setError(null); setDone(null)
  }

  async function performWipe() {
    setLoading(true); setError(null)
    try {
      const res = await fetch("/api/leads-import/wipe-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? `Ошибка ${res.status}`)
        return
      }
      setDone(data.deletedClients ?? 0)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const expires = new Date(expiresAt)
  const expiresStr = expires.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  })

  return (
    <>
      <Button
        variant="destructive"
        onClick={() => { reset(); setStep(1) }}
      >
        <Trash2 className="size-4" />
        Очистить всю базу
      </Button>

      {/* ============ ШАГ 1: первое предупреждение ============ */}
      <Dialog open={step === 1} onOpenChange={(v) => { if (!v) reset() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              Внимание. Опасная операция (1/3)
            </DialogTitle>
            <DialogDescription className="pt-2 space-y-2 text-foreground">
              <p>
                Вы собираетесь <b>безвозвратно удалить</b> всю клиентскую базу организации
                «{orgName}».
              </p>
              <p>
                Эта операция нужна, только если импорт прошёл с ошибкой и нужно
                перезаписать данные с нуля. Окно доступа закроется {expiresStr}.
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={reset}>Отмена</Button>
            <Button variant="destructive" onClick={() => setStep(2)}>
              Я понимаю, продолжить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ ШАГ 2: детали + два чекбокса ============ */}
      <Dialog open={step === 2} onOpenChange={(v) => { if (!v) reset() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="size-5" />
              Что именно будет удалено (2/3)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1">
              <div className="font-medium text-destructive">Будет удалено:</div>
              <ul className="list-disc pl-5 text-foreground">
                <li>Все клиенты и их подопечные (Ward)</li>
                <li>Все абонементы, оплаты, скидки, балансы и история транзакций</li>
                <li>Все посещения (Attendance) и пробные занятия</li>
                <li>Зачисления в группы, заявки, кампании обзвона, коммуникации</li>
                <li>Клиентские задачи и токены клиентского портала</li>
              </ul>
            </div>
            <div className="rounded-md border bg-muted/30 p-3 space-y-1">
              <div className="font-medium">Останется без изменений:</div>
              <ul className="list-disc pl-5 text-foreground">
                <li>Организация, филиалы, кабинеты, сотрудники, права ролей</li>
                <li>Направления, группы расписания, шаблоны</li>
                <li>Финансовые счета, расходы, категории, ЗП, операции</li>
                <li>Справочники (каналы, причины, шаблоны скидок)</li>
              </ul>
            </div>
            <div className="space-y-2 pt-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox checked={agree1} onCheckedChange={(v) => setAgree1(v === true)} />
                <span className="text-sm">
                  Я понимаю, что отменить эту операцию <b>нельзя</b> — резервной копии не создаётся.
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox checked={agree2} onCheckedChange={(v) => setAgree2(v === true)} />
                <span className="text-sm">
                  Я провёл сверку и точно знаю, что текущие клиентские данные ошибочные.
                </span>
              </label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={reset}>Отмена</Button>
            <Button
              variant="destructive"
              disabled={!agree1 || !agree2}
              onClick={() => setStep(3)}
            >
              Перейти к последнему шагу
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ ШАГ 3: точное подтверждение названия ============ */}
      <Dialog open={step === 3} onOpenChange={(v) => { if (!v) reset() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Skull className="size-5" />
              Финальное подтверждение (3/3)
            </DialogTitle>
            <DialogDescription className="pt-2 text-foreground space-y-2">
              <p>
                Введите точное название организации, чтобы подтвердить удаление:
              </p>
              <p className="font-mono rounded bg-muted px-2 py-1 select-all">{orgName}</p>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Название организации</Label>
              <Input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder={orgName}
                autoFocus
              />
            </div>
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            {done !== null && (
              <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm">
                Удалено клиентов: {done}. Страница обновится.
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={reset} disabled={loading}>
              {done !== null ? "Закрыть" : "Отмена"}
            </Button>
            <Button
              variant="destructive"
              disabled={loading || confirmation.trim() !== orgName.trim() || done !== null}
              onClick={performWipe}
            >
              {loading ? "Удаление…" : "УДАЛИТЬ ВСЁ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
