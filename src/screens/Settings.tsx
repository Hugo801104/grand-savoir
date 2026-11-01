import { useEffect, useRef, useState } from 'react';
import { openReportIssue, ReportSheet, reportTypeLabel } from '../components/ReportSheet';
import { Empty, formatDate, formatDateTime, Switch, toast, TopBar } from '../components/ui';
import { APP_VERSION } from '../lib/config';
import { href } from '../lib/router';
import {
  deleteReport,
  exportData,
  importData,
  markBackupDone,
  refreshContent,
  refreshReportStatuses,
  updateSettings,
  useApp,
} from '../lib/store';
import { REPORT_STATUS_LABELS, type ReportStatus } from '../lib/types';

const STATUS_BADGE: Record<ReportStatus, string> = {
  nouveau: 'soft',
  en_analyse: 'warn',
  correction_proposee: 'warn',
  en_attente_validation: 'warn',
  corrige: 'good',
  rejete: 'bad',
  echec_technique: 'bad',
};

export function MyReports() {
  const { reports } = useApp();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    const err = await refreshReportStatuses();
    setLoading(false);
    if (err) toast(err);
  }
  useEffect(() => {
    if (reports.some((r) => r.sent) && navigator.onLine) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <TopBar
        title="Mes signalements"
        right={
          <button className="icon-btn" onClick={refresh} aria-label="Actualiser les statuts" disabled={loading}>
            {loading ? '…' : '⟳'}
          </button>
        }
      />
      <button className="btn block" onClick={() => setOpen(true)}>
        ＋ Suggérer une amélioration ou signaler un bug
      </button>
      <p className="tiny" style={{ marginTop: 10 }}>
        Chaque signalement devient un ticket GitHub, analysé puis traité ; son statut s'affiche ici.
      </p>
      <div className="list" style={{ marginTop: 14 }}>
        {reports.length === 0 && <Empty icon="⚑">Aucun signalement. Le lien « Signaler » est disponible sous chaque question.</Empty>}
        {reports.map((r) => (
          <details key={r.id} className="card tight">
            <summary>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b className="small">{reportTypeLabel(r.type)}</b>
                <span className={`badge ${r.issueUrl ? STATUS_BADGE[r.status] : 'soft'}`}>
                  {r.issueUrl ? REPORT_STATUS_LABELS[r.status] : r.sent ? 'Envoi à confirmer' : 'Non envoyé'}
                </span>
              </div>
              <p className="tiny" style={{ marginTop: 4 }}>
                {formatDateTime(r.createdAt)}
                {r.snapshot?.enonce ? ` · « ${String(r.snapshot.enonce).slice(0, 60)}… »` : ''}
              </p>
            </summary>
            {r.comment && (
              <p className="small" style={{ marginTop: 8 }}>
                Ton commentaire : {r.comment}
              </p>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              {r.issueUrl ? (
                <a className="btn sm" href={r.issueUrl} target="_blank" rel="noopener noreferrer">
                  Voir le suivi et le compte rendu ↗
                </a>
              ) : (
                <button className="btn sm" onClick={() => openReportIssue(r)}>
                  {r.sent ? 'Rouvrir le ticket à valider ↗' : 'Envoyer sur GitHub ↗'}
                </button>
              )}
              {!r.issueUrl && (
                <button className="btn sm ghost" onClick={() => void deleteReport(r.id)}>
                  Supprimer
                </button>
              )}
            </div>
          </details>
        ))}
      </div>
      {open && <ReportSheet onClose={() => setOpen(false)} />}
    </div>
  );
}

export function SettingsScreen() {
  const st = useApp();
  const s = st.settings;
  const fileRef = useRef<HTMLInputElement>(null);

  async function backup() {
    const name = `grand-savoir-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([exportData()], name, { type: 'application/json' });
    try {
      // Sur Android : feuille de partage (Google Drive, e-mail…).
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Sauvegarde Le Grand Savoir' });
        await markBackupDone();
        toast('Sauvegarde partagée.');
        return;
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    await markBackupDone();
  }

  return (
    <div className="app">
      <TopBar title="Réglages" />
      <section className="card stack">
        <h2>Jeu</h2>
        <Switch label="Chronomètre" checked={s.timerEnabled} onChange={(v) => updateSettings({ timerEnabled: v })} />
        {s.timerEnabled && (
          <div className="field">
            <label htmlFor="timer">Temps par question : {s.timerSeconds} s</label>
            <input id="timer" type="range" min={10} max={90} step={5} value={s.timerSeconds} onChange={(e) => updateSettings({ timerSeconds: Number(e.target.value) })} />
          </div>
        )}
        <div className="field">
          <label htmlFor="qpg">Questions par partie : {s.questionsPerGame}</label>
          <input id="qpg" type="range" min={5} max={30} value={s.questionsPerGame} onChange={(e) => updateSettings({ questionsPerGame: Number(e.target.value) })} />
        </div>
        <Switch label="Toujours afficher l'explication" checked={s.alwaysExplain} onChange={(v) => updateSettings({ alwaysExplain: v })} />
        <Switch label="Sons" checked={s.sound} onChange={(v) => updateSettings({ sound: v })} />
        <Switch label="Vibration en cas d'erreur" checked={s.vibration} onChange={(v) => updateSettings({ vibration: v })} />
        <Switch label="Réduire les animations" checked={s.reducedMotion} onChange={(v) => updateSettings({ reducedMotion: v })} />
      </section>

      <section className="card stack" style={{ marginTop: 14 }}>
        <h2>Ma progression</h2>
        <p className="small muted">
          Ta progression est enregistrée sur ce téléphone, sans compte ni serveur. Elle n'est jamais remise à zéro, même
          après une longue absence ou une mise à jour de l'appli.
        </p>
        <p className="tiny">
          {st.persistent ? '✅ Stockage protégé : le navigateur ne l’effacera pas pour manque de place.' : 'ℹ️ Installe l’appli sur l’écran d’accueil pour mieux protéger le stockage.'}
          <br />
          Dernière sauvegarde : {st.lastBackup ? formatDate(st.lastBackup) : 'jamais'}. Une sauvegarde régulière te protège en cas de
          changement de téléphone ou de réinitialisation du navigateur.
        </p>
        <div className="row">
          <button className="btn sm primary" onClick={backup}>💾 Sauvegarder</button>
          <button className="btn sm" onClick={() => fileRef.current?.click()}>⬆️ Restaurer / fusionner</button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              toast(await importData(await f.text()));
            } catch (err) {
              toast((err as Error).message);
            }
            e.target.value = '';
          }}
        />
        <p className="tiny">La restauration fusionne : elle n'efface rien et permet de réunir la progression de deux appareils.</p>
      </section>

      <section className="card stack" style={{ marginTop: 14 }}>
        <h2>Questions</h2>
        <p className="small muted">
          {st.content?.questions.length ?? 0} questions disponibles hors connexion. Les nouvelles questions et corrections
          arrivent automatiquement.
        </p>
        <button
          className="btn sm"
          onClick={async () => {
            await refreshContent(true);
            toast('Questions à jour.');
          }}
        >
          🔄 Vérifier les mises à jour
        </button>
        <a className="btn sm ghost" href={href('/suivi')}>🛠️ Suivi technique (signalements, agents, publications)</a>
      </section>

      <p className="tiny" style={{ textAlign: 'center', marginTop: 14 }}>
        Le Grand Savoir v{APP_VERSION} · contenu {st.content?.version}
        <br />
        Aucune publicité, aucun traceur, aucun compte. Données personnelles : uniquement sur ton appareil.
      </p>
    </div>
  );
}
