"use client"

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AddWardForm } from "./add-ward-form"

interface Ward {
  id: string
  firstName: string
  lastName: string | null
  birthDate: string | null // ISO string
}

function calculateAge(birthDate: string): string {
  const birth = new Date(birthDate)
  const now = new Date()
  let years = now.getFullYear() - birth.getFullYear()
  const monthDiff = now.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    years--
  }
  // Склонение "лет/год/года"
  const mod10 = years % 10
  const mod100 = years % 100
  if (mod100 >= 11 && mod100 <= 19) return `${years} лет`
  if (mod10 === 1) return `${years} год`
  if (mod10 >= 2 && mod10 <= 4) return `${years} года`
  return `${years} лет`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export function ClientTabs({
  clientId,
  wards,
}: {
  clientId: string
  wards: Ward[]
}) {
  return (
    <Tabs defaultValue="wards">
      <TabsList variant="line">
        <TabsTrigger value="wards">Подопечные</TabsTrigger>
        <TabsTrigger value="subscriptions">Абонементы</TabsTrigger>
        <TabsTrigger value="payments">Оплаты</TabsTrigger>
        <TabsTrigger value="attendance">Посещения</TabsTrigger>
        <TabsTrigger value="history">История</TabsTrigger>
      </TabsList>

      <TabsContent value="wards">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Подопечные ({wards.length})
              </CardTitle>
              <AddWardForm clientId={clientId} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {wards.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Подопечные не указаны
              </p>
            ) : (
              wards.map((w) => {
                const name = [w.firstName, w.lastName].filter(Boolean).join(" ")
                return (
                  <div
                    key={w.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <span className="font-medium">{name}</span>
                    <span className="text-sm text-muted-foreground">
                      {w.birthDate
                        ? `${formatDate(w.birthDate)} (${calculateAge(w.birthDate)})`
                        : "Дата рождения не указана"}
                    </span>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="subscriptions">
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Будет в модуле 5
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="payments">
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Будет в модуле 6
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="attendance">
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Будет в модуле 5
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="history">
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Будет позже
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
