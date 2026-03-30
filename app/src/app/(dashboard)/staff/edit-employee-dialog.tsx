"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { Pencil } from "lucide-react"

const ROLES = [
  { value: "manager", label: "Управляющий" },
  { value: "admin", label: "Администратор" },
  { value: "instructor", label: "Инструктор" },
  { value: "readonly", label: "Только чтение" },
] as const

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

export function EditEmployeeDialog({ employee, branches }: { employee: Employee; branches: Branch[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
          role,
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
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {branches.length > 0 && (
              <div>
                <Label>Филиалы</Label>
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
              </div>
            )}

            <div>
              <Label>Новый пароль (оставьте пустым, чтобы не менять)</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Мин. 6 символов" autoComplete="new-password" />
            </div>
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
