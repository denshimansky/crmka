import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const wardId = searchParams.get("wardId")
  const directionId = searchParams.get("directionId")
  const branchId = searchParams.get("branchId")

  if (!wardId || !directionId || !branchId) {
    return NextResponse.json({ duplicates: [] })
  }

  const duplicates = await db.application.findMany({
    where: {
      tenantId: session.user.tenantId,
      wardId,
      directionId,
      branchId,
      status: "active",
      deletedAt: null,
    },
    select: {
      id: true,
      createdAt: true,
      comment: true,
      direction: { select: { name: true } },
      branch: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  })

  return NextResponse.json({
    duplicates: duplicates.map((d) => ({
      id: d.id,
      createdAt: d.createdAt.toISOString(),
      comment: d.comment,
      directionName: d.direction.name,
      branchName: d.branch.name,
    })),
  })
}
