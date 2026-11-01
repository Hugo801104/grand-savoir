import { useMemo, useState } from 'react';
import { Verdict } from '../components/QuestionPlay';
import { ReportSheet } from '../components/ReportSheet';
import { Bar, Empty, formatDate, LevelsBar, TopBar } from '../components/ui';
import { correctAnswerText, estimateLevels, levelLabel, normalizeAnswer, upcomingReviews } from '../lib/engine';
import { categoryProgress, dailyActivity, globalLevels, MASTERY_COLORS } from '../lib/progress';
import { href } from '../lib/router';
import { MASTERY_LABELS, type MasteryLevel, masteryLevel } from '../lib/srs';
import { useApp } from '../lib/store';

export function Stats() {
  const { content, cards, events } = useApp();
  const now = Date.now();
  const d = useMemo(() => {
    if (!content) return null;
    const byId = new Map(content.questions.map((q) => [q.id, q]));
    const ratings = estimateLevels(events, byId);
    const good = events.filter((e) => e.correct).length;
    return {
      cats: categoryProgress(content.categories, content.questions, cards, now).filter((c) => c.total > 0),
      levels: globalLevels(content.questions, cards, now),
      activity: dailyActivity(events, now, 14),
      upcoming: upcomingReviews(cards, now, 7),
      ratings,
      accuracy: events.length ? good / events.length : null,
      days: new Set(events.map((e) => new Date(e.at).toDateString())).size,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, cards, events]);
  if (!content || !d) return null;
  if (events.length === 0) {
    return (
      <div className="app">
        <TopBar title="Statistiques" />
        <Empty icon="📊">Joue une première partie pour voir ta progression ici.</Empty>
      </div>
    );
  }
  const maxDay = Math.max(1, ...d.activity.map((a) => a.correct + a.wrong));
  const maxUp = Math.max(1, ...d.upcoming);
  return (
    <div className="app">
      <TopBar title="Statistiques" />
      <div className="card">
        <div className="stats-strip">
          <div className="stat">
            <b>{events.length}</b>
            <span>réponses</span>
          </div>
          <div className="stat">
            <b>{d.accuracy !== null ? Math.round(d.accuracy * 100) : 0} %</b>
            <span>de réussite</span>
          </div>
          <div className="stat">
            <b>{d.days}</b>
            <span>jours joués</span>
          </div>
        </div>
        <p className="small" style={{ textAlign: 'center', marginTop: 8 }}>
          Niveau estimé : <b>{levelLabel(d.ratings.get('*') ?? 1000)}</b>
        </p>
      </div>

      <section className="section">
        <h2>Maîtrise globale</h2>
        <div className="card" style={{ marginTop: 10 }}>
          <LevelsBar levels={d.levels} />
          <p className="tiny" style={{ marginTop: 10 }}>
            Une connaissance est « acquise » après des bonnes réponses sur au moins deux jours différents, espacées dans le
            temps — une seule bonne réponse ne suffit pas.
          </p>
        </div>
      </section>

      <section className="section">
        <h2>Activité (14 jours)</h2>
        <div className="card" style={{ marginTop: 10 }}>
          <div className="bars">
            {d.activity.map((a, i) => (
              <div key={i} title={`${a.correct} justes, ${a.wrong} fausses`}>
                <i style={{ height: `${(a.wrong / maxDay) * 100}%`, background: 'var(--bad)', opacity: 0.7 }} />
                <i style={{ height: `${(a.correct / maxDay) * 100}%`, background: 'var(--good)' }} />
              </div>
            ))}
          </div>
          <div className="bars-labels">
            {d.activity.map((a, i) => (
              <span key={i}>{a.day.getDate()}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Révisions à venir</h2>
        <div className="card" style={{ marginTop: 10 }}>
          <div className="bars" style={{ height: 60 }}>
            {d.upcoming.map((n, i) => (
              <div key={i} title={`${n} question(s)`}>
                <i style={{ height: `${(n / maxUp) * 100}%`, background: 'var(--accent)' }} />
              </div>
            ))}
          </div>
          <div className="bars-labels">
            {d.upcoming.map((n, i) => (
              <span key={i}>{i === 0 ? "auj." : `J+${i}`} · {n}</span>
            ))}
          </div>
          <p className="tiny" style={{ marginTop: 8 }}>Aucune obligation : si tu t'absentes, les révisions t'attendent, rien n'est perdu.</p>
        </div>
      </section>

      <section className="section">
        <h2>Par thème</h2>
        <div className="list" style={{ marginTop: 10 }}>
          {d.cats
            .sort((a, b) => b.mastery - a.mastery)
            .map((c) => (
              <a key={c.category.id} className="list-item" href={href('/categorie/' + c.category.id)}>
                <span className="ico">{c.category.icon}</span>
                <span className="grow">
                  <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="small">{c.category.name}</span>
                    <span className="tiny">
                      {levelLabel(d.ratings.get(c.category.id) ?? 1000)} · {Math.round(c.mastery * 100)} %
                    </span>
                  </span>
                  <span style={{ display: 'block', marginTop: 6 }}>
                    <Bar value={c.mastery} color={c.category.color} />
                  </span>
                </span>
              </a>
            ))}
        </div>
      </section>
    </div>
  );
}

const LEVEL_FILTERS: (MasteryLevel | 'tout')[] = ['tout', 'fragile', 'en_cours', 'acquis', 'maitrise'];

/** Toutes les questions déjà rencontrées, avec recherche : pour retrouver les explications. */
export function History() {
  const { content, cards } = useApp();
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<MasteryLevel | 'tout'>('tout');
  const now = Date.now();
  if (!content) return null;
  const nq = normalizeAnswer(query);
  const seen = content.questions
    .filter((q) => cards.has(q.id))
    .map((q) => ({ q, card: cards.get(q.id)!, lvl: masteryLevel(cards.get(q.id)!, now) }))
    .filter((x) => level === 'tout' || x.lvl === level)
    .filter(
      (x) =>
        !nq ||
        normalizeAnswer(`${x.q.prompt} ${correctAnswerText(x.q)} ${x.q.themes.join(' ')} ${x.q.explanation}`).includes(nq),
    )
    .sort((a, b) => b.card.lastAt - a.card.lastAt);
  return (
    <div className="app">
      <TopBar title="Mes questions" />
      <input className="input" type="search" placeholder="Rechercher (mot, thème, réponse…)" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="chips" style={{ marginTop: 10 }}>
        {LEVEL_FILTERS.map((l) => (
          <button key={l} className="chip" aria-pressed={level === l} onClick={() => setLevel(l)}>
            {l === 'tout' ? 'Toutes' : MASTERY_LABELS[l]}
          </button>
        ))}
      </div>
      <div className="list" style={{ marginTop: 12 }}>
        {seen.length === 0 && <Empty icon="📚">Aucune question ici pour l'instant.</Empty>}
        {seen.slice(0, 300).map(({ q, card, lvl }) => (
          <a key={q.id} className="list-item" href={href('/question/' + q.id)}>
            <i className="dot" style={{ background: MASTERY_COLORS[lvl], width: 12, height: 12 }} />
            <span className="grow">
              <span className="small" style={{ display: 'block' }}>{q.prompt}</span>
              <span className="tiny">
                → {correctAnswerText(q)} · vue {card.reps} fois · {formatDate(card.lastAt)}
              </span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** Fiche d'une question : réponse, explication, sources, maîtrise, signalement. */
export function QuestionDetail({ id }: { id: string }) {
  const { content, cards } = useApp();
  const [reporting, setReporting] = useState(false);
  const q = content?.questions.find((x) => x.id === id);
  if (!content) return null;
  if (!q) {
    return (
      <div className="app">
        <TopBar title="Question" />
        <Empty icon="🤷">Cette question n'est plus disponible (elle a pu être retirée ou corrigée).</Empty>
      </div>
    );
  }
  const card = cards.get(q.id) ?? null;
  const lvl = masteryLevel(card, Date.now());
  const cat = content.categories.find((c) => c.id === q.category);
  const related = (q.seeAlso ?? [])
    .map((r) => content.questions.find((x) => x.id === r))
    .filter((x): x is NonNullable<typeof x> => !!x && x.status === 'publie');
  return (
    <div className="app">
      <TopBar title="Fiche" />
      <div className="q-card">
        <div className="q-meta">
          {cat && <span className="pill">{cat.icon} {cat.name}</span>}
          <span className="pill" style={{ color: MASTERY_COLORS[lvl] === 'rgba(255,255,255,0.08)' ? undefined : MASTERY_COLORS[lvl] }}>
            {MASTERY_LABELS[lvl]}
          </span>
        </div>
        <p className="q-prompt">{q.prompt}</p>
        <p style={{ marginTop: 10, color: 'var(--good)', fontWeight: 700 }}>→ {correctAnswerText(q)}</p>
      </div>
      <Verdict q={q} correct related={related} showDetails hideTitle />
      {card && (
        <p className="tiny" style={{ marginTop: 10 }}>
          Vue {card.reps} fois ({card.correctCount} bonnes réponses) · prochaine révision : {formatDate(card.due)}
        </p>
      )}
      <button className="report-link" onClick={() => setReporting(true)}>
        ⚑ Signaler un problème / proposer une amélioration
      </button>
      {reporting && <ReportSheet question={q} onClose={() => setReporting(false)} />}
    </div>
  );
}
