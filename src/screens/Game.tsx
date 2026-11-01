import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QuestionPlay, Verdict } from '../components/QuestionPlay';
import { ReportSheet } from '../components/ReportSheet';
import { Bar, Empty } from '../components/ui';
import { buildSession, type GivenAnswer, type SessionOptions } from '../lib/engine';
import { playResult, playTick } from '../lib/feedback';
import { go, type Route } from '../lib/router';
import { setLastGame, type GameResult } from '../lib/session';
import { getState, recordAnswer, useApp } from '../lib/store';
import type { GameMode, Question } from '../lib/types';

const MODE_TITLES: Record<GameMode, string> = {
  aleatoire: 'Partie aléatoire',
  thematique: 'Partie thématique',
  personnalisee: 'Partie personnalisée',
  decouverte: 'Découverte',
  defi: 'Défi',
  revision: 'Révision',
};

const list = (s?: string) => (s ? s.split(',').filter(Boolean) : undefined);

export function Game({ route }: { route: Route }) {
  const { content, settings } = useApp();
  const p = route.params;
  const mode = (p.mode as GameMode) || 'aleatoire';
  const path = content?.paths.find((x) => x.id === p.path);
  const step = path?.steps[Number(p.step ?? 0)];

  // La partie est construite une seule fois (elle ne doit pas changer pendant qu'on joue).
  const [session] = useState<Question[]>(() => {
    const st = getState();
    if (!st.content) return [];
    const opts: SessionOptions = {
      mode,
      count: Number(p.n) || st.settings.questionsPerGame,
      categories: list(p.cat),
      subcategories: list(p.sub),
      difficulties: list(p.diff)?.map(Number),
      formats: list(p.fmt),
      questionIds: step?.questionIds,
    };
    return buildSession(opts, { questions: st.content.questions, cards: st.cards, events: st.events, now: Date.now() });
  });

  const [index, setIndex] = useState(0);
  const [given, setGiven] = useState<GivenAnswer | null>(null);
  const [wasCorrect, setWasCorrect] = useState(false);
  const [results, setResults] = useState<GameResult['answers']>([]);
  const [reporting, setReporting] = useState(false);
  const [showIntro, setShowIntro] = useState(mode === 'decouverte' && !!step);
  const shownRef = useRef<string[]>([]);
  const startRef = useRef(Date.now());
  const q = session[index];
  const category = content?.categories.find((c) => c.id === q?.category);
  const timerOn = settings.timerEnabled && !showIntro;
  const [left, setLeft] = useState(settings.timerSeconds);

  const finish = useCallback(
    (answers: GameResult['answers']) => {
      setLastGame({ mode, title: step ? `${path?.title} — ${step.title}` : MODE_TITLES[mode], answers, params: p, endedAt: Date.now() });
      go('/resultats', undefined, true);
    },
    [mode, p, path, step],
  );

  const answer = useCallback(
    (g: GivenAnswer, correct: boolean) => {
      if (given || !q) return;
      const responseMs = Date.now() - startRef.current;
      setGiven(g);
      setWasCorrect(correct);
      playResult(correct);
      setResults((r) => [...r, { questionId: q.id, correct, timedOut: g.kind === 'timeout' }]);
      void recordAnswer({ questionId: q.id, questionVersion: q.version, correct, responseMs, mode });
    },
    [given, q, mode],
  );

  // Chronomètre facultatif.
  useEffect(() => {
    if (!timerOn || given || !q) return;
    setLeft(settings.timerSeconds);
    const started = Date.now();
    const t = setInterval(() => {
      const remaining = settings.timerSeconds - Math.floor((Date.now() - started) / 1000);
      setLeft(remaining);
      if (remaining <= 5 && remaining > 0) playTick();
      if (remaining <= 0) {
        clearInterval(t);
        answer({ kind: 'timeout' }, false);
      }
    }, 250);
    return () => clearInterval(t);
  }, [timerOn, given, q, settings.timerSeconds, answer]);

  const next = useCallback(() => {
    if (index + 1 >= session.length) {
      finish(results);
      return;
    }
    setIndex(index + 1);
    setGiven(null);
    startRef.current = Date.now();
  }, [index, session.length, finish, results]);

  // Entrée / espace = question suivante.
  useEffect(() => {
    if (!given || reporting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
    };
    const t = setTimeout(() => window.addEventListener('keydown', onKey), 150);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [given, next, reporting]);

  const related = useMemo(() => {
    if (!q || !content) return [];
    const cards = getState().cards;
    const byId = new Map(content.questions.map((x) => [x.id, x]));
    const linked = (q.seeAlso ?? []).map((id) => byId.get(id)).filter((x): x is Question => !!x && x.status === 'publie');
    // On privilégie les notions déjà étudiées.
    return [...linked.filter((x) => cards.has(x.id)), ...linked.filter((x) => !cards.has(x.id))].slice(0, 3);
  }, [q, content]);

  const onShown = useCallback((labels: string[]) => {
    shownRef.current = labels;
  }, []);

  if (!content) return null;
  if (session.length === 0) {
    return (
      <div className="app">
        <Empty icon={mode === 'revision' ? '🎉' : '🔍'}>
          <p>
            {mode === 'revision'
              ? 'Rien à réviser pour le moment : tout est à jour !'
              : 'Aucune question ne correspond à ces critères.'}
          </p>
          <div className="spacer" />
          <button className="btn primary" onClick={() => go('/', undefined, true)}>
            Retour à l'accueil
          </button>
        </Empty>
      </div>
    );
  }

  if (showIntro && step) {
    return (
      <div className="app">
        <div className="game">
          <div className="q-card">
            <div className="q-meta">
              <span className="pill">
                {path?.icon} {path?.title}
              </span>
              <span className="pill">
                Étape {Number(p.step ?? 0) + 1}/{path?.steps.length}
              </span>
            </div>
            <h2>{step.title}</h2>
            <p style={{ marginTop: 10 }}>{step.intro}</p>
          </div>
          <div className="game-actions">
            <button className="btn ghost" onClick={() => go('/', undefined, true)}>
              Plus tard
            </button>
            <button className="btn primary" autoFocus onClick={() => setShowIntro(false)}>
              C'est parti ({session.length} questions)
            </button>
          </div>
        </div>
      </div>
    );
  }

  const reduce = settings.reducedMotion ? 'reduced' : '';
  return (
    <div className={`app ${reduce}`}>
      <div className="game">
        <div className="game-top">
          <button
            className="icon-btn"
            aria-label="Arrêter la partie"
            onClick={() => (results.length ? finish(results) : go('/', undefined, true))}
          >
            ✕
          </button>
          <div className="game-progress">
            <div className="tiny">
              <span>{MODE_TITLES[mode]}</span>
              <span>
                {index + 1} / {session.length}
              </span>
            </div>
            <Bar value={(index + (given ? 1 : 0)) / session.length} />
          </div>
          {timerOn && !given && (
            <div
              className={`timer ${left <= 5 ? 'low' : ''}`}
              style={{ ['--p' as string]: (left / settings.timerSeconds) * 100 }}
              aria-label={`${left} secondes restantes`}
            >
              <span>{Math.max(0, left)}</span>
            </div>
          )}
        </div>

        <QuestionPlay key={q.id} question={q} category={category} given={given} onAnswer={answer} onShownChoices={onShown} />

        {given && (
          <Verdict
            key={'v' + q.id}
            q={q}
            correct={wasCorrect}
            timedOut={given.kind === 'timeout'}
            related={related}
            showDetails={settings.alwaysExplain || mode === 'decouverte'}
          />
        )}

        <div className="game-actions">
          <button className="report-link" onClick={() => setReporting(true)}>
            ⚑ Signaler / suggérer
          </button>
          {given && (
            <button className="btn primary" onClick={next} autoFocus>
              {index + 1 >= session.length ? 'Voir le bilan' : 'Question suivante →'}
            </button>
          )}
        </div>
      </div>
      {reporting && <ReportSheet question={q} shownChoices={shownRef.current} onClose={() => setReporting(false)} />}
    </div>
  );
}
