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
  const { year, month } = getMonthFromParams(await searchParams)
  return <InstructorDetailClient employeeId={employeeId} year={year} month={month} />
}
