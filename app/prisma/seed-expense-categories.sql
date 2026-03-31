-- Seed: 14 системных категорий расходов (идемпотентный)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM expense_categories WHERE is_system = true LIMIT 1) THEN
    INSERT INTO expense_categories (id, name, is_salary, is_variable, is_system, is_active, sort_order, created_at)
    VALUES
      (gen_random_uuid(), 'Аренда', false, false, true, true, 1, NOW()),
      (gen_random_uuid(), 'Коммунальные услуги', false, false, true, true, 2, NOW()),
      (gen_random_uuid(), 'Зарплата инструкторов', true, true, true, true, 3, NOW()),
      (gen_random_uuid(), 'Зарплата администраторов', true, false, true, true, 4, NOW()),
      (gen_random_uuid(), 'Зарплата управляющего', true, false, true, true, 5, NOW()),
      (gen_random_uuid(), 'Маркетинг и реклама', false, false, true, true, 6, NOW()),
      (gen_random_uuid(), 'Канцтовары и расходники', false, true, true, true, 7, NOW()),
      (gen_random_uuid(), 'Оборудование', false, false, true, true, 8, NOW()),
      (gen_random_uuid(), 'Связь и интернет', false, false, true, true, 9, NOW()),
      (gen_random_uuid(), 'Бухгалтерия', false, false, true, true, 10, NOW()),
      (gen_random_uuid(), 'Налоги и взносы', false, false, true, true, 11, NOW()),
      (gen_random_uuid(), 'Хозяйственные расходы', false, false, true, true, 12, NOW()),
      (gen_random_uuid(), 'Обучение персонала', false, false, true, true, 13, NOW()),
      (gen_random_uuid(), 'Прочие расходы', false, false, true, true, 14, NOW());
    RAISE NOTICE 'Expense categories seeded';
  ELSE
    RAISE NOTICE 'Expense categories already exist';
  END IF;
END $$;
