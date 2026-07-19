import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Phone, MessageCircle, Send } from "lucide-react"
import type { BranchContacts } from "@/lib/portal-data"

// Карточка «Связь с филиалом»: крупные кнопки только для заполненных контактов.

export function BranchContactsCard({ branches }: { branches: BranchContacts[] }) {
  const withContacts = branches.filter(
    (b) => b.contactPhone || b.contactWhatsapp || b.contactTelegram || b.contactMax
  )
  if (withContacts.length === 0) return null

  return (
    <>
      {withContacts.map((branch) => (
        <Card key={branch.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Связь с филиалом «{branch.name}»
            </CardTitle>
            {branch.address && <p className="text-xs text-muted-foreground">{branch.address}</p>}
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {branch.contactPhone && (
              <ContactButton href={`tel:${branch.contactPhone.replace(/[^\d+]/g, "")}`}>
                <Phone className="size-4" />
                Позвонить
              </ContactButton>
            )}
            {branch.contactWhatsapp && (
              <ContactButton href={branch.contactWhatsapp}>
                <MessageCircle className="size-4" />
                WhatsApp
              </ContactButton>
            )}
            {branch.contactTelegram && (
              <ContactButton href={branch.contactTelegram}>
                <Send className="size-4" />
                Telegram
              </ContactButton>
            )}
            {branch.contactMax && (
              <ContactButton href={branch.contactMax}>
                <MessageCircle className="size-4" />
                MAX
              </ContactButton>
            )}
          </CardContent>
        </Card>
      ))}
    </>
  )
}

function ContactButton({ href, children }: { href: string; children: React.ReactNode }) {
  const external = !href.startsWith("tel:")
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm font-medium hover:bg-muted"
    >
      {children}
    </a>
  )
}
