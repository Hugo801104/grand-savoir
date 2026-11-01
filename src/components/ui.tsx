import { type ReactNode, useEffect, useState } from 'react';
import { back } from '../lib/router';
import { MASTERY_COLORS } from '../lib/progress';
import { MASTERY_LABELS, type MasteryLevel } from '../lib/srs';

export function TopBar({ title, backTo = '/', right }: { title: string; backTo?: string | null; right?: ReactNode }) {
  return (
    <header className="topbar">
      {backTo !== null && (
        <button className="icon-btn" onClick={() => back(backTo)} aria-label="Retour">
          ←
        </button>
      )}
      <h1>{title}</h1>
      {right}
    </header>
  );
}

export function Bar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="bar" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, background: color }} />
    </div>
  );
}

export function LevelsBar({ levels }: { levels: Record<MasteryLevel, number> }) {
  const total = Object.values(levels).reduce((a, b) => a + b, 0) || 1;
  const order: MasteryLevel[] = ['maitrise', 'acquis', 'en_cours', 'fragile', 'nouveau'];
  return (
    <>
      <div className="stacked" aria-hidden>
        {order.map((l) => (
          <i key={l} style={{ width: `${(levels[l] / total) * 100}%`, background: MASTERY_COLORS[l] }} />
        ))}
      </div>
      <div className="mastery-legend" style={{ marginTop: 8 }}>
        {order.map((l) => (
          <span key={l}>
            <i className="dot" style={{ background: MASTERY_COLORS[l] }} />
            {MASTERY_LABELS[l]} : {levels[l]}
          </span>
        ))}
      </div>
    </>
  );
}

export function Stars({ n }: { n: number }) {
  return (
    <span className="stars" aria-label={`Difficulté ${n} sur 5`}>
      {'★'.repeat(n)}
      <span style={{ opacity: 0.25 }}>{'★'.repeat(5 - n)}</span>
    </span>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <span className="switch">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
        <span />
      </span>
    </label>
  );
}

export function Empty({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="big">{icon}</span>
      {children}
    </div>
  );
}

let toastSetter: ((m: string | null) => void) | null = null;
export function toast(message: string) {
  toastSetter?.(message);
}
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    toastSetter = setMsg;
    return () => {
      toastSetter = null;
    };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4500);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? (
    <div className="toast" role="status" onClick={() => setMsg(null)}>
      {msg}
    </div>
  ) : null;
}

export function formatDate(d: string | number | Date): string {
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function formatDateTime(d: string | number | Date): string {
  return new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const FORMAT_LABELS: Record<string, string> = {
  qcm: 'QCM',
  vrai_faux: 'Vrai / Faux',
  saisie: 'Réponse libre',
  classement: 'Classement',
  association: 'Association',
};
