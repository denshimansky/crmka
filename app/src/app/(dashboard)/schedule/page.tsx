"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { demoSchedule } from "@/lib/demo-data"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"

const rooms = ["Зал 1", "Зал 2", "Кабинет 3"]
const days = ["Пн 24", "Вт 25", "Ср 26", "Чт 27", "Пт 28", "Сб 29"]

export default function SchedulePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Расписание</h1>
        <Button><Plus className="mr-2 size-4" />Занятие</Button>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon"><ChevronLeft className="size-4" /></Button>
          <span className="text-sm font-medium">24–29 марта 2026</span>
          <Button variant="outline" size="icon"><ChevronRight className="size-4" /></Button>
        </div>
        <div className="flex gap-1">
          {["По кабинетам", "По педагогам", "По направлениям", "Список"].map((v, i) => (
            <Button key={v} variant={i === 0 ? "default" : "outline"} size="sm">{v}</Button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[120px_repeat(6,1fr)] gap-px bg-border">
            <div className="bg-background p-2" />
            {days.map((day) => (
              <div key={day} className="bg-background p-2 text-center text-sm font-medium">{day}</div>
            ))}

            {rooms.map((room, ri) => (
              <>
                <div key={room} className="bg-background p-2 text-sm font-medium text-muted-foreground">{room}</div>
                {days.map((_, di) => {
                  const lessons = demoSchedule.filter((l) => l.day === di && l.room === ri)
                  return (
                    <div key={`${ri}-${di}`} className="min-h-[100px] bg-background p-1 space-y-1">
                      {lessons.map((lesson, li) => (
                        <Card key={li} className={`cursor-pointer border p-2 text-xs ${lesson.color} hover:opacity-80`}>
                          <div className="font-bold">{lesson.time}</div>
                          <div className="font-medium">{lesson.name}</div>
                          <div className="opacity-70">{lesson.instructor}</div>
                          <div className="mt-1 flex items-center justify-between">
                            <span>{lesson.students}/{lesson.capacity}</span>
                            {lesson.students / lesson.capacity > 0.8 && (
                              <Badge variant="destructive" className="h-4 px-1 text-[10px]">!</Badge>
                            )}
                          </div>
                        </Card>
                      ))}
                    </div>
                  )
                })}
              </>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
