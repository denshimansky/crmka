import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  computeOkladTwinPortion,
  okladRecognitionTarget,
  okladTwinRecognition,
  buildOkladTwin,
} from "@/lib/salary/oklad-twin"

describe("computeOkladTwinPortion", () => {
  it("выплата целиком в пределах оклада → признаётся вся", () => {
    assert.equal(computeOkladTwinPortion({ monthlySalary: 40000, paymentTotal: 40000, alreadyTwinned: 0 }), 40000)
  })

  it("переплата сверх оклада → потолок = оклад (премия/аванс не раздувают ОПИУ)", () => {
    assert.equal(computeOkladTwinPortion({ monthlySalary: 20000, paymentTotal: 26300, alreadyTwinned: 0 }), 20000)
  })

  it("совмещающий (оклад 5000 + сделка): большая сделочная выплата капается окладом", () => {
    // 12000 выплаты (оклад 5000 + сделка 7000) → окладом признаётся только 5000,
    // сделка идёт отдельным начислением из посещений (не задваивается).
    assert.equal(computeOkladTwinPortion({ monthlySalary: 5000, paymentTotal: 12000, alreadyTwinned: 0 }), 5000)
  })

  it("частичная выплата (аванс) → признаётся по факту, ниже потолка", () => {
    assert.equal(computeOkladTwinPortion({ monthlySalary: 5000, paymentTotal: 3000, alreadyTwinned: 0 }), 3000)
  })

  it("вторая выплата за период идемпотентна: остаток потолка после уже признанного", () => {
    // Аванс 3000 уже признан; остаток 5000−3000=2000, доплата 4000 → +2000.
    assert.equal(computeOkladTwinPortion({ monthlySalary: 5000, paymentTotal: 4000, alreadyTwinned: 3000 }), 2000)
  })

  it("оклад уже полностью признан → 0 (нет второго твина)", () => {
    assert.equal(computeOkladTwinPortion({ monthlySalary: 5000, paymentTotal: 4000, alreadyTwinned: 5000 }), 0)
  })

  it("не окладник (monthlySalary=0) → 0", () => {
    assert.equal(computeOkladTwinPortion({ monthlySalary: 0, paymentTotal: 9000, alreadyTwinned: 0 }), 0)
  })

  it("копейки округляются до 2 знаков", () => {
    assert.equal(computeOkladTwinPortion({ monthlySalary: 5000.005, paymentTotal: 5000.004, alreadyTwinned: 0 }), 5000)
  })
})

describe("okladRecognitionTarget (потолок = оклад + премии − штрафы)", () => {
  it("без корректировок = оклад", () => {
    assert.equal(okladRecognitionTarget(20000, 0), 20000)
  })
  it("реальная премия окладнику входит в потолок (не теряется в ОПИУ)", () => {
    // Исаева: оклад 20000, премия «за продажи» 6300 → признать 26300, а не 20000.
    assert.equal(okladRecognitionTarget(20000, 6300), 26300)
  })
  it("штраф уменьшает потолок", () => {
    assert.equal(okladRecognitionTarget(20000, -3000), 17000)
  })
  it("штраф больше оклада+премии → клампится к 0", () => {
    assert.equal(okladRecognitionTarget(5000, -8000), 0)
  })

  it("связка target→portion: премия признаётся при полной выплате", () => {
    const target = okladRecognitionTarget(20000, 6300)
    assert.equal(computeOkladTwinPortion({ monthlySalary: target, paymentTotal: 26300, alreadyTwinned: 0 }), 26300)
  })
  it("связка target→portion: совмещающий — сделка сверх (оклад+премия) капается", () => {
    // Золотарёва: оклад 5000, премий нет, выплачено 30440 (оклад + сделка 25440).
    const target = okladRecognitionTarget(5000, 0)
    assert.equal(computeOkladTwinPortion({ monthlySalary: target, paymentTotal: 30440, alreadyTwinned: 0 }), 5000)
  })
})

describe("okladTwinRecognition", () => {
  it("всегда весь оклад в месяц периода (single_period, якорь = 1-е число)", () => {
    const r = okladTwinRecognition(2026, 7)
    assert.equal(r.recognitionMode, "single_period")
    assert.equal(r.amortizationMonths, 1)
    assert.deepEqual(r.amortizationStartDate, new Date(Date.UTC(2026, 6, 1)))
    assert.deepEqual(r.date, new Date(Date.UTC(2026, 6, 1)))
  })

  it("оклад июля, проведённый в августе, признаётся в ИЮЛЕ (месяц периода, не дата платежа)", () => {
    const r = okladTwinRecognition(2026, 7)
    assert.deepEqual(r.date, new Date(Date.UTC(2026, 6, 1)))
  })

  it("детерминированно: тот же период → тот же якорь (важно для per-period ресинка)", () => {
    assert.deepEqual(okladTwinRecognition(2026, 7), okladTwinRecognition(2026, 7))
  })

  it("граница года: январь", () => {
    const r = okladTwinRecognition(2026, 1)
    assert.deepEqual(r.date, new Date(Date.UTC(2026, 0, 1)))
  })
})

describe("buildOkladTwin", () => {
  it("собирает один твин: accountId=NULL, isVariable=false, направление и признание из входа", () => {
    const recognition = okladTwinRecognition(2026, 7)
    const twin = buildOkladTwin({
      tenantId: "t1",
      categoryId: "cat-oklad",
      salaryPaymentId: "sp1",
      amount: 5000,
      directionId: "d1",
      recognition,
      createdBy: "emp-owner",
    })
    assert.deepEqual(twin, {
      tenantId: "t1", categoryId: "cat-oklad", accountId: null, amount: 5000,
      date: new Date(Date.UTC(2026, 6, 1)), recognitionMode: "single_period",
      amortizationStartDate: new Date(Date.UTC(2026, 6, 1)), amortizationMonths: 1,
      isVariable: false, createdBy: "emp-owner", salaryPaymentId: "sp1", directionId: "d1",
    })
  })

  it("окладник без направления → directionId=null", () => {
    const recognition = okladTwinRecognition(2026, 7)
    const twin = buildOkladTwin({
      tenantId: "t1", categoryId: "cat-oklad", salaryPaymentId: "sp1",
      amount: 42500, directionId: null, recognition, createdBy: null,
    })
    assert.equal(twin.directionId, null)
    assert.equal(twin.accountId, null)
    assert.equal(twin.amount, 42500)
  })
})
