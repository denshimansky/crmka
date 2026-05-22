import { redirect } from "next/navigation"

export default function LeadsRedirect() {
  redirect("/crm/contacts?tab=leads")
}
