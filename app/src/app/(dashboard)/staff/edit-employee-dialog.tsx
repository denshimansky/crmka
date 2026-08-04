"use client"

import { useState } from "react"
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
import { Pencil, Archive, ArchiveRestore } from "lucide-react"
import { useRoleNames } from "@/components/role-names-provider"

const ASSIGNABLE_ROLES = ["manager", "admin", "instructor", "readonly"] as const

interface Branch {
  id: string
  name: string
}

interface Employee {
  id: string
  firstName: string
  lastName: string
  middleName: string | null
  login: string
  email: string | null
  phone: string | null
  birthDate: string | null
  role: string
  isActive: boolean
  employeeBranches: { branch: Branch }[]
}

// Архив = isActive:false. Сотрудник уходит вниз списка и не может войти
// в аккаунт, пока владелец/управляющий не разархивирует его.

export function EditEmployeeDialog({
  employee,
  branches,
}: {
  employee: Employee
  branches: Branch[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const roleNames = useRoleNames()
  const roleOptions = ASSIGNABLE_ROLES.map((value) => ({ value, label: roleNames[value] }))

  const [lastName, setLastName] = useState(employee.lastName)
  const [firstName, setFirstName] = useState(employee.firstName)
  const [middleName, setMiddleName] = useState(employee.middleName || "")
  const [email, setEmail] = useState(employee.email || "")
  const [phone, setPhone] = useState(employee.phone || "")
  const [birthDate, setBirthDate] = useState(employee.birthDate?.slice(0, 10) || "")
  const [role, setRole] = useState(employee.role)
  const [password, setPassword] = useState("")
  const [selectedBranches, setSelectedBranches] = useState<string[]>(
    employee.employeeBranches.map((eb) => eb.branch.id)
  )

  function toggleBranch(branchId: string) {
    setSelectedBranches((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!lastName.trim() || !firstName.trim()) {
      setError("Фамилия и имя обязательны")
      return
    }

    // ADM-04: хотя бы один филиал нужен только администратору (ограничивает
    // видимость данных). Инструктор и так видит только свои занятия.
    if (role === "admin" && selectedBranches.length === 0) {
      setError(`Для роли «${roleNames.admin}» нужно выбрать хотя бы один филиал`)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lastName: lastName.trim(),
          firstName: firstName.trim(),
          middleName: middleName.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          birthDate: birthDate || null,
          // Роль владельца не редактируется и не должна попадать в запрос:
          // API принимает только manager/admin/instructor/readonly.
          role: employee.role === "owner" ? undefined : role,
          password: password || undefined,
          branchIds: selectedBranches,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при сохранении")
        return
      }

      setOpen(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  async function handleArchive(archived: boolean) {
    setError(null)
    setArchiving(true)
    try {
      const res = await fetch(`/api/employees/${employee.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось изменить статус")
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setArchiving(false)
    }
  }

  const isOwner = employee.role === "owner"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon" />}>
        <Pencil className="size-4" />
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Редактирование: {employee.lastName} {employee.firstName}</DialogTitle>
            <DialogDescription>Логин: {employee.login}</DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label>Фамилия *</Label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div>
                <Label>Имя *</Label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div>
                <Label>Отчество</Label>
                <Input value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Телефон</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 (999) 123-45-67" />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Дата рождения</Label>
              <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </div>

            {!isOwner && (
              <div>
                <Label>Роль</Label>
                <Select value={role} onValueChange={(v) => { if (v) setRole(v) }}>
                  <SelectTrigger className="w-full">{roleOptions.find(r => r.value === role)?.label ?? <span className="text-muted-foreground">Выберите роль</span>}</SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {branches.length > 0 && (
              <div>
                <Label>
                  Филиалы{role === "admin" ? " *" : ""}
                </Label>
                <div className="mt-1 space-y-2">
                  {branches.map((branch) => (
                    <label key={branch.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedBranches.includes(branch.id)}
                        onCheckedChange={() => toggleBranch(branch.id)}
                      />
                      {branch.name}
                    </label>
                  ))}
                </div>
                {role === "admin" && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Для роли «{roleNames.admin}» — обязательно хотя бы один филиал
                    (ограничивает видимость данных в CRM).
                  </p>
                )}
                {role === "instructor" && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Необязательно: роль «{roleNames.instructor}» видит только свои занятия.
                  </p>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Оклад и сдельные ставки настраиваются отдельной кнопкой «Ставки ЗП»
              (кошелёк) в списке сотрудников.
            </p>

            <div>
              <Label>Новый пароль (оставьте пустым, чтобы не менять)</Label>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Мин. 6 символов" autoComplete="new-password" />
            </div>

            {!isOwner && (
              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">Архив</legend>
                {employee.isActive ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Для уволенных сотрудников. Архивированный уходит вниз списка и не
                      может войти в аккаунт, пока его не разархивируют.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={archiving}
                      onClick={() => handleArchive(true)}
                    >
                      <Archive className="size-4" />
                      {archiving ? "Архивирование..." : "Архивировать"}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Сотрудник в архиве — вход в аккаунт заблокирован. Разархивируйте,
                      чтобы вернуть доступ.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={archiving}
                      onClick={() => handleArchive(false)}
                    >
                      <ArchiveRestore className="size-4" />
                      {archiving ? "Возврат..." : "Разархивировать"}
                    </Button>
                  </>
                )}
              </fieldset>
            )}
          </div>

          <DialogFooter className="mt-4">
            <DialogClose render={<Button variant="outline" type="button" />}>Отмена</DialogClose>
            <Button type="submit" disabled={loading}>{loading ? "Сохранение..." : "Сохранить"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
