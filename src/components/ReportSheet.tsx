import { useEffect, useRef, useState } from 'react';
import { issueUrl } from '../lib/github';
import { createReport, markReportOpened } from '../lib/store';
import { REPORT_TYPES, type Question, type Report, type ReportType } from '../lib/types';
import { toast } from './ui';

interface Props {
  question?: Question | null;
  /** Réponses telles qu'affichées (ordre mélangé) */
  shownChoices?: string[];
  onClose: () => void;
  defaultType?: ReportType;
}

export const reportTypeLabel = (t: string) => REPORT_TYPES.find((x) => x.id === t)?.label ?? t;

/** Ouvre le ticket GitHub pré-rempli d'un signalement (nouvel onglet : la partie n'est pas perdue). */
export function openReportIssue(r: Report) {
  window.open(issueUrl(r, reportTypeLabel(r.type)), '_blank', 'noopener');
  void markReportOpened(r.id);
}

/** Feuille « Signaler un problème / Proposer une amélioration ». */
export function ReportSheet({ question, shownChoices, onClose, defaultType }: Props) {
  const [type, setType] = useState<ReportType>(defaultType ?? (question ? 'erreur_factuelle' : 'amelioration'));
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const types = question ? REPORT_TYPES : REPORT_TYPES.filter((t) => ['amelioration', 'nouvelle_question', 'bug', 'autre'].includes(t.id));
  const needsComment = ['autre', 'amelioration', 'nouvelle_question', 'bug'].includes(type);

  async function send() {
    setBusy(true);
    const res = await createReport({
      type,
      comment,
      questionId: question?.id ?? null,
      questionVersion: question?.version ?? null,
      snapshot: question
        ? {
            enonce: question.prompt,
            format: question.format,
            reponses_affichees: shownChoices?.length ? shownChoices : (question.choices ?? question.items ?? question.pairs ?? null),
            bonne_reponse: question.choices?.[question.correct ?? -1] ?? question.accepted ?? question.items ?? question.pairs,
            categorie: question.category,
            sous_categorie: question.subcategory,
            difficulte: question.difficulty,
          }
        : null,
    });
    setBusy(false);
    if (!res.ok) {
      toast(res.message);
      return;
    }
    if (navigator.onLine) {
      openReportIssue(res.report);
      toast('Signalement enregistré. Valide le ticket sur GitHub (« Submit new issue ») pour l’envoyer.');
    } else {
      toast('Hors connexion : signalement gardé sur l’appareil. Envoie-le plus tard depuis « Mes signalements ».');
    }
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grabber" />
        <h2 id="report-title">Signaler un problème / Proposer une amélioration</h2>
        {question && (
          <p className="tiny" style={{ marginTop: 4 }}>
            Question « {question.prompt.slice(0, 80)}
            {question.prompt.length > 80 ? '…' : ''} » (réf. {question.id}, v{question.version})
          </p>
        )}
        <fieldset className="radio-list" style={{ border: 0, padding: 0, margin: '14px 0' }}>
          <legend className="sr-only">Type de signalement</legend>
          {types.map((t) => (
            <label key={t.id}>
              <input type="radio" name="type" value={t.id} checked={type === t.id} onChange={() => setType(t.id)} />
              {t.label}
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="report-comment">
            Commentaire {needsComment ? '' : <span className="tiny">(facultatif mais utile : quelle est l'erreur ? une source ?)</span>}
          </label>
          <textarea
            id="report-comment"
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Ex. : la bataille a eu lieu en 1515, pas en 1516 (source : …)"
          />
          <span className="tiny">
            Le signalement devient un ticket public sur GitHub : n'y mets aucune donnée personnelle. Sont joints : la
            référence de la question, ce qui était affiché et la version de l'appli.
          </span>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={busy || (needsComment && comment.trim().length < 5)} onClick={send}>
            Continuer sur GitHub ↗
          </button>
        </div>
      </div>
    </div>
  );
}
