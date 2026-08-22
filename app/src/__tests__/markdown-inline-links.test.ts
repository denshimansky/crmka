/**
 * Unit-тесты ссылок в renderInline (22.08.2026: в базе знаний адреса статей
 * выводились текстом — скопировать можно, кликнуть нельзя).
 *
 * Проверяем голые ссылки, markdown-ссылки [текст](адрес), хвостовую пунктуацию
 * и то, что небезопасные схемы ссылкой не становятся.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { ReactElement } from "react"
import { renderInline } from "../components/markdown-guide"

type Node = ReturnType<typeof renderInline>[number]

const isEl = (n: Node): n is ReactElement<Record<string, unknown>> =>
  typeof n === "object" && n !== null && "props" in (n as object)

/** Первая ссылка в результате (или null). */
function firstLink(nodes: Node[]): Record<string, unknown> | null {
  for (const n of nodes) {
    if (isEl(n) && n.type === "a") return n.props as Record<string, unknown>
  }
  return null
}

/** Только текстовые куски — чтобы проверить, что ничего не потерялось. */
function plain(nodes: Node[]): string {
  return nodes
    .map((n) => (typeof n === "string" ? n : isEl(n) ? String(n.props.children ?? "") : ""))
    .join("")
}

describe("renderInline — ссылки", () => {
  it("голый адрес становится ссылкой", () => {
    const link = firstLink(renderInline("Инструкция: https://msk1.umnayacrm.ru/knowledge/abc", "k"))
    assert.equal(link?.href, "https://msk1.umnayacrm.ru/knowledge/abc")
    assert.equal(link?.target, "_blank")
    assert.equal(link?.rel, "noopener noreferrer")
  })

  it("хвостовая пунктуация не попадает в адрес и остаётся в тексте", () => {
    const nodes = renderInline("(Инструкция: https://a.ru/sozdanie-grupp), перевести учеников", "k")
    assert.equal(firstLink(nodes)?.href, "https://a.ru/sozdanie-grupp")
    assert.equal(plain(nodes), "(Инструкция: https://a.ru/sozdanie-grupp), перевести учеников")
  })

  it("точка в конце предложения не съедается", () => {
    const nodes = renderInline("Смотри https://a.ru/kak-zakryt-gruppu.", "k")
    assert.equal(firstLink(nodes)?.href, "https://a.ru/kak-zakryt-gruppu")
    assert.equal(plain(nodes), "Смотри https://a.ru/kak-zakryt-gruppu.")
  })

  it("парные скобки внутри адреса сохраняются", () => {
    const link = firstLink(renderInline("https://ru.wikipedia.org/wiki/Ага_(значения)", "k"))
    assert.equal(link?.href, "https://ru.wikipedia.org/wiki/Ага_(значения)")
  })

  it("markdown-ссылка: показывается текст, ведёт на адрес", () => {
    const nodes = renderInline("см. [производственный календарь](https://a.ru/kalendar)", "k")
    const link = firstLink(nodes)
    assert.equal(link?.href, "https://a.ru/kalendar")
    assert.equal(link?.children, "производственный календарь")
  })

  it("внутренняя ссылка «/…» открывается в текущей вкладке", () => {
    const link = firstLink(renderInline("[Расписание](/schedule)", "k"))
    assert.equal(link?.href, "/schedule")
    assert.equal(link?.target, undefined)
  })

  it("javascript:-адрес ссылкой не становится", () => {
    const nodes = renderInline("[клик](javascript:alert(1))", "k")
    assert.equal(firstLink(nodes), null)
    assert.equal(plain(nodes), "[клик](javascript:alert(1))")
  })

  it("остальная разметка не сломалась", () => {
    const nodes = renderInline("**жирный** и *курсив* и `код` и __подчёркнутый__", "k")
    const types = nodes.filter(isEl).map((n) => n.type)
    assert.deepEqual(types, ["strong", "em", "code", "u"])
  })

  it("ссылка рядом с жирным текстом", () => {
    const nodes = renderInline("**Важно:** https://a.ru/x — читать", "k")
    assert.equal(firstLink(nodes)?.href, "https://a.ru/x")
    assert.ok(nodes.filter(isEl).some((n) => n.type === "strong"))
  })
})
