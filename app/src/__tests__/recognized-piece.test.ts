import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  allocatePieceFifo,
  computePiecePaid,
  ymKeyOf,
} from "@/lib/salary/recognized-piece"

const JUL = ymKeyOf(2026, 7)
const AUG = ymKeyOf(2026, 8)
const JUN = ymKeyOf(2026, 6)

describe("allocatePieceFifo", () => {
  it("один месяц, частичная оплата → ratio < 1", () => {
    const r = allocatePieceFifo([{ ymKey: JUL, accrual: 10000 }], 6000, 0)
    assert.equal(r.get(JUL), 0.6)
  })

  it("один месяц, полностью оплачено → ratio = 1", () => {
    const r = allocatePieceFifo([{ ymKey: JUL, accrual: 10000 }], 10000, 0)
    assert.equal(r.get(JUL), 1)
  })

  it("FIFO: оплата наполняет старейший месяц первым (июль целиком, август частично)", () => {
    const r = allocatePieceFifo(
      [{ ymKey: JUL, accrual: 10000 }, { ymKey: AUG, accrual: 8000 }],
      13000,
      0,
    )
    assert.equal(r.get(JUL), 1) // 10000 из 10000
    assert.equal(r.get(AUG), 3000 / 8000) // остаток 3000 из 8000
  })

  it("доплата за июль в августе → июль дозаполняется (FIFO старейший первым)", () => {
    // Было оплачено 4000 из июльских 10000; доплатили ещё 6000 (итого 10000).
    const before = allocatePieceFifo([{ ymKey: JUL, accrual: 10000 }, { ymKey: AUG, accrual: 8000 }], 4000, 0)
    assert.equal(before.get(JUL), 0.4)
    assert.equal(before.get(AUG), 0)
    const after = allocatePieceFifo([{ ymKey: JUL, accrual: 10000 }, { ymKey: AUG, accrual: 8000 }], 10000, 0)
    assert.equal(after.get(JUL), 1) // июль закрыт полностью
    assert.equal(after.get(AUG), 0) // август ещё не оплачивался
  })

  it("переплата сверх суммы начислений → все месяцы ratio=1, лишнее не признаётся", () => {
    const r = allocatePieceFifo(
      [{ ymKey: JUL, accrual: 10000 }, { ymKey: AUG, accrual: 8000 }],
      25000, // 7000 сверх — уходит в будущие месяцы (вне окна), не раздувает текущие
      0,
    )
    assert.equal(r.get(JUL), 1)
    assert.equal(r.get(AUG), 1)
  })

  it("начисления до окна гасятся первыми (prior уменьшает доступную оплату)", () => {
    // Июнь (до окна) начислено 5000; оплачено всего 8000 → в окно приходит 3000.
    const r = allocatePieceFifo([{ ymKey: JUL, accrual: 10000 }], 8000, 5000)
    assert.equal(r.get(JUL), 0.3) // 3000 из 10000
  })

  it("оплаты хватило только на месяцы до окна → окно ratio=0", () => {
    const r = allocatePieceFifo([{ ymKey: JUL, accrual: 10000 }], 8000, 12000)
    assert.equal(r.get(JUL), 0)
  })

  it("ничего не оплачено → все месяцы ratio=0", () => {
    const r = allocatePieceFifo([{ ymKey: JUL, accrual: 10000 }, { ymKey: AUG, accrual: 8000 }], 0, 0)
    assert.equal(r.get(JUL), 0)
    assert.equal(r.get(AUG), 0)
  })

  it("месяц с нулевым начислением → ratio 0, без деления на ноль (NaN)", () => {
    const r = allocatePieceFifo([{ ymKey: JUL, accrual: 0 }], 5000, 0)
    assert.equal(r.get(JUL), 0)
  })

  it("сортировка по возрасту не зависит от порядка входа (июнь раньше июля)", () => {
    const r = allocatePieceFifo(
      [{ ymKey: JUL, accrual: 6000 }, { ymKey: JUN, accrual: 5000 }],
      8000,
      0,
    )
    assert.equal(r.get(JUN), 1) // старейший закрыт первым: 5000
    assert.equal(r.get(JUL), 3000 / 6000) // остаток 3000
  })
})

describe("computePiecePaid (оклад не задваивается)", () => {
  it("совмещающий: из выплат вычитается признанный оклад-твин", () => {
    // Выплачено 12000 (оклад 5000 + сделка 7000); оклад-твин признал 5000.
    assert.equal(computePiecePaid(12000, 5000), 7000)
  })

  it("чистый сдельщик: оклада нет → вся выплата = сделка", () => {
    assert.equal(computePiecePaid(9000, 0), 9000)
  })

  it("оклад больше выплат (аванс оклада) → сделка 0, без отрицательных", () => {
    assert.equal(computePiecePaid(3000, 5000), 0)
  })
})
