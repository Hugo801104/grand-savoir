import { useEffect, useMemo, useState } from 'react';
import { Empty, TopBar } from '../components/ui';
import { correctAnswerText } from '../lib/engine';
import { go, href } from '../lib/router';
import { type GameResult, getLastGame } from '../lib/session';
import { MASTERY_LABELS, masteryLevel } from '../lib/srs';
import { useApp } from '../lib/store';

export function Results() {
  const { content, cards } = useApp();
  const [game, setGame] = useState<GameResult | null | undefined>(undefined);
  useEffect(() => {
    void getLastGame().then(setGame);
  }, []);

  const byId = useMemo(() => new Map(content?.questions.map((q) => [q.id, q]) ?? []), [content]);
  if (game === undefined) return null;
  if (!game || !content) {
    return (
      <div className="app">
        <TopBar title="Bilan" />
        <Empty icon="🎬">Aucune partie récente.</Empty>
      </div>
    );
  }

  const total = game.answers.length;
  const good = game.answers.filter((a) => a.correct).length;
  const pct = total ? good / total : 0;
  const themes = new Map<string, { good: number; total: number }>();
  for (const a of game.answers) {
    const q = byId.get(a.questionId);
    if (!q) continue;
    const cat = content.categories.find((c) => c.id === q.category);
    const key = cat ? `${cat.icon} ${cat.name}` : q.category;
    const t = themes.get(key) ?? { good: 0, total: 0 };
    t.total++;
    if (a.correct) t.good++;
    themes.set(key, t);
  }
  const mistakes = game.answers.filter((a) => !a.correct).map((a) => byId.get(a.questionId)).filter(Boolean);
  const successes = game.answers.filter((a) => a.correct).map((a) => byId.get(a.questionId)).filter(Boolean);
  const now = Date.now();
  const toReview = game.answers
    .map((a) => byId.get(a.questionId))
    .filter((q) => q && ['fragile', 'en_cours'].includes(masteryLevel(cards.get(q.id) ?? null, now)));

  const message =
    pct === 1 ? 'Sans faute, bravo !' : pct >= 0.8 ? 'Excellent !' : pct >= 0.6 ? 'Belle partie !' : pct >= 0.4 ? 'Bien joué, ça progresse.' : 'Chaque erreur est une découverte.';
  const R = 70;
  const C = 2 * Math.PI * R;

  // « Continuer » relance une partie avec les mêmes réglages (nouvelle étape en mode découverte).
  const replayParams = { ...game.params };
  if (game.mode === 'decouverte' && replayParams.path) {
    const path = content.paths.find((x) => x.id === replayParams.path);
    const nextStep = Number(replayParams.step ?? 0) + 1;
    if (path && nextStep < path.steps.length) replayParams.step = String(nextStep);
  }
  const replay = () => go('/jouer', { ...replayParams, t: Date.now() }, true);

  return (
    <div className="app">
      <TopBar title={game.title} backTo={null} />
      <div className="score-ring">
        <svg viewBox="0 0 160 160" aria-hidden>
          <circle cx="80" cy="80" r={R} stroke="rgba(255,255,255,0.08)" strokeWidth="12" fill="none" />
          <circle
            cx="80" cy="80" r={R} stroke="url(#g)" strokeWidth="12" fill="none" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - pct)} style={{ transition: 'stroke-dashoffset 1s ease' }}
          />
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#7c6cff" />
              <stop offset="1" stopColor="#ffc94a" />
            </linearGradient>
          </defs>
        </svg>
        <div className="inner">
          <div>
            <b>
              {good}/{total}
            </b>
            <span className="muted small">{message}</span>
          </div>
        </div>
      </div>
      <p className="tiny" style={{ textAlign: 'center' }}>Ta progression est enregistrée automatiquement.</p>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={() => go('/', undefined, true)}>
          Accueil
        </button>
        <button className="btn primary" onClick={replay} autoFocus>
          Continuer ▶
        </button>
      </div>

      <section className="section">
        <h2>Thèmes travaillés</h2>
        <div className="list" style={{ marginTop: 10 }}>
          {[...themes].map(([name, t]) => (
            <div className="list-item" key={name}>
              <span className="grow">{name}</span>
              <span className={`badge ${t.good === t.total ? 'good' : t.good === 0 ? 'bad' : 'soft'}`}>
                {t.good}/{t.total}
              </span>
            </div>
          ))}
        </div>
      </section>

      {mistakes.length > 0 && (
        <section className="section">
          <h2>Erreurs à retenir ({mistakes.length})</h2>
          <div className="list" style={{ marginTop: 10 }}>
            {mistakes.map((q) => (
              <details className="result-item" key={q!.id}>
                <summary>
                  <span className="mark">❌</span> {q!.prompt} <span className="chev">›</span>
                  <div className="small" style={{ color: 'var(--good)', marginTop: 4 }}>→ {correctAnswerText(q!)}</div>
                </summary>
                <p className="small muted" style={{ marginTop: 8 }}>{q!.explanation}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {successes.length > 0 && (
        <section className="section">
          <h2>Réussites ({successes.length})</h2>
          <div className="list" style={{ marginTop: 10 }}>
            {successes.map((q) => (
              <a className="result-item" key={q!.id} href={href('/question/' + q!.id)} style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="mark">✅</span>
                <span className="grow small">
                  {q!.prompt}
                  <span className="tiny" style={{ display: 'block' }}>{MASTERY_LABELS[masteryLevel(cards.get(q!.id) ?? null, now)]}</span>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {toReview.length > 0 && (
        <section className="section">
          <div className="notice">
            <b>{toReview.length} connaissance(s) à consolider.</b> Elles reviendront automatiquement dans tes prochaines
            parties, au bon moment. Tu peux aussi les retravailler maintenant.
          </div>
          <button className="btn accent block" style={{ marginTop: 10 }} onClick={() => go('/jouer', { mode: 'revision', t: Date.now() }, true)}>
            Réviser maintenant
          </button>
        </section>
      )}
    </div>
  );
}
