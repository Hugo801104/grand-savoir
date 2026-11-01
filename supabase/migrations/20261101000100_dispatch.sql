-- Déclenchement immédiat du traitement à chaque nouveau signalement (facultatif).
-- Sans cette configuration, le traitement a lieu toutes les 6 heures (tâche planifiée GitHub).
--
-- Mise en service (une fois la fonction report-dispatch déployée) :
--   select vault.create_secret('https://<projet>.supabase.co/functions/v1/report-dispatch', 'report_dispatch_url');
--   select vault.create_secret('<secret partagé>', 'report_dispatch_secret');

create extension if not exists pg_net with schema extensions;

create or replace function public.dispatch_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target text;
  secret text;
begin
  select decrypted_secret into target from vault.decrypted_secrets where name = 'report_dispatch_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'report_dispatch_secret';
  if target is null or secret is null then
    return null; -- non configuré : la tâche planifiée prendra le relais
  end if;
  perform net.http_post(
    url := target,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := jsonb_build_object('report_id', new.id)
  );
  return null;
exception when others then
  return null; -- un souci de déclenchement ne doit jamais empêcher d'enregistrer un signalement
end $$;

revoke execute on function public.dispatch_report() from public, anon, authenticated;

create trigger reports_dispatch after insert on public.reports
  for each row execute function public.dispatch_report();
