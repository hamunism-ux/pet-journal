-- ============================================================
-- 宠物手帐 一次到位的资料库设定（新专案用）
-- Supabase → SQL Editor → 整份贴上 → Run（可重复执行）
-- 内容 = schema.sql + migrate-v4 ~ v16 依序合并（v15 只改测试资料名字，新专案不需要）；已建过的专案不需要跑，跑了也不会坏
-- ============================================================

-- ============================================================
-- 寵物手帳 資料庫結構 v3（含 city、owner_email）
-- 用法：Supabase 後台 → SQL Editor → New query → 整段貼上 → Run
-- 可以重複執行（會先刪掉舊的規則再建）
-- ============================================================

-- 1. 寵物資料表：一列 = 一隻寵物
create table if not exists public.pets (
  id            uuid primary key,                                   -- 由 app 產生，和舊版資料一致
  owner_id      uuid not null references auth.users (id) on delete cascade,  -- 誰的寵物（帳號被刪，寵物跟著刪）
  name          text not null,
  species       text not null check (species in ('dog', 'cat')),
  breed         text,                                               -- 存代碼（shiba / poodle …），顯示時翻譯
  gender        text check (gender in ('male', 'female') or gender is null),
  birthday      date,
  weight_kg     numeric(5, 2),
  neutered      boolean not null default false,
  allergies     text[] not null default '{}',                       -- 存代碼陣列（chicken / beef …）
  chip_id       text,
  next_vaccine  date,
  city          text,
  owner_email   text,
  advice        jsonb,                                              -- AI 生成的三栏建议快取
  advice_key    text,                                               -- 生成时的资料指纹，变了才重生成                                               -- 主人聯絡用 Email（選填）                                               -- 存代碼（singapore / taipei …），顯示時翻譯
  note          text,
  photo         text,                                               -- 目前存縮小後的圖片字串；之後改用 Storage
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists pets_owner_idx on public.pets (owner_id);

-- 2. 自動更新 updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists pets_set_updated_at on public.pets;
create trigger pets_set_updated_at
  before update on public.pets
  for each row execute function public.set_updated_at();

-- 3. 門鎖：Row Level Security
--    打開之後，沒有規則允許的操作一律被拒絕。
--    下面四條規則的意思都一樣：「這一列的 owner_id 必須等於現在登入的人」。
alter table public.pets enable row level security;

drop policy if exists "pets: owner can read"   on public.pets;
drop policy if exists "pets: owner can insert" on public.pets;
drop policy if exists "pets: owner can update" on public.pets;
drop policy if exists "pets: owner can delete" on public.pets;

create policy "pets: owner can read"
  on public.pets for select
  to authenticated
  using (owner_id = auth.uid());

create policy "pets: owner can insert"
  on public.pets for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "pets: owner can update"
  on public.pets for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "pets: owner can delete"
  on public.pets for delete
  to authenticated
  using (owner_id = auth.uid());

-- ============================================================
-- 人工檢查（照交接文件的要求）：
-- 執行完後到 Table Editor → pets → 右上角應該看到 "RLS enabled"。
-- 到 Authentication → Policies → pets 應該看到上面四條。
-- 沒登入的人（anon）沒有任何規則 = 什麼都做不了，這是刻意的。
-- ============================================================


-- ============================================================
-- v4：尋找附近的玩伴
-- Supabase → SQL Editor → 貼上 → Run（可重複執行）
--
-- 為什麼要用資料庫函式：RLS 規定每個人只看得到自己的寵物。
-- 這個函式以「資料庫擁有者」身分執行（security definer），
-- 幫使用者挑出同城、同物種、別人的寵物，但只回傳需要的欄位，
-- 而且只有最佳配對那一筆才帶主人 Email。
-- 分數規則和 App.jsx 的 playmateScore() 完全相同。
-- ============================================================

-- 年齡階段：0 幼年（<12 個月）、1 成年（12–84）、2 熟齡；沒生日當成年
create or replace function public.pet_stage_n(b date)
returns int language sql stable as $$
  select case
    when b is null then 1
    when (extract(year from age(current_date, b)) * 12 + extract(month from age(current_date, b))) < 12 then 0
    when (extract(year from age(current_date, b)) * 12 + extract(month from age(current_date, b))) <= 84 then 1
    else 2 end;
$$;

create or replace function public.find_playmates(p_pet_id uuid)
returns table (
  id uuid, name text, species text, breed text, gender text, birthday date,
  weight_kg numeric, neutered boolean, city text, photo text,
  score int, is_match boolean, owner_email text
)
language plpgsql security definer set search_path = public as $$
declare
  me public.pets%rowtype;
begin
  -- 只能替自己的寵物找
  select * into me from public.pets p where p.id = p_pet_id and p.owner_id = auth.uid();
  if not found or me.city is null then return; end if;

  return query
  with cand as (
    select p.*,
      ( case when pet_stage_n(p.birthday) = pet_stage_n(me.birthday) then 3
             when abs(pet_stage_n(p.birthday) - pet_stage_n(me.birthday)) = 1 then 1 else 0 end
      + case when p.weight_kg is null or me.weight_kg is null or p.weight_kg = 0 or me.weight_kg = 0 then 1
             when greatest(p.weight_kg, me.weight_kg) / least(p.weight_kg, me.weight_kg) <= 1.5 then 3
             when greatest(p.weight_kg, me.weight_kg) / least(p.weight_kg, me.weight_kg) <= 2.5 then 1 else 0 end
      + case when p.neutered and me.neutered then 1 else 0 end
      - case when not p.neutered and not me.neutered and p.gender = 'male' and me.gender = 'male' then 2 else 0 end
      )::int as sc
    from public.pets p
    where p.city = me.city and p.species = me.species and p.owner_id <> me.owner_id
  ),
  ranked as (
    select c.*, row_number() over (order by c.sc desc, c.created_at asc) as rn from cand c
  )
  select r.id, r.name, r.species, r.breed, r.gender, r.birthday, r.weight_kg, r.neutered, r.city, r.photo,
         r.sc, (r.rn = 1), null::text  -- v12：不再回传主人 Email（改由 App 内聊天联络），栏位保留以免旧版程式出错
  from ranked r
  order by r.rn;
end $$;

revoke all on function public.find_playmates(uuid) from public;
grant execute on function public.find_playmates(uuid) to authenticated;

-- 驗證：換成你自己某隻寵物的 id（Table Editor 可以複製）
-- select name, city, score, is_match, owner_email from public.find_playmates('這裡貼寵物 id');


-- v5：首頁全站統計
-- Supabase → SQL Editor → 貼上 → Run（可重複執行）
-- RLS 讓每個人只看得到自己的寵物，所以「全站有幾位主人、幾隻寵物」要靠這個函式來數。
-- 它只回傳兩個數字，不回傳任何寵物或主人的資料。
create or replace function public.journal_stats()
returns table (owners bigint, pets bigint)
language sql security definer stable set search_path = public as $$
  select count(distinct owner_id), count(*) from public.pets;
$$;

revoke all on function public.journal_stats() from public;
grant execute on function public.journal_stats() to authenticated;

-- 驗證：
-- select * from public.journal_stats();


-- ============================================================
-- v6：照片改存 Supabase Storage
-- Supabase → SQL Editor → 貼上 → Run（可重複執行）
--
-- 建一個叫 pet-photos 的公開儲存桶：
--   任何人拿到網址都能「看」照片（app 顯示需要）
--   只有登入的人能「上傳／覆蓋／刪除」，而且只能動自己資料夾（自己的 user id）裡的檔案
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pet-photos', 'pet-photos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 8388608, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "pet-photos: public read"      on storage.objects;
drop policy if exists "pet-photos: owner upload"     on storage.objects;
drop policy if exists "pet-photos: owner update"     on storage.objects;
drop policy if exists "pet-photos: owner delete"     on storage.objects;

create policy "pet-photos: public read"
  on storage.objects for select
  using (bucket_id = 'pet-photos');

create policy "pet-photos: owner upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'pet-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "pet-photos: owner update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'pet-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'pet-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "pet-photos: owner delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'pet-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 驗證：左邊 Storage 應該出現 pet-photos，標示 Public。
-- 檔案路徑規則：{使用者 id}/{寵物 id}.jpg ；你手動放測試照片可以用 seed/ 資料夾（後台上傳不受上面規則限制）。


-- v8：首页空状态的「已加入的宠物」小照片列
-- Supabase → SQL Editor → 贴上 → Run（可重复执行）
-- 随机取 n 只宠物的照片（有照片的优先），只回传照片、物种、品种，不回传名字或主人。
create or replace function public.sample_pets(n int default 6)
returns table (photo text, species text, breed text)
language sql security definer stable set search_path = public as $$
  select p.photo, p.species, p.breed
  from public.pets p
  order by (p.photo is null), random()
  limit greatest(1, least(n, 12));
$$;

revoke all on function public.sample_pets(int) from public;
grant execute on function public.sample_pets(int) to authenticated;


-- v9：玩伴配对结果快取（Supabase → SQL Editor → 贴上 → Run，可重复执行）
-- 存在自己那只宠物的资料列上：{ key: 双方资料的指纹, ai: 上次 AI 的打分与理由 }
-- 指纹没变（自己没改、同城同物种的宠物没增减也没改）就不再呼叫 AI。
alter table public.pets add column if not exists playmate_cache jsonb;

-- v10：商品检查结果快取（Supabase → SQL Editor → 整段贴上 → Run，可重复执行）
-- 同一张照片（或同一段输入文字）＋ 同一只宠物（资料指纹没变）→ app 直接用上次结果，不再呼叫 AI。
-- 一列 = 一次「输入 × 宠物」的判断结果。宠物或帐号被删，快取跟着删。

create table if not exists public.food_checks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,  -- 自动填成登入者
  pet_id      uuid not null references public.pets (id) on delete cascade,
  input_hash  text not null,                     -- 照片档案或输入文字的 SHA-256 指纹
  pet_key     text not null,                     -- 宠物资料指纹（物种、品种、生命阶段、整数体重、结扎、过敏原）
  result      jsonb not null,                    -- AI 的判断（商品名、成分、结论、中英文理由、来源、是否上网查证过）
  created_at  timestamptz not null default now(),
  unique (pet_id, input_hash, pet_key)           -- 同一组指纹只留一列，新结果覆盖旧的
);

alter table public.food_checks enable row level security;

drop policy if exists "food_checks: owner can read"   on public.food_checks;
drop policy if exists "food_checks: owner can insert" on public.food_checks;
drop policy if exists "food_checks: owner can update" on public.food_checks;
drop policy if exists "food_checks: owner can delete" on public.food_checks;

create policy "food_checks: owner can read"
  on public.food_checks for select
  to authenticated
  using (owner_id = auth.uid());

create policy "food_checks: owner can insert"
  on public.food_checks for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "food_checks: owner can update"
  on public.food_checks for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "food_checks: owner can delete"
  on public.food_checks for delete
  to authenticated
  using (owner_id = auth.uid());

-- v11：纯文字聊天（Supabase → SQL Editor → 整段贴上 → Run，可重复执行）
-- 两张表：conversations（谁跟谁、用哪两只宠物、各自读到哪）、messages（一句话一列）。
-- 所有「开对话」「读收件匣」「标已读」都走函式（security definer），前端不能直接改别人的东西。
-- 对现有资料零影响：只有新增，不动 pets。

-- ---------- 对话 ----------
create table if not exists public.conversations (
  id           uuid primary key default gen_random_uuid(),
  pet_a        uuid not null references public.pets (id) on delete cascade,
  pet_b        uuid not null references public.pets (id) on delete cascade,
  user_a       uuid not null references auth.users (id) on delete cascade,
  user_b       uuid not null references auth.users (id) on delete cascade,
  read_a       timestamptz not null default now(),   -- user_a 读到什么时候
  read_b       timestamptz not null default now(),
  last_at      timestamptz not null default now(),   -- 最后一句的时间（收件匣排序用）
  last_preview text not null default '',             -- 最后一句的前 60 字
  created_at   timestamptz not null default now(),
  unique (pet_a, pet_b)                              -- 同一对宠物只有一个对话（pet_a 永远是 id 较小的那只）
);
create index if not exists conversations_user_a_idx on public.conversations (user_a, last_at desc);
create index if not exists conversations_user_b_idx on public.conversations (user_b, last_at desc);

alter table public.conversations enable row level security;
drop policy if exists "conversations: participants can read" on public.conversations;
create policy "conversations: participants can read"
  on public.conversations for select to authenticated
  using (auth.uid() in (user_a, user_b));
-- 没有 insert / update / delete policy：只能透过下面的函式

-- ---------- 讯息 ----------
create table if not exists public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 1000),
  created_at      timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages (conversation_id, id);

alter table public.messages enable row level security;
drop policy if exists "messages: participants can read" on public.messages;
drop policy if exists "messages: participants can send" on public.messages;
create policy "messages: participants can read"
  on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b)));
create policy "messages: participants can send"
  on public.messages for insert to authenticated
  with check (sender_id = auth.uid()
    and exists (select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b)));

-- 每送一句，顺手更新对话的「最后一句」（用 security definer 绕过 conversations 没有 update policy）
create or replace function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_at = new.created_at,
         last_preview = left(new.body, 60),
         -- 自己送的当然算自己已读
         read_a = case when user_a = new.sender_id then new.created_at else read_a end,
         read_b = case when user_b = new.sender_id then new.created_at else read_b end
   where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

-- ---------- 函式 ----------
-- 开对话（或拿回已存在的）：我的宠物 × 对方的宠物。只有绑定 Email 的正式帐号能开；不能跟自己的宠物开。
create or replace function public.start_conversation(p_my_pet uuid, p_their_pet uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  my_owner uuid; their_owner uuid;
  a uuid; b uuid; ua uuid; ub uuid;
  cid uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'anonymous'; end if;
  select owner_id into my_owner from public.pets where id = p_my_pet;
  select owner_id into their_owner from public.pets where id = p_their_pet;
  if my_owner is null or their_owner is null then raise exception 'pet not found'; end if;
  if my_owner <> me then raise exception 'not your pet'; end if;
  if their_owner = me then raise exception 'same owner'; end if;
  -- 固定顺序：pet_a 是 id 较小的那只，这样 A→B 和 B→A 会找到同一个对话
  if p_my_pet < p_their_pet then a := p_my_pet; b := p_their_pet; ua := my_owner; ub := their_owner;
  else a := p_their_pet; b := p_my_pet; ua := their_owner; ub := my_owner; end if;
  select id into cid from public.conversations where pet_a = a and pet_b = b;
  if cid is null then
    insert into public.conversations (pet_a, pet_b, user_a, user_b) values (a, b, ua, ub) returning id into cid;
  end if;
  return cid;
end $$;

-- 收件匣：我的所有对话，附上对方宠物的名字／照片、我这边用的宠物、最后一句、未读数
create or replace function public.inbox()
returns table (
  id uuid, my_pet_id uuid, my_pet_name text,
  other_pet_id uuid, other_pet_name text, other_pet_photo text, other_species text, other_breed text,
  last_at timestamptz, last_preview text, unread integer
) language sql security definer set search_path = public stable as $$
  select c.id,
         mp.id, mp.name,
         op.id, op.name, op.photo, op.species, op.breed,
         c.last_at, c.last_preview,
         (select count(*)::int from public.messages m
           where m.conversation_id = c.id and m.sender_id <> auth.uid()
             and m.created_at > case when c.user_a = auth.uid() then c.read_a else c.read_b end)
    from public.conversations c
    join public.pets mp on mp.id = case when c.user_a = auth.uid() then c.pet_a else c.pet_b end
    join public.pets op on op.id = case when c.user_a = auth.uid() then c.pet_b else c.pet_a end
   where auth.uid() in (c.user_a, c.user_b)
   order by c.last_at desc
$$;

-- 标已读：把我这边的 read 时间推到现在
create or replace function public.mark_read(p_conv uuid)
returns void language sql security definer set search_path = public as $$
  update public.conversations
     set read_a = case when user_a = auth.uid() then now() else read_a end,
         read_b = case when user_b = auth.uid() then now() else read_b end
   where id = p_conv and auth.uid() in (user_a, user_b)
$$;

-- Supabase 预设就会给 authenticated 这些权限，这里明写一次比较保险（RLS 仍然管着能看到哪些列）
grant select on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.start_conversation(uuid, uuid) to authenticated;
grant execute on function public.inbox() to authenticated;
grant execute on function public.mark_read(uuid) to authenticated;

-- v13：对话记下「当时在哪个城市配对」（Supabase → SQL Editor → 整段贴上 → Run，可重复执行）
-- 收件匣与聊天室的副标改成「曾与 YY 在 某城市 最佳配对」。之后宠物搬家、或重新配对配不上了，对话照样保留。

alter table public.conversations add column if not exists city text;

-- 旧对话：用发起方宠物当时（现在）的城市补上
update public.conversations c set city = p.city from public.pets p where p.id = c.pet_a and c.city is null;

-- 开对话时把我的宠物所在城市记下来
create or replace function public.start_conversation(p_my_pet uuid, p_their_pet uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  my_owner uuid; their_owner uuid; my_city text;
  a uuid; b uuid; ua uuid; ub uuid;
  cid uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'anonymous'; end if;
  select owner_id, city into my_owner, my_city from public.pets where id = p_my_pet;
  select owner_id into their_owner from public.pets where id = p_their_pet;
  if my_owner is null or their_owner is null then raise exception 'pet not found'; end if;
  if my_owner <> me then raise exception 'not your pet'; end if;
  if their_owner = me then raise exception 'same owner'; end if;
  if p_my_pet < p_their_pet then a := p_my_pet; b := p_their_pet; ua := my_owner; ub := their_owner;
  else a := p_their_pet; b := p_my_pet; ua := their_owner; ub := my_owner; end if;
  select id into cid from public.conversations where pet_a = a and pet_b = b;
  if cid is null then
    insert into public.conversations (pet_a, pet_b, user_a, user_b, city) values (a, b, ua, ub, my_city) returning id into cid;
  end if;
  return cid;
end $$;

-- 收件匣多回传 city
drop function if exists public.inbox();
create or replace function public.inbox()
returns table (
  id uuid, my_pet_id uuid, my_pet_name text,
  other_pet_id uuid, other_pet_name text, other_pet_photo text, other_species text, other_breed text,
  last_at timestamptz, last_preview text, unread integer, city text
) language sql security definer set search_path = public stable as $$
  select c.id,
         mp.id, mp.name,
         op.id, op.name, op.photo, op.species, op.breed,
         c.last_at, c.last_preview,
         (select count(*)::int from public.messages m
           where m.conversation_id = c.id and m.sender_id <> auth.uid()
             and m.created_at > case when c.user_a = auth.uid() then c.read_a else c.read_b end),
         c.city
    from public.conversations c
    join public.pets mp on mp.id = case when c.user_a = auth.uid() then c.pet_a else c.pet_b end
    join public.pets op on op.id = case when c.user_a = auth.uid() then c.pet_b else c.pet_a end
   where auth.uid() in (c.user_a, c.user_b)
   order by c.last_at desc
$$;
grant execute on function public.start_conversation(uuid, uuid) to authenticated;
grant execute on function public.inbox() to authenticated;

-- v14：测试资料自动回覆（Supabase → SQL Editor → 整段贴上 → Run，可重复执行）
-- seed-pets.sql 建的 16 只测试宠物，主人是假的匿名帐号，永远不会回讯息。
-- 朋友测试时若跟它们聊天，资料库会用那位「主人」的身分立刻自动回一句「我是测试资料」，每个对话只回一次。
-- 怎么认测试资料：主人 id 是 a0000000-0000-4000-8000-… 开头，或宠物备注含「[測試資料]」／「[测试资料]」。

create or replace function public.is_seed_owner(p_user uuid)
returns boolean language sql stable set search_path = public as $$
  select p_user::text like 'a0000000-0000-4000-8000-%'
      or exists (select 1 from public.pets p where p.owner_id = p_user and (p.note like '%[測試資料]%' or p.note like '%[测试资料]%'))
$$;

create or replace function public.seed_auto_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c record;
  receiver uuid;
  receiver_pet uuid;
  pet_name text;
begin
  select * into c from public.conversations where id = new.conversation_id;
  if c is null then return new; end if;
  -- 收讯息的那一方是谁、用哪只宠物
  if new.sender_id = c.user_a then receiver := c.user_b; receiver_pet := c.pet_b;
  else receiver := c.user_a; receiver_pet := c.pet_a; end if;
  -- 只有「收讯息的是测试资料、送讯息的不是」才回
  if not public.is_seed_owner(receiver) or public.is_seed_owner(new.sender_id) then return new; end if;
  -- 每个对话只回一次
  if exists (select 1 from public.messages m where m.conversation_id = new.conversation_id and m.sender_id = receiver) then return new; end if;
  select name into pet_name from public.pets where id = receiver_pet;
  insert into public.messages (conversation_id, sender_id, body)
  values (new.conversation_id, receiver,
    '你好！' || coalesce(pet_name, '这只宠物') || ' 是 App 里的测试资料，主人不是真人，不会回讯息。请找其他配对聊聊吧 🐾' || E'\n' ||
    'Hi! ' || coalesce(pet_name, 'This pet') || ' is test data in the app. The owner isn''t a real person and won''t reply. Try another match 🐾');
  return new;
end $$;

drop trigger if exists seed_auto_reply on public.messages;
create trigger seed_auto_reply after insert on public.messages
  for each row execute function public.seed_auto_reply();

-- v16：对话记下「当时的配对理由」，收件匣多回传对方宠物的基本资料（Supabase → SQL Editor → 贴上 → Run，可重复执行）
-- 聊天室上方会显示对方宠物的品种、年龄、体重、性别、结扎，以及当时的配对理由（一行）。

alter table public.conversations add column if not exists reasons jsonb;  -- { zh: [...], en: [...] }

-- 开对话时把理由一起存（已存在的对话不覆盖）
drop function if exists public.start_conversation(uuid, uuid);
create or replace function public.start_conversation(p_my_pet uuid, p_their_pet uuid, p_reasons jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  my_owner uuid; their_owner uuid; my_city text;
  a uuid; b uuid; ua uuid; ub uuid;
  cid uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'anonymous'; end if;
  select owner_id, city into my_owner, my_city from public.pets where id = p_my_pet;
  select owner_id into their_owner from public.pets where id = p_their_pet;
  if my_owner is null or their_owner is null then raise exception 'pet not found'; end if;
  if my_owner <> me then raise exception 'not your pet'; end if;
  if their_owner = me then raise exception 'same owner'; end if;
  if p_my_pet < p_their_pet then a := p_my_pet; b := p_their_pet; ua := my_owner; ub := their_owner;
  else a := p_their_pet; b := p_my_pet; ua := their_owner; ub := my_owner; end if;
  select id into cid from public.conversations where pet_a = a and pet_b = b;
  if cid is null then
    insert into public.conversations (pet_a, pet_b, user_a, user_b, city, reasons) values (a, b, ua, ub, my_city, p_reasons) returning id into cid;
  elsif p_reasons is not null then
    update public.conversations set reasons = p_reasons where id = cid and reasons is null; -- 旧对话没理由的补上
  end if;
  return cid;
end $$;

-- 收件匣：多回传对方宠物的基本资料与配对理由
drop function if exists public.inbox();
create or replace function public.inbox()
returns table (
  id uuid, my_pet_id uuid, my_pet_name text,
  other_pet_id uuid, other_pet_name text, other_pet_photo text, other_species text, other_breed text,
  other_gender text, other_birthday date, other_weight_kg numeric, other_neutered boolean,
  last_at timestamptz, last_preview text, unread integer, city text, reasons jsonb
) language sql security definer set search_path = public stable as $$
  select c.id,
         mp.id, mp.name,
         op.id, op.name, op.photo, op.species, op.breed,
         op.gender, op.birthday, op.weight_kg, op.neutered,
         c.last_at, c.last_preview,
         (select count(*)::int from public.messages m
           where m.conversation_id = c.id and m.sender_id <> auth.uid()
             and m.created_at > case when c.user_a = auth.uid() then c.read_a else c.read_b end),
         c.city, c.reasons
    from public.conversations c
    join public.pets mp on mp.id = case when c.user_a = auth.uid() then c.pet_a else c.pet_b end
    join public.pets op on op.id = case when c.user_a = auth.uid() then c.pet_b else c.pet_a end
   where auth.uid() in (c.user_a, c.user_b)
   order by c.last_at desc
$$;
grant execute on function public.start_conversation(uuid, uuid, jsonb) to authenticated;
grant execute on function public.inbox() to authenticated;

-- 完成。验证：select * from public.journal_stats();
