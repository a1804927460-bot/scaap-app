-- Remote content catalog for templates and Market. Content editors can add,
-- reorder, publish or unpublish rows without requiring a desktop release.

insert into storage.buckets (id, name, public)
values ('app-content', 'app-content', true)
on conflict (id) do update set public = excluded.public;

create table if not exists public.app_content_items (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9._-]{0,119}$'),
  surface text not null check (surface in ('templates', 'market')),
  category text not null default 'other' check (char_length(category) between 1 and 60),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 600),
  prompt text not null default '' check (char_length(prompt) <= 12000),
  kind text not null default 'image' check (kind in ('image', 'video')),
  image_url text not null default '' check (char_length(image_url) <= 2048),
  action_url text not null default '' check (char_length(action_url) <= 2048),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  sort_order integer not null default 0,
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_content_surface_order_idx
  on public.app_content_items (surface, published, sort_order, updated_at desc);

create or replace function public.app_content_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.published and new.published_at is null then new.published_at := now(); end if;
  return new;
end;
$$;

drop trigger if exists app_content_items_touch_updated_at on public.app_content_items;
create trigger app_content_items_touch_updated_at
before insert or update on public.app_content_items
for each row execute function public.app_content_touch_updated_at();

alter table public.app_content_items enable row level security;
drop policy if exists "Published app content is publicly readable" on public.app_content_items;
create policy "Published app content is publicly readable"
  on public.app_content_items for select to anon, authenticated
  using (published = true);

drop policy if exists "App content media is publicly readable" on storage.objects;
create policy "App content media is publicly readable"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'app-content');

-- These seed prompts make the entry useful immediately. Uploading a cover to
-- app-content and updating image_url replaces the local placeholder live.
insert into public.app_content_items
  (id, surface, category, title, description, prompt, kind, metadata, sort_order, published)
values
  ('music-neon-pulse', 'templates', 'music-cover', '霓虹律动专辑封面', '高对比舞曲封面与中心人物构图', '音乐专辑封面，中心人物肖像，黑色背景，克制的霓虹灯带与金属质感，高对比棚拍光线，清晰标题留白，方形构图，精致商业视觉', 'image', '{"tone":"magenta","categoryLabelZh":"音乐封面","categoryLabelEn":"Music covers"}', 10, true),
  ('music-minimal-vinyl', 'templates', 'music-cover', '黑胶极简封面', '留白、黑胶与编辑排版', '极简音乐专辑封面，黑胶唱片与抽象纸张构成，大面积留白，黑白编辑排版，柔和侧光，细腻纸张纹理，现代平面设计，方形构图', 'image', '{"tone":"ivory","categoryLabelZh":"音乐封面","categoryLabelEn":"Music covers"}', 20, true),
  ('stage-red-architecture', 'templates', 'stage-visual', '红色建筑舞台', '大型屏幕与纵深灯阵', '大型演唱会舞美视觉，红色几何建筑结构，多层LED屏幕，纵深灯阵与薄雾，中心对称构图，真实舞台工程尺度，电影级光影，超宽画幅', 'image', '{"tone":"red","categoryLabelZh":"舞美视觉","categoryLabelEn":"Stage visuals"}', 30, true),
  ('stage-silver-wave', 'templates', 'stage-visual', '银色流体舞美', '金属流体与冷白追光', '舞台主屏动态视觉，银色液态金属缓慢流动，冷白追光穿过薄雾，镜面反射，节奏平稳，循环首尾衔接，克制高级，无文字，超宽画幅', 'video', '{"tone":"silver","categoryLabelZh":"舞美视觉","categoryLabelEn":"Stage visuals"}', 40, true),
  ('brand-monochrome-system', 'templates', 'brand-visual', '黑白品牌系统', '标志、字体和应用场景', '高端品牌视觉系统展示，黑白标志、字体规范、名片与包装应用，模块化网格排版，真实纸张与压印细节，俯拍，整洁专业', 'image', '{"tone":"graphite","categoryLabelZh":"品牌视觉","categoryLabelEn":"Brand visuals"}', 50, true),
  ('product-glass-studio', 'templates', 'product-ad', '玻璃质感产品广告', '透明材质与柔和棚拍光', '高端产品广告摄影，透明玻璃材质产品置于简洁展台，柔和棚拍光线，清晰轮廓与折射，高级商业构图，背景干净，留出文案空间', 'image', '{"tone":"cyan","categoryLabelZh":"产品广告","categoryLabelEn":"Product advertising"}', 60, true),
  ('storyboard-night-drive', 'templates', 'storyboard', '夜间驾驶分镜', '电影感六格镜头序列', '电影分镜板，夜间城市驾驶场景，六个连续镜头，包含远景、中景、特写和车内视角，统一角色与车辆，雨夜反光，清晰镜头节奏，专业分镜排版', 'image', '{"tone":"blue","categoryLabelZh":"分镜故事","categoryLabelEn":"Storyboards"}', 70, true)
on conflict (id) do nothing;

grant select on public.app_content_items to anon, authenticated;
revoke insert, update, delete on public.app_content_items from anon, authenticated;

notify pgrst, 'reload schema';
