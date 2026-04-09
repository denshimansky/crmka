"use client"

import { Button } from "@/components/ui/button"
import { Printer } from "lucide-react"

export function SchedulePrintButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()}>
      <Printer className="mr-1 size-4" />
      Печать
    </Button>
  )
}
