"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EditExpenseDialog } from "./edit-expense-dialog"

type RecognitionMode = "by_payment_date" | "single_period" | "amortized" | "not_in_pnl"

interface ExpenseRow {
  id: string
  categoryId: string
  categoryName: string
  accountId: string
  accountName: string
  amount: number
  date: string
  comment: string | null
  isRecurring: boolean
  isVariable: boolean
  recognitionMode: RecognitionMode
  amortizationMonths: number | null
  amortizationStartDate: string | null
  branchNames: string[]
  branchIds: string[]
  directionId: string | null
  directionName: string | null
  leadChannelId: string | null
  leadChannelName: string | null
}

interface CategoryOption {
  id: string
  name: string
  isVariable: boolean
}

interface AccountOption {
  id: string
  name: string
}

interface BranchOption {
  id: string
  name: string
}

interface DirectionOption {
  id: string
  name: string
  branchIds: string[]
}

interface LeadChannelOption {
  id: string
  name: string
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export function ExpensesTable({
  expenses,
  categories,
  accounts,
  branches,
  directions,
  leadChannels,
}: {
  expenses: ExpenseRow[]
  categories: CategoryOption[]
  accounts: AccountOption[]
  branches: BranchOption[]
  directions: DirectionOption[]
  leadChannels: LeadChannelOption[]
}) {
  const [editingExpense, setEditingExpense] = useState<ExpenseRow | null>(null)

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Дата</TableHead>
              <TableHead>Статья</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
              <TableHead>Филиал</TableHead>
              <TableHead>Направление</TableHead>
              <TableHead>Канал</TableHead>
              <TableHead>Счёт</TableHead>
              <TableHead>ОПИУ</TableHead>
              <TableHead>Комментарий</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.map((exp) => (
              <TableRow
                key={exp.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setEditingExpense(exp)}
              >
                <TableCell className="text-muted-foreground">{formatDate(exp.date)}</TableCell>
                <TableCell className="font-medium">
                  {exp.categoryName}
                  {exp.isRecurring && (
                    <Badge variant="outline" className="ml-2 text-xs">повтор</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right font-medium text-red-600">
                  {formatMoney(exp.amount)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {exp.branchNames.length > 0 ? exp.branchNames.join(", ") : "Все"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {exp.directionName ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {exp.leadChannelName ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">{exp.accountName}</TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {exp.recognitionMode === "not_in_pnl"
                    ? "Не в финрезе"
                    : exp.recognitionMode === "single_period" && exp.amortizationStartDate
                    ? `1 мес. с ${formatDate(exp.amortizationStartDate)}`
                    : exp.recognitionMode === "amortized" && exp.amortizationMonths && exp.amortizationStartDate
                      ? `${exp.amortizationMonths} мес. с ${formatDate(exp.amortizationStartDate)}`
                      : "По дате платежа"}
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-muted-foreground">
                  {exp.comment || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editingExpense && (
        <EditExpenseDialog
          expense={{
            id: editingExpense.id,
            categoryId: editingExpense.categoryId,
            accountId: editingExpense.accountId,
            amount: editingExpense.amount,
            date: editingExpense.date,
            comment: editingExpense.comment,
            isRecurring: editingExpense.isRecurring,
            recognitionMode: editingExpense.recognitionMode,
            amortizationMonths: editingExpense.amortizationMonths,
            amortizationStartDate: editingExpense.amortizationStartDate,
            branchIds: editingExpense.branchIds,
            directionId: editingExpense.directionId,
            leadChannelId: editingExpense.leadChannelId,
          }}
          categories={categories}
          accounts={accounts}
          branches={branches}
          directions={directions}
          leadChannels={leadChannels}
          open={!!editingExpense}
          onOpenChange={(v) => { if (!v) setEditingExpense(null) }}
        />
      )}
    </>
  )
}
