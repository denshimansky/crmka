import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { canEditKb } from "@/lib/kb"
import { KB_ALLOWED_MIME, KB_MAX_UPLOAD_BYTES, saveUpload } from "@/lib/kb-uploads"

// POST /api/admin/kb/upload — загрузка фото для блока-изображения.
// Пишет файл на том kb-uploads, регистрирует в KbAsset, возвращает URL отдачи.
export async function POST(req: NextRequest) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canEditKb(admin)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  if (!file) return NextResponse.json({ error: "Файл не выбран" }, { status: 400 })

  const mime = file.type
  if (!KB_ALLOWED_MIME[mime]) {
    return NextResponse.json({ error: "Разрешены только JPG, PNG, WebP или GIF" }, { status: 400 })
  }
  if (file.size > KB_MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Файл слишком большой (макс. 5 МБ)" }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const filename = await saveUpload(buffer, mime)
  if (!filename) return NextResponse.json({ error: "Не удалось сохранить файл" }, { status: 400 })

  await db.kbAsset.create({
    data: { filename, mimeType: mime, size: file.size, createdBy: admin.adminId },
  })

  return NextResponse.json({ url: `/api/kb/media/${filename}`, filename }, { status: 201 })
}
