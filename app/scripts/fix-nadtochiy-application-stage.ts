/**
 * Одноразовая корректировка (25.08.2026, msk1 / ДЦ Замок).
 *
 * Заявка Надточий Полина на направление «Английский» (групповой) была ошибочно
 * проштампована awaiting_payment при выписке абонемента на ДРУГОЕ направление —
 * «Английский индивидуальный» (баг рассинхрона направления в
 * move-to-awaiting-payment, первопричина закрыта гардом). Из-за этого заявка
 * повисла в воронке «Ожидаем оплату» без своей группы/цены («—»), т.к. строка
 * «Продаж» матчит абонемент по (ребёнок+направление).
 *
 * Возвращаем заявку в стадию «Заявка» (application), чтобы её можно было корректно
 * выписать в групповую «Английский 3-й класс». Абонементы НЕ трогаем — индив.
 * абонемент 07bb2904 корректен и оплачивается. firstPaidLessonDate заявки чистим
 * (в «Заявке» она не нужна; при повторной выписке проставится заново), агрегаты
 * пересчитываем каноническими сервисами.
 *
 * Запуск (из app/), DATABASE_URL → прод через SSH-туннель:
 *   node --import tsx scripts/fix-nadtochiy-application-stage.ts           # DRY-RUN (откат)
 *   node --import tsx scripts/fix-nadtochiy-application-stage.ts --apply   # APPLY
 * Идемпотентно: повторный прогон видит stage!='awaiting_payment' → no-op.
 */
import { db } from "@/lib/db"
import { recomputeWardSalesStage } from "@/lib/services/ward-sales-stage"
import { recomputeClientFirstPaidLessonDate } from "@/lib/services/client-first-paid-lesson-date"

const APPLY = process.argv.includes("--apply")
const APP_ID = "c5040c53-66ee-4e71-9127-8baea8e393d0"

class DryRunRollback extends Error {}

async function main() {
  const app = await db.application.findUnique({
    where: { id: APP_ID },
    select: {
      id: true, tenantId: true, wardId: true, clientId: true,
      stage: true, directionId: true, firstPaidLessonDate: true, deletedAt: true,
    },
  })
  if (!app) {
    console.log("Заявка не найдена:", APP_ID)
    return
  }
  console.log("BEFORE:", JSON.stringify(app, null, 2))
  if (app.deletedAt) {
    console.log("Заявка soft-удалена — пропуск.")
    return
  }
  if (app.stage !== "awaiting_payment") {
    console.log(`stage='${app.stage}' (не awaiting_payment) — уже откачено, no-op.`)
    return
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.application.update({
        where: { id: app.id },
        data: { stage: "application", firstPaidLessonDate: null },
      })
      await recomputeWardSalesStage(tx, app.tenantId, app.wardId)
      await recomputeClientFirstPaidLessonDate(tx, app.tenantId, app.clientId)
      await tx.auditLog.create({
        data: {
          tenantId: app.tenantId,
          employeeId: null,
          action: "update",
          entityType: "Application",
          entityId: app.id,
          changes: {
            stage: { old: "awaiting_payment", new: "application" },
            note: {
              new: "Ручной откат ошибочного awaiting (рассинхрон направления заявка↔абонемент, кейс Надточий); абонементы не тронуты",
            },
          },
        },
      })

      const [appAfter, wardAfter, clientAfter] = await Promise.all([
        tx.application.findUnique({
          where: { id: app.id },
          select: { stage: true, firstPaidLessonDate: true },
        }),
        tx.ward.findUnique({ where: { id: app.wardId }, select: { salesStage: true, salesStageAt: true } }),
        tx.client.findUnique({ where: { id: app.clientId }, select: { firstPaidLessonDate: true } }),
      ])
      console.log("AFTER (в транзакции):", JSON.stringify({ appAfter, wardAfter, clientAfter }, null, 2))

      if (!APPLY) throw new DryRunRollback()
    })
    console.log("✅ APPLIED — заявка возвращена в «Заявка».")
  } catch (e) {
    if (e instanceof DryRunRollback) {
      console.log("↩️  DRY-RUN — транзакция откачена, ничего не записано. Запусти с --apply.")
      return
    }
    throw e
  }
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e)
    return db.$disconnect().finally(() => process.exit(1))
  })
