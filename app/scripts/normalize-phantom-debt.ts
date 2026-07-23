// Разовый прод-фикс (баг «фантомный долг после переначисления возврата»):
// нормализует 3 клиента Dream, у кого пересчёт вернул на баланс больше, чем
// была переплата, оставив абонемент с долгом при плюсовом балансе.
//
// Через РЕАЛЬНЫЙ сервис payFromBalance (как кнопка «Оплатить с баланса»):
// добавляет transfer_in на сумму долга → долг абонемента 0, баланс родителя
// уменьшается на ту же сумму. Нетто-позиция клиента не меняется, «Должники»
// очищаются. Идемпотентно: после долг=0, повтор ничего не спишет (guard amt>0).
//
// DRY-RUN по умолчанию (откат транзакции). APPLY=1 — реально применить.
//
// Запуск локально через SSH-туннель к прод-БД:
//   DATABASE_URL=postgresql://crmka:***@localhost:15432/crmka?schema=public \
//   npx tsx scripts/normalize-phantom-debt.ts          (dry-run)
//   ... APPLY=1 npx tsx scripts/normalize-phantom-debt.ts   (применить)

import { db } from "../src/lib/db"
import { payFromBalance } from "../src/lib/subscriptions/pay-from-balance"

const APPLY = process.env.APPLY === "1"

// Абонементы-должники (id) 3 клиентов Dream — из read-only скана.
const DEBT_SUB_IDS = [
  "a5ef0204-c4c9-4fa9-842d-62e394797c5c", // Арискина Марина — Обучение чтению
  "3ac1d4b6-25b3-4b3b-b56c-fa0dfd4dbf7b", // Перепичай Алексей — Подготовка к школе
  "47c7174b-3984-4d9c-938b-f8689dcc07fc", // Хватова Ксения — Компьютерная грамотность
]

class Rollback extends Error {}

async function loadState() {
  const subs = await db.subscription.findMany({
    where: { id: { in: DEBT_SUB_IDS } },
    select: {
      id: true, tenantId: true, balance: true, status: true,
      client: { select: { lastName: true, firstName: true, clientBalance: true } },
      direction: { select: { name: true } },
    },
  })
  return subs
}

function printRow(tag: string, s: any) {
  const name = `${s.client.lastName} ${s.client.firstName}`
  console.log(
    `  [${tag}] ${name} — ${s.direction?.name}: долг=${Number(s.balance).toFixed(2)} ` +
    `баланс=${Number(s.client.clientBalance).toFixed(2)} статус=${s.status}`,
  )
}

async function main() {
  console.log(`\n=== Нормализация фантомного долга (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`)

  const before = await loadState()
  console.log("ДО:")
  before.forEach((s) => printRow("before", s))

  const plan = before
    .filter((s) => Number(s.balance) > 0 && (s.status === "active" || s.status === "pending"))
    .map((s) => ({
      tenantId: s.tenantId,
      subscriptionId: s.id,
      amount: Math.min(Number(s.balance), Number(s.client.clientBalance)),
    }))

  console.log("\nПлан списаний с баланса:")
  plan.forEach((p) => console.log(`  sub ${p.subscriptionId.slice(0, 8)} → ${p.amount.toFixed(2)} ₽`))

  try {
    await db.$transaction(async (tx) => {
      for (const p of plan) {
        if (!(p.amount > 0)) continue
        const res = await payFromBalance(
          { ...p, createdBy: null, comment: "Нормализация фантомного долга (переначисление возврата)" },
          tx,
        )
        console.log(
          `  ✓ sub ${p.subscriptionId.slice(0, 8)}: долг → ${res.newSubscriptionBalance.toFixed(2)}, ` +
          `баланс → ${res.newClientBalance.toFixed(2)}`,
        )
      }
      if (!APPLY) throw new Rollback("dry-run")
    })
  } catch (e) {
    if (e instanceof Rollback) {
      console.log("\n(DRY-RUN — транзакция откачена, изменения НЕ сохранены)")
    } else {
      throw e
    }
  }

  const after = await loadState()
  console.log("\nПОСЛЕ (из БД):")
  after.forEach((s) => printRow("after", s))
  console.log("")
}

main()
  .then(() => db.$disconnect())
  .catch((e) => { console.error(e); return db.$disconnect().then(() => process.exit(1)) })
