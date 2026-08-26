import { describe, it } from "node:test"

// Интеграционные сценарии платного пробного. Требуют запущенного сервера + БД
// (TEST_BASE_URL); локально БД нет, поэтому suite скипается. Тела — it.todo:
// реализуются по образцу соседних integration/trial-*.test.ts, когда доступен
// TEST_BASE_URL. Спека: docs/superpowers/specs/2026-08-26-paid-trial-charge-design.md
const BASE = process.env.TEST_BASE_URL
const suite = BASE ? describe : describe.skip

suite("платное пробное — списание с баланса", () => {
  it.todo("отметка «Был» на платном пробном (trialFree=false, trialPrice>0) списывает trialPrice с баланса родителя; attendance.chargeAmount=trialPrice")
  it.todo("сброс отметки (attended→scheduled/no_show/cancelled) возвращает списание на баланс и удаляет явку")
  it.todo("повторный PATCH с той же суммой (в т.ч. тумблер «Оплата инструктору») не двигает баланс — идемпотентность")
  it.todo("бесплатное пробное (trialFree=true) не списывает — chargeAmount=0")
  it.todo("смена цены пробного между отметками: старое списание откатывается, новое применяется (дельта)")
  it.todo("дубли пробного на одном занятии: сброс одного при выжившем attended не создаёт фантомный долг и не задваивает списание")
  it.todo("выручка ОПИУ (/api/reports/pnl) и прогноз прибыли (/api/reports/profit-forecast) растут на сумму платного пробного")
  it.todo("долг за неоплаченное пробное виден в /finance/debtors в бакете «разовые посещения»")
})
