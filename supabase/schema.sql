-- ============================================================
-- 寵物手帳 資料庫結構 v1
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
