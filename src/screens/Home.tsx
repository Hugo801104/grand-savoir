import { useMemo } from 'react';
import { LevelsBar } from '../components/ui';
import { countDue, estimateLevels, levelLabel } from '../lib/engine';
import { globalLevels, recentDiscoveries } from '../lib/progress';
import { go, href } from '../lib/router';
import { useApp } from '../lib/store';

export function Home() {
  const { content, cards, events, reports, isAdmin, user, sync } = useApp();
  const now = Date.now();
  const data = useMemo(() => {
    if (!content) return null;
    const byId = new Map(content.questions.map((q) => [q.id, q]));
    const published = new Set(content.questions.filter((q) => q.status === 'publie').map((q) => q.id));
    const levels = globalLevels(content.questions, cards, now);
    const rating = estimateLevels(events, byId).get('*') ?? 1000;
    return {
      due: countDue(cards, published, now),
      levels,
      acquired: levels.acquis + levels.maitrise,
      seen: published.size - levels.nouveau,
      total: published.size,
      rating,
      discoveries: recentDiscoveries(events, byId, 3),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, cards, events]);

  if (!content || !data) return null;
  const openReports = reports.filter((r) => !['corrige', 'rejete'].includes(r.status)).length;

  return (
    <div className="app">
      <header className="hero">
        <div className="logo">Le Grand Savoir</div>
        <p className="tagline">Le jeu qui fait grandir ta culture générale</p>
        <button className="play-btn" onClick={() => go('/jouer', { mode: 'aleatoire', t: Date.now() })} aria-label="Jouer une partie aléatoire">
          <span>
            JOUER
            <small>{data.seen === 0 ? 'première partie' : `niveau ${levelLabel(data.rating)}`}</small>
          </span>
        </button>
      </header>

      <section className="section">
        <div className="modes">
          <a className={`mode ${data.due > 0 ? 'highlight' : ''}`} href={href('/jouer', { mode: 'revision' })}>
            <span className="ico">🔁</span>
            <b>
              Révision {data.due > 0 && <span className="badge">{data.due}</span>}
            </b>
            <span>{data.due > 0 ? 'Connaissances à consolider' : 'Tout est à jour'}</span>
          </a>
          <a className="mode" href={href('/categories')}>
            <span className="ico">🗂️</span>
            <b>Thèmes</b>
            <span>Une catégorie au choix</span>
          </a>
          <a className="mode" href={href('/decouverte')}>
            <span className="ico">🧭</span>
            <b>Découverte</b>
            <span>Parcours pas à pas</span>
          </a>
          <a className="mode" href={href('/jouer', { mode: 'defi' })}>
            <span className="ico">🔥</span>
            <b>Défi</b>
            <span>Questions difficiles</span>
          </a>
          <a className="mode" href={href('/perso')}>
            <span className="ico">🎛️</span>
            <b>Sur mesure</b>
            <span>Thèmes et difficulté</span>
          </a>
          <a className="mode" href={href('/jouer', { mode: 'aleatoire', n: 5 })}>
            <span className="ico">⚡</span>
            <b>Express</b>
            <span>5 questions, 2 minutes</span>
          </a>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Ma progression</h2>
          <a href={href('/stats')}>Détails →</a>
        </div>
        <div className="card">
          <div className="stats-strip">
            <div className="stat">
              <b>{data.seen}</b>
              <span>vues / {data.total}</span>
            </div>
            <div className="stat">
              <b>{data.acquired}</b>
              <span>acquises</span>
            </div>
            <div className="stat">
              <b>{events.length}</b>
              <span>réponses</span>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <LevelsBar levels={data.levels} />
          </div>
        </div>
      </section>

      {data.discoveries.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Dernières découvertes</h2>
            <a href={href('/historique')}>Tout revoir →</a>
          </div>
          <div className="list">
            {data.discoveries.map((q) => (
              <a key={q.id} className="list-item" href={href('/question/' + q.id)}>
                <span className="ico">💡</span>
                <span className="grow">
                  <span className="small" style={{ display: 'block', fontWeight: 600 }}>{q.prompt}</span>
                  <span className="tiny">{(q.anecdote ?? q.explanation).slice(0, 110)}…</span>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="links-grid">
          <a className="list-item" href={href('/stats')}>
            <span className="ico">📊</span>
            <span className="grow">Statistiques</span>
          </a>
          <a className="list-item" href={href('/historique')}>
            <span className="ico">📚</span>
            <span className="grow">Mes questions</span>
          </a>
          <a className="list-item" href={href('/signalements')}>
            <span className="ico">⚑</span>
            <span className="grow">
              Signalements {openReports > 0 && <span className="badge soft">{openReports}</span>}
            </span>
          </a>
          <a className="list-item" href={href('/reglages')}>
            <span className="ico">⚙️</span>
            <span className="grow">Réglages</span>
          </a>
          {isAdmin && (
            <a className="list-item" href={href('/admin')} style={{ gridColumn: '1 / -1' }}>
              <span className="ico">🛠️</span>
              <span className="grow">Administration</span>
            </a>
          )}
        </div>
        <p className="tiny" style={{ textAlign: 'center', marginTop: 14 }}>
          {user
            ? sync === 'error'
              ? '⚠️ Synchronisation en erreur (tes données restent sur l’appareil)'
              : sync === 'offline'
                ? 'Hors connexion — synchro au retour du réseau'
                : `Synchronisé · ${user.email ?? ''}`
            : sync === 'local'
              ? 'Mode local : données sur cet appareil'
              : 'Non connecté : données sur cet appareil'}
        </p>
      </section>
    </div>
  );
}
