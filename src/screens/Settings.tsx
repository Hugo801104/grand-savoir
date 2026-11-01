import { useRef, useState } from 'react';
import { ReportSheet } from '../components/ReportSheet';
import { Empty, formatDateTime, Switch, toast, TopBar } from '../components/ui';
import { APP_VERSION, hasBackend } from '../lib/config';
import {
  deleteAccount,
  exportData,
  importData,
  refreshContent,
  resetPassword,
  signIn,
  signOut,
  signUp,
  syncNow,
  updateSettings,
  useApp,
} from '../lib/store';
import { REPORT_STATUS_LABELS, REPORT_TYPES, type ReportStatus } from '../lib/types';

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
  const { reports, user } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <div className="app">
      <TopBar title="Mes signalements" />
      <button className="btn block" onClick={() => setOpen(true)}>
        ＋ Suggérer une amélioration ou signaler un bug
      </button>
      {!user && hasBackend() && (
        <p className="notice warn small" style={{ marginTop: 12 }}>
          Connecte-toi dans les Réglages pour que tes signalements soient transmis et suivis.
        </p>
      )}
      <div className="list" style={{ marginTop: 14 }}>
        {reports.length === 0 && <Empty icon="⚑">Aucun signalement. Le bouton « Signaler » est disponible sous chaque question.</Empty>}
        {reports.map((r) => (
          <details key={r.id} className="card tight">
            <summary>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b className="small">{REPORT_TYPES.find((t) => t.id === r.type)?.label ?? r.type}</b>
                <span className={`badge ${STATUS_BADGE[r.status]}`}>{r.sent ? REPORT_STATUS_LABELS[r.status] : 'Non envoyé'}</span>
              </div>
              <p className="tiny" style={{ marginTop: 4 }}>
                {formatDateTime(r.createdAt)}
                {r.snapshot?.enonce ? ` · « ${String(r.snapshot.enonce).slice(0, 60)}… »` : ''}
              </p>
            </summary>
            {r.comment && <p className="small" style={{ marginTop: 8 }}>Ton commentaire : {r.comment}</p>}
            {r.resolution && (
              <div className="notice small" style={{ marginTop: 8 }}>
                <b>Compte rendu :</b> {r.resolution}
              </div>
            )}
            {r.issueUrl && (
              <p className="tiny" style={{ marginTop: 6 }}>
                <a href={r.issueUrl} target="_blank" rel="noopener noreferrer">Voir le suivi technique</a>
              </p>
            )}
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

  function download() {
    const blob = new Blob([exportData()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `grand-savoir-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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

      <AccountSection />

      <section className="card stack" style={{ marginTop: 14 }}>
        <h2>Mes données</h2>
        <p className="small muted">
          Ta progression est enregistrée sur cet appareil{st.user ? ' et sauvegardée sur ton compte' : ''}. Elle n'est jamais remise
          à zéro, même après une longue absence ou une mise à jour.
        </p>
        <div className="row">
          <button className="btn sm" onClick={download}>⬇️ Exporter</button>
          <button className="btn sm" onClick={() => fileRef.current?.click()}>⬆️ Importer</button>
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
        <button
          className="btn sm"
          onClick={async () => {
            await refreshContent(true);
            toast(`Contenu à jour : ${st.content?.questions.length ?? 0} questions.`);
          }}
        >
          🔄 Mettre à jour les questions
        </button>
      </section>

      <section className="stack" style={{ marginTop: 14 }}>
        <p className="tiny" style={{ textAlign: 'center' }}>
          Le Grand Savoir v{APP_VERSION} · contenu {st.content?.version.slice(0, 19)} · {st.content?.questions.length ?? 0} questions
          <br />
          Données personnelles : uniquement ta progression, tes réglages et tes signalements. Aucune publicité, aucun traceur.
        </p>
      </section>
    </div>
  );
}

function AccountSection() {
  const { user, sync, syncError, lastSync } = useApp();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!hasBackend()) {
    return (
      <section className="card stack" style={{ marginTop: 14 }}>
        <h2>Compte</h2>
        <p className="small muted">Synchronisation non configurée : l'appli fonctionne en mode local (données sur cet appareil).</p>
      </section>
    );
  }
  if (user) {
    return (
      <section className="card stack" style={{ marginTop: 14 }}>
        <h2>Compte</h2>
        <p className="small">Connecté : <b>{user.email}</b></p>
        <p className="tiny">
          {sync === 'syncing' ? 'Synchronisation…' : sync === 'error' ? `Erreur de synchro : ${syncError}` : sync === 'offline' ? 'Hors connexion' : lastSync ? `Dernière synchro : ${formatDateTime(lastSync)}` : ''}
        </p>
        <div className="row">
          <button className="btn sm" onClick={() => void syncNow()}>Synchroniser</button>
          <button className="btn sm ghost" onClick={() => void signOut()}>Se déconnecter</button>
        </div>
        <button
          className="report-link"
          style={{ textAlign: 'left' }}
          onClick={async () => {
            if (!confirm('Supprimer définitivement ton compte et tes données en ligne ? Ta progression restera sur cet appareil.')) return;
            const err = await deleteAccount();
            toast(err ?? 'Compte supprimé. Tes données en ligne ont été effacées.');
          }}
        >
          Supprimer mon compte et mes données en ligne
        </button>
      </section>
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const err = mode === 'login' ? await signIn(email, password) : await signUp(email, password);
    setBusy(false);
    setMsg(err);
  }
  return (
    <section className="card" style={{ marginTop: 14 }}>
      <h2>Compte</h2>
      <p className="small muted" style={{ margin: '6px 0 12px' }}>
        Facultatif : sauvegarde ta progression en ligne, retrouve-la sur tous tes appareils et transmets tes signalements.
      </p>
      <form className="stack" onSubmit={submit}>
        <input className="input" type="email" required autoComplete="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          className="input"
          type="password"
          required
          minLength={8}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          placeholder="Mot de passe (8 caractères min.)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {msg && <p className="notice small">{msg}</p>}
        <button className="btn primary" disabled={busy}>
          {busy ? '…' : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
        </button>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="report-link" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? 'Créer un compte' : "J'ai déjà un compte"}
          </button>
          <button
            type="button"
            className="report-link"
            onClick={async () => {
              if (!email) return setMsg("Indique d'abord ton e-mail.");
              setMsg(await resetPassword(email));
            }}
          >
            Mot de passe oublié
          </button>
        </div>
      </form>
    </section>
  );
}
