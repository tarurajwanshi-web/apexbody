create table if not exists public.plan_generation_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','done','failed')),
  attempts smallint not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.plan_generation_queue to service_role;

alter table public.plan_generation_queue enable row level security;

create unique index if not exists pgq_one_active_per_user
  on public.plan_generation_queue (user_id)
  where status in ('pending','processing');

create index if not exists pgq_pending
  on public.plan_generation_queue (status, created_at);

create trigger update_plan_generation_queue_updated_at
  before update on public.plan_generation_queue
  for each row execute function public.update_updated_at_column();

select cron.schedule(
  'drain-plan-queue',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/generate-plan',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name='dispatch_secret' limit 1)
    ),
    body := jsonb_build_object('drain', true)
  );
  $$
);