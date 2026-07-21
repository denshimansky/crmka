import { NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import { resolveStoredPath, contentTypeForFilename } from "@/lib/kb-uploads"

// GET /api/kb/media/[filename] — отдаёт загруженное фото базы знаний.
// Публичный read (продуктовая справка, не чувствительные данные): картинки
// грузятся браузером и в читалке (сессия NextAuth), и в редакторе (cookie
// admin-token) — единый публичный эндпоинт снимает проблему двух контекстов.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params

  const filePath = resolveStoredPath(filename)
  if (!filePath) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let buffer: Buffer
  try {
    buffer = await fs.readFile(filePath)
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentTypeForFilename(filename),
      "Content-Length": String(buffer.length),
      // Имя контент-адресное (uuid) — можно кэшировать бессрочно.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })
}
