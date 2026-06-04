"use client"

import { Button } from "@/components/ui/button"
import { DialogTrigger } from "@/components/ui/dialog"
import { Plus } from "lucide-react"
import { CreateClientDialog } from "@/app/(dashboard)/crm/clients/create-client-dialog"

/**
 * Плавающая кнопка «Новый лид» в правом нижнем углу (на главной и в воронке).
 * Открывает ту же форму, что и «Новый клиент» — пользователь видит идентичный
 * набор полей и валидацию (телефон ИЛИ соцсеть обязательны).
 *
 * Отличия от обычной кнопки «Клиент» в /crm/clients:
 *  - кастомный плавающий триггер
 *  - заголовок «Новый лид»
 *  - после создания — переход в карточку нового клиента
 */
export function QuickLeadButton() {
  return (
    <CreateClientDialog
      title="Новый лид"
      description="Заполните данные лида. Телефон или соцсеть обязательны."
      submitLabel="Создать лида"
      redirectAfterCreate
      trigger={
        <DialogTrigger
          render={
            <Button
              size="lg"
              className="fixed bottom-24 right-6 z-50 rounded-full shadow-lg h-14 px-6 gap-2"
            />
          }
        >
          <Plus className="size-5" />
          Новый лид
        </DialogTrigger>
      }
    />
  )
}
