// Espace d'administration : réservé aux comptes listés dans la table « admins » (vérifié côté serveur par RLS).
import { useCallback, useEffect, useState } from 'react';
import { Empty, formatDateTime, toast, TopBar } from '../components/ui';
import { correctAnswerText } from '../lib/engine';
import { rowToQuestion, type QuestionRow } from '../lib/rows';
import { getSupabase } from '../lib/supabase';
import { refreshContent, useApp } from '../lib/store';
import { EDITORIAL_STATUSES, REPORT_STATUS_LABELS, REPORT_TYPES, type ReportStatus } from '../lib/types';

type Tab = 'reports' | 'proposals' | 'content' | 'runs' | 'history' | 'costs' | 'config';
const TABS: [Tab, string][] = [
  ['reports', 'Signalements'],
  ['proposals', 'Propositions IA'],
  ['content', 'Contenus'],
  ['runs', 'Agents'],
  ['history', 'Publications'],
  ['costs', 'Coûts'],
  ['config', 'Configuration'],
];

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function useQuery(fn: () => Promise<Row[]>, deps: unknown[]) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    fn()
      .then(setRows)
      .catch((e) => setError(e.message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { rows, error, reload };
}

async function sb() {
  const c = await getSupabase();
  if (!c) throw new Error('Supabase non configuré');
  return c;
}
async function q<T = Row[]>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export function Admin() {
  const { isAdmin, user } = useApp();
  const [tab, setTab] = useState<Tab>('reports');
  if (!user || !isAdmin) {
    return (
      <div className="app">
        <TopBar title="Administration" />
        <Empty icon="🔒">Accès réservé à l'administrateur (connecte-toi avec le compte administrateur).</Empty>
      </div>
    );
  }
  return (
    <div className="app">
      <TopBar title="Administration" />
      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'reports' && <ReportsTab />}
      {tab === 'proposals' && <ProposalsTab />}
      {tab === 'content' && <ContentTab />}
      {tab === 'runs' && <RunsTab />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'costs' && <CostsTab />}
      {tab === 'config' && <ConfigTab />}
    </div>
  );
}

function ErrorBox({ error }: { error: string | null }) {
  return error ? <p className="notice bad small">{error}</p> : null;
}

// ---------------------------------------------------------------------------

function ReportsTab() {
  const [status, setStatus] = useState<string>('ouverts');
  const { rows, error, reload } = useQuery(async () => {
    let query = (await sb()).from('reports').select('*').order('created_at', { ascending: false }).limit(200);
    if (status === 'ouverts') query = query.not('status', 'in', '(corrige,rejete)');
    else if (status !== 'tous') query = query.eq('status', status);
    return q(query);
  }, [status]);

  async function update(id: string, patch: Row) {
    try {
      await q((await sb()).from('reports').update(patch).eq('id', id));
      toast('Signalement mis à jour');
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="stack">
      <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrer par statut">
        <option value="ouverts">Ouverts</option>
        <option value="tous">Tous</option>
        {Object.entries(REPORT_STATUS_LABELS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <ErrorBox error={error} />
      {rows?.length === 0 && <Empty icon="✨">Aucun signalement.</Empty>}
      {rows?.map((r) => (
        <details key={r.id} className="card tight">
          <summary>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b className="small">{REPORT_TYPES.find((t) => t.id === r.type)?.label}</b>
              <span className="badge soft">{REPORT_STATUS_LABELS[r.status as ReportStatus]}</span>
            </div>
            <p className="tiny">{formatDateTime(r.created_at)} · {r.question_id ?? 'général'}</p>
            {r.comment && <p className="small" style={{ marginTop: 4 }}>{r.comment}</p>}
          </summary>
          <dl className="kv" style={{ marginTop: 10 }}>
            <dt>Version</dt><dd>appli {r.app_version} · question v{r.question_version ?? '–'}</dd>
            {r.issue_url && (<><dt>Ticket</dt><dd><a href={r.issue_url} target="_blank" rel="noreferrer">{r.issue_url}</a></dd></>)}
            {r.pr_url && (<><dt>PR</dt><dd><a href={r.pr_url} target="_blank" rel="noreferrer">{r.pr_url}</a></dd></>)}
            {r.resolution && (<><dt>Compte rendu</dt><dd>{r.resolution}</dd></>)}
            <dt>Tentatives agent</dt><dd>{r.attempts ?? 0}</dd>
          </dl>
          {r.snapshot && <pre className="json">{JSON.stringify(r.snapshot, null, 1)}</pre>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => update(r.id, { status: 'nouveau', attempts: 0 })}>Relancer l'agent</button>
            <button className="btn sm" onClick={() => update(r.id, { status: 'corrige', resolution: r.resolution ?? 'Traité manuellement.' })}>Marquer corrigé</button>
            <button
              className="btn sm danger"
              onClick={() => {
                const why = prompt('Motif du rejet (visible par l’utilisateur) :', r.resolution ?? '');
                if (why !== null) void update(r.id, { status: 'rejete', resolution: why });
              }}
            >
              Rejeter
            </button>
          </div>
        </details>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function QuestionPreview({ row, title }: { row: Row; title: string }) {
  const qq = rowToQuestion(row as QuestionRow);
  return (
    <div className="card tight" style={{ background: 'rgba(0,0,0,0.2)' }}>
      <p className="tiny">{title}</p>
      <p className="small"><b>{qq.prompt}</b></p>
      {qq.choices && <p className="tiny">Choix : {qq.choices.join(' | ')}</p>}
      <p className="small" style={{ color: 'var(--good)' }}>→ {correctAnswerText(qq)}</p>
      <p className="tiny" style={{ marginTop: 4 }}>{qq.explanation}</p>
      {qq.anecdote && <p className="tiny">💡 {qq.anecdote}</p>}
      <ul className="sources">
        {qq.sources.map((s) => (
          <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>
        ))}
      </ul>
    </div>
  );
}

function ProposalsTab() {
  const [status, setStatus] = useState('en_attente');
  const { rows, error, reload } = useQuery(async () => {
    const c = await sb();
    const props = await q(c.from('ai_proposals').select('*').eq('status', status).order('created_at', { ascending: false }).limit(100));
    const ids = props.map((p) => p.question_id).filter(Boolean);
    const current = ids.length ? await q(c.from('questions').select('*').in('id', ids)) : [];
    return props.map((p) => ({ ...p, current: current.find((x) => x.id === p.question_id) }));
  }, [status]);

  async function decide(id: string, approve: boolean) {
    try {
      const c = await sb();
      if (approve) await q(c.rpc('apply_proposal', { p_id: id, p_actor: 'admin' }));
      else {
        const why = prompt('Motif du rejet :') ?? '';
        await q(c.rpc('reject_proposal', { p_id: id, p_reason: why }));
      }
      toast(approve ? 'Proposition appliquée et publiée' : 'Proposition rejetée');
      reload();
      void refreshContent(true);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="stack">
      <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut">
        <option value="en_attente">En attente de validation</option>
        <option value="publiee">Publiées</option>
        <option value="rejetee">Rejetées</option>
      </select>
      <ErrorBox error={error} />
      {rows?.length === 0 && <Empty icon="🤖">Aucune proposition.</Empty>}
      {rows?.map((p) => (
        <div key={p.id} className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b className="small">{p.kind === 'correction' ? 'Correction' : p.kind === 'nouvelle_question' ? 'Nouvelle question' : p.kind}</b>
            <span className={`badge ${p.confidence >= 0.85 ? 'good' : 'warn'}`}>confiance {Math.round((p.confidence ?? 0) * 100)} %</span>
          </div>
          <p className="small">{p.summary}</p>
          {p.risk_flags?.length > 0 && <p className="tiny">⚠️ {p.risk_flags.join(', ')}</p>}
          {p.current && <QuestionPreview row={p.current} title={`Actuelle (v${p.current.version})`} />}
          {p.payload && <QuestionPreview row={{ ...p.current, ...p.payload }} title="Proposée" />}
          {p.status === 'en_attente' && (
            <div className="row">
              <button className="btn sm danger" onClick={() => decide(p.id, false)}>Rejeter</button>
              <button className="btn sm primary" onClick={() => decide(p.id, true)}>Valider et publier</button>
            </div>
          )}
          <p className="tiny">{formatDateTime(p.created_at)} {p.report_id ? `· signalement ${p.report_id.slice(0, 8)}` : ''}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ContentTab() {
  const [status, setStatus] = useState('a_verifier');
  const [search, setSearch] = useState('');
  const { rows, error, reload } = useQuery(async () => {
    let query = (await sb()).from('questions').select('*').order('updated_at', { ascending: false }).limit(100);
    if (search.trim()) query = query.or(`id.ilike.%${search.replace(/[%,()]/g, '')}%,prompt.ilike.%${search.replace(/[%,()]/g, '')}%`);
    else query = query.eq('status', status);
    return q(query);
  }, [status, search]);

  async function setQStatus(id: string, s: string) {
    try {
      const reason = prompt('Motif (historique) :', s === 'publie' ? 'Validée par l’administrateur' : '') ?? '';
      await q((await sb()).rpc('set_question_status', { p_id: id, p_status: s, p_reason: reason }));
      toast('Statut modifié');
      reload();
      void refreshContent(true);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="stack">
      <input className="input" type="search" placeholder="Chercher une question (id ou texte)" value={search} onChange={(e) => setSearch(e.target.value)} />
      {!search && (
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut éditorial">
          {EDITORIAL_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      )}
      <ErrorBox error={error} />
      {rows?.length === 0 && <Empty icon="📭">Aucune question.</Empty>}
      {rows?.map((r) => (
        <details key={r.id} className="card tight">
          <summary>
            <p className="small"><b>{r.prompt}</b></p>
            <p className="tiny">{r.id} · v{r.version} · {r.status} · {r.category}/{r.subcategory} · ★{r.difficulty} · {r.origin}</p>
          </summary>
          <QuestionPreview row={r} title="Contenu" />
          <div className="row" style={{ marginTop: 8 }}>
            {r.status !== 'publie' && <button className="btn sm primary" onClick={() => setQStatus(r.id, 'publie')}>Publier</button>}
            {r.status === 'publie' && <button className="btn sm" onClick={() => setQStatus(r.id, 'suspendu')}>Suspendre</button>}
            {r.status !== 'archive' && <button className="btn sm danger" onClick={() => setQStatus(r.id, 'archive')}>Archiver</button>}
          </div>
          <QuestionHistory id={r.id} onReverted={reload} />
        </details>
      ))}
    </div>
  );
}

function QuestionHistory({ id, onReverted }: { id: string; onReverted: () => void }) {
  const [open, setOpen] = useState(false);
  const { rows } = useQuery(async () => (open ? q((await sb()).from('question_history').select('*').eq('question_id', id).order('version', { ascending: false })) : []), [open, id]);
  if (!open) return <button className="report-link" onClick={() => setOpen(true)}>Historique des versions</button>;
  return (
    <div className="stack" style={{ marginTop: 8 }}>
      {rows?.map((h) => (
        <div key={h.id} className="row small" style={{ justifyContent: 'space-between' }}>
          <span>v{h.version} · {formatDateTime(h.changed_at)} · {h.changed_by} — {h.reason}</span>
          <button
            className="btn sm"
            onClick={async () => {
              if (!confirm(`Revenir à la version ${h.version} ? (une nouvelle version sera créée)`)) return;
              try {
                await q((await sb()).rpc('revert_question', { p_id: id, p_version: h.version, p_reason: 'Retour arrière (admin)' }));
                toast('Retour arrière effectué');
                onReverted();
                void refreshContent(true);
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            Restaurer
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RunsTab() {
  const { rows, error } = useQuery(async () => q((await sb()).from('agent_runs').select('*').order('started_at', { ascending: false }).limit(100)), []);
  return (
    <div className="stack">
      <ErrorBox error={error} />
      {rows?.length === 0 && <Empty icon="🤖">Aucune exécution d'agent pour l'instant.</Empty>}
      {rows?.map((r) => (
        <div key={r.id} className="card tight">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b className="small">{r.kind}</b>
            <span className={`badge ${r.status === 'succes' ? 'good' : r.status === 'echec' ? 'bad' : 'warn'}`}>{r.status}</span>
          </div>
          <p className="tiny">
            {formatDateTime(r.started_at)} · {r.cost_usd ? `${Number(r.cost_usd).toFixed(3)} $` : 'coût n/c'}
            {r.run_url && (<> · <a href={r.run_url} target="_blank" rel="noreferrer">journal</a></>)}
          </p>
          {r.summary && <p className="small" style={{ marginTop: 4 }}>{r.summary}</p>}
          {r.error && <p className="small" style={{ color: 'var(--bad)', marginTop: 4 }}>{r.error}</p>}
        </div>
      ))}
    </div>
  );
}

function HistoryTab() {
  const { rows, error } = useQuery(async () => q((await sb()).from('question_history').select('id,question_id,version,changed_at,changed_by,reason').order('changed_at', { ascending: false }).limit(150)), []);
  return (
    <div className="stack">
      <ErrorBox error={error} />
      <table className="simple">
        <thead><tr><th>Date</th><th>Question</th><th>Par</th><th>Motif</th></tr></thead>
        <tbody>
          {rows?.map((h) => (
            <tr key={h.id}>
              <td className="tiny">{formatDateTime(h.changed_at)}</td>
              <td className="tiny">{h.question_id} v{h.version}</td>
              <td className="tiny">{h.changed_by}</td>
              <td className="tiny">{h.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tiny">Pour revenir en arrière : onglet Contenus → chercher la question → Historique des versions → Restaurer.</p>
    </div>
  );
}

function CostsTab() {
  const { rows, error } = useQuery(async () => q((await sb()).from('ai_usage_monthly').select('*').order('month', { ascending: false }).limit(12)), []);
  return (
    <div className="stack">
      <ErrorBox error={error} />
      <table className="simple">
        <thead><tr><th>Mois</th><th>Exécutions</th><th>Échecs</th><th>Coût</th></tr></thead>
        <tbody>
          {rows?.map((m) => (
            <tr key={m.month}>
              <td>{String(m.month).slice(0, 7)}</td>
              <td>{m.runs}</td>
              <td>{m.failures}</td>
              <td>{Number(m.cost_usd ?? 0).toFixed(2)} $</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows?.length === 0 && <p className="tiny">Aucune consommation enregistrée.</p>}
      <p className="tiny">Plafonds réglables dans l'onglet Configuration. Au-delà, les agents s'arrêtent automatiquement.</p>
    </div>
  );
}

function ConfigTab() {
  const { rows, error, reload } = useQuery(async () => q((await sb()).from('system_config').select('*').order('key')), []);
  return (
    <div className="stack">
      <ErrorBox error={error} />
      {rows?.map((c) => (
        <form
          key={c.key}
          className="card tight stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const raw = String(new FormData(e.currentTarget).get('v'));
            try {
              const value = JSON.parse(raw);
              await q((await sb()).from('system_config').update({ value, updated_at: new Date().toISOString() }).eq('key', c.key));
              toast('Enregistré');
              reload();
            } catch (err) {
              toast(`Valeur invalide : ${(err as Error).message}`);
            }
          }}
        >
          <b className="small">{c.key}</b>
          <span className="tiny">{c.description}</span>
          <div className="row">
            <input className="input" name="v" defaultValue={JSON.stringify(c.value)} style={{ flex: 1 }} />
            <button className="btn sm">OK</button>
          </div>
        </form>
      ))}
    </div>
  );
}
