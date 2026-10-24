-- ============================================================================
-- Seed (lokal / sinov): namuna firma, 3 obyekt va materiallar shabloni.
-- Auth foydalanuvchilari yo'q (Batch 2). Triggerlar ishlaydi: auth.uid() null →
-- created_by null, audit_log.device = 'tizim'. Qayta ishga tushirish xavfsiz.
-- ============================================================================

insert into public.companies (id, name)
values ('5eed0000-0000-4000-8000-000000000001', 'Namuna Qurilish MChJ')
on conflict (id) do nothing;

insert into public.objects (id, company_id, name, address)
values
  ('5eed0000-0000-4000-8000-000000000101', '5eed0000-0000-4000-8000-000000000001',
   'Yunusobod turar-joy majmuasi', 'Toshkent sh., Yunusobod tumani'),
  ('5eed0000-0000-4000-8000-000000000102', '5eed0000-0000-4000-8000-000000000001',
   'Chilonzor maktab binosi', 'Toshkent sh., Chilonzor tumani'),
  ('5eed0000-0000-4000-8000-000000000103', '5eed0000-0000-4000-8000-000000000001',
   'Sergeli savdo markazi', 'Toshkent sh., Sergeli tumani')
on conflict (id) do nothing;

select private.apply_material_template('5eed0000-0000-4000-8000-000000000001');
