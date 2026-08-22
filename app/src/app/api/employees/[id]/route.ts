import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { isEmailTaken, EMAIL_TAKEN_MSG, uniqueViolationMessage } from "@/lib/employee-identity"

const updateSchema = z.object({
  firstName: z.string().min(1, "Имя обязательно").optional(),
  lastName: z.string().min(1, "Фамилия обязательна").optional(),
  // PATCH — частичное обновление: отсутствующий ключ НЕ трогает поле. `.optional()`
  // важен, иначе z.any() превращает undefined в null и минимальный PATCH (напр.
  // только оклад из модалки «Ставки ЗП») затёр бы отчество/почту/телефон/др.
  middleName: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null).optional(),
  email: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null).pipe(z.string().email("Некорректный email").nullable()).optional(),
  phone: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null).optional(),
  birthDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null).optional(),
  role: z.enum(["manager", "admin", "instructor", "readonly"]).optional(),
  password: z.string().min(6, "Пароль минимум 6 символов").optional().or(z.literal("")).transform(v => v || undefined),
  branchIds: z.array(z.string().uuid()).optional(),
  isActive: z.boolean().optional(),
  // Окладники: фиксированный месячный оклад и основное направление для ОПИУ.
  monthlySalary: z.any().transform(v => {
    if (v === null || v === undefined || v === "") return null
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : null
  }).optional(),
  defaultDirectionId: z.any().transform(v => {
    if (v === null || v === undefined || v === "") return null
    return typeof v === "string" ? v : null
  }).optional(),
  // Дата, с которой действует оклад (YYYY-MM-DD). Пусто → оклад за весь месяц во
  // всех периодах (обратная совместимость). Иначе оклад не начисляется за месяцы
  // до неё, неполный первый месяц — пропорционально (см. lib/salary/oklad-for-period).
  okladFrom: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null).optional(),
  // Филиалы, на которые распространяется оклад (разнесение оклад-твина в ОПИУ).
  // Пусто → по всем ∝ выручке.
  okladBranchIds: z.array(z.string().uuid()).nullable().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Проверяем что сотрудник принадлежит нашей организации
  const existing = await db.employee.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
  }

  // Email уникален глобально (второй логин + адрес сброса пароля). При смене
  // проверяем, что его не занял другой сотрудник (регистро-/пробелонезависимо).
  if (data.email && (await isEmailTaken(db, data.email, session.user.tenantId, id))) {
    return NextResponse.json({ error: EMAIL_TAKEN_MSG }, { status: 409 })
  }

  // Нельзя менять роль владельца
  if (existing.role === "owner" && data.role) {
    return NextResponse.json({ error: "Нельзя изменить роль владельца" }, { status: 400 })
  }

  // ADM-04: при редактировании сотрудника с ролью admin/instructor — нельзя
  // явно «обнулить» привязки. Считаем эффективную роль и эффективный набор.
  // Если ни роль, ни branchIds не меняются — пропускаем проверку.
  // ADM-04: требование «≥1 филиал» действует только для admin — без привязок он
  // видел бы данные всех филиалов. Инструктору филиал необязателен: его видимость
  // и так ограничена своими занятиями (scopeLessonForInstructor).
  const effectiveRole = data.role ?? existing.role
  if (effectiveRole === "admin" && data.branchIds !== undefined) {
    if (data.branchIds.length === 0) {
      return NextResponse.json(
        { error: "Для роли «администратор» нужно оставить хотя бы один филиал" },
        { status: 400 },
      )
    }
  }
  // Если сменили роль на admin без передачи branchIds — проверяем
  // текущие привязки в БД. Если их нет — отбойник.
  if (data.role === "admin" && data.branchIds === undefined) {
    const linksCount = await db.employeeBranch.count({ where: { employeeId: id } })
    if (linksCount === 0) {
      return NextResponse.json(
        { error: "Для роли «администратор» нужно выбрать хотя бы один филиал" },
        { status: 400 },
      )
    }
  }

  // Обновляем привязки к филиалам если переданы
  if (data.branchIds) {
    await db.employeeBranch.deleteMany({ where: { employeeId: id } })
    if (data.branchIds.length > 0) {
      await db.employeeBranch.createMany({
        data: data.branchIds.map(branchId => ({ tenantId: session.user.tenantId, employeeId: id, branchId })),
      })
    }
  }

  // Базовый оклад и дата его начала задаются ОДИН раз: они действуют «с начала
  // времён», поэтому их правка пересчитывает все прошлые месяцы новой суммой —
  // ровно так у Андреевой (ДЦ Умный Я) обнулились июнь и июль, а выплаты за них
  // остались. Дальше сумму меняют версиями (OkladSchedule), которые действуют
  // только вперёд от своей даты. Опечатку в базе тоже правят версией — с той же
  // даты начала, она перекрывает базу полностью.
  const okladAlreadySet = existing.monthlySalary !== null
  if (okladAlreadySet) {
    const changesBase =
      (data.monthlySalary !== undefined && Number(data.monthlySalary ?? 0) !== Number(existing.monthlySalary)) ||
      (data.okladFrom !== undefined &&
        (data.okladFrom ? new Date(data.okladFrom).toISOString().slice(0, 10) : null) !==
          (existing.okladFrom ? existing.okladFrom.toISOString().slice(0, 10) : null))
    if (changesBase) {
      return NextResponse.json(
        { error: "Оклад уже задан. Изменить сумму можно только через «Историю оклада» — так прошлые месяцы не пересчитаются задним числом." },
        { status: 400 },
      )
    }
  }

  // Правка окладных полей меняет РАСЧЁТ прошлых месяцев (база — «версия с начала
  // времён»), поэтому оклад-твины ОПИУ надо пересобрать, иначе начисление и расход
  // разъедутся: было 18 000 → стало 25 000, а в финрезе прошлых месяцев осталось
  // 18 000. Резолвим категорию ДО транзакции (см. getOkladCategoryId).
  const okladFieldsTouched =
    data.monthlySalary !== undefined ||
    data.okladFrom !== undefined ||
    data.defaultDirectionId !== undefined ||
    data.okladBranchIds !== undefined

  let employee
  try {
    employee = await db.employee.update({
      where: { id },
      data: {
        ...(data.firstName && { firstName: data.firstName }),
        ...(data.lastName && { lastName: data.lastName }),
        ...(data.middleName !== undefined && { middleName: data.middleName }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.birthDate !== undefined && { birthDate: data.birthDate ? new Date(data.birthDate) : null }),
        ...(data.role && { role: data.role }),
        ...(data.password && { passwordHash: await bcrypt.hash(data.password, 10) }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.monthlySalary !== undefined && { monthlySalary: data.monthlySalary }),
        ...(data.okladFrom !== undefined && { okladFrom: data.okladFrom ? new Date(data.okladFrom) : null }),
        ...(data.defaultDirectionId !== undefined && { defaultDirectionId: data.defaultDirectionId }),
        ...(data.okladBranchIds !== undefined && {
          okladBranchIds: data.okladBranchIds && data.okladBranchIds.length > 0 ? data.okladBranchIds : Prisma.DbNull,
        }),
      },
      include: {
        employeeBranches: { include: { branch: { select: { id: true, name: true } } } },
      },
    })
    if (okladFieldsTouched) {
      const { getOkladCategoryId } = await import("@/lib/salary/oklad-category")
      const { resyncOkladTwinsFromMonth } = await import("@/lib/salary/sync-oklad-twin")
      const okladCategoryId = await getOkladCategoryId()
      await db.$transaction(
        async (tx) => {
          await resyncOkladTwinsFromMonth(tx, {
            tenantId: session.user.tenantId,
            employeeId: id,
            fromYear: 1970,
            fromMonth: 1,
            okladCategoryId,
            createdBy: session.user.employeeId ?? null,
          })
        },
        { timeout: 120_000 },
      )
    }
  } catch (e) {
    // Гонка между isEmailTaken и update (смена email) → БД-индекс → 409.
    const msg = uniqueViolationMessage(e)
    if (msg) return NextResponse.json({ error: msg }, { status: 409 })
    throw e
  }

  return NextResponse.json(employee)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Только владелец может удалять сотрудников" }, { status: 403 })
  }

  const { id } = await params

  const existing = await db.employee.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
  }
  if (existing.role === "owner") {
    return NextResponse.json({ error: "Нельзя удалить владельца" }, { status: 400 })
  }

  // Мягкое удаление
  await db.employee.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  })

  return NextResponse.json({ ok: true })
}
