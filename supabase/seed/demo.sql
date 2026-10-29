-- ============================================================================
-- Demo seed (Batch 11, docs/handoff-design.md → 3-bo'lim): alohida "Demo qurilish"
-- firmasi, 30 kunlik realistik ma'lumot. AVTOMATIK QO'LLANMAYDI — admin xohlasa
-- SQL Editor yoki psql orqali ishga tushiradi (docs/deploy-supabase.md).
--
-- Kafolatlar:
--   * Bitta tranzaksiya: xato bo'lsa hech narsa qolmaydi.
--   * Idempotent: firma (id de300000-…-0001) bor bo'lsa — hech narsa qilinmaydi
--     (NOTICE), takroriy qator yo'q.
--   * Boshqa firmalarga tegmaydi: har bir yozuv company_id = demo firma. Global
--     cron funksiyalari (evaluate_due_purchases, evaluate_cash_advances, …)
--     CHAQIRILMAYDI — faqat demo yozuvlari bo'yicha qoida funksiyalari.
--   * Profillar auth akkauntsiz (auth_user_id null, login_kind 'none').
--
-- Qanday ishlaydi:
--   * Triggerlar YOQIQ — ogohlantirishlar (alerts) va Telegram navbati
--     (notification_outbox) tabiiy hosil bo'ladi.
--   * Oddiy yozuvlar "tizim" kontekstida (JWT claims yo'q → auth.uid() null):
--     o'tgan sanalar bilan yozish mumkin (b_op_date cheklovi faqat foydalanuvchi
--     sessiyasida), created_by aniq beriladi, audit device = 'tizim'.
--   * Faqat foydalanuvchi sessiyasini talab qiladigan RPC'lar (create_transfer,
--     receive_transfer, submit_inventory_count) va admin qarorlari (so'rovni
--     tasdiqlash/rad etish, xato yozuvni o'chirish) uchun: 4 ta VAQTINCHALIK
--     auth.users qatori (de300000-…-0f01..0f04, email *@demo-seed.invalid)
--     demo admin, 2 prorab va tekshiruvchi profiliga bog'lanadi; testlardagi
--     kabi `request.jwt.claims` / `request.jwt.claim.sub` (tranzaksiya-lokal)
--     o'rnatiladi. Oxirida bog'lanish uziladi (login_kind 'none') va vaqtinchalik
--     auth.users qatorlari o'chiriladi. Natija: auth.users o'zgarmaydi.
--   * created_at / alerts.created_at — seed ishga tushgan vaqt (a_before_insert
--     server vaqtini qo'yadi); voqea sanalari — occurred_at, purchased_at,
--     issued_at, counted_at (30 kun ichida, Asia/Tashkent). Istisno: xaridlarda
--     created_at = purchased_at (8-bo'lim, qoida 1 kutishi).
--
-- Ataylab yaratilgan holatlar (ogohlantirishlar):
--   xarid_qabul_farqi   — Chilonzor, armatura 1,05 t xarid, 0,97 t qabul (−7,6 %);
--                         Yunusobod, shag'al 6 m³ xarid qilingan, qabul qilinmagan
--   narx_ogishi         — Chilonzor, Sement M400 76 000 so'm/qop (o'rtacha ~65 000)
--   ozi_qabul_qilgan    — Sergeli, prorab qumni o'zi xarid qilib o'zi qabul qilgan
--   normadan_oshish     — Chilonzor, g'isht sarfi smetadagi 16 000 donadan oshgan
--   manfiy_qoldiq       — Sergeli, beton: 10 m³ kirim, 12 m³ chiqim
--   inventarizatsiya_kamomadi — Yunusobod: sement −150 kg, armatura −35 kg
--   smetadan_ortiq_sorov — Sergeli, armatura 20 t so'rov (smetada qolgani kam)
--   sorovdan_ortiq_xarid — Yunusobod, 100 qop so'rov, 125 qop xarid (+25 %)
--   otkazma_farqi       — Yunusobod → Chilonzor 600 dona g'isht, 560 qabul
--   kirim_manbasiz      — Yunusobod, Sement M500 kirimi xaridsiz
--   takroriy_yozuv, yozuv_ochirildi — omborchi qum chiqimini ikki marta kiritgan,
--                         admin takrorini o'chirgan
--   joylashuv_farqi     — Sergeli, kirim obyektdan ~3 km uzoqda kiritilgan
--   chek_farqi          — Yunusobod, chekdagi summa 60 000 so'mga kam
-- Cron keyingi ishga tushganda tabiiy qo'shiladi: podotchet_muddati (ta'minotchi
-- puli 28 kundan beri ochiq), podotchet_manfiy (Sergeli prorabi), request_overdue
-- (kafel so'rovi muddati o'tgan).
-- ============================================================================

begin;

do $seed$
declare
  c          constant uuid := 'de300000-0000-4000-8000-000000000001';
  -- profillar
  p_admin    constant uuid := 'de300000-0000-4000-8000-000000000201';
  p_dir      constant uuid := 'de300000-0000-4000-8000-000000000202';
  p_bux      constant uuid := 'de300000-0000-4000-8000-000000000203';
  p_tam      constant uuid := 'de300000-0000-4000-8000-000000000204';
  p_pro1     constant uuid := 'de300000-0000-4000-8000-000000000205';
  p_pro2     constant uuid := 'de300000-0000-4000-8000-000000000206';
  p_omb1     constant uuid := 'de300000-0000-4000-8000-000000000207';
  p_omb2     constant uuid := 'de300000-0000-4000-8000-000000000208';
  p_hay      constant uuid := 'de300000-0000-4000-8000-000000000209';
  p_tek      constant uuid := 'de300000-0000-4000-8000-000000000210';
  -- vaqtinchalik auth foydalanuvchilar (oxirida o'chiriladi)
  u_admin    constant uuid := 'de300000-0000-4000-8000-000000000f01';
  u_pro1     constant uuid := 'de300000-0000-4000-8000-000000000f02';
  u_pro2     constant uuid := 'de300000-0000-4000-8000-000000000f03';
  u_tek      constant uuid := 'de300000-0000-4000-8000-000000000f04';
  -- obyektlar
  o1         constant uuid := 'de300000-0000-4000-8000-000000000101';
  o2         constant uuid := 'de300000-0000-4000-8000-000000000102';
  o3         constant uuid := 'de300000-0000-4000-8000-000000000103';
  v_obj      uuid[] := array[o1, o2, o3];
  v_pro      uuid[] := array[p_pro1, p_pro1, p_pro2];
  v_omb      uuid[] := array[p_omb1, p_omb2, p_omb2];
  v_lat      numeric[] := array[41.366123, 41.275634, 41.224087];
  v_lng      numeric[] := array[69.284512, 69.203178, 69.218850];

  v_today    date := (now() at time zone 'Asia/Tashkent')::date;
  v_cfg      jsonb;
  v_sup      jsonb;
  r          record;
  d          integer;
  o          integer;
  k          integer;
  v_mult     numeric;
  v_ts       timestamptz;
  v_qty      numeric;
  v_qty2     numeric;
  v_total    numeric;
  v_var      numeric;
  v_buyer    uuid;
  v_pid      uuid;
  v_mid      uuid;
  v_req      uuid;
  v_tr       uuid;
  v_cnt      uuid;
  v_dup      uuid;
  v_spent    numeric;
  -- material / birlik id'lari (maxsus holatlar uchun)
  m_sement   uuid;  m_m500 uuid;  m_gisht uuid;  m_qum uuid;  m_shagal uuid;
  m_arm      uuid;  m_beton uuid; m_kafel uuid;
  u_qop      uuid;  u_kg uuid;    u_m500kg uuid; u_dona uuid; u_poddon uuid;
  u_qum      uuid;  u_shagal uuid; u_tonna uuid; u_armkg uuid; u_beton uuid; u_kafel uuid;
begin
  if exists (select 1 from public.companies where id = c) then
    raise notice 'Demo qurilish allaqachon bor — seed o''tkazib yuborildi';
    return;
  end if;
  if exists (select 1 from auth.users where id in (u_admin, u_pro1, u_pro2, u_tek)) then
    raise exception 'demo seed: vaqtinchalik auth.users id band — seed to''xtatildi';
  end if;
  -- Tizim konteksti: oldindan qolgan claims bo'lmasin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.headers', '', true);

  -- ==========================================================================
  -- 1. Firma, katalog shabloni, xodimlar, obyektlar, sotuvchilar
  -- ==========================================================================
  insert into public.companies (id, name) values (c, 'Demo qurilish');
  perform private.apply_material_template(c);

  insert into auth.users (id, email)
  values (u_admin, 'admin@demo-seed.invalid'), (u_pro1, 'prorab1@demo-seed.invalid'),
         (u_pro2, 'prorab2@demo-seed.invalid'), (u_tek, 'tekshiruvchi@demo-seed.invalid');

  insert into public.profiles (id, company_id, role, full_name, phone, auth_user_id) values
    (p_admin, c, 'admin',        'Rustam Qodirov',      '+998901110001', u_admin),
    (p_dir,   c, 'direktor',     'Abdulla Karimov',     '+998901110002', null),
    (p_bux,   c, 'buxgalter',    'Dilnoza Rahimova',    '+998901110003', null),
    (p_tam,   c, 'taminotchi',   'Jasur Toshmatov',     '+998901110004', null),
    (p_pro1,  c, 'prorab',       'Sherzod Aliyev',      '+998901110005', u_pro1),
    (p_pro2,  c, 'prorab',       'Bekzod Yusupov',      '+998901110006', u_pro2),
    (p_omb1,  c, 'omborchi',     'Farhod Ergashev',     '+998901110007', null),
    (p_omb2,  c, 'omborchi',     'Otabek Nazarov',      '+998901110008', null),
    (p_hay,   c, 'haydovchi',    'Ulug''bek Saidov',    '+998901110009', null),
    (p_tek,   c, 'tekshiruvchi', 'Nodira Xolmatova',    '+998901110010', u_tek);

  insert into public.objects (id, company_id, name, address, lat, lng, radius_m, created_by) values
    (o1, c, 'Yunusobod 12-mavze turar-joy', 'Toshkent sh., Yunusobod tumani, 12-mavze', v_lat[1], v_lng[1], 300, p_admin),
    (o2, c, 'Chilonzor maktab binosi',      'Toshkent sh., Chilonzor tumani, 9-kvartal', v_lat[2], v_lng[2], 250, p_admin),
    (o3, c, 'Sergeli savdo markazi',        'Toshkent sh., Sergeli tumani, Yangi Sergeli ko''chasi', v_lat[3], v_lng[3], 400, p_admin);

  insert into public.object_members (company_id, object_id, profile_id, created_by) values
    (c, o1, p_pro1, p_admin), (c, o2, p_pro1, p_admin), (c, o3, p_pro2, p_admin),
    (c, o1, p_omb1, p_admin), (c, o2, p_omb2, p_admin), (c, o3, p_omb2, p_admin),
    (c, o1, p_hay,  p_admin), (c, o2, p_hay,  p_admin), (c, o3, p_hay,  p_admin);

  insert into public.suppliers (id, company_id, name, phone, tin, created_by) values
    ('de300000-0000-4000-8000-000000000301', c, 'Ohangaron Sement Savdo',     '+998712001001', '301234567', p_admin),
    ('de300000-0000-4000-8000-000000000302', c, 'Qo''yliq G''isht Zavodi',    '+998712001002', '302345678', p_admin),
    ('de300000-0000-4000-8000-000000000303', c, 'Chirchiq Inert Materiallar', '+998712001003', '303456789', p_admin),
    ('de300000-0000-4000-8000-000000000304', c, 'Bekobod Metall Savdo',       '+998712001004', '304567890', p_admin),
    ('de300000-0000-4000-8000-000000000305', c, 'Toshkent Beton Qorishma',    '+998712001005', '305678901', p_admin),
    ('de300000-0000-4000-8000-000000000306', c, 'Kafel Olami do''koni',       '+998712001006', null,        p_admin);
  v_sup := jsonb_build_object(
    'sement', 'de300000-0000-4000-8000-000000000301', 'gisht',  'de300000-0000-4000-8000-000000000302',
    'inert',  'de300000-0000-4000-8000-000000000303', 'metall', 'de300000-0000-4000-8000-000000000304',
    'beton',  'de300000-0000-4000-8000-000000000305', 'kafel',  'de300000-0000-4000-8000-000000000306');

  -- Material va birlik id'lari
  select id into m_sement from public.materials where company_id = c and name = 'Sement M400';
  select id into m_m500   from public.materials where company_id = c and name = 'Sement M500';
  select id into m_gisht  from public.materials where company_id = c and name = 'G''isht';
  select id into m_qum    from public.materials where company_id = c and name = 'Qum';
  select id into m_shagal from public.materials where company_id = c and name = 'Shag''al';
  select id into m_arm    from public.materials where company_id = c and name = 'Armatura';
  select id into m_beton  from public.materials where company_id = c and name = 'Beton';
  select id into m_kafel  from public.materials where company_id = c and name = 'Kafel';
  select id into u_qop    from public.material_units where company_id = c and material_id = m_sement and unit = 'qop'    and variant is null;
  select id into u_kg     from public.material_units where company_id = c and material_id = m_sement and unit = 'kg'     and variant is null;
  select id into u_m500kg from public.material_units where company_id = c and material_id = m_m500   and unit = 'kg'     and variant is null;
  select id into u_dona   from public.material_units where company_id = c and material_id = m_gisht  and unit = 'dona'   and variant is null;
  select id into u_poddon from public.material_units where company_id = c and material_id = m_gisht  and unit = 'poddon' and variant is null;
  select id into u_qum    from public.material_units where company_id = c and material_id = m_qum    and unit = 'm³'     and variant is null;
  select id into u_shagal from public.material_units where company_id = c and material_id = m_shagal and unit = 'm³'     and variant is null;
  select id into u_tonna  from public.material_units where company_id = c and material_id = m_arm    and unit = 'tonna'  and variant is null;
  select id into u_armkg  from public.material_units where company_id = c and material_id = m_arm    and unit = 'kg'     and variant is null;
  select id into u_beton  from public.material_units where company_id = c and material_id = m_beton  and unit = 'm³'     and variant is null;
  select id into u_kafel  from public.material_units where company_id = c and material_id = m_kafel  and unit = 'm²'     and variant is null;

  -- Muntazam ta'minot va sarf rejasi (asosiy birlikda sarf; kirim — xarid birligida).
  --   init/rbase/rstep — boshlang'ich va 4 ta to'ldirish (24, 17, 10, 3 kun oldin);
  --   c0 + d * cstep — chiqim (d — necha kun oldin), (d + idx) juft kunlarda;
  --   obyekt koeffitsienti 1,0 / 1,1 / 1,2 (har yozuv miqdori takrorlanmaydi —
  --   takroriy_yozuv qoidasi faqat ataylab qilingan holatda ishlaydi).
  select jsonb_agg(jsonb_build_object(
           'key', x.key, 'mat', m.id, 'kunit', ku.id, 'cunit', cu.id, 'kdig', x.kdig,
           'init', x.init, 'rbase', x.rbase, 'rstep', x.rstep, 'price', x.price,
           'c0', x.c0, 'cstep', x.cstep, 'cdig', x.cdig, 'idx', x.idx, 'sup', x.sup, 'objs', x.objs)
         order by x.ord)
    into v_cfg
    from (values
      (1, 'sement',   'Sement M400', 'qop',    0, 120::numeric, 50::numeric,  1::numeric,    65000::numeric,   'kg',   600::numeric, 10::numeric,  0, 0, 'sement', '123'),
      (2, 'gisht',    'G''isht',     'poddon', 0,  40,          12,           1,            360000,           'dona', 800,          20,           0, 1, 'gisht',  '12'),
      (3, 'qum',      'Qum',         'm³',     1,  25,           9,           1,            180000,           'm³',   2,            0.1,          2, 0, 'inert',  '123'),
      (4, 'shagal',   'Shag''al',    'm³',     1,  20,           8,           1,            210000,           'm³',   1.5,          0.1,          2, 1, 'inert',  '12'),
      (5, 'armatura', 'Armatura',    'tonna',  2,  2.5,          0.8,         0.05,         9800000,          'kg',   200,          5,            1, 0, 'metall', '123'),
      (6, 'kafel',    'Kafel',       'm²',     0, 150,          40,           1,            95000,            'm²',   10,           0.5,          2, 1, 'kafel',  '3')
    ) x(ord, key, name, kunit, kdig, init, rbase, rstep, price, cunit, c0, cstep, cdig, idx, sup, objs)
    join public.materials m on m.company_id = c and m.name = x.name
    join public.material_units ku on ku.company_id = c and ku.material_id = m.id and ku.unit = x.kunit
                                 and ku.variant is null and ku.deleted_at is null
    join public.material_units cu on cu.company_id = c and cu.material_id = m.id and cu.unit = x.cunit
                                 and cu.variant is null and cu.deleted_at is null;

  -- ==========================================================================
  -- 2. Smetalar (har obyektga bitta, joriy). Chilonzor g'ishti va Sergeli
  --    armaturasi ataylab kam — normadan oshish va smetadan ortiq so'rov.
  -- ==========================================================================
  insert into public.estimates (id, company_id, object_id, version, title, estimate_date, source_file_name, is_current, created_by) values
    ('de300000-0000-4000-8000-000000000401', c, o1, 1, 'Yunusobod 12-mavze — asosiy smeta', v_today - 45, 'smeta_yunusobod_v1.xlsx', true, p_bux),
    ('de300000-0000-4000-8000-000000000402', c, o2, 1, 'Chilonzor maktab — asosiy smeta',   v_today - 40, 'smeta_chilonzor_v1.xlsx', true, p_bux),
    ('de300000-0000-4000-8000-000000000403', c, o3, 1, 'Sergeli savdo markazi — smeta',      v_today - 38, 'smeta_sergeli_v1.xlsx',   true, p_bux);

  insert into public.estimate_items (company_id, estimate_id, item_type, name, material_id, unit, qty, unit_price, sort_order, created_by)
  select c, x.est::uuid, x.item_type::public.estimate_item_type, x.name, x.mat, x.unit, x.qty, x.price, x.ord, p_bux
    from (values
      ('de300000-0000-4000-8000-000000000401', 1, 'ish',      'G''isht devor terish',          null::uuid, 'm³',   850::numeric,   320000::numeric),
      ('de300000-0000-4000-8000-000000000401', 2, 'material', 'Sement M400',                   m_sement,   'kg',   80000,          1300),
      ('de300000-0000-4000-8000-000000000401', 3, 'material', 'Sement M500',                   m_m500,     'kg',   6000,           1450),
      ('de300000-0000-4000-8000-000000000401', 4, 'material', 'G''isht',                       m_gisht,    'dona', 120000,         1200),
      ('de300000-0000-4000-8000-000000000401', 5, 'material', 'Qum',                           m_qum,      'm³',   300,            180000),
      ('de300000-0000-4000-8000-000000000401', 6, 'material', 'Shag''al',                      m_shagal,   'm³',   250,            210000),
      ('de300000-0000-4000-8000-000000000401', 7, 'material', 'Armatura',                      m_arm,      'kg',   30000,          9800),
      ('de300000-0000-4000-8000-000000000402', 1, 'ish',      'Poydevor va devorlar',          null,       'm³',   600,            350000),
      ('de300000-0000-4000-8000-000000000402', 2, 'material', 'Sement M400',                   m_sement,   'kg',   90000,          1300),
      ('de300000-0000-4000-8000-000000000402', 3, 'material', 'G''isht',                       m_gisht,    'dona', 16000,          1200),
      ('de300000-0000-4000-8000-000000000402', 4, 'material', 'Qum',                           m_qum,      'm³',   320,            180000),
      ('de300000-0000-4000-8000-000000000402', 5, 'material', 'Shag''al',                      m_shagal,   'm³',   260,            210000),
      ('de300000-0000-4000-8000-000000000402', 6, 'material', 'Armatura',                      m_arm,      'kg',   32000,          9800),
      ('de300000-0000-4000-8000-000000000403', 1, 'ish',      'Karkas va pardozlash ishlari',  null,       'm²',   4200,           150000),
      ('de300000-0000-4000-8000-000000000403', 2, 'material', 'Sement M400',                   m_sement,   'kg',   100000,         1300),
      ('de300000-0000-4000-8000-000000000403', 3, 'material', 'Qum',                           m_qum,      'm³',   350,            180000),
      ('de300000-0000-4000-8000-000000000403', 4, 'material', 'Armatura',                      m_arm,      'kg',   12000,          9800),
      ('de300000-0000-4000-8000-000000000403', 5, 'material', 'Kafel',                         m_kafel,    'm²',   2500,           95000),
      ('de300000-0000-4000-8000-000000000403', 6, 'material', 'Beton',                         m_beton,    'm³',   400,            850000)
    ) x(est, ord, item_type, name, mat, unit, qty, price);

  -- ==========================================================================
  -- 3. 30 kun: xarid → kirim (bog'langan), chiqim; maxsus holatlar kun bo'yicha.
  --    Tartib: har kuni avval kirim, keyin chiqim (qoldiq manfiy bo'lmasin).
  -- ==========================================================================
  for d in reverse 30..1 loop
    for o in 1..3 loop
      v_mult := 1 + 0.1 * (o - 1);

      for r in
        select * from jsonb_to_recordset(v_cfg) as x(
          key text, mat uuid, kunit uuid, cunit uuid, kdig int, init numeric, rbase numeric, rstep numeric,
          price numeric, c0 numeric, cstep numeric, cdig int, idx int, sup text, objs text)
      loop
        continue when position(o::text in r.objs) = 0;

        -- (a) xarid va kirim: 30 kun oldin boshlang'ich, 24/17/10/3 kun oldin to'ldirish
        k := case d when 30 then 0 when 24 then 1 when 17 then 2 when 10 then 3 when 3 then 4 else -1 end;
        if k >= 0 then
          v_qty := round(case when k = 0 then r.init else r.rbase + k * r.rstep end * v_mult, r.kdig);
          v_var := (((d * 7 + o * 3 + r.idx * 5) % 5) - 2) * 0.006;           -- −1,2 % .. +1,2 %
          v_total := round(v_qty * r.price * (1 + v_var), -3);
          v_buyer := case when k = 0 or k % 2 = 1 then p_tam else p_hay end;
          v_ts := ((v_today - d) + time '10:00' + make_interval(mins => o * 20 + r.idx * 7))::timestamp
                  at time zone 'Asia/Tashkent';

          insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, supplier_id,
                                        qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount,
                                        purchased_at, note, created_by)
          values (c, v_buyer, v_obj[o], r.mat, r.kunit, (v_sup ->> r.sup)::uuid,
                  v_qty, '-', 0, 0, 0, v_total, v_ts,
                  case when k = 0 then 'Boshlang''ich zaxira' end, v_buyer)
          returning id into v_pid;

          -- Chilonzor armaturasi (10 kun oldin) — kam qabul qilingan (xarid ≠ qabul)
          v_qty2 := case when o = 2 and r.key = 'armatura' and d = 10 then 0.97 else v_qty end;
          insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input,
                                        qty_base, purchase_id, occurred_at, note, created_by,
                                        geo_status, geo_lat, geo_lng, geo_accuracy_m)
          values (c, 'kirim', v_obj[o], r.mat, r.kunit, v_qty2, '-', 0, v_pid, v_ts + interval '2 hours',
                  case when v_qty2 <> v_qty then 'Mashinada kam keldi' end, v_omb[o],
                  case when d <= 7 then 'ok' end,
                  case when d <= 7 then v_lat[o] + 0.0004 end,
                  case when d <= 7 then v_lng[o] - 0.0003 end,
                  case when d <= 7 then 12 end);
        end if;

        -- (b) chiqim
        if d <= 29 and (d + r.idx) % 2 = 0 then
          v_qty := round((r.c0 + d * r.cstep) * v_mult, r.cdig);
          v_ts := ((v_today - d) + time '15:00' + make_interval(mins => o * 10 + r.idx * 4))::timestamp
                  at time zone 'Asia/Tashkent';
          insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input,
                                        qty_base, occurred_at, created_by)
          values (c, 'chiqim', v_obj[o], r.mat, r.cunit, v_qty, '-', 0, v_ts,
                  case when d % 4 < 2 then v_pro[o] else v_omb[o] end);
        end if;
      end loop;
    end loop;

    -- ---- Maxsus holatlar ---------------------------------------------------
    v_ts := ((v_today - d) + time '11:30')::timestamp at time zone 'Asia/Tashkent';

    -- Sergeli: beton quyish (kirim = chiqim); 2 kun oldin — 10 m³ keldi, 12 m³ quyildi
    if d in (27, 20, 13, 6, 2) then
      v_qty := case d when 27 then 8.5 when 20 then 9 when 13 then 9.5 when 6 then 11 else 10 end;
      insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, supplier_id,
                                    qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount,
                                    purchased_at, created_by)
      values (c, p_tam, o3, m_beton, u_beton, (v_sup ->> 'beton')::uuid, v_qty, '-', 0, 0, 0,
              round(v_qty * 850000 * (1 + ((d % 3) - 1) * 0.005), -3), v_ts - interval '3 hours', p_tam)
      returning id into v_pid;
      insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input,
                                    qty_base, purchase_id, occurred_at, note, created_by)
      values (c, 'kirim', o3, m_beton, u_beton, v_qty, '-', 0, v_pid, v_ts - interval '1 hour', 'Avtobetonmikser', p_omb2);
      insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input,
                                    qty_base, occurred_at, note, created_by)
      values (c, 'chiqim', o3, m_beton, u_beton, case when d = 2 then 12 else v_qty end, '-', 0, v_ts,
              case when d = 2 then 'Plita quyildi (2-qavat)' else 'Quyildi' end, p_pro2);
    end if;

    -- Yunusobod: 100 qop so'rov (12 kun oldin) → tasdiqlandi → 125 qop xarid (11 kun oldin)
    if d = 12 then
      insert into public.material_requests (id, company_id, object_id, material_id, unit_id, qty_input, unit_input,
                                            qty_base, needed_by, note, created_by)
      values ('de300000-0000-4000-8000-000000000501', c, o1, m_sement, u_qop, 100, '-', 0, v_today - 10,
              '3-qavat devorlari uchun', p_pro1);
      perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', u_admin::text, true);
      perform set_config('request.headers', '{"x-client-device":"veb"}', true);
      update public.material_requests set status = 'tasdiqlandi', decision_note = 'Tasdiqlandi'
       where id = 'de300000-0000-4000-8000-000000000501';
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.headers', '', true);
    end if;
    if d = 11 then
      insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, supplier_id,
                                    qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount,
                                    purchased_at, request_id, note, created_by)
      values (c, p_tam, o1, m_sement, u_qop, (v_sup ->> 'sement')::uuid, 125, '-', 0, 0, 0, 8125000, v_ts,
              'de300000-0000-4000-8000-000000000501', 'Zavodda aksiya — ko''proq olindi', p_tam)
      returning id into v_pid;
      insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input,
                                    qty_base, purchase_id, occurred_at, created_by)
      values (c, 'kirim', o1, m_sement, u_qop, 125, '-', 0, v_pid, v_ts + interval '2 hours', p_omb1);
    end if;

    -- Sergeli: prorab qumni o'zi olib, o'zi qabul qildi (ozi_qabul_qilgan)
    if d = 8 then
      insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, supplier_id,
                                    qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount,
                                    purchased_at, created_by)
      values (c, p_pro2, o3, m_qum, u_qum, (v_sup ->> 'inert')::uuid, 7, '-', 0, 0, 0, 1260000, v_ts, p_pro2)
      returning id into v_pid;
      insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input,
                                    qty_base, purchase_id, occurred_at, created_by)
      values (c, 'kirim', o3, m_qum, u_qum, 7, '-', 0, v_pid, v_ts + interval '1 hour', p_pro2);
    end if;

    -- Yunusobod: chek bilan xarid, chekdagi summa 60 000 so'mga kam (chek_farqi)
    if d = 7 then
      insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, supplier_id,
                                    qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount,
                                    purchased_at, receipt_fiscal_sign, receipt_terminal_id, receipt_no, receipt_total,
                                    created_by)
      values (c, p_hay, o1, m_sement, u_qop, (v_sup ->> 'sement')::uuid, 20, '-', 0, 0, 0, 1300000, v_ts,
              'DEMO8812400017', 'EP000000000731', '1742', 1240000, p_hay)
      returning id into v_pid;
      insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input,
                                    qty_base, purchase_id, occurred_at, created_by)
      values (c, 'kirim', o1, m_sement, u_qop, 20, '-', 0, v_pid, v_ts + interval '90 minutes', p_omb1);
    end if;

    -- Chilonzor: Sement M400 qimmat narxda (narx_ogishi)
    if d = 6 then
      insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, supplier_id,
                                    qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount,
                                    purchased_at, note, created_by)
      values (c, p_tam, o2, m_sement, u_qop, null, 40, '-', 0, 0, 0, 3040000, v_ts,
              'Bozordan, shoshilinch', p_tam)
      returning id into v_pid;
      insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input,
                                    qty_base, purchase_id, occurred_at, created_by)
      values (c, 'kirim', o2, m_sement, u_qop, 40, '-', 0, v_pid, v_ts + interval '2 hours', p_omb2);
    end if;

    -- Yunusobod: Sement M500 xaridsiz keldi (kirim_manbasiz)
    if d = 5 then
      insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input,
                                    qty_base, occurred_at, note, created_by)
      values (c, 'kirim', o1, m_m500, u_m500kg, 1500, '-', 0, v_ts, 'Yetkazib beruvchi qo''shimcha olib keldi', p_omb1);
    end if;

    -- Yunusobod: omborchi qum chiqimini ikki marta kiritdi (takroriy_yozuv)
    if d = 4 then
      insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input,
                                    qty_base, occurred_at, created_by)
      values (c, 'chiqim', o1, m_qum, u_qum, 2.75, '-', 0, v_ts, p_omb1);
      insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input,
                                    qty_base, occurred_at, created_by)
      values (c, 'chiqim', o1, m_qum, u_qum, 2.75, '-', 0, v_ts + interval '3 minutes', p_omb1)
      returning id into v_dup;
    end if;

    -- Sergeli: kirim obyektdan ~3 km uzoqda kiritilgan (joylashuv_farqi);
    -- Yunusobod: shag'al xarid qilindi, lekin qabul qilinmadi (xarid ≠ qabul)
    if d = 2 then
      insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, supplier_id,
                                    qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount,
                                    purchased_at, created_by)
      values (c, p_tam, o3, m_kafel, u_kafel, (v_sup ->> 'kafel')::uuid, 36, '-', 0, 0, 0, 3420000, v_ts, p_tam)
      returning id into v_pid;
      insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input,
                                    qty_base, purchase_id, occurred_at, created_by,
                                    geo_status, geo_lat, geo_lng, geo_accuracy_m)
      values (c, 'kirim', o3, m_kafel, u_kafel, 36, '-', 0, v_pid, v_ts + interval '1 hour', p_omb2,
              'ok', v_lat[3] + 0.027, v_lng[3] + 0.004, 20);

      insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, supplier_id,
                                    qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount,
                                    purchased_at, note, created_by)
      values (c, p_hay, o1, m_shagal, u_shagal, (v_sup ->> 'inert')::uuid, 6, '-', 0, 0, 0, 1260000, v_ts,
              'Kamaz, 6 kub', p_hay);
    end if;
  end loop;

  -- ==========================================================================
  -- 4. So'rovlar (bugungi holat)
  -- ==========================================================================
  insert into public.material_requests (id, company_id, object_id, material_id, unit_id, qty_input, unit_input,
                                        qty_base, needed_by, note, created_by) values
    ('de300000-0000-4000-8000-000000000502', c, o3, m_arm,   u_tonna,  20, '-', 0, v_today + 5,
     'Karkas 3-4 qavat', p_pro2),
    ('de300000-0000-4000-8000-000000000503', c, o2, m_qum,   u_qum,    12, '-', 0, v_today + 2,
     'Suvoq ishlari', p_pro1),
    ('de300000-0000-4000-8000-000000000504', c, o1, m_gisht, u_poddon, 10, '-', 0, v_today + 3,
     null, p_pro1),
    ('de300000-0000-4000-8000-000000000505', c, o3, m_kafel, u_kafel,  60, '-', 0, v_today - 1,
     'Savdo zali poli', p_pro2);

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', u_admin::text, true);
  perform set_config('request.headers', '{"x-client-device":"veb"}', true);
  update public.material_requests set status = 'rad', decision_note = 'Omborda yetarli g''isht bor'
   where id = 'de300000-0000-4000-8000-000000000504';
  update public.material_requests set status = 'tasdiqlandi'
   where id = 'de300000-0000-4000-8000-000000000505';

  -- Takroriy chiqimni admin o'chirdi (yozuv_ochirildi)
  update public.movements set deleted_at = now(), note = 'Takror kiritilgan' where id = v_dup;

  -- ==========================================================================
  -- 5. O'tkazmalar (bugun): admin yuboradi, qabul qiluvchi obyekt prorabi qabul qiladi
  -- ==========================================================================
  v_tr := public.create_transfer('de300000-0000-4000-8000-000000000601', o1, o2, m_gisht, u_dona, 600,
                                 'Chilonzorga devor uchun');
  perform public.create_transfer('de300000-0000-4000-8000-000000000602', o1, o3, m_qum, u_qum, 5, null);
  perform public.create_transfer('de300000-0000-4000-8000-000000000603', o2, o1, m_shagal, u_shagal, 3,
                                 'Ortib qolgan shag''al');

  perform set_config('request.jwt.claims', json_build_object('sub', u_pro1, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', u_pro1::text, true);
  perform set_config('request.headers', '{"x-client-device":"mobil"}', true);
  perform public.receive_transfer(v_tr, '560', 'Yo''lda 40 dona singan');

  perform set_config('request.jwt.claims', json_build_object('sub', u_pro2, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', u_pro2::text, true);
  perform public.receive_transfer('de300000-0000-4000-8000-000000000602', null, null);

  -- ==========================================================================
  -- 6. Inventarizatsiya (Yunusobod): qoldig'i bor hamma material sanaldi;
  --    sement 150 kg, armatura 35 kg kam.
  -- ==========================================================================
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.headers', '', true);

  v_cnt := 'de300000-0000-4000-8000-000000000701';
  insert into public.inventory_counts (id, company_id, object_id, counted_at, note, created_by)
  values (v_cnt, c, o1, now(),
          'Oylik inventarizatsiya', p_tek);
  insert into public.inventory_count_items (company_id, inventory_count_id, material_id, unit_id, qty_input, created_by)
  select c, v_cnt, sb.material_id, mu.id,
         sb.qty_base - case sb.material_id when m_sement then 150 when m_arm then 35 else 0 end,
         p_tek
    from public.stock_balances sb
    join public.materials m on m.company_id = sb.company_id and m.id = sb.material_id
    join public.material_units mu on mu.company_id = sb.company_id and mu.material_id = sb.material_id
                                 and mu.unit = m.base_unit and mu.variant is null and mu.deleted_at is null
   where sb.company_id = c and sb.object_id = o1 and sb.qty_base <> 0
   order by sb.material_id;

  perform set_config('request.jwt.claims', json_build_object('sub', u_tek, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', u_tek::text, true);
  perform set_config('request.headers', '{"x-client-device":"mobil"}', true);
  perform public.submit_inventory_count(v_cnt);

  -- Tizim kontekstiga qaytish
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.headers', '', true);

  -- ==========================================================================
  -- 7. Podotchet (berilgan pul sanalari — o'tmishda):
  --    haydovchi — uch marta, oxirgisi ~9 kun oldin, 500 000 qaytardi;
  --    ta'minotchi — 28 kun oldin bitta katta summa (qoldiq 28 kundan beri ochiq →
  --    keyingi cron'da podotchet_muddati); Sergeli prorabi — 1 000 000 (sarf
  --    ko'proq → podotchet_manfiy).
  -- ==========================================================================
  select coalesce(sum(total_amount), 0) into v_spent from public.purchases
   where company_id = c and buyer_id = p_hay and deleted_at is null;
  insert into public.cash_advances (company_id, recipient_id, amount, issued_at, note, kind, created_by) values
    (c, p_hay, round(v_spent * 0.40, -6) + 1000000, ((v_today - 29) + time '09:00')::timestamp at time zone 'Asia/Tashkent', 'Xarajatlar uchun', 'berildi', p_bux),
    (c, p_hay, round(v_spent * 0.35, -6),           ((v_today - 19) + time '09:00')::timestamp at time zone 'Asia/Tashkent', null, 'berildi', p_bux),
    (c, p_hay, round(v_spent * 0.25, -6) + 1500000, ((v_today - 9)  + time '09:00')::timestamp at time zone 'Asia/Tashkent', null, 'berildi', p_bux),
    (c, p_hay, 500000,                              ((v_today - 1)  + time '18:00')::timestamp at time zone 'Asia/Tashkent', 'Ortib qolgan pul qaytarildi', 'qaytarildi', p_bux);

  select coalesce(sum(total_amount), 0) into v_spent from public.purchases
   where company_id = c and buyer_id = p_tam and deleted_at is null;
  insert into public.cash_advances (company_id, recipient_id, amount, issued_at, note, kind, created_by) values
    (c, p_tam, ceil(v_spent / 1000000) * 1000000 + 5000000,
     ((v_today - 28) + time '09:00')::timestamp at time zone 'Asia/Tashkent', 'Oylik ta''minot uchun', 'berildi', p_bux);

  insert into public.cash_advances (company_id, recipient_id, amount, issued_at, note, kind, created_by) values
    (c, p_pro2, 1000000, ((v_today - 9) + time '09:00')::timestamp at time zone 'Asia/Tashkent', 'Mayda xarajatlar', 'berildi', p_bux);

  -- ==========================================================================
  -- 8. Xarid ≠ qabul — soatlik cron qiladigan ishni faqat demo xaridlari uchun
  --    (qabul qilinmagan shag'al xaridi alert oladi; qolganlari — o'zgarishsiz).
  --    Qoida 1 kutishi greatest(purchased_at, created_at) + 24 soat
  --    (20261112000001_audit3_fixes.sql D6): demo xaridlari "o'z vaqtida kiritilgan" deb
  --    baholanadi — purchased_at + 24 soat o'tgan xarid uchun p_now kutish oxiriga suriladi
  --    (session_replication_role kerak emas: Supabase'da huquq yetmasligi mumkin).
  --    Keyin alert details.evaluated_at haqiqiy vaqtga qaytariladi.
  -- ==========================================================================
  for v_pid in
    select p.id from public.purchases p where p.company_id = c and p.deleted_at is null order by p.purchased_at, p.id
  loop
    perform private.evaluate_purchase_receipt(
      v_pid,
      (select case when now() >= p.purchased_at + interval '24 hours'
                   then greatest(now(), greatest(p.purchased_at, p.created_at) + interval '24 hours')
                   else now() end
         from public.purchases p where p.id = v_pid));
  end loop;
  update public.alerts
     set details = jsonb_set(details, '{evaluated_at}', to_jsonb(now()))
   where company_id = c
     and type = 'xarid_qabul_farqi'
     and details ? 'evaluated_at';

  -- ==========================================================================
  -- 9. Vaqtinchalik auth bog'lanishlarini olib tashlash
  -- ==========================================================================
  update public.profiles set auth_user_id = null
   where company_id = c and auth_user_id in (u_admin, u_pro1, u_pro2, u_tek);
  delete from auth.users where id in (u_admin, u_pro1, u_pro2, u_tek);

  raise notice 'Demo qurilish yaratildi: % harakat, % xarid, % ogohlantirish',
    (select count(*) from public.movements where company_id = c),
    (select count(*) from public.purchases where company_id = c),
    (select count(*) from public.alerts where company_id = c);
end
$seed$;

commit;
