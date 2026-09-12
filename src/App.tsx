import { Database, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

type HealthState = { ok: boolean; userVersion: number; preview?: boolean };

export default function App() {
  const [health, setHealth] = useState<HealthState | null>(null);

  useEffect(() => {
    const api = window.financeiro?.system;
    if (!api) {
      setHealth({ ok: true, userVersion: 0, preview: true });
      return;
    }
    api.health()
      .then((result) => setHealth({ ok: result.ok, userVersion: result.userVersion }))
      .catch(() => setHealth({ ok: false, userVersion: 0 }));
  }, []);

  const status = health?.preview
    ? 'Prévia web local'
    : health?.ok
      ? `SQLite v${health.userVersion} operacional`
      : health
        ? 'Banco indisponível'
        : 'Verificando ambiente…';

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="brand-mark"><Database size={28} /></div>
        <div>
          <p className="eyebrow">ArtiSys</p>
          <h1>Sistema Financeiro</h1>
          <p className="subtitle">Base local-first pronta para receber os módulos financeiros.</p>
        </div>
        <div className={health?.ok ? 'status status-ok' : 'status'}>
          <ShieldCheck size={18} />
          {status}
        </div>
      </section>
    </main>
  );
}
