create or replace function public.tmp_dispatch_generate_plan(_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare _secret text; _req_id bigint;
begin
  select decrypted_secret into _secret from vault.decrypted_secrets where name='dispatch_secret' limit 1;
  select net.http_post(
    url:='https://toixlzfmxtmtypmupcuc.supabase.co/functions/v1/generate-plan',
    headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',coalesce(_secret,'')),
    body:=jsonb_build_object('user_id',_user_id)
  ) into _req_id;
  return _req_id;
end;
$$;