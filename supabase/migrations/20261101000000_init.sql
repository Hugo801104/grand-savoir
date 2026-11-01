-- Le Grand Savoir — schéma initial
-- Principes :
--  * contenus (questions, catégories, parcours) lisibles par tous s'ils sont publiés ;
--  * données personnelles (réponses, réglages, signalements) visibles uniquement par leur propriétaire ;
--  * administration et agents : réservés aux comptes de la table admins et à la clé service_role (jamais dans l'appli) ;
--  * chaque modification de question crée une version dans question_history (retour arrière possible).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Administrateurs
-- ---------------------------------------------------------------------------
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- aucune politique : table invisible via l'API, consultée uniquement par is_admin().

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.is_service() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;

create or replace function public.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_admin() or public.is_service()) then
    raise exception 'réservé à l''administration' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Contenus
-- ---------------------------------------------------------------------------
create type public.editorial_status as enum ('brouillon', 'a_verifier', 'valide', 'publie', 'suspendu', 'archive');

create table public.content_meta (
  id int primary key default 1 check (id = 1),
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.content_meta (id) values (1);

create table public.categories (
  id text primary key check (id ~ '^[a-z0-9-]{2,60}$'),
  name text not null,
  icon text not null default '❓',
  color text not null default '#7c6cff',
  position int not null default 100,
  subcategories jsonb not null default '[]'
);

create table public.paths (
  id text primary key check (id ~ '^[a-z0-9-]{2,80}$'),
  title text not null,
  description text not null default '',
  category text not null references public.categories (id),
  icon text not null default '🧭',
  steps jsonb not null default '[]',
  status public.editorial_status not null default 'publie',
  updated_at timestamptz not null default now()
);

create table public.questions (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  version int not null default 1,
  status public.editorial_status not null default 'brouillon',
  format text not null check (format in ('qcm', 'vrai_faux', 'saisie', 'classement', 'association')),
  category text not null references public.categories (id),
  subcategory text not null,
  themes text[] not null default '{}',
  difficulty smallint not null check (difficulty between 1 and 5),
  prompt text not null check (char_length(prompt) between 10 and 400),
  data jsonb not null default '{}',
  explanation text not null check (char_length(explanation) >= 30),
  anecdote text,
  see_also text[] not null default '{}',
  sources jsonb not null default '[]',
  origin text,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  fingerprint text generated always as (lower(regexp_replace(prompt, '[^[:alnum:]]+', ' ', 'g'))) stored,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'systeme',
  change_reason text,
  -- une question publiée doit toujours avoir au moins une source
  constraint publie_avec_source check (status <> 'publie' or jsonb_array_length(sources) > 0)
);
create index questions_status_idx on public.questions (status);
create index questions_category_idx on public.questions (category);
-- doublon strict : même énoncé (normalisé) sur deux questions actives
create unique index questions_fingerprint_uniq on public.questions (fingerprint) where status <> 'archive';

create table public.question_history (
  id bigserial primary key,
  question_id text not null,
  version int not null,
  snapshot jsonb not null,
  changed_at timestamptz not null default now(),
  changed_by text,
  reason text
);
create index question_history_q_idx on public.question_history (question_id, version desc);

-- Version : incrémentée à chaque changement réel ; historique : un instantané par version.
create or replace function public.questions_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - array['version', 'updated_at', 'updated_by', 'change_reason', 'fingerprint'])
     is distinct from (to_jsonb(old) - array['version', 'updated_at', 'updated_by', 'change_reason', 'fingerprint']) then
    new.version := old.version + 1;
    new.updated_at := now();
  else
    new.version := old.version;
  end if;
  return new;
end $$;
create trigger questions_before_update before update on public.questions
  for each row execute function public.questions_before_update();

create or replace function public.questions_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into public.question_history (question_id, version, snapshot, changed_by, reason)
    values (new.id, new.version, to_jsonb(new) - 'fingerprint', new.updated_by, coalesce(new.change_reason, case when tg_op = 'INSERT' then 'création' else 'modification' end));
  end if;
  return null;
end $$;
create trigger questions_history after insert or update on public.questions
  for each row execute function public.questions_history();

-- Toute modification de contenu change la version globale : les applis savent qu'il faut se mettre à jour.
create or replace function public.bump_content_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.content_meta set version = version + 1, updated_at = now() where id = 1;
  return null;
end $$;
create trigger questions_bump after insert or update or delete on public.questions for each statement execute function public.bump_content_version();
create trigger categories_bump after insert or update or delete on public.categories for each statement execute function public.bump_content_version();
create trigger paths_bump after insert or update or delete on public.paths for each statement execute function public.bump_content_version();

alter table public.content_meta enable row level security;
alter table public.categories enable row level security;
alter table public.paths enable row level security;
alter table public.questions enable row level security;
alter table public.question_history enable row level security;

create policy "lecture publique" on public.content_meta for select using (true);
create policy "lecture publique" on public.categories for select using (true);
create policy "admin écrit" on public.categories for all using (public.is_admin()) with check (public.is_admin());
create policy "lecture des parcours publiés" on public.paths for select using (status = 'publie' or public.is_admin());
create policy "admin écrit" on public.paths for all using (public.is_admin()) with check (public.is_admin());
create policy "lecture des questions publiées" on public.questions for select using (status = 'publie' or public.is_admin());
create policy "admin écrit" on public.questions for all using (public.is_admin()) with check (public.is_admin());
create policy "admin lit l'historique" on public.question_history for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Données personnelles
-- ---------------------------------------------------------------------------
create table public.answer_events (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id text not null,
  question_version int,
  correct boolean not null,
  response_ms int check (response_ms is null or response_ms between 0 and 3600000),
  mode text check (char_length(mode) <= 20),
  answered_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create index answer_events_user_created_idx on public.answer_events (user_id, created_at);
alter table public.answer_events enable row level security;
create policy "chacun lit ses réponses" on public.answer_events for select using (user_id = auth.uid());
create policy "chacun ajoute ses réponses" on public.answer_events for insert with check (user_id = auth.uid());

-- La date d'enregistrement est fixée par le serveur (curseur de synchronisation fiable).
create or replace function public.answer_events_server_time() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := clock_timestamp();
  return new;
end $$;
create trigger answer_events_server_time before insert on public.answer_events
  for each row execute function public.answer_events_server_time();

create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings jsonb not null default '{}' check (pg_column_size(settings) < 10000),
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
create policy "chacun gère ses réglages" on public.user_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Signalements
-- ---------------------------------------------------------------------------
create type public.report_status as enum (
  'nouveau', 'en_analyse', 'correction_proposee', 'en_attente_validation', 'corrige', 'rejete', 'echec_technique'
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  type text not null check (type in ('erreur_factuelle', 'mauvaise_reponse', 'ambigue', 'explication', 'anecdote', 'source',
                                      'amelioration', 'nouvelle_question', 'bug', 'autre')),
  comment text not null default '' check (char_length(comment) <= 2000),
  question_id text,
  question_version int,
  snapshot jsonb check (snapshot is null or pg_column_size(snapshot) < 20000),
  app_version text check (char_length(app_version) <= 30),
  client_info jsonb check (client_info is null or pg_column_size(client_info) < 2000),
  created_at timestamptz not null default now(),
  status public.report_status not null default 'nouveau',
  resolution text,
  analysis jsonb,
  issue_number int,
  issue_url text,
  pr_url text,
  attempts int not null default 0,
  updated_at timestamptz not null default now()
);
create index reports_status_idx on public.reports (status, created_at);
create index reports_user_idx on public.reports (user_id, created_at desc);
alter table public.reports enable row level security;
create policy "chacun crée ses signalements" on public.reports for insert with check (user_id = auth.uid());
create policy "chacun lit ses signalements" on public.reports for select using (user_id = auth.uid() or public.is_admin());
create policy "admin met à jour" on public.reports for update using (public.is_admin()) with check (public.is_admin());

-- Protection : un utilisateur ne peut ni fixer le statut, ni dépasser un débit raisonnable (anti-spam).
create or replace function public.reports_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  last_hour int;
  last_day int;
begin
  if public.is_service() then
    return new;
  end if;
  new.status := 'nouveau';
  new.resolution := null;
  new.analysis := null;
  new.issue_number := null;
  new.issue_url := null;
  new.pr_url := null;
  new.attempts := 0;
  new.created_at := now();
  new.updated_at := now();
  select count(*) into last_hour from public.reports where user_id = new.user_id and created_at > now() - interval '1 hour';
  select count(*) into last_day from public.reports where user_id = new.user_id and created_at > now() - interval '1 day';
  if last_hour >= 20 or last_day >= 60 then
    raise exception 'trop de signalements, réessaie plus tard' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger reports_before_insert before insert on public.reports
  for each row execute function public.reports_before_insert();

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger reports_touch before update on public.reports for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Agents IA : propositions, exécutions, configuration et budget
-- ---------------------------------------------------------------------------
create table public.ai_proposals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('correction', 'nouvelle_question', 'categorie', 'parcours', 'autre')),
  report_id uuid references public.reports (id) on delete set null,
  question_id text,
  payload jsonb,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  summary text not null default '',
  risk_flags text[] not null default '{}',
  checks jsonb,
  status text not null default 'en_attente' check (status in ('en_attente', 'publiee', 'rejetee')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  agent_run_id uuid
);
create index ai_proposals_status_idx on public.ai_proposals (status, created_at desc);
alter table public.ai_proposals enable row level security;
create policy "admin" on public.ai_proposals for all using (public.is_admin()) with check (public.is_admin());

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  report_id uuid references public.reports (id) on delete set null,
  issue_number int,
  status text not null default 'en_cours' check (status in ('en_cours', 'succes', 'echec', 'ignore')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cost_usd numeric,
  input_tokens int,
  output_tokens int,
  summary text,
  error text,
  run_url text
);
create index agent_runs_started_idx on public.agent_runs (started_at desc);
alter table public.agent_runs enable row level security;
create policy "admin lit" on public.agent_runs for select using (public.is_admin());

create view public.ai_usage_monthly with (security_invoker = true) as
  select date_trunc('month', started_at) as month,
         count(*) as runs,
         count(*) filter (where status = 'echec') as failures,
         coalesce(sum(cost_usd), 0) as cost_usd
  from public.agent_runs
  group by 1;

create table public.system_config (
  key text primary key,
  value jsonb not null,
  description text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.system_config enable row level security;
create policy "admin" on public.system_config for all using (public.is_admin()) with check (public.is_admin());

insert into public.system_config (key, value, description) values
  ('agent_enabled', 'true', 'Active le traitement automatique des signalements par l''agent IA.'),
  ('agent_max_runs_per_day', '10', 'Nombre maximal d''exécutions d''agent par jour (toutes tâches confondues).'),
  ('agent_monthly_budget_usd', '10', 'Budget mensuel maximal (en dollars) des services IA. Au-delà, les agents s''arrêtent.'),
  ('agent_max_attempts_per_report', '2', 'Nombre maximal de tentatives par signalement avant « échec technique ».'),
  ('agent_reports_per_run', '3', 'Nombre de signalements traités par exécution.'),
  ('auto_publish_enabled', 'true', 'Autorise la publication automatique des corrections de contenu sûres.'),
  ('auto_publish_min_confidence', '0.9', 'Confiance minimale (0 à 1) pour publier une correction sans validation humaine.'),
  ('enrichment_enabled', 'false', 'Active l''enrichissement hebdomadaire de la bibliothèque par l''IA.'),
  ('enrichment_batch_size', '5', 'Nombre de nouvelles questions proposées par l''enrichissement hebdomadaire.'),
  ('enrichment_auto_publish', 'false', 'Publier sans validation humaine les nouvelles questions qui passent tous les contrôles.');

-- État du budget, utilisé par les scripts d'agent avant chaque exécution.
create or replace function public.agent_budget_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb;
  runs_today int;
  cost_month numeric;
begin
  perform public.require_admin();
  select jsonb_object_agg(key, value) into cfg from public.system_config;
  select count(*) into runs_today from public.agent_runs where started_at > now() - interval '1 day';
  select coalesce(sum(cost_usd), 0) into cost_month from public.agent_runs where started_at >= date_trunc('month', now());
  return jsonb_build_object(
    'config', cfg,
    'runs_today', runs_today,
    'cost_month_usd', cost_month,
    'allowed', coalesce((cfg ->> 'agent_enabled')::boolean, false)
               and runs_today < coalesce((cfg ->> 'agent_max_runs_per_day')::int, 0)
               and cost_month < coalesce((cfg ->> 'agent_monthly_budget_usd')::numeric, 0)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Actions éditoriales (administration et agents)
-- ---------------------------------------------------------------------------
create or replace function public.set_question_status(p_id text, p_status public.editorial_status, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  update public.questions
     set status = p_status,
         verified_at = case when p_status = 'publie' then now() else verified_at end,
         updated_by = case when public.is_service() then 'agent' else 'admin' end,
         change_reason = coalesce(nullif(p_reason, ''), 'statut : ' || p_status)
   where id = p_id;
  if not found then raise exception 'question introuvable : %', p_id; end if;
end $$;

create or replace function public.revert_question(p_id text, p_version int, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  snap jsonb;
begin
  perform public.require_admin();
  select snapshot into snap from public.question_history where question_id = p_id and version = p_version;
  if snap is null then raise exception 'version introuvable'; end if;
  update public.questions set
    status = (snap ->> 'status')::public.editorial_status,
    format = snap ->> 'format',
    category = snap ->> 'category',
    subcategory = snap ->> 'subcategory',
    themes = array(select jsonb_array_elements_text(snap -> 'themes')),
    difficulty = (snap ->> 'difficulty')::smallint,
    prompt = snap ->> 'prompt',
    data = snap -> 'data',
    explanation = snap ->> 'explanation',
    anecdote = snap ->> 'anecdote',
    see_also = array(select jsonb_array_elements_text(snap -> 'see_also')),
    sources = snap -> 'sources',
    verified_at = (snap ->> 'verified_at')::timestamptz,
    updated_by = case when public.is_service() then 'agent' else 'admin' end,
    change_reason = coalesce(p_reason, 'retour arrière vers la version ' || p_version)
  where id = p_id;
end $$;

-- Applique une proposition (correction ou nouvelle question) : seuls les champs autorisés sont repris.
create or replace function public.apply_proposal(p_id uuid, p_actor text default 'admin')
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.ai_proposals;
  pl jsonb;
begin
  perform public.require_admin();
  select * into p from public.ai_proposals where id = p_id for update;
  if p is null then raise exception 'proposition introuvable'; end if;
  if p.status <> 'en_attente' then raise exception 'proposition déjà traitée'; end if;
  pl := coalesce(p.payload, '{}'::jsonb);

  if p.kind = 'correction' then
    update public.questions q set
      prompt = coalesce(pl ->> 'prompt', q.prompt),
      data = coalesce(pl -> 'data', q.data),
      explanation = coalesce(pl ->> 'explanation', q.explanation),
      anecdote = case when pl ? 'anecdote' then pl ->> 'anecdote' else q.anecdote end,
      sources = coalesce(pl -> 'sources', q.sources),
      difficulty = coalesce((pl ->> 'difficulty')::smallint, q.difficulty),
      subcategory = coalesce(pl ->> 'subcategory', q.subcategory),
      themes = case when pl ? 'themes' then array(select jsonb_array_elements_text(pl -> 'themes')) else q.themes end,
      status = coalesce((pl ->> 'status')::public.editorial_status, 'publie'),
      verified_at = now(),
      updated_by = p_actor,
      change_reason = left('correction : ' || p.summary, 500)
    where q.id = p.question_id;
    if not found then raise exception 'question introuvable : %', p.question_id; end if;
  elsif p.kind = 'nouvelle_question' then
    insert into public.questions (id, status, format, category, subcategory, themes, difficulty, prompt, data,
                                  explanation, anecdote, see_also, sources, origin, confidence, verified_at, updated_by, change_reason)
    values (pl ->> 'id', 'publie', pl ->> 'format', pl ->> 'category', pl ->> 'subcategory',
            coalesce(array(select jsonb_array_elements_text(pl -> 'themes')), '{}'),
            (pl ->> 'difficulty')::smallint, pl ->> 'prompt', coalesce(pl -> 'data', '{}'), pl ->> 'explanation',
            pl ->> 'anecdote', coalesce(array(select jsonb_array_elements_text(pl -> 'see_also')), '{}'),
            coalesce(pl -> 'sources', '[]'), 'ia', p.confidence, now(), p_actor, left('nouvelle question : ' || p.summary, 500));
  else
    raise exception 'type de proposition non applicable automatiquement : %', p.kind;
  end if;

  update public.ai_proposals set status = 'publiee', decided_at = now(), decided_by = p_actor where id = p_id;
  if p.report_id is not null then
    update public.reports set status = 'corrige', resolution = left(p.summary, 2000) where id = p.report_id;
  end if;
end $$;

create or replace function public.reject_proposal(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.ai_proposals;
begin
  perform public.require_admin();
  update public.ai_proposals set status = 'rejetee', decided_at = now(),
         decided_by = case when public.is_service() then 'agent' else 'admin' end
   where id = p_id and status = 'en_attente' returning * into p;
  if p is null then raise exception 'proposition introuvable ou déjà traitée'; end if;
  if p.report_id is not null then
    update public.reports set status = 'rejete',
           resolution = coalesce(nullif(p_reason, ''), 'La correction proposée n''a pas été retenue après vérification.')
     where id = p.report_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RGPD : suppression de son compte et de ses données en ligne
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  -- réponses et réglages : supprimés en cascade ; signalements : conservés mais anonymisés
  delete from auth.users where id = auth.uid();
end $$;

-- Droits d'exécution : uniquement les comptes connectés (les fonctions vérifient elles-mêmes l'administration).
revoke execute on all functions in schema public from public, anon;
-- is_admin() est évaluée dans les règles de lecture, y compris pour les visiteurs non connectés.
grant execute on function public.is_admin() to anon;
grant execute on function public.is_admin(), public.delete_my_account(), public.set_question_status(text, public.editorial_status, text),
  public.revert_question(text, int, text), public.apply_proposal(uuid, text), public.reject_proposal(uuid, text),
  public.agent_budget_status() to authenticated, service_role;
