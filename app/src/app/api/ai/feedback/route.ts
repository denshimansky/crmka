import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/ai/feedback — оценка ответа AI-ассистента («был ли ответ полезен»).
 * body: { logId, feedback: "like" | "dislike" | null } — null снимает оценку.
 * Пишется в ai_chat_logs.feedback; разбор дизлайков — выборкой через SQL
 * (WHERE feedback = 'dislike'), UI нет.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const tenantId = (session.user as any).tenantId

  const body = await req.json()
  const logId = body.logId
  const feedback = body.feedback
  if (typeof logId !== "string" || !UUID_RE.test(logId)) {
    return NextResponse.json({ error: "Некорректный logId" }, { status: 400 })
  }
  if (feedback !== "like" && feedback !== "dislike" && feedback !== null) {
    return NextResponse.json({ error: "Некорректная оценка" }, { status: 400 })
  }

  // updateMany с tenantId — проверка владения (изоляция на уровне приложения).
  const { count } = await db.aiChatLog.updateMany({
    where: { id: logId, tenantId },
    data: { feedback },
  })
  if (count === 0) {
    return NextResponse.json({ error: "Диалог не найден" }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
