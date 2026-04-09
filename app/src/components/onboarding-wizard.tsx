"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Building2, MapPin, BookOpen, UserCog, Users, PartyPopper,
  ChevronLeft, ChevronRight, SkipForward, Loader2, Check,
} from "lucide-react"

interface OnboardingWizardProps {
  orgName: string
  orgInn: string | null
}

const STEPS = [
  { title: "Добро пожаловать", icon: Building2 },
  { title: "Филиалы", icon: MapPin },
  { title: "Направления", icon: BookOpen },
  { title: "Сотрудники", icon: UserCog },
  { title: "Группы", icon: Users },
  { title: "Готово!", icon: PartyPopper },
]

export function OnboardingWizard({ orgName, orgInn }: OnboardingWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Step 1: Organization
  const [name, setName] = useState(orgName)
  const [inn, setInn] = useState(orgInn || "")

  // Step 2: Branch
  const [branchName, setBranchName] = useState("")
  const [roomName, setRoomName] = useState("Кабинет 1")
  const [branchCreated, setBranchCreated] = useState(false)
  const [createdBranchId, setCreatedBranchId] = useState("")

  // Step 3: Direction
  const [directionName, setDirectionName] = useState("")
  const [lessonPrice, setLessonPrice] = useState("")
  const [directionCreated, setDirectionCreated] = useState(false)
  const [createdDirectionId, setCreatedDirectionId] = useState("")

  // Step 4: Employee
  const [empFirstName, setEmpFirstName] = useState("")
  const [empLastName, setEmpLastName] = useState("")
  const [empLogin, setEmpLogin] = useState("")
  const [empPassword, setEmpPassword] = useState("")
  const [employeeCreated, setEmployeeCreated] = useState(false)
  const [createdEmployeeId, setCreatedEmployeeId] = useState("")

  // Step 5: Group
  const [groupName, setGroupName] = useState("")
  const [groupCreated, setGroupCreated] = useState(false)

  const [error, setError] = useState("")

  async function saveOrganization() {
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, inn: inn || undefined }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.error || "Ошибка сохранения")
        return
      }
      setStep(1)
    } finally {
      setSaving(false)
    }
  }

  async function createBranch() {
    if (!branchName.trim()) { setError("Укажите название филиала"); return }
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: branchName }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.error || "Ошибка создания филиала")
        return
      }
      const branch = await res.json()
      setCreatedBranchId(branch.id)

      // Создаём кабинет
      if (roomName.trim()) {
        await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: roomName, branchId: branch.id, capacity: 15 }),
        })
      }

      setBranchCreated(true)
      setStep(2)
    } finally {
      setSaving(false)
    }
  }

  async function createDirection() {
    if (!directionName.trim()) { setError("Укажите название направления"); return }
    const price = Number(lessonPrice)
    if (isNaN(price) || price < 0) { setError("Укажите корректную цену"); return }
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/directions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: directionName, lessonPrice: price }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.error || "Ошибка создания направления")
        return
      }
      const dir = await res.json()
      setCreatedDirectionId(dir.id)
      setDirectionCreated(true)
      setStep(3)
    } finally {
      setSaving(false)
    }
  }

  async function createEmployee() {
    if (!empFirstName.trim() || !empLastName.trim()) { setError("Укажите имя и фамилию"); return }
    if (!empLogin.trim()) { setError("Укажите логин"); return }
    if (!empPassword || empPassword.length < 6) { setError("Пароль минимум 6 символов"); return }
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: empFirstName,
          lastName: empLastName,
          login: empLogin,
          password: empPassword,
          role: "instructor",
          branchIds: createdBranchId ? [createdBranchId] : [],
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.error || "Ошибка создания сотрудника")
        return
      }
      const emp = await res.json()
      setCreatedEmployeeId(emp.id)
      setEmployeeCreated(true)
      setStep(4)
    } finally {
      setSaving(false)
    }
  }

  async function createGroup() {
    if (!groupName.trim()) { setError("Укажите название группы"); return }
    if (!createdBranchId || !createdDirectionId || !createdEmployeeId) {
      setError("Сначала создайте филиал, направление и сотрудника")
      return
    }
    setSaving(true)
    setError("")
    try {
      // Нужен roomId — получим первый кабинет филиала
      const roomsRes = await fetch("/api/rooms")
      const rooms = await roomsRes.json()
      const room = rooms.find((r: { branch: { id: string } }) => r.branch?.id === createdBranchId)

      if (!room) {
        setError("Кабинет не найден — создайте кабинет в настройках")
        return
      }

      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: groupName,
          directionId: createdDirectionId,
          branchId: createdBranchId,
          roomId: room.id,
          instructorId: createdEmployeeId,
          maxStudents: 15,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.error || "Ошибка создания группы")
        return
      }
      setGroupCreated(true)
      setStep(5)
    } finally {
      setSaving(false)
    }
  }

  async function finishOnboarding() {
    setSaving(true)
    try {
      await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingCompleted: true }),
      })
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const progressPercent = Math.round((step / (STEPS.length - 1)) * 100)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Шаг {step + 1} из {STEPS.length}</span>
          <span>{progressPercent}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted">
          <div
            className="h-2 rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between">
          {STEPS.map((s, i) => (
            <div
              key={i}
              className={`flex items-center gap-1 text-xs ${
                i <= step ? "text-primary font-medium" : "text-muted-foreground"
              }`}
            >
              {i < step ? (
                <Check className="size-3" />
              ) : (
                <s.icon className="size-3" />
              )}
              <span className="hidden sm:inline">{s.title}</span>
            </div>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {(() => { const Icon = STEPS[step].icon; return <Icon className="size-5" /> })()}
            {STEPS[step].title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Step 0: Welcome */}
          {step === 0 && (
            <>
              <p className="text-sm text-muted-foreground">
                Настроим вашу организацию за несколько шагов. Это займёт пару минут.
              </p>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="org-name">Название организации *</Label>
                  <Input
                    id="org-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Детский центр «Радуга»"
                  />
                </div>
                <div>
                  <Label htmlFor="org-inn">ИНН (опционально)</Label>
                  <Input
                    id="org-inn"
                    value={inn}
                    onChange={(e) => setInn(e.target.value)}
                    placeholder="1234567890"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={saveOrganization} disabled={saving || !name.trim()}>
                  {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
                  Далее
                  <ChevronRight className="ml-1 size-4" />
                </Button>
              </div>
            </>
          )}

          {/* Step 1: Branch */}
          {step === 1 && (
            <>
              <p className="text-sm text-muted-foreground">
                Создайте хотя бы один филиал и кабинет. Филиал — это физическая локация вашего центра.
              </p>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="branch-name">Название филиала *</Label>
                  <Input
                    id="branch-name"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder="Основной филиал"
                  />
                </div>
                <div>
                  <Label htmlFor="room-name">Название кабинета</Label>
                  <Input
                    id="room-name"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder="Кабинет 1"
                  />
                </div>
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(0)}>
                  <ChevronLeft className="mr-1 size-4" />
                  Назад
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep(2)}>
                    <SkipForward className="mr-1 size-4" />
                    Пропустить
                  </Button>
                  <Button onClick={createBranch} disabled={saving}>
                    {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
                    Далее
                    <ChevronRight className="ml-1 size-4" />
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Step 2: Direction */}
          {step === 2 && (
            <>
              <p className="text-sm text-muted-foreground">
                Направление — это вид занятий в вашем центре (рисование, танцы, английский и т.д.).
              </p>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="dir-name">Название направления *</Label>
                  <Input
                    id="dir-name"
                    value={directionName}
                    onChange={(e) => setDirectionName(e.target.value)}
                    placeholder="Рисование"
                  />
                </div>
                <div>
                  <Label htmlFor="lesson-price">Стоимость одного занятия (₽) *</Label>
                  <Input
                    id="lesson-price"
                    type="number"
                    value={lessonPrice}
                    onChange={(e) => setLessonPrice(e.target.value)}
                    placeholder="500"
                  />
                </div>
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ChevronLeft className="mr-1 size-4" />
                  Назад
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep(3)}>
                    <SkipForward className="mr-1 size-4" />
                    Пропустить
                  </Button>
                  <Button onClick={createDirection} disabled={saving}>
                    {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
                    Далее
                    <ChevronRight className="ml-1 size-4" />
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Step 3: Employee */}
          {step === 3 && (
            <>
              <p className="text-sm text-muted-foreground">
                Добавьте инструктора — он будет вести занятия. Логин и пароль понадобятся для входа в систему.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="emp-fn">Имя *</Label>
                  <Input
                    id="emp-fn"
                    value={empFirstName}
                    onChange={(e) => setEmpFirstName(e.target.value)}
                    placeholder="Анна"
                  />
                </div>
                <div>
                  <Label htmlFor="emp-ln">Фамилия *</Label>
                  <Input
                    id="emp-ln"
                    value={empLastName}
                    onChange={(e) => setEmpLastName(e.target.value)}
                    placeholder="Иванова"
                  />
                </div>
                <div>
                  <Label htmlFor="emp-login">Логин (латиница) *</Label>
                  <Input
                    id="emp-login"
                    value={empLogin}
                    onChange={(e) => setEmpLogin(e.target.value)}
                    placeholder="ivanova"
                  />
                </div>
                <div>
                  <Label htmlFor="emp-pass">Пароль *</Label>
                  <Input
                    id="emp-pass"
                    type="password"
                    value={empPassword}
                    onChange={(e) => setEmpPassword(e.target.value)}
                    placeholder="••••••"
                  />
                </div>
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)}>
                  <ChevronLeft className="mr-1 size-4" />
                  Назад
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep(4)}>
                    <SkipForward className="mr-1 size-4" />
                    Пропустить
                  </Button>
                  <Button onClick={createEmployee} disabled={saving}>
                    {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
                    Далее
                    <ChevronRight className="ml-1 size-4" />
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Step 4: Group */}
          {step === 4 && (
            <>
              <p className="text-sm text-muted-foreground">
                Группа объединяет направление, инструктора и кабинет. После создания группы можно будет сгенерировать расписание.
              </p>
              {!createdBranchId || !createdDirectionId || !createdEmployeeId ? (
                <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800">
                  Для создания группы нужны филиал, направление и инструктор. Вернитесь и создайте их или пропустите этот шаг.
                </div>
              ) : (
                <div>
                  <Label htmlFor="group-name">Название группы *</Label>
                  <Input
                    id="group-name"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="Рисование Пн/Ср 10:00"
                  />
                </div>
              )}
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(3)}>
                  <ChevronLeft className="mr-1 size-4" />
                  Назад
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep(5)}>
                    <SkipForward className="mr-1 size-4" />
                    Пропустить
                  </Button>
                  {createdBranchId && createdDirectionId && createdEmployeeId && (
                    <Button onClick={createGroup} disabled={saving}>
                      {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
                      Далее
                      <ChevronRight className="ml-1 size-4" />
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Step 5: Done */}
          {step === 5 && (
            <>
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <PartyPopper className="size-12 text-primary" />
                <h2 className="text-xl font-bold">Всё готово!</h2>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Основная настройка завершена. Теперь можно работать с CRM: добавлять клиентов, вести расписание, принимать оплаты.
                </p>
                <div className="flex flex-col gap-2 text-sm text-left">
                  {branchCreated && (
                    <div className="flex items-center gap-2 text-green-600">
                      <Check className="size-4" /> Филиал создан
                    </div>
                  )}
                  {directionCreated && (
                    <div className="flex items-center gap-2 text-green-600">
                      <Check className="size-4" /> Направление создано
                    </div>
                  )}
                  {employeeCreated && (
                    <div className="flex items-center gap-2 text-green-600">
                      <Check className="size-4" /> Инструктор добавлен
                    </div>
                  )}
                  {groupCreated && (
                    <div className="flex items-center gap-2 text-green-600">
                      <Check className="size-4" /> Группа создана
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-center">
                <Button size="lg" onClick={finishOnboarding} disabled={saving}>
                  {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
                  Перейти к дашборду
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
