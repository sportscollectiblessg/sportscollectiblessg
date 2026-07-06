-- Run this whole file once in your Supabase project's SQL editor
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)

-- ---------------------------------------------------------
-- Tables
-- ---------------------------------------------------------

create table if not exists consignors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  telegram_username text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  consignor_id uuid not null references consignors(id) on delete cascade,
  link text default '',
  description text default '',
  status text not null default 'listed', -- listed | offer | sold | paid
  sale_mechanism text, -- 'listed' | 'offer' | null — remembers original type after status moves to sold/paid
  start_date timestamptz,
  start_value numeric,
  end_date timestamptz,
  end_value numeric,
  order_total numeric,
  order_earnings numeric,
  shipping numeric,
  photo_url text,
  receipt_order_total_url text,
  receipt_order_earnings_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Seed a default FX rate row if it doesn't exist yet
insert into app_settings (key, value)
values ('fx_rate', jsonb_build_object('rate', 1.29, 'updatedAt', now()))
on conflict (key) do nothing;

-- ---------------------------------------------------------
-- Row Level Security
-- Anyone (including consignors, who aren't logged in) can READ.
-- Only a logged-in, authenticated owner can WRITE.
-- ---------------------------------------------------------

alter table consignors enable row level security;
alter table cards enable row level security;
alter table app_settings enable row level security;

create policy "Public can read consignors" on consignors
  for select using (true);
create policy "Authenticated can write consignors" on consignors
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "Public can read cards" on cards
  for select using (true);
create policy "Authenticated can write cards" on cards
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "Public can read settings" on app_settings
  for select using (true);
create policy "Authenticated can write settings" on app_settings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------------------------------------------------------
-- Storage buckets for card photos + receipts
-- Public read (so consignors can view images), owner-only upload.
-- ---------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('card-photos', 'card-photos', true)
on conflict (id) do nothing;

create policy "Public can view card photos" on storage.objects
  for select using (bucket_id = 'card-photos');
create policy "Authenticated can upload card photos" on storage.objects
  for insert with check (bucket_id = 'card-photos' and auth.role() = 'authenticated');
create policy "Authenticated can update card photos" on storage.objects
  for update using (bucket_id = 'card-photos' and auth.role() = 'authenticated');
create policy "Authenticated can delete card photos" on storage.objects
  for delete using (bucket_id = 'card-photos' and auth.role() = 'authenticated');
