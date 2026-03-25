export const demoOrg = {
  name: "Детский центр «Радуга»",
  branch: "Филиал на Ленина",
}

export const dashboardStats = {
  activeStudents: 87,
  activeSubscriptions: 94,
  monthRevenue: 892_400,
  monthExpenses: 341_200,
  trialScheduled: 12,
  debtors: 8,
  debtAmount: 47_600,
  unmarkedLessons: 3,
  tasksToday: 5,
  newLeads: 14,
  conversionRate: 68,
  churnRate: 4.2,
}

export const demoClients = [
  { id: "1", name: "Иванова Мария", phone: "+7 (999) 123-45-67", email: "ivanova@mail.ru", status: "active" as const, segment: "VIP", children: ["Аня (8 лет)", "Миша (5 лет)"], balance: 4200, subscriptions: 22 },
  { id: "2", name: "Петров Алексей", phone: "+7 (999) 234-56-78", email: "petrov@gmail.com", status: "active" as const, segment: "Постоянный", children: ["Даша (6 лет)"], balance: 0, subscriptions: 15 },
  { id: "3", name: "Сидорова Елена", phone: "+7 (999) 345-67-89", email: "sidorova@ya.ru", status: "active" as const, segment: "Стандарт", children: ["Коля (7 лет)"], balance: -2400, subscriptions: 6 },
  { id: "4", name: "Козлов Дмитрий", phone: "+7 (999) 456-78-90", email: null, status: "lead" as const, segment: "Новый", children: ["Вика (4 года)"], balance: 0, subscriptions: 0 },
  { id: "5", name: "Морозова Анна", phone: "+7 (999) 567-89-01", email: "morozova@mail.ru", status: "active" as const, segment: "Стандарт", children: ["Артём (9 лет)"], balance: 1800, subscriptions: 8 },
  { id: "6", name: "Волкова Ольга", phone: "+7 (999) 678-90-12", email: "volkova@ya.ru", status: "lead" as const, segment: "Новый", children: ["Соня (3 года)"], balance: 0, subscriptions: 0 },
  { id: "7", name: "Новикова Татьяна", phone: "+7 (999) 789-01-23", email: "novikova@gmail.com", status: "churned" as const, segment: "Стандарт", children: ["Максим (10 лет)"], balance: 0, subscriptions: 4 },
  { id: "8", name: "Соколова Ирина", phone: "+7 (999) 890-12-34", email: "sokolova@mail.ru", status: "active" as const, segment: "Постоянный", children: ["Лиза (6 лет)", "Ваня (8 лет)"], balance: 8400, subscriptions: 18 },
]

export const demoSchedule = [
  { day: 0, room: 0, time: "09:00", name: "Развивайка 3-4", instructor: "Петрова Н.", students: 8, capacity: 10, color: "bg-blue-100 border-blue-300 text-blue-800" },
  { day: 0, room: 0, time: "10:00", name: "Английский 5-6", instructor: "Сидоров А.", students: 6, capacity: 8, color: "bg-green-100 border-green-300 text-green-800" },
  { day: 0, room: 0, time: "16:00", name: "Подготовка к школе", instructor: "Иванова Т.", students: 10, capacity: 12, color: "bg-purple-100 border-purple-300 text-purple-800" },
  { day: 0, room: 1, time: "09:00", name: "Танцы 4-5", instructor: "Козлова М.", students: 12, capacity: 15, color: "bg-pink-100 border-pink-300 text-pink-800" },
  { day: 0, room: 1, time: "11:00", name: "Рисование 6-7", instructor: "Морозова О.", students: 7, capacity: 10, color: "bg-orange-100 border-orange-300 text-orange-800" },
  { day: 0, room: 2, time: "10:00", name: "Логопед", instructor: "Волкова Е.", students: 1, capacity: 1, color: "bg-teal-100 border-teal-300 text-teal-800" },
  { day: 1, room: 0, time: "09:00", name: "Развивайка 3-4", instructor: "Петрова Н.", students: 7, capacity: 10, color: "bg-blue-100 border-blue-300 text-blue-800" },
  { day: 1, room: 0, time: "16:00", name: "Шахматы 7-9", instructor: "Новиков Д.", students: 5, capacity: 8, color: "bg-amber-100 border-amber-300 text-amber-800" },
  { day: 1, room: 1, time: "10:00", name: "Танцы 4-5", instructor: "Козлова М.", students: 11, capacity: 15, color: "bg-pink-100 border-pink-300 text-pink-800" },
  { day: 1, room: 1, time: "16:00", name: "Карате 6-8", instructor: "Смирнов В.", students: 14, capacity: 15, color: "bg-red-100 border-red-300 text-red-800" },
  { day: 2, room: 0, time: "09:00", name: "Развивайка 3-4", instructor: "Петрова Н.", students: 9, capacity: 10, color: "bg-blue-100 border-blue-300 text-blue-800" },
  { day: 2, room: 0, time: "10:00", name: "Английский 5-6", instructor: "Сидоров А.", students: 5, capacity: 8, color: "bg-green-100 border-green-300 text-green-800" },
  { day: 2, room: 1, time: "09:00", name: "Танцы 4-5", instructor: "Козлова М.", students: 13, capacity: 15, color: "bg-pink-100 border-pink-300 text-pink-800" },
  { day: 2, room: 1, time: "11:00", name: "Рисование 6-7", instructor: "Морозова О.", students: 8, capacity: 10, color: "bg-orange-100 border-orange-300 text-orange-800" },
  { day: 3, room: 0, time: "16:00", name: "Подготовка к школе", instructor: "Иванова Т.", students: 11, capacity: 12, color: "bg-purple-100 border-purple-300 text-purple-800" },
  { day: 3, room: 1, time: "16:00", name: "Карате 6-8", instructor: "Смирнов В.", students: 13, capacity: 15, color: "bg-red-100 border-red-300 text-red-800" },
  { day: 4, room: 0, time: "09:00", name: "Развивайка 3-4", instructor: "Петрова Н.", students: 8, capacity: 10, color: "bg-blue-100 border-blue-300 text-blue-800" },
  { day: 4, room: 1, time: "10:00", name: "Танцы 4-5", instructor: "Козлова М.", students: 12, capacity: 15, color: "bg-pink-100 border-pink-300 text-pink-800" },
  { day: 5, room: 0, time: "10:00", name: "Мини-сад", instructor: "Петрова Н.", students: 6, capacity: 8, color: "bg-yellow-100 border-yellow-300 text-yellow-800" },
  { day: 5, room: 1, time: "10:00", name: "День рождения", instructor: "Козлова М.", students: 15, capacity: 15, color: "bg-pink-100 border-pink-300 text-pink-800" },
]

export const demoPayments = [
  { id: "1", date: "25.03.2026", client: "Иванова Мария", type: "Оплата абонемента", amount: 4800, method: "Наличные", subscription: "Развивайка (апрель)" },
  { id: "2", date: "25.03.2026", client: "Петров Алексей", type: "Оплата абонемента", amount: 3600, method: "Эквайринг", subscription: "Английский (апрель)" },
  { id: "3", date: "24.03.2026", client: "Соколова Ирина", type: "Оплата абонемента", amount: 9600, method: "Онлайн (ЮKassa)", subscription: "Танцы + Карате (апрель)" },
  { id: "4", date: "24.03.2026", client: "Морозова Анна", type: "Пробное занятие", amount: 500, method: "Наличные", subscription: "Рисование (пробное)" },
  { id: "5", date: "23.03.2026", client: "Козлов Дмитрий", type: "Пробное занятие", amount: 0, method: "—", subscription: "Развивайка (бесплатное пробное)" },
]

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}
