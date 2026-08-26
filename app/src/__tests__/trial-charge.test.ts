import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeTrialCharge } from "../lib/services/trial-charge"

describe("computeTrialCharge", () => {
  it("бесплатное пробное → 0 даже при заданной цене", () => {
    assert.equal(computeTrialCharge({ trialFree: true, trialPrice: 1000 }).toNumber(), 0)
  })
  it("платное пробное → trialPrice", () => {
    assert.equal(computeTrialCharge({ trialFree: false, trialPrice: 1000 }).toNumber(), 1000)
  })
  it("платное без заданной цены → 0", () => {
    assert.equal(computeTrialCharge({ trialFree: false, trialPrice: null }).toNumber(), 0)
  })
  it("trialFree=null трактуем как не-бесплатное → trialPrice", () => {
    assert.equal(computeTrialCharge({ trialFree: null, trialPrice: 500 }).toNumber(), 500)
  })
})
