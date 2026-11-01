import { Bar, Empty, TopBar } from '../components/ui';
import { href } from '../lib/router';
import { useApp } from '../lib/store';

/** Liste des parcours ou détail d'un parcours (mode découverte). */
export function Discovery({ id }: { id?: string }) {
  const { content, cards } = useApp();
  if (!content) return null;
  const done = (ids: string[]) => ids.filter((q) => cards.get(q)?.lastCorrect).length;

  if (!id) {
    return (
      <div className="app">
        <TopBar title="Découverte" />
        <p className="muted small" style={{ marginBottom: 14 }}>
          Apprends un sujet progressivement : chaque étape présente une notion, puis quelques questions avec explications.
        </p>
        {content.paths.length === 0 ? (
          <Empty icon="🧭">Aucun parcours pour le moment.</Empty>
        ) : (
          <div className="list">
            {content.paths.map((p) => {
              const all = p.steps.flatMap((s) => s.questionIds);
              return (
                <a key={p.id} className="list-item" href={href('/decouverte/' + p.id)}>
                  <span className="ico">{p.icon}</span>
                  <span className="grow">
                    <b>{p.title}</b>
                    <span className="tiny" style={{ display: 'block' }}>
                      {p.description}
                    </span>
                    <span style={{ display: 'block', marginTop: 6 }}>
                      <Bar value={all.length ? done(all) / all.length : 0} />
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  const path = content.paths.find((p) => p.id === id);
  if (!path) {
    return (
      <div className="app">
        <TopBar title="Parcours" backTo="/decouverte" />
        <Empty icon="🤷">Parcours introuvable.</Empty>
      </div>
    );
  }
  return (
    <div className="app">
      <TopBar title={`${path.icon} ${path.title}`} backTo="/decouverte" />
      <p className="muted">{path.description}</p>
      <div className="list" style={{ marginTop: 14 }}>
        {path.steps.map((s, i) => {
          const d = done(s.questionIds);
          const complete = d === s.questionIds.length;
          return (
            <a key={i} className="list-item" href={href('/jouer', { mode: 'decouverte', path: path.id, step: i })}>
              <span className="ico">{complete ? '✅' : `${i + 1}.`}</span>
              <span className="grow">
                <b>{s.title}</b>
                <span className="tiny" style={{ display: 'block' }}>
                  {d}/{s.questionIds.length} réussies
                </span>
              </span>
              <span aria-hidden>▶</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
