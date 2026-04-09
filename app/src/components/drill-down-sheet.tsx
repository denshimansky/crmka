"use client"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface DrillDownData {
  columns: string[]
  rows: (string | number)[][]
}

interface DrillDownSheetProps {
  title: string
  description?: string
  isOpen: boolean
  onClose: () => void
  data: DrillDownData | null
  isLoading: boolean
}

function formatValue(val: string | number): string {
  if (typeof val === "number") {
    return new Intl.NumberFormat("ru-RU").format(Math.round(val)) + " ₽"
  }
  return String(val)
}

export function DrillDownSheet({
  title,
  description,
  isOpen,
  onClose,
  data,
  isLoading,
}: DrillDownSheetProps) {
  return (
    <Sheet open={isOpen} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent side="right" className="sm:max-w-xl w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>

        <div className="px-4 pb-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Загрузка...</p>
          ) : !data || data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Нет данных</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {data.columns.map((col, i) => (
                      <TableHead key={i} className={i === data.columns.length - 1 ? "text-right" : ""}>
                        {col}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row, i) => (
                    <TableRow key={i}>
                      {row.map((cell, j) => (
                        <TableCell
                          key={j}
                          className={j === row.length - 1 ? "text-right font-medium" : ""}
                        >
                          {j === row.length - 1 && typeof cell === "number"
                            ? formatValue(cell)
                            : String(cell)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
