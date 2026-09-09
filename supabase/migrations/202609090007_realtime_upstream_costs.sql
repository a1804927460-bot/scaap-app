create table if not exists public.upstream_cost_rates (
  id bigint generated always as identity primary key,
  provider_id text not null,
  logical_model text not null,
  variant text not null default '',
  resolution text not null default '',
  quality text not null default '',
  duration_seconds integer not null default 0,
  reference_image_count integer not null default 0,
  reference_video_seconds numeric not null default 0,
  cost_usd numeric not null check (cost_usd >= 0),
  currency text not null default 'USD',
  source_url text not null,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  enabled boolean not null default true,
  unique(provider_id, logical_model, variant, resolution, quality, duration_seconds, reference_image_count, reference_video_seconds)
);
create index if not exists upstream_cost_rates_lookup on public.upstream_cost_rates
  (logical_model, resolution, quality, enabled, expires_at);
revoke all on public.upstream_cost_rates from public, anon, authenticated;
grant select on public.upstream_cost_rates to service_role;

insert into public.upstream_cost_rates
  (provider_id, logical_model, resolution, quality, cost_usd, source_url, verified_at, expires_at)
values
  ('aireiter','nano-banana-v2','1K','',0.03,'https://aireiter.com/image/nano-banana-v2',now(),now()+interval '7 days'),
  ('aireiter','nano-banana-v2','2K','',0.03,'https://aireiter.com/image/nano-banana-v2',now(),now()+interval '7 days'),
  ('aireiter','nano-banana-v2','4K','',0.035,'https://aireiter.com/image/nano-banana-v2',now(),now()+interval '7 days'),
  ('aireiter','nano-banana-pro','1K','',0.05,'https://aireiter.com/image/nano-banana-pro',now(),now()+interval '7 days'),
  ('aireiter','nano-banana-pro','2K','',0.05,'https://aireiter.com/image/nano-banana-pro',now(),now()+interval '7 days'),
  ('aireiter','nano-banana-pro','4K','',0.06,'https://aireiter.com/image/nano-banana-pro',now(),now()+interval '7 days'),
  ('aireiter','gpt-image-2.5','1K','flare',0.022,'https://aireiter.com/image/gpt-image-2-5',now(),now()+interval '1 day'),
  ('aireiter','gpt-image-2.5','1K','sunburst',0.022,'https://aireiter.com/image/gpt-image-2-5',now(),now()+interval '1 day')
on conflict do nothing;

create or replace function public.get_active_upstream_cost(
  p_logical_model text, p_provider_id text, p_resolution text default '', p_quality text default '', p_variant text default ''
) returns numeric language sql security definer stable set search_path=public as $$
  select cost_usd from public.upstream_cost_rates
   where enabled and expires_at > now() and logical_model=lower(trim(p_logical_model))
     and provider_id=lower(trim(p_provider_id)) and resolution=upper(trim(coalesce(p_resolution,'')))
     and quality=lower(trim(coalesce(p_quality,''))) and variant=lower(trim(coalesce(p_variant,'')))
   order by verified_at desc limit 1
$$;
revoke all on function public.get_active_upstream_cost(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.get_active_upstream_cost(text,text,text,text,text) to service_role;
