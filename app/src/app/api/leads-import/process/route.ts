import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { processLeads } from "@/lib/leads-import/process-leads"

export const runtime = "nodejs"
export const maxDuration = 60

// POST /api/leads-import/process — этап 1: сырой xlsx из 1С → промежуточный xlsx
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Только владелец может выполнять импорт" }, { status: 403 })
  }

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  if (!file) {
    return NextResponse.json({ error: "Файл не выбран" }, { status: 400 })
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json({ error: "Ожидается файл .xlsx" }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  let result
  try {
    result = processLeads(buffer)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        error: "Найдены проблемные строки: статус «Лид» вместе с другим статусом. Поправьте источник и попробуйте снова.",
        conflicts: result.conflicts,
      },
      { status: 409 },
    )
  }

  const fileName = encodeURIComponent(result.fileName)
  return new NextResponse(new Uint8Array(result.fileBuffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="leads-import.xlsx"; filename*=UTF-8''${fileName}`,
      "X-Import-Stats": Buffer.from(JSON.stringify(result.stats)).toString("base64"),
    },
  })
}
