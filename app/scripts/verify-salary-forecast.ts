// Read-only проверка отчёта «Прогноз сдельной оплаты» на прод-данных.
// Гоняет реальную computeSalaryForecastBreakdown по SSH-туннелю к прод-БД.
import { db } from "../src/lib/db"
import { computeSalaryForecastBreakdown } from "../src/lib/salary/forecast-month"

const NAMES = ["Dream", "Умные дети", "Easy", "Умный Я"]

async function main() {
  for (const q of NAMES) {
    const org = await db.organization.findFirst({
      where: { name: { contains: q } },
      select: { id: true, name: true },
    })
    if (!org) { console.log(`\n(нет орг: ${q})`); continue }
    const { total, rows } = await computeSalaryForecastBreakdown(db, org.id, 2026, 7)
    const piece = rows.filter((r) => !r.isOklad)
    const pieceTotal = piece.reduce((s, r) => s + r.forecast, 0)
    console.log(`\n=== ${org.name} ===`)
    console.log(`total(с окладами)=${total.toFixed(0)} | сдельных инструкторов=${piece.length} | сдельный прогноз=${pieceTotal.toFixed(0)}`)
    for (const r of piece.sort((a, b) => b.forecast - a.forecast).slice(0, 6)) {
      console.log(`  ${r.instructorName} | ${r.directionNames.join(", ")} | ${r.scheme} | зан ${r.lessonsCount} | уч ${r.studentsCount} | прогноз ${r.forecast.toFixed(0)}`)
    }
  }
}

main().then(() => db.$disconnect()).catch((e) => { console.error(e); return db.$disconnect().then(() => process.exit(1)) })
