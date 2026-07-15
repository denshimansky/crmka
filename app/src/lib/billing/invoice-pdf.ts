// Рендер PDF «Счёт-договор оферты» (по образцу Счёт_Пример.docx):
// банковская шапка получателя (ИП Шиманский), Исполнитель/Заказчик,
// таблица позиций, «Итого (без НДС)», условия оферты, подписи.
// Генерируется on-the-fly, файлы не хранятся.
//
// Шрифт PT Sans (OFL 1.1) — встроенные шрифты pdfkit кириллицу не умеют.
// Буфер шрифта передаётся в конструктор PDFDocument как дефолтный, чтобы
// pdfkit не читал AFM-данные Helvetica (проблема standalone-трейсинга).

import fs from "fs"
import path from "path"
import PDFDocument from "pdfkit"
import { EXECUTOR } from "./requisites"

export interface InvoicePdfData {
  number: string
  /** Дата выставления счёта (createdAt) */
  issueDate: Date
  periodStart: Date
  periodEnd: Date
  amount: number
  periodMonths: number
  branchCount: number
  customer: {
    /** Юрлицо (legalName) или название организации */
    legalName: string
    inn: string
  }
}

// Формулировка услуги — как в реальном счёте ИП Шиманского
const SERVICE_NAME =
  process.env.BILLING_SERVICE_NAME ||
  "Разработка, адаптации и модификации программных продуктов, баз данных, " +
    "а также работы по установке, тестированию и сопровождению данных программных продуктов"

let _fonts: { regular: Buffer; bold: Buffer } | null = null

function loadFonts() {
  if (_fonts) return _fonts
  const dir = path.join(process.cwd(), "public", "fonts")
  _fonts = {
    regular: fs.readFileSync(path.join(dir, "PTSans-Regular.ttf")),
    bold: fs.readFileSync(path.join(dir, "PTSans-Bold.ttf")),
  }
  return _fonts
}

const fmtDate = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`

const fmtMoney = (n: number) =>
  n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const fonts = loadFonts()

  return new Promise<Buffer>((resolve, reject) => {
    // font: Buffer — дефолтный шрифт с кириллицей вместо Helvetica (AFM)
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      font: fonts.regular as unknown as string,
      info: { Title: `Счёт-договор оферты №${data.number}` },
    })
    doc.registerFont("PT", fonts.regular)
    doc.registerFont("PT-Bold", fonts.bold)

    const chunks: Buffer[] = []
    doc.on("data", (c: Buffer) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)

    const x0 = 40
    const W = 515 // ширина контента A4 при полях 40

    // --- Банковская шапка получателя ---
    const leftW = 300
    const labW = 55
    const valW = W - leftW - labW

    const cellText = (
      text: string,
      x: number,
      y: number,
      w: number,
      opts: { bold?: boolean; size?: number; color?: string } = {}
    ) => {
      doc
        .font(opts.bold ? "PT-Bold" : "PT")
        .fontSize(opts.size ?? 9)
        .fillColor(opts.color ?? "#000")
        .text(text, x + 4, y, { width: w - 8 })
    }

    let y = doc.y
    const rowHeights = [30, 22, 46]
    const rows: Array<{ left: () => void; label: string; value: string }> = [
      {
        left: () => {
          cellText(EXECUTOR.bankName, x0, y + 4, leftW, { bold: true })
          cellText("Банк получателя", x0, y + 17, leftW, { size: 7, color: "#555" })
        },
        label: "БИК",
        value: EXECUTOR.bik,
      },
      {
        left: () => {
          cellText(`ИНН ${EXECUTOR.inn}        КПП —`, x0, y + 6, leftW)
        },
        label: "к/с",
        value: EXECUTOR.corrAccount,
      },
      {
        left: () => {
          cellText(EXECUTOR.name, x0, y + 4, leftW)
          cellText("Получатель", x0, y + 33, leftW, { size: 7, color: "#555" })
        },
        label: "р/с",
        value: EXECUTOR.account,
      },
    ]

    for (let i = 0; i < rows.length; i++) {
      const h = rowHeights[i]
      const r = rows[i]
      doc.rect(x0, y, leftW, h).stroke()
      doc.rect(x0 + leftW, y, labW, h).stroke()
      doc.rect(x0 + leftW + labW, y, valW, h).stroke()
      r.left()
      cellText(r.label, x0 + leftW, y + (h - 11) / 2, labW)
      cellText(r.value, x0 + leftW + labW, y + (h - 11) / 2, valW)
      y += h
    }

    // --- Заголовок ---
    y += 18
    doc
      .font("PT-Bold")
      .fontSize(12)
      .fillColor("#000")
      .text(
        `Счет-договор оферты от ${fmtDate(data.issueDate)} №${data.number} на оказание услуг`,
        x0,
        y,
        { width: W, align: "center" }
      )
    y = doc.y + 14

    // --- Стороны ---
    doc.font("PT").fontSize(9)
    doc.text(
      `Исполнитель: ${EXECUTOR.name} ИНН ${EXECUTOR.inn} ОГРНИП ${EXECUTOR.ogrnip}, адрес: ${EXECUTOR.address}`,
      x0,
      y,
      { width: W }
    )
    y = doc.y + 8
    doc.text(`Заказчик: ${data.customer.legalName}, ИНН ${data.customer.inn}`, x0, y, {
      width: W,
    })
    y = doc.y + 14

    // --- Таблица позиций ---
    const cols = [
      { title: "N п/п", w: 34, align: "center" as const },
      { title: "Наименование услуги", w: 261, align: "left" as const },
      { title: "Кол-во", w: 40, align: "center" as const },
      { title: "Ед.", w: 30, align: "center" as const },
      { title: "Цена", w: 75, align: "right" as const },
      { title: "Сумма", w: 75, align: "right" as const },
    ]

    const drawRow = (cells: string[], opts: { bold?: boolean } = {}) => {
      doc.font(opts.bold ? "PT-Bold" : "PT").fontSize(9)
      let h = 18
      cells.forEach((text, i) => {
        const th = doc.heightOfString(text, { width: cols[i].w - 8 }) + 10
        if (th > h) h = th
      })
      let x = x0
      cells.forEach((text, i) => {
        doc.rect(x, y, cols[i].w, h).stroke()
        doc.text(text, x + 4, y + 5, { width: cols[i].w - 8, align: cols[i].align })
        x += cols[i].w
      })
      y += h
    }

    drawRow(cols.map((c) => c.title), { bold: true })
    const monthlyPrice = data.amount / data.periodMonths
    drawRow([
      "1",
      SERVICE_NAME,
      String(data.periodMonths),
      "мес",
      fmtMoney(monthlyPrice),
      fmtMoney(data.amount),
    ])

    // Итого (без НДС)
    doc.font("PT-Bold").fontSize(9)
    const totalLabelW = W - cols[cols.length - 1].w
    const totalH = 18
    doc.rect(x0, y, totalLabelW, totalH).stroke()
    doc.rect(x0 + totalLabelW, y, cols[cols.length - 1].w, totalH).stroke()
    doc.text("Итого (без НДС)", x0 + 4, y + 5, { width: totalLabelW - 8, align: "right" })
    doc.text(fmtMoney(data.amount), x0 + totalLabelW + 4, y + 5, {
      width: cols[cols.length - 1].w - 8,
      align: "right",
    })
    y += totalH + 16

    // --- Условия оферты ---
    doc.font("PT-Bold").fontSize(9).text("Основные условия:", x0, y, { width: W })
    y = doc.y + 4
    doc.font("PT").fontSize(9)
    const terms = [
      `1. Услуги оказываются Исполнителем в период с ${fmtDate(data.periodStart)} до ${fmtDate(data.periodEnd)}`,
      "2. Оплата услуг Заказчиком по данному счету-договору оферты означает его согласие с условиями настоящего счета-договора оферты и производится Заказчиком не позднее начала оказания услуг.",
      "3. В случае, если в течении тридцати календарных дней с момента истечения срока, указанного в п.1 настоящего Счета-Договора оферты, Исполнитель не получил претензий Заказчика, связанных с оказанием услуг, то считается что обязанности Исполнителя исполнены в полном объеме и надлежащим образом.",
    ]
    for (const t of terms) {
      doc.text(t, x0, y, { width: W })
      y = doc.y + 4
    }

    // Подсказка для автоматической сверки оплаты по выписке
    y += 6
    doc
      .fontSize(8)
      .fillColor("#555")
      .text(
        `При оплате укажите в назначении платежа: «Оплата по счету-договору оферты №${data.number}»`,
        x0,
        y,
        { width: W }
      )
    y = doc.y + 24

    // --- Подписи ---
    doc.font("PT-Bold").fontSize(9).fillColor("#000").text("Подписи сторон:", x0, y, { width: W })
    y = doc.y + 18
    const half = W / 2
    doc.font("PT").fontSize(9)
    doc.text(`_________________ ${data.customer.legalName}`, x0, y, { width: half - 10 })
    doc.text(`_________________ ${EXECUTOR.shortName}`, x0 + half, y, { width: half - 10 })
    doc
      .fontSize(7)
      .fillColor("#555")
      .text("Заказчик", x0, y + 14, { width: half - 10 })
      .text("Исполнитель", x0 + half, y + 14, { width: half - 10 })

    doc.end()
  })
}
