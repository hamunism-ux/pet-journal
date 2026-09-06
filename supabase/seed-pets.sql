-- ============================================================
-- 寵物手帳 測試資料：16 位飼主、16 隻寵物
-- 新加坡 5、楓丹白露 4、阿布達比 3、其他 4
--
-- 用法：Supabase → SQL Editor → New query → 整份貼上 → Run
-- 可以重複執行（飼主帳號用 on conflict 跳過，寵物會再新增一份，
-- 所以想重跑請先執行最下方的清除區塊）
--
-- 為什麼要先建飼主帳號：pets.owner_id 必須對應 auth.users 裡真實存在的人，
-- 這裡建的是 16 個「匿名帳號」，和 app 訪客模式產生的帳號一模一樣。
-- ============================================================

begin;

-- 名字尾巴的 ＊ 代表测试资料（v15 起，配对结果一眼可辨）
-- 1. 16 位測試飼主（匿名帳號）
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, is_anonymous, is_sso_user,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, '', null,
  '{"provider":"anonymous","providers":["anonymous"]}'::jsonb, '{}'::jsonb, true, false,
  now() - interval '40 days', now() - interval '40 days',
  '', '', '', '', '', '', '', ''
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid), ('a0000000-0000-4000-8000-000000000002'::uuid),
  ('a0000000-0000-4000-8000-000000000003'::uuid), ('a0000000-0000-4000-8000-000000000004'::uuid),
  ('a0000000-0000-4000-8000-000000000005'::uuid), ('a0000000-0000-4000-8000-000000000006'::uuid),
  ('a0000000-0000-4000-8000-000000000007'::uuid), ('a0000000-0000-4000-8000-000000000008'::uuid),
  ('a0000000-0000-4000-8000-000000000009'::uuid), ('a0000000-0000-4000-8000-000000000010'::uuid),
  ('a0000000-0000-4000-8000-000000000011'::uuid), ('a0000000-0000-4000-8000-000000000012'::uuid),
  ('a0000000-0000-4000-8000-000000000013'::uuid), ('a0000000-0000-4000-8000-000000000014'::uuid),
  ('a0000000-0000-4000-8000-000000000015'::uuid), ('a0000000-0000-4000-8000-000000000016'::uuid)
) as u(id)
on conflict (id) do nothing;

-- 2. 16 隻寵物（品種、過敏原都用 app 的代碼；照片留空，app 會顯示品種剪影）
insert into public.pets
  (id, owner_id, name, species, breed, gender, birthday, weight_kg, neutered, allergies, city, owner_email, note, created_at, updated_at)
values
  -- 新加坡 ×5
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000001', 'Mochi＊',   'dog', 'shiba',     'male',   '2022-03-15',  9.8, true,  '{chicken}',        'singapore',     'alice.tan@example.com',      '怕打雷 [測試資料]',                 now() - interval '32 days', now() - interval '32 days'),
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000002', 'Bella＊',   'dog', 'poodle',    'female', '2019-07-02',  4.2, true,  '{}',               'singapore',     'siti.rahman@example.com',    '[測試資料]',                        now() - interval '30 days', now() - interval '30 days'),
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000003', 'Kopi＊',    'cat', 'mix',       'male',   '2024-11-20',  3.6, false, '{fish}',           'singapore',     'ravi.kumar@example.com',     '領養自 SPCA [測試資料]',            now() - interval '27 days', now() - interval '27 days'),
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000004', 'Luna＊',    'cat', 'bsh',       'female', '2021-01-09',  5.1, true,  '{chicken,dairy}',  'singapore',     'jasmine.lim@example.com',    '[測試資料]',                        now() - interval '25 days', now() - interval '25 days'),
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000005', 'Max＊',     'dog', 'golden',    'male',   '2017-05-30', 31.5, true,  '{}',               'singapore',     'daniel.ong@example.com',     '髖關節要留意 [測試資料]',           now() - interval '22 days', now() - interval '22 days'),
  -- 楓丹白露 ×4
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000006', 'Oscar＊',   'dog', 'frenchie',  'male',   '2023-02-14', 12.3, false, '{wheat}',          'fontainebleau', 'camille.dubois@example.com', '[測試資料]',                        now() - interval '20 days', now() - interval '20 days'),
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000007', 'Minette＊', 'cat', 'ragdoll',   'female', '2020-09-05',  4.8, true,  '{}',               'fontainebleau', 'louis.martin@example.com',   '[測試資料]',                        now() - interval '18 days', now() - interval '18 days'),
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000008', 'Gaston＊',  'dog', 'dachshund', 'male',   '2016-04-22',  8.9, true,  '{beef}',           'fontainebleau', 'elise.bernard@example.com',  '背部曾受傷，避免跳沙發 [測試資料]', now() - interval '16 days', now() - interval '16 days'),
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000009', 'Fleur＊',   'cat', 'mix',       'female', '2025-12-01',  2.1, false, '{}',               'fontainebleau', 'theo.lefevre@example.com',   '[測試資料]',                        now() - interval '14 days', now() - interval '14 days'),
  -- 阿布達比 ×3
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000010', 'Zayn＊',    'dog', 'husky',     'male',   '2021-11-11', 24.0, true,  '{}',               'abuDhabi',      'omar.alhashimi@example.com', '夏天只在清晨散步 [測試資料]',       now() - interval '12 days', now() - interval '12 days'),
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000011', 'Noor＊',    'cat', 'persian',   'female', '2018-06-18',  4.4, true,  '{fish,egg}',       'abuDhabi',      'fatima.alzaabi@example.com', '[測試資料]',                        now() - interval '10 days', now() - interval '10 days'),
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000012', 'Simba＊',   'cat', 'bengal',    'male',   '2023-08-08',  5.6, false, '{}',               'abuDhabi',      'priya.nair@example.com',     '[測試資料]',                        now() - interval '8 days',  now() - interval '8 days'),
  -- 其他 ×4
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000013', 'Hana＊',    'dog', 'maltese',   'female', '2022-10-10',  3.1, true,  '{chicken,corn}',   'other',         'yuki.sato@example.com',      '[測試資料]',                        now() - interval '6 days',  now() - interval '6 days'),
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000014', 'Biscuit＊', 'dog', 'lab',       'male',   '2020-02-29', 29.4, false, '{}',               'other',         'mark.wilson@example.com',    '[測試資料]',                        now() - interval '4 days',  now() - interval '4 days'),
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000015', 'Pixel＊',   'cat', 'sphynx',    'male',   '2024-04-04',  3.9, true,  '{dairy}',          'other',         'anna.kowalski@example.com',  '[測試資料]',                        now() - interval '2 days',  now() - interval '2 days'),
  (gen_random_uuid(), 'a0000000-0000-4000-8000-000000000016', 'Toffee＊',  'cat', 'mix',       'female', '2015-03-03',  4.0, true,  '{}',               'other',         'chen.wei@example.com',       '慢性腎病，每半年檢查 [測試資料]',   now() - interval '1 day',   now() - interval '1 day');

commit;

-- 跑完可以立刻驗證：應該看到 singapore 5、fontainebleau 4、abuDhabi 3、other 4
select city, count(*) from public.pets group by city order by 2 desc;


-- ============================================================
-- 清除測試資料（要用時把下面兩行前面的 -- 拿掉再 Run）
-- 刪飼主帳號會連帶刪掉他們的寵物（資料表設了 on delete cascade）
-- ============================================================
-- delete from auth.users where id::text like 'a0000000-0000-4000-8000-0000000000%';
-- select count(*) from public.pets where note like '%[測試資料]%';   -- 應該是 0
