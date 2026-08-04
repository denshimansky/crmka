"use client"

// Ссылка-кнопка «Скачать шаблон». Клиентский компонент, потому что buttonVariants
// живёт в «use client»-модуле button.tsx — вызывать его в серверном page.tsx нельзя
// (client-reference). Само по себе поведение статическое: <a download>.
import { buttonVariants } from "@/components/ui/button"
import { Download } from "lucide-react"
import { TEMPLATE_HREF, TEMPLATE_FILENAME } from "./template-meta"

export function DownloadTemplateLink() {
  return (
    <a
      href={TEMPLATE_HREF}
      download={TEMPLATE_FILENAME}
      className={buttonVariants({ variant: "outline" })}
    >
      <Download className="size-4" />
      Скачать шаблон
    </a>
  )
}
