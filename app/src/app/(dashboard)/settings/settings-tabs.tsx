"use client"

import { type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

/**
 * Вкладки настроек с сохранением активной вкладки в URL (?tab=org|personnel).
 * Без этого при переходе в подстраницу настроек и возврате «назад» (кнопка мыши
 * или браузера) вкладка сбрасывалась на дефолтную «Организация» — теперь
 * возврат ведёт на ту вкладку, с которой ушли.
 *
 * Контент вкладок приходит уже отрендеренным с сервера (плитки зависят от роли),
 * поэтому передаём его как ReactNode-слоты — иконки-компоненты не пересекают
 * границу сервер/клиент.
 */
export function SettingsTabs({
  orgContent,
  personnelContent,
}: {
  orgContent: ReactNode
  personnelContent: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = searchParams.get("tab") === "personnel" ? "personnel" : "org"

  function onTabChange(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === "org") params.delete("tab")
    else params.set("tab", value)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <Tabs value={tab} onValueChange={onTabChange}>
      <TabsList>
        <TabsTrigger value="org">Организация</TabsTrigger>
        <TabsTrigger value="personnel">Персональные</TabsTrigger>
      </TabsList>

      <TabsContent value="org">{orgContent}</TabsContent>
      <TabsContent value="personnel">{personnelContent}</TabsContent>
    </Tabs>
  )
}
