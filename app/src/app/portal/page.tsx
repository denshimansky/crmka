import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { ensurePortalSlug } from "@/lib/portal-slug"

// Legacy-вход по магической ссылке (/portal?token=...) отключён: кабинет
// переехал на /p/<slug> с логином/паролем. Старые ссылки редиректим на форму
// входа центра (по токену определяем тенант); автологина нет — осознанно.
// Страница и таблица client_portal_tokens удаляются в релизе 2.

export default async function LegacyPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  if (token) {
    const portalToken = await db.clientPortalToken.findUnique({
      where: { token },
      select: { tenantId: true },
    })
    if (portalToken) {
      const slug = await ensurePortalSlug(portalToken.tenantId).catch(() => null)
      if (slug) redirect(`/p/${slug}?from=legacy`)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-bold">Личный кабинет переехал</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Вход по ссылке больше не работает. Теперь в кабинет входят по телефону и паролю на
        странице вашего центра — логин и пароль выдаёт администратор.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Обратитесь в ваш центр, чтобы получить доступ.
      </p>
    </div>
  )
}
