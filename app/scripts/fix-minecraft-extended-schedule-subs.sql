-- Фикс данных msk1 (13.07.2026): группа «Майнкрафт ВтЧт 16-17 Мол Лето»
-- («Детский центр Dream», группа f24293a4-fdf9-4558-a697-6df8003a37a0).
--
-- Причина: 09.07 в 06:11 выписаны абонементы июля по расписанию, которое
-- заканчивалось 28.07 (7 занятий от даты старта 07.07). В тот же день в 14:16
-- группу продлили до 28.08 — появилось занятие 30.07 (8-е в диапазоне), но
-- totalLessons/суммы абонементов не пересчитались (фича дельта-пересчёта
-- recalc-on-schedule-change появилась только сейчас и на прошлое не действует).
--
-- Фикс: трём абонементам 7 → 8 занятий, 5250 → 6000 ₽, долг = 6000 − оплачено.
-- Скидок нет (discount_source='none', discount_amount=0) — формула прямая.
-- Затронутые: Разумная (pending, было balance 5250 → 6000),
--             Пантелеева (active, 0 → 750), Фахирова (active, 0 → 750).
--
-- Когорта проверена сканом: другие расхождения totalLessons ↔ расписание
-- на проде либо сознательная ручная выписка меньшего числа занятий
-- (added_after=0), либо демо-тенант «Умные дети» — их не трогаем.

DO $$
DECLARE n int;
BEGIN
  UPDATE subscriptions s SET
    total_lessons = 8,
    total_amount  = 6000.00,
    final_amount  = 6000.00,
    balance       = 6000.00 - COALESCE((
      SELECT sum(p.amount) FROM payments p
      WHERE p.subscription_id = s.id AND p.deleted_at IS NULL), 0),
    updated_at    = now()
  WHERE s.id IN (
      'd05bdaa6-316f-4076-861e-ddf4873d75ca', -- Разумная Лидия (pending)
      '5e983d37-2603-40b3-9b7e-ab4a9f4ec708', -- Пантелеева Ирина (active)
      '6acb7f11-5d63-4918-9a85-dd520860cf8b'  -- Фахирова Анастасия (active)
    )
    AND s.deleted_at IS NULL
    AND s.status IN ('pending', 'active')
    AND s.total_lessons = 7
    AND s.lesson_price = 750.00
    AND s.discount_source = 'none'
    AND s.discount_amount = 0;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 3 THEN
    RAISE EXCEPTION 'Ожидалось 3 строки, изменено % — откат', n;
  END IF;
END $$;

-- Проверка после применения
SELECT c.last_name, s.status, s.total_lessons, s.total_amount, s.final_amount, s.balance
FROM subscriptions s JOIN clients c ON c.id = s.client_id
WHERE s.group_id = 'f24293a4-fdf9-4558-a697-6df8003a37a0'
  AND s.period_year = 2026 AND s.period_month = 7
ORDER BY c.last_name;
