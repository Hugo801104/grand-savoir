import { useEffect, useMemo, useState } from 'react';
import { checkAnswer, correctAnswerText, type GivenAnswer, shuffle, shuffledChoices } from '../lib/engine';
import { href } from '../lib/router';
import type { Category, Question } from '../lib/types';
import { FORMAT_LABELS, Stars } from './ui';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

interface Props {
  question: Question;
  category?: Category;
  /** Réponse déjà donnée (affichage du résultat) */
  given: GivenAnswer | null;
  onAnswer: (given: GivenAnswer, correct: boolean) => void;
  onShownChoices?: (labels: string[]) => void;
}

export function QuestionPlay({ question: q, category, given, onAnswer, onShownChoices }: Props) {
  const sub = category?.subcategories.find((s) => s.id === q.subcategory);
  return (
    <div className="q-card" key={q.id}>
      <div className="q-meta">
        {category && (
          <span className="pill">
            {category.icon} {category.name}
            {sub ? ` · ${sub.name}` : ''}
          </span>
        )}
        <Stars n={q.difficulty} />
        {q.format !== 'qcm' && <span className="pill">{FORMAT_LABELS[q.format]}</span>}
      </div>
      <p className="q-prompt">{q.prompt}</p>
      {(q.format === 'qcm' || q.format === 'vrai_faux') && (
        <Choices q={q} given={given} onAnswer={onAnswer} onShown={onShownChoices} />
      )}
      {q.format === 'saisie' && <FreeText q={q} given={given} onAnswer={onAnswer} />}
      {q.format === 'classement' && <Ordering q={q} given={given} onAnswer={onAnswer} onShown={onShownChoices} />}
      {q.format === 'association' && <Matching q={q} given={given} onAnswer={onAnswer} />}
    </div>
  );
}

type SubProps = { q: Question; given: GivenAnswer | null; onAnswer: Props['onAnswer']; onShown?: (l: string[]) => void };

function Choices({ q, given, onAnswer, onShown }: SubProps) {
  const { labels, map } = useMemo(() => shuffledChoices(q), [q]);
  useEffect(() => onShown?.(labels), [labels, onShown]);
  const answered = given !== null;
  const pickedOriginal = given?.kind === 'choice' ? given.index : -1;

  useEffect(() => {
    if (answered) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const i = ['1', '2', '3', '4', '5', '6'].indexOf(e.key);
      const j = LETTERS.indexOf(e.key.toUpperCase());
      const k = i >= 0 ? i : j;
      if (k >= 0 && k < labels.length) {
        const g: GivenAnswer = { kind: 'choice', index: map[k] };
        onAnswer(g, checkAnswer(q, g));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answered, labels, map, q, onAnswer]);

  return (
    <div className={`answers ${q.format === 'vrai_faux' ? 'tf' : ''}`} role="group" aria-label="Réponses">
      {labels.map((label, i) => {
        const original = map[i];
        let cls = 'answer';
        if (answered) {
          if (original === q.correct) cls += ' correct';
          else if (original === pickedOriginal) cls += ' wrong';
          else cls += ' dim';
        }
        return (
          <button
            key={label}
            className={cls}
            disabled={answered}
            onClick={() => {
              const g: GivenAnswer = { kind: 'choice', index: original };
              onAnswer(g, checkAnswer(q, g));
            }}
          >
            {q.format !== 'vrai_faux' && <span className="letter">{LETTERS[i]}</span>}
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function FreeText({ q, given, onAnswer }: SubProps) {
  const [value, setValue] = useState('');
  const answered = given !== null;
  const ok = answered && checkAnswer(q, given);
  return (
    <form
      className="text-answer"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim() || answered) return;
        const g: GivenAnswer = { kind: 'text', value };
        onAnswer(g, checkAnswer(q, g));
      }}
    >
      <input
        autoFocus
        aria-label="Ta réponse"
        placeholder="Ta réponse…"
        value={answered && given?.kind === 'text' ? given.value : value}
        disabled={answered}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        autoCapitalize="sentences"
        style={answered ? { borderColor: ok ? 'var(--good)' : 'var(--bad)' } : undefined}
      />
      {!answered && (
        <button className="btn primary" type="submit" disabled={!value.trim()}>
          OK
        </button>
      )}
    </form>
  );
}

function Ordering({ q, given, onAnswer, onShown }: SubProps) {
  const initial = useMemo(() => {
    const items = q.items ?? [];
    let s = shuffle(items, Math.random);
    // Évite de proposer d'emblée le bon ordre.
    for (let i = 0; i < 5 && JSON.stringify(s) === JSON.stringify(items); i++) s = shuffle(items, Math.random);
    return s;
  }, [q]);
  const [order, setOrder] = useState(initial);
  useEffect(() => {
    setOrder(initial);
    onShown?.(initial);
  }, [initial, onShown]);
  const answered = given !== null;
  const shown = answered && given?.kind === 'order' ? given.items : order;
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };
  return (
    <>
      {q.orderLabel && <p className="small muted" style={{ marginTop: 8 }}>Classe {q.orderLabel}.</p>}
      <ol className="order-list" style={{ listStyle: 'none', padding: 0 }}>
        {shown.map((item, i) => {
          const cls = answered ? (q.items?.[i] === item ? 'correct' : 'wrong') : '';
          return (
            <li key={item} className={`order-item ${cls}`}>
              <span className="num">{i + 1}</span>
              <span className="grow">{item}</span>
              {!answered && (
                <>
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Monter ${item}`}>
                    ↑
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === shown.length - 1} aria-label={`Descendre ${item}`}>
                    ↓
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ol>
      {!answered && (
        <button
          className="btn primary block"
          style={{ marginTop: 12 }}
          onClick={() => {
            const g: GivenAnswer = { kind: 'order', items: order };
            onAnswer(g, checkAnswer(q, g));
          }}
        >
          Valider l'ordre
        </button>
      )}
    </>
  );
}

function Matching({ q, given, onAnswer }: SubProps) {
  const pairs = q.pairs ?? [];
  const lefts = useMemo(() => shuffle(pairs.map((p) => p[0]), Math.random), [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const rights = useMemo(() => shuffle(pairs.map((p) => p[1]), Math.random), [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const [active, setActive] = useState<string | null>(null);
  const [made, setMade] = useState<[string, string][]>([]);
  const answered = given !== null;
  const final = answered && given?.kind === 'pairs' ? given.pairs : made;
  const truth = new Map(pairs);

  const pickRight = (r: string) => {
    if (!active || answered) return;
    const next = [...made.filter(([l, rr]) => l !== active && rr !== r), [active, r] as [string, string]];
    setMade(next);
    setActive(null);
  };
  const leftOf = (r: string) => final.find(([, rr]) => rr === r)?.[0];
  const rightOf = (l: string) => final.find(([ll]) => ll === l)?.[1];

  return (
    <>
      <p className="small muted" style={{ marginTop: 8 }}>
        Touche un élément à gauche puis son correspondant à droite.
      </p>
      <div className="match">
        <div className="stack" style={{ gap: 8 }}>
          {lefts.map((l) => {
            const r = rightOf(l);
            const cls = answered ? (truth.get(l) === r ? 'correct' : 'wrong') : active === l ? 'active' : r ? 'paired' : '';
            return (
              <button key={l} className={cls} disabled={answered} onClick={() => setActive(active === l ? null : l)}>
                {l}
              </button>
            );
          })}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          {rights.map((r) => (
            <button key={r} className={leftOf(r) && !answered ? 'paired' : ''} disabled={answered || !active} onClick={() => pickRight(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>
      {final.length > 0 && (
        <div className="pairs-done">
          {final.map(([l, r]) => (
            <div key={l} className="pair-row">
              <span className="grow">
                {l} ↔ {r}
              </span>
              {answered ? (truth.get(l) === r ? '✅' : `❌ ${truth.get(l)}`) : null}
            </div>
          ))}
        </div>
      )}
      {!answered && (
        <button
          className="btn primary block"
          style={{ marginTop: 12 }}
          disabled={made.length !== pairs.length}
          onClick={() => {
            const g: GivenAnswer = { kind: 'pairs', pairs: made };
            onAnswer(g, checkAnswer(q, g));
          }}
        >
          Valider ({made.length}/{pairs.length})
        </button>
      )}
    </>
  );
}

/** Bloc affiché après la réponse : verdict, bonne réponse, explication, anecdote, liens. */
export function Verdict({
  q,
  correct,
  timedOut,
  related,
  showDetails,
  hideTitle,
}: {
  q: Question;
  correct: boolean;
  timedOut?: boolean;
  related: Question[];
  showDetails: boolean;
  hideTitle?: boolean;
}) {
  const [open, setOpen] = useState(showDetails || !correct);
  return (
    <section className={`verdict ${hideTitle ? '' : correct ? 'ok' : 'ko'}`} aria-live="polite">
      {!hideTitle && (
        <div className="verdict-title">
          <span aria-hidden>{correct ? '✅' : timedOut ? '⏱️' : '❌'}</span>
          {correct ? 'Bonne réponse !' : timedOut ? 'Temps écoulé' : 'Pas tout à fait…'}
        </div>
      )}
      {!correct && <p className="answer-line">La bonne réponse : {correctAnswerText(q)}</p>}
      {!open ? (
        <button className="report-link" style={{ paddingLeft: 0 }} onClick={() => setOpen(true)}>
          Voir l'explication
        </button>
      ) : (
        <>
          <div className="block">
            <h4>Pourquoi</h4>
            <p>{q.explanation}</p>
          </div>
          {q.anecdote && (
            <div className="block">
              <h4>Le saviez-vous ?</h4>
              <p className="anecdote">{q.anecdote}</p>
            </div>
          )}
          {related.length > 0 && (
            <div className="block">
              <h4>À relier avec</h4>
              <div className="see-also">
                {related.map((r) => (
                  <a key={r.id} href={href('/question/' + r.id)}>
                    {r.prompt.length > 60 ? r.prompt.slice(0, 58) + '…' : r.prompt}
                  </a>
                ))}
              </div>
            </div>
          )}
          {q.sources.length > 0 && (
            <details className="block">
              <summary className="tiny">
                <span className="chev">›</span> Sources ({q.sources.length})
                {q.verifiedAt ? ` · vérifiée le ${new Date(q.verifiedAt).toLocaleDateString('fr-FR')}` : ''}
              </summary>
              <ul className="sources">
                {q.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
