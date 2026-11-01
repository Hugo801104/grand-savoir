import { useMemo, useState } from 'react';
import { Bar, LevelsBar, TopBar } from '../components/ui';
import { categoryProgress } from '../lib/progress';
import { go, href, type Route } from '../lib/router';
import { useApp } from '../lib/store';

export function Categories() {
  const { content, cards } = useApp();
  const progress = useMemo(
    () => (content ? categoryProgress(content.categories, content.questions, cards, Date.now()) : []),
    [content, cards],
  );
  return (
    <div className="app">
      <TopBar title="Thèmes" />
      <div className="cat-grid">
        {progress
          .filter((p) => p.total > 0)
          .map((p) => (
            <a key={p.category.id} className="cat" href={href('/categorie/' + p.category.id)} style={{ ['--c' as string]: p.category.color }}>
              <span className="ico">{p.category.icon}</span>
              <b>{p.category.name}</b>
              <span className="tiny">
                {p.seen}/{p.total} vues · {Math.round(p.mastery * 100)} %
              </span>
              <Bar value={p.mastery} color={p.category.color} />
            </a>
          ))}
      </div>
    </div>
  );
}

export function CategoryDetail({ id }: { id: string }) {
  const { content, cards } = useApp();
  const cat = content?.categories.find((c) => c.id === id);
  const prog = useMemo(
    () => (content && cat ? categoryProgress([cat], content.questions, cards, Date.now())[0] : null),
    [content, cards, cat],
  );
  if (!content || !cat || !prog) return null;
  const subs = cat.subcategories
    .map((s) => ({
      ...s,
      count: content.questions.filter((q) => q.subcategory === s.id && q.category === cat.id && q.status === 'publie').length,
    }))
    .filter((s) => s.count > 0);
  const paths = content.paths.filter((p) => p.category === cat.id);
  return (
    <div className="app">
      <TopBar title={`${cat.icon} ${cat.name}`} backTo="/categories" />
      <div className="card">
        <LevelsBar levels={prog.levels} />
        {prog.accuracy !== null && (
          <p className="tiny" style={{ marginTop: 8 }}>
            Taux de bonnes réponses : {Math.round(prog.accuracy * 100)} %
          </p>
        )}
      </div>
      <div className="stack" style={{ marginTop: 14 }}>
        <button className="btn primary block" onClick={() => go('/jouer', { mode: 'thematique', cat: cat.id, t: Date.now() })}>
          Jouer : tout le thème ({prog.total})
        </button>
        <div className="row">
          <button className="btn sm" onClick={() => go('/jouer', { mode: 'revision', cat: cat.id, t: Date.now() })}>
            🔁 Réviser ce thème
          </button>
          <button className="btn sm" onClick={() => go('/jouer', { mode: 'defi', cat: cat.id, t: Date.now() })}>
            🔥 Défi
          </button>
        </div>
      </div>
      {subs.length > 0 && (
        <section className="section">
          <h2>Sous-thèmes</h2>
          <div className="list" style={{ marginTop: 10 }}>
            {subs.map((s) => (
              <a key={s.id} className="list-item" href={href('/jouer', { mode: 'thematique', cat: cat.id, sub: s.id })}>
                <span className="grow">{s.name}</span>
                <span className="badge soft">{s.count}</span>
                <span aria-hidden>▶</span>
              </a>
            ))}
          </div>
        </section>
      )}
      {paths.length > 0 && (
        <section className="section">
          <h2>Parcours découverte</h2>
          <div className="list" style={{ marginTop: 10 }}>
            {paths.map((p) => (
              <a key={p.id} className="list-item" href={href('/decouverte/' + p.id)}>
                <span className="ico">{p.icon}</span>
                <span className="grow">{p.title}</span>
                <span aria-hidden>›</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const DIFFS = [1, 2, 3, 4, 5];
const FORMATS: [string, string][] = [
  ['qcm', 'QCM'],
  ['vrai_faux', 'Vrai/Faux'],
  ['saisie', 'Réponse libre'],
  ['classement', 'Classement'],
  ['association', 'Association'],
];

function toggle<T>(list: T[], v: T, set: (l: T[]) => void) {
  set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
}

export function Custom({ route }: { route: Route }) {
  const { content, settings } = useApp();
  const [cats, setCats] = useState<string[]>(route.params.cat ? [route.params.cat] : []);
  const [diffs, setDiffs] = useState<number[]>([]);
  const [fmts, setFmts] = useState<string[]>([]);
  const [n, setN] = useState(settings.questionsPerGame);
  if (!content) return null;
  const available = content.questions.filter(
    (q) =>
      q.status === 'publie' &&
      (!cats.length || cats.includes(q.category)) &&
      (!diffs.length || diffs.includes(q.difficulty)) &&
      (!fmts.length || fmts.includes(q.format)),
  ).length;
  return (
    <div className="app">
      <TopBar title="Partie sur mesure" />
      <div className="stack">
        <div className="field">
          <span className="label">Thèmes {cats.length === 0 && <span className="tiny">(tous)</span>}</span>
          <div className="chips">
            {content.categories.map((c) => (
              <button key={c.id} className="chip" aria-pressed={cats.includes(c.id)} onClick={() => toggle(cats, c.id, setCats)}>
                {c.icon} {c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">Difficulté {diffs.length === 0 && <span className="tiny">(adaptée à ton niveau)</span>}</span>
          <div className="chips">
            {DIFFS.map((d) => (
              <button key={d} className="chip" aria-pressed={diffs.includes(d)} onClick={() => toggle(diffs, d, setDiffs)}>
                {'★'.repeat(d)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">Formats {fmts.length === 0 && <span className="tiny">(tous)</span>}</span>
          <div className="chips">
            {FORMATS.map(([id, label]) => (
              <button key={id} className="chip" aria-pressed={fmts.includes(id)} onClick={() => toggle(fmts, id, setFmts)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="n">Nombre de questions : {n}</label>
          <input id="n" type="range" min={3} max={30} value={n} onChange={(e) => setN(Number(e.target.value))} />
        </div>
        <p className="tiny">{available} question(s) disponible(s) avec ces critères.</p>
        <button
          className="btn primary block"
          disabled={available === 0}
          onClick={() =>
            go('/jouer', { mode: 'personnalisee', cat: cats.join(','), diff: diffs.join(','), fmt: fmts.join(','), n, t: Date.now() })
          }
        >
          Lancer la partie
        </button>
      </div>
    </div>
  );
}
