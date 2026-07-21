import { getAdminSession } from "@/lib/admin-auth"
import { parseDialogRange, fetchDialogs, buildDialogsMarkdown } from "@/lib/ai-review"

// GET /api/admin/ai-review/export?from=YYYY-MM-DD&to=YYYY-MM-DD&onlyDisliked=1
// Выгрузка диалогов ИИ за период в Markdown-файл (attachment) — на разбор в чат.
export async function GET(req: Request) {
  const admin = await getAdminSession()
  if (!admin) return new Response("Unauthorized", { status: 401 })

  const { searchParams } = new URL(req.url)
  const range = parseDialogRange(searchParams)
  const dialogs = await fetchDialogs(range)
  const md = buildDialogsMarkdown(dialogs, range)

  const fromS = range.from.toISOString().slice(0, 10)
  const toS = range.to.toISOString().slice(0, 10)
  const filename = `ai-dialogs-${fromS}_${toS}.md`

  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
