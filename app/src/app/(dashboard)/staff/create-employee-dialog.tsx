"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select, SelectTrigger, SelectContent, SelectItem,
} from "@/components/ui/select"
import { Plus } from "lucide-react"

const ROLES = [
  { value: "manager", label: "Управляющий" },
  { value: "admin", label: "Администратор" },
  { value: "instructor", label: "Инструктор" },
  { value: "readonly", label: "Только чтение" },
] as const

const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
}

function transliterate(input: string): string {
  return input
    .toLowerCase()
    .split("")
    .map((ch) => CYR_TO_LAT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]/g, "")
}

function randomDigits(n: number): string {
  let s = ""
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10).toString()
  return s
}

interface Branch {
  id: string
  name: string
}

export interface CreatedEmployee {
  id: string
  firstName: string
  lastName: string
  middleName?: string | null
  role: string
  login: string
}

interface Props {
  branches: Branch[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSuccess?: (employee: CreatedEmployee) => void
  hideTrigger?: boolean
  defaultRole?: string
  refreshOnSuccess?: boolean
}

export function CreateEmployeeDialog({
  branches,
  open: openProp,
  onOpenChange,
  onSuccess,
  hideTrigger,
  defaultRole = "admin",
  refreshOnSuccess = true,
}: Props) {
  const router = useRouter()
  const [openInternal, setOpenInternal] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp! : openInternal
  const setOpen = (v: boolean) => {
    if (!isControlled) setOpenInternal(v)
    onOpenChange?.(v)
  }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [lastName, setLastName] = useState("")
  const [firstName, setFirstName] = useState("")
  const [middleName, setMiddleName] = useState("")
  const [login, setLogin] = useState("")
  const [password, setPassword] = useState("")
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [passwordSuffix, setPasswordSuffix] = useState(() => randomDigits(4))
  const [role, setRole] = useState<string>(defaultRole)
  const [selectedBranches, setSelectedBranches] = useState<string[]>([])
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [birthDate, setBirthDate] = useState("")

  useEffect(() => {
    if (passwordTouched) return
    const prefix = transliterate(lastName.trim())
    setPassword(prefix ? prefix + passwordSuffix : "")
  }, [lastName, passwordSuffix, passwordTouched])

  function resetForm() {
    setLastName("")
    setFirstName("")
    setMiddleName("")
    setLogin("")
    setPassword("")
    setPasswordTouched(false)
    setPasswordSuffix(randomDigits(4))
    setRole(defaultRole)
    setSelectedBranches([])
    setPhone("")
    setEmail("")
    setBirthDate("")
    setError(null)
  }

  function toggleBranch(branchId: string) {
    setSelectedBranches((prev) =>
      prev.includes(branchId)
        ? prev.filter((id) => id !== branchId)
        : [...prev, branchId]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!lastName.trim() || !firstName.trim()) {
      setError("Фамилия и имя обязательны")
      return
    }
    if (!login.trim()) {
      setError("Логин обязателен")
      return
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(login)) {
      setError("Логин может содержать только латинские буквы, цифры, точки, дефисы и подчёркивания")
      return
    }
    if (!password || password.length < 6) {
      setError("Пароль должен быть не менее 6 символов")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lastName: lastName.trim(),
          firstName: firstName.trim(),
          middleName: middleName.trim() || null,
          login: login.trim(),
          password,
          role,
          branchIds: selectedBranches,
          phone: phone.trim() || null,
          email: email.trim() || null,
          birthDate: birthDate || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при создании сотрудника")
        return
      }

      const employee = (await res.json()) as CreatedEmployee
      setOpen(false)
      resetForm()
      onSuccess?.(employee)
      if (refreshOnSuccess) router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) resetForm()
      }}
    >
      {!hideTrigger && (
        <DialogTrigger render={<Button size="sm" />}>
          <Plus className="size-4" />
          Сотрудник
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Новый сотрудник</DialogTitle>
            <DialogDescription>
              Заполните данные нового сотрудника. Логин должен быть на латинице.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* ФИО */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label htmlFor="lastName">Фамилия *</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Иванов"
                />
              </div>
              <div>
                <Label htmlFor="firstName">Имя *</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Иван"
                />
              </div>
              <div>
                <Label htmlFor="middleName">Отчество</Label>
                <Input
                  id="middleName"
                  value={middleName}
                  onChange={(e) => setMiddleName(e.target.value)}
                  placeholder="Иванович"
                />
              </div>
            </div>

            {/* Логин и пароль */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="login">Логин *</Label>
                <Input
                  id="login"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="ivanov"
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="password">Пароль *</Label>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setPasswordTouched(true)
                  }}
                  placeholder="Мин. 6 символов"
                  autoComplete="new-password"
                />
                {!passwordTouched && password && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Сгенерирован по фамилии — можно изменить
                  </p>
                )}
              </div>
            </div>

            {/* Роль */}
            <div>
              <Label>Роль</Label>
              <Select value={role} onValueChange={(v) => { if (v) setRole(v) }}>
                <SelectTrigger className="w-full">
                  {ROLES.find(r => r.value === role)?.label ?? <span className="text-muted-foreground">Выберите роль</span>}
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Филиалы */}
            {branches.length > 0 && (
              <div>
                <Label>Филиалы</Label>
                <div className="mt-1 space-y-2">
                  {branches.map((branch) => (
                    <label
                      key={branch.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={selectedBranches.includes(branch.id)}
                        onCheckedChange={() => toggleBranch(branch.id)}
                      />
                      {branch.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Контакты */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="phone">Телефон</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+7 (999) 123-45-67"
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@example.com"
                />
              </div>
            </div>

            {/* Дата рождения */}
            <div>
              <Label htmlFor="birthDate">Дата рождения</Label>
              <Input
                id="birthDate"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <DialogClose render={<Button variant="outline" type="button" />}>
              Отмена
            </DialogClose>
            <Button type="submit" disabled={loading}>
              {loading ? "Создание..." : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
