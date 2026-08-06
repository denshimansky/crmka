import { getMonthFromParams } from "@/lib/month-params"
import { InstructorDetailClient } from "./instructor-detail-client"

export default async function InstructorSalaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { employeeId } = await params
  const sp = await searchParams
  const { year, month } = getMonthFromParams(sp)
  const kind = sp.kind === "salary" ? "salary" : sp.kind === "piece" ? "piece" : undefined
  return <InstructorDetailClient employeeId={employeeId} year={year} month={month} kind={kind} />
}
