"use client"

// Ссылка-кнопка «Скачать шаблон остатков» для Шага 3. Клиентский компонент,
// потому что buttonVariants живёт в «use client»-модуле button.tsx — вызывать его
// в серверном page.tsx нельзя (client-reference). Поведение статическое: <a download>.
import { buttonVariants } from "@/components/ui/button"
import { Download } from "lucide-react"
import { BALANCES_TEMPLATE_HREF, BALANCES_TEMPLATE_FILENAME } from "./template-meta"

export function DownloadBalancesTemplateLink() {
  return (
    <a
      href={BALANCES_TEMPLATE_HREF}
      download={BALANCES_TEMPLATE_FILENAME}
      className={buttonVariants({ variant: "outline" })}
    >
      <Download className="size-4" />
      Скачать шаблон остатков
    </a>
  )
}
