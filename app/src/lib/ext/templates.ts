import type { CommunicationChannel } from "@prisma/client"
import { db } from "@/lib/db"
import { formatMoney } from "@/lib/currency"
import { lessonsWord } from "@/lib/plural"
import { EMPTY_VALUE, expandTemplate } from "@/lib/ext/template-placeholders"
import {
  collectClientFacts,
  formatLessonLine,
  formatScheduleText,
  type ClientFacts,
} from "@/lib/ext/quick-info"
import type { ExtContext } from "@/lib/ext-auth"

/**
 * Шаблоны ответов с подстановкой полей (docs/messenger-extension.md, Фаза 3).
 *
 * Администратор пишет шаблон один раз («Здравствуйте! Напоминаем: у {ребёнок}
 * занятие {ближайшее_занятие}»), панель подставляет данные конкретного клиента
 * и кладёт готовый текст В ПОЛЕ ВВОДА. Отправляет человек — он же и вычитывает
 * подстановку, поэтому текст должен быть предсказуемым, а не «умным».
 *
 * Правила подстановки, из которых всё остальное следует:
 *   • данных нет → «—», а не пустота: в сообщении сразу видно, что подставлять
 *     было нечего, и человек не отправит «у вас осталось  занятий»;
 *   • незнакомый плейсхолдер оставляем как есть — это опечатка в шаблоне, и
 *     молча съесть кусок текста хуже, чем показать «{ребенок}» перед отправкой;
 *   • раскрытие только на сервере: те же данные, что в справке, и ни строчки
 *     бизнес-логики в расширении.
 */

/** Значения плейсхолдеров по фактам о клиенте. */
export function buildTemplateValues(
  facts: ClientFacts,
  context: { employeeName: string | null; organizationName: string | null },
): Record<string, string> {
  const wardNames = facts.wards.map((w) => w.name).filter(Boolean)
  const subscriptions = facts.wards.flatMap((w) => w.subscriptions)

  // Ближайшее занятие — по всем детям сразу: расписание уже отсортировано по
  // дате, поэтому берём самое раннее из первых.
  const nextLesson = facts.wards
    .map((w) => w.lessons[0])
    .filter(Boolean)
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))[0]

  const remaining = subscriptions.reduce((sum, s) => sum + s.remainingLessons, 0)
  const debt = subscriptions.reduce((sum, s) => sum + s.debt, 0)
  const directions = [...new Set(subscriptions.map((s) => s.direction).filter(Boolean))]

  return {
    родитель: facts.parentFirstName || EMPTY_VALUE,
    ребёнок: wardNames.length ? wardNames.join(" и ") : EMPTY_VALUE,
    направление: directions.length ? directions.join(", ") : EMPTY_VALUE,
    ближайшее_занятие: nextLesson ? formatLessonLine(nextLesson) : EMPTY_VALUE,
    расписание:
      formatScheduleText(facts.wards, { showNames: facts.showNames }) ?? EMPTY_VALUE,
    // Абонементов нет — честный ноль, а не «—»: «осталось 0 занятий» осмысленно.
    остаток: subscriptions.length ? String(remaining) : "0",
    остаток_занятий: `${remaining} ${lessonsWord(remaining)}`,
    долг: formatMoney(debt, facts.currency),
    баланс: formatMoney(facts.balance, facts.currency),
    филиал: facts.branchName || EMPTY_VALUE,
    центр: context.organizationName || EMPTY_VALUE,
    сотрудник: context.employeeName || EMPTY_VALUE,
  }
}

/**
 * Шаблоны организации с уже раскрытыми плейсхолдерами.
 *
 * clientId не передан (чат ещё не привязан) — отдаём тексты как есть: пусть
 * человек видит шаблон целиком, а подставит его после привязки клиента.
 */
export async function buildTemplatesForChat(
  ctx: ExtContext,
  options: { clientId?: string | null; channel?: CommunicationChannel | null },
): Promise<Array<{ id: string; title: string; text: string }>> {
  const templates = await db.messageTemplate.findMany({
    where: {
      tenantId: ctx.tenantId,
      deletedAt: null,
      // NULL — шаблон для любого канала; иначе только для своего.
      ...(options.channel ? { OR: [{ channel: null }, { channel: options.channel }] } : {}),
    },
    select: { id: true, title: true, body: true },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    take: 50,
  })
  if (templates.length === 0) return []

  const facts = options.clientId ? await collectClientFacts(ctx, options.clientId) : null
  if (!facts) return templates.map((t) => ({ id: t.id, title: t.title, text: t.body }))

  // Имя сотрудника уже посчитал гард (он и так читает сотрудника на каждый
  // запрос) — второй запрос за тем же именем не нужен.
  const organization = await db.organization.findUnique({
    where: { id: ctx.tenantId },
    select: { name: true },
  })

  const values = buildTemplateValues(facts, {
    employeeName: ctx.employeeName,
    organizationName: organization?.name ?? null,
  })

  return templates.map((t) => ({ id: t.id, title: t.title, text: expandTemplate(t.body, values) }))
}
