import path from "path"
import { promises as fs } from "fs"
import crypto from "crypto"

// Хранилище загруженных фото базы знаний.
// В Docker KB_UPLOAD_DIR = /app/uploads (том kb-uploads), локально — <cwd>/uploads.
// Файлы отдаются через /api/kb/media/[filename], пишутся через /api/admin/kb/upload.

export const KB_MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5 МБ

// Разрешённые типы → расширение файла на диске.
export const KB_ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
}

export function getUploadDir(): string {
  const dir = process.env.KB_UPLOAD_DIR?.trim()
  return dir && dir.length > 0 ? dir : path.join(process.cwd(), "uploads")
}

/**
 * Имя хранимого файла: <uuid>.<ext>. Только такие имена принимает отдача —
 * защита от path-traversal и подстановки произвольных путей.
 */
const STORED_NAME_RE = /^[a-f0-9-]{36}\.(jpg|png|webp|gif)$/

export function isValidStoredFilename(name: string): boolean {
  return STORED_NAME_RE.test(name)
}

export function makeStoredFilename(mime: string): string | null {
  const ext = KB_ALLOWED_MIME[mime]
  if (!ext) return null
  return `${crypto.randomUUID()}.${ext}`
}

/** Абсолютный путь к файлу по (уже провалидированному) имени. */
export function resolveStoredPath(filename: string): string | null {
  if (!isValidStoredFilename(filename)) return null
  return path.join(getUploadDir(), filename)
}

export function contentTypeForFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "jpg":
      return "image/jpeg"
    case "png":
      return "image/png"
    case "webp":
      return "image/webp"
    case "gif":
      return "image/gif"
    default:
      return "application/octet-stream"
  }
}

/** Записывает буфер новым файлом, возвращает имя. Каталог создаётся при отсутствии. */
export async function saveUpload(buffer: Buffer, mime: string): Promise<string | null> {
  const filename = makeStoredFilename(mime)
  if (!filename) return null
  const dir = getUploadDir()
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, filename), buffer)
  return filename
}
