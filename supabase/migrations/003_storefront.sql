-- Storefront content; customers can read published banners, only the backend can write.
alter table public.products add column if not exists subcategory text not null default '' check (char_length(subcategory) <= 60);
update public.products set subcategory = case slug
  when 'elden-ring' then 'Hành động & nhập vai'
  when 'black-myth-wukong' then 'Hành động & nhập vai'
  when 'cyberpunk-2077' then 'Thế giới mở'
  when 'red-dead-redemption-2' then 'Thế giới mở'
  when 'hollow-knight' then 'Indie & phiêu lưu'
  when 'stardew-valley' then 'Mô phỏng & thư giãn'
  when 'steam-wallet' then 'Steam Wallet'
  when 'xbox-gift-card' then 'Xbox Gift Card'
  when 'valorant' then 'Valorant'
  when 'genshin-impact' then 'Genshin Impact'
  when 'residential-proxy' then 'Proxy dân cư'
  when 'private-proxy' then 'Proxy IPv4 riêng'
  else platform end where subcategory = '';
create index if not exists products_category_subcategory_idx on public.products(category, subcategory);
create table public.banners (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 100),
  eyebrow text not null default '' check (char_length(eyebrow) <= 60),
  description text not null default '' check (char_length(description) <= 240),
  image text not null check (image ~ '^https://shared[.]fastly[.]steamstatic[.]com/[a-zA-Z0-9_./-]+$'),
  href text not null check (href ~ '^/(products/[a-z0-9-]+|catalog([?][^[:space:]\\#]*)?|promotions|guide|wallet|support)$'),
  cta text not null check (char_length(cta) between 2 and 40),
  active boolean not null default false,
  sort_order integer not null default 0 check (sort_order between 0 and 999)
);
alter table public.banners enable row level security;
revoke all on public.banners from anon, authenticated;
grant select on public.banners to anon, authenticated;
grant all on public.banners to service_role;
create policy banners_published on public.banners for select to anon, authenticated using (active = true);
insert into public.banners(title,eyebrow,description,image,href,cta,active,sort_order) values
('Bước vào Lands Between','ELDEN RING / STEAM','Chọn phiên bản, kiểm tra khu vực và bắt đầu hành trình của bạn.','https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/library_hero.jpg','/products/elden-ring','Khám phá Elden Ring',true,0),
('Viết tiếp truyền thuyết','BLACK MYTH: WUKONG','Một hành trình hành động nhập vai lấy cảm hứng từ Tây Du Ký.','https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2358720/library_hero.jpg','/products/black-myth-wukong','Xem các phiên bản',true,1),
('Night City đang chờ','CYBERPUNK 2077 / PC','Khám phá thế giới mở của Cyberpunk 2077 trên tài khoản Steam của bạn.','https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1091500/library_hero.jpg','/products/cyberpunk-2077','Xem game',true,2);
