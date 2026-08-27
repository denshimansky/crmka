/**
 * Одноразовый бэкфилл: доначислить платные пробные, отмеченные «Был» ДО фичи
 * (chargeAmount=0) на направлениях с платным пробным (trialFree=false, trialPrice>0).
 * Использует ту же логику, что и живая отметка (computeTrialCharge + applyBalanceDelta
 * + recomputeClientFirstPaidLessonDate) — НЕ hand-SQL, чтобы баланс/лента/долг сошлись.
 * Идемпотентно: берёт только chargeAmount=0.
 *
 * Запуск (через SSH-туннель к прод-БД):
 *   DATABASE_URL="postgresql://crmka:***@localhost:5433/crmka?schema=public" \
 *     npx tsx app/scripts/backfill-paid-trial-charge.ts <tenantId> [--apply]
 * Без --apply — DRY-RUN (только печать, без записи).
 */
import { PrismaClient, Prisma } from "@prisma/client"
import { computeTrialCharge } from "../src/lib/services/trial-charge"
import { applyBalanceDelta } from "../src/lib/balance/transactions"
import { recomputeClientFirstPaidLessonDate } from "../src/lib/services/client-first-paid-lesson-date"

const TENANT = process.argv[2]
const APPLY = process.argv.includes("--apply")

async function main() {
  if (!TENANT) throw new Error("usage: tsx backfill-paid-trial-charge.ts <tenantId> [--apply]")
  const prisma = new PrismaClient()
  const url = process.env.DATABASE_URL || ""
  console.log("DB    :", url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@"))
  console.log("TENANT:", TENANT)
  console.log("MODE  :", APPLY ? "APPLY (will write)" : "DRY-RUN (no writes)")
  console.log("")

  const atts = await prisma.attendance.findMany({
    where: { tenantId: TENANT, isTrial: true, chargeAmount: { equals: 0 } },
    include: {
      client: { select: { lastName: true, firstName: true } },
      lesson: {
        select: {
          date: true,
          group: {
            select: {
              direction: { select: { id: true, name: true, trialFree: true, trialPrice: true } },
            },
          },
        },
      },
    },
    orderBy: [{ lesson: { date: "asc" } }],
  })

  let total = new Prisma.Decimal(0)
  let n = 0
  for (const a of atts) {
    const dir = a.lesson.group?.direction
    if (!dir) continue
    const charge = computeTrialCharge(dir)
    if (!charge.gt(0)) continue // бесплатное пробное — пропускаем
    n++
    total = total.add(charge)
    const name = `${a.client.lastName ?? ""} ${a.client.firstName ?? ""}`.trim()
    console.log(
      `  [${n}] ${name} | ${dir.name} | ${a.lesson.date.toISOString().slice(0, 10)} | +${charge.toString()} ₽`,
    )
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        await tx.attendance.update({ where: { id: a.id }, data: { chargeAmount: charge } })
        await applyBalanceDelta(tx, {
          tenantId: TENANT,
          clientId: a.clientId,
          delta: charge.negated(),
          type: "trial_charge",
          refs: { lessonId: a.lessonId, attendanceId: a.id, directionId: dir.id },
          comment: "Пробное занятие (доначислено, фикс бага 26.08)",
          createdBy: null,
        })
        await recomputeClientFirstPaidLessonDate(tx, TENANT, a.clientId)
      })
    }
  }
  console.log("")
  console.log(`ИТОГО: ${n} пробных, ${total.toString()} ₽. ${APPLY ? "СПИСАНО." : "DRY-RUN — изменений нет."}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
