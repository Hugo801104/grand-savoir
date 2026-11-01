// Suivi et administration. Tout est lu depuis GitHub (données publiques) : aucun compte requis pour consulter.
// Les décisions (valider une correction, revenir en arrière, régler l'agent) se prennent sur GitHub,
// y compris depuis l'application mobile GitHub : fusionner / fermer une Pull Request, bouton « Revert », etc.

import { useEffect, useMemo, useState } from 'react';
import { Empty, formatDateTime, TopBar } from '../components/ui';
import { GITHUB_REPO } from '../lib/config';
import {
  type AgentRun,
  type GhCommit,
  type GhIssue,
  type GhPull,
  listContentCommits,
  listPulls,
  listReportIssues,
  readAgentConfig,
  readAgentJournal,
  statusFromIssue,
} from '../lib/github';
import { findStale } from '../lib/quality';
import { useApp } from '../lib/store';
import { REPORT_STATUS_LABELS } from '../lib/types';

type Tab = 'signalements' | 'validations' | 'publications' | 'agents' | 'contenu' | 'reglages';
const TABS: [Tab, string][] = [
  ['signalements', 'Signalements'],
  ['validations', 'À valider'],
  ['publications', 'Publications'],
  ['agents', 'Agents et coûts'],
  ['contenu', 'Contenu'],
  ['reglages', 'Réglages'],
];
const GH = `https://github.com/${GITHUB_REPO}`;

function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setError(null);
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

const Err = ({ e }: { e: string | null }) => (e ? <p className="notice bad small">{e}</p> : null);

export function Suivi() {
  const [tab, setTab] = useState<Tab>('signalements');
  return (
    <div className="app">
      <TopBar title="Suivi technique" backTo="/reglages" />
      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'signalements' && <Reports />}
      {tab === 'validations' && <Validations />}
      {tab === 'publications' && <Publications />}
      {tab === 'agents' && <Agents />}
      {tab === 'contenu' && <Contenu />}
      {tab === 'reglages' && <Reglages />}
    </div>
  );
}

function Reports() {
  const { data, error } = useLoad<GhIssue[]>(listReportIssues);
  return (
    <div className="stack">
      <Err e={error} />
      {data?.length === 0 && <Empty icon="✨">Aucun signalement.</Empty>}
      {data?.map((i) => (
        <a key={i.number} className="list-item" href={i.html_url} target="_blank" rel="noopener noreferrer">
          <span className="grow">
            <span className="small" style={{ display: 'block' }}>
              #{i.number} {i.title.replace(/^\[Signalement\]\s*/, '')}
            </span>
            <span className="tiny">
              {formatDateTime(i.created_at)} · {i.user?.login}
            </span>
          </span>
          <span className="badge soft">{REPORT_STATUS_LABELS[statusFromIssue(i)]}</span>
        </a>
      ))}
    </div>
  );
}

function Validations() {
  const { data, error } = useLoad<GhPull[]>(listPulls);
  const open = data?.filter((p) => p.state === 'open') ?? [];
  return (
    <div className="stack">
      <p className="tiny">
        Corrections et nouvelles questions proposées par l'agent, et modifications de code. Valider = fusionner la Pull
        Request ; refuser = la fermer. Rien n'est publié sans fusion.
      </p>
      <Err e={error} />
      {data && open.length === 0 && <Empty icon="✅">Rien en attente de validation.</Empty>}
      {open.map((p) => (
        <a key={p.number} className="list-item" href={p.html_url} target="_blank" rel="noopener noreferrer">
          <span className="grow">
            <span className="small" style={{ display: 'block' }}>#{p.number} {p.title}</span>
            <span className="tiny">
              {formatDateTime(p.created_at)} · {p.labels.map((l) => l.name).join(', ') || p.head.ref}
            </span>
          </span>
          <span aria-hidden>↗</span>
        </a>
      ))}
      <a className="btn sm ghost" href={`${GH}/pulls`} target="_blank" rel="noopener noreferrer">
        Toutes les Pull Requests ↗
      </a>
    </div>
  );
}

function Publications() {
  const { data, error } = useLoad<GhCommit[]>(listContentCommits);
  return (
    <div className="stack">
      <p className="tiny">
        Historique des modifications de la bibliothèque. Chaque version reste disponible ; pour revenir en arrière,
        ouvre la Pull Request concernée sur GitHub et utilise le bouton « Revert ».
      </p>
      <Err e={error} />
      {data?.map((c) => (
        <a key={c.sha} className="list-item" href={c.html_url} target="_blank" rel="noopener noreferrer">
          <span className="grow">
            <span className="small" style={{ display: 'block' }}>{c.commit.message.split('\n')[0]}</span>
            <span className="tiny">
              {formatDateTime(c.commit.author.date)} · {c.commit.author.name} · {c.sha.slice(0, 7)}
            </span>
          </span>
        </a>
      ))}
    </div>
  );
}

function Agents() {
  const { data, error } = useLoad<AgentRun[]>(readAgentJournal);
  const months = useMemo(() => {
    const m = new Map<string, { runs: number; failures: number; cost: number }>();
    for (const r of data ?? []) {
      const k = r.date.slice(0, 7);
      const v = m.get(k) ?? { runs: 0, failures: 0, cost: 0 };
      v.runs++;
      if (r.status === 'echec') v.failures++;
      v.cost += r.cost_usd ?? 0;
      m.set(k, v);
    }
    return [...m];
  }, [data]);
  return (
    <div className="stack">
      <Err e={error} />
      <div className="card tight">
        <h3>Consommation par mois</h3>
        {months.length === 0 ? (
          <p className="tiny" style={{ marginTop: 6 }}>Aucune exécution d'agent enregistrée.</p>
        ) : (
          <table className="simple" style={{ marginTop: 6 }}>
            <thead>
              <tr><th>Mois</th><th>Exécutions</th><th>Échecs</th><th>Coût</th></tr>
            </thead>
            <tbody>
              {months.map(([k, v]) => (
                <tr key={k}><td>{k}</td><td>{v.runs}</td><td>{v.failures}</td><td>{v.cost.toFixed(2)} $</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data?.slice(0, 50).map((r, i) => (
        <div key={i} className="card tight">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b className="small">{r.kind}{r.issue ? ` · #${r.issue}` : ''}</b>
            <span className={`badge ${r.status === 'succes' ? 'good' : r.status === 'echec' ? 'bad' : 'soft'}`}>{r.status}</span>
          </div>
          <p className="tiny">
            {formatDateTime(r.date)}
            {r.cost_usd != null ? ` · ${r.cost_usd.toFixed(3)} $` : ''}
            {r.run_url && (<> · <a href={r.run_url} target="_blank" rel="noopener noreferrer">journal d'exécution</a></>)}
          </p>
          {r.summary && <p className="small" style={{ marginTop: 4 }}>{r.summary}</p>}
          {r.error && <p className="small" style={{ color: 'var(--bad)', marginTop: 4 }}>{r.error}</p>}
        </div>
      ))}
      <a className="btn sm ghost" href={`${GH}/actions`} target="_blank" rel="noopener noreferrer">Exécutions GitHub Actions ↗</a>
    </div>
  );
}

function Contenu() {
  const { content } = useApp();
  if (!content) return null;
  const qs = content.questions;
  const stale = findStale(qs, Date.now(), 365);
  const byFormat = new Map<string, number>();
  for (const q of qs) byFormat.set(q.format, (byFormat.get(q.format) ?? 0) + 1);
  return (
    <div className="stack">
      <div className="card tight">
        <dl className="kv">
          <dt>Questions publiées</dt><dd>{qs.length}</dd>
          <dt>Catégories</dt><dd>{content.categories.length}</dd>
          <dt>Parcours</dt><dd>{content.paths.length}</dd>
          <dt>Formats</dt><dd>{[...byFormat].map(([k, v]) => `${k} ${v}`).join(' · ')}</dd>
          <dt>Sources</dt><dd>{qs.reduce((a, q) => a + q.sources.length, 0)}</dd>
          <dt>À revérifier (&gt; 1 an)</dt><dd>{stale.length}</dd>
          <dt>Version</dt><dd>{content.version} ({formatDateTime(content.generatedAt)})</dd>
        </dl>
      </div>
      <table className="simple">
        <thead><tr><th>Catégorie</th><th>Questions</th><th>Difficultés</th></tr></thead>
        <tbody>
          {content.categories.map((c) => {
            const inCat = qs.filter((q) => q.category === c.id);
            return (
              <tr key={c.id}>
                <td>{c.icon} {c.name}</td>
                <td>{inCat.length}</td>
                <td>{[1, 2, 3, 4, 5].map((d) => inCat.filter((q) => q.difficulty === d).length).join(' / ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Reglages() {
  const { data, error } = useLoad(readAgentConfig);
  return (
    <div className="stack">
      <p className="tiny">
        Les réglages de l'agent (activation, plafonds, seuils de publication automatique, enrichissement) sont dans le
        fichier <code>agent.config.json</code> du dépôt. Pour les modifier : l'ouvrir sur GitHub et cliquer sur le crayon.
      </p>
      <Err e={error} />
      {data && <pre className="json">{JSON.stringify(data, null, 2)}</pre>}
      <a className="btn sm" href={`${GH}/edit/main/agent.config.json`} target="_blank" rel="noopener noreferrer">Modifier les réglages ↗</a>
      <a className="btn sm ghost" href={`${GH}/settings/secrets/actions`} target="_blank" rel="noopener noreferrer">Secrets (clé IA) ↗</a>
    </div>
  );
}
