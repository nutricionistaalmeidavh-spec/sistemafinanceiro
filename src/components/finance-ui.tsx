import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type ButtonSize = 'sm' | 'md';

export function FinanceButton({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={cx('finance-button', `finance-button-${variant}`, `finance-button-${size}`, className)} {...props}/>;
}

export function FinanceMetricCard({
  label,
  value,
  helper,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger' | 'accent';
}) {
  return <section className={cx('finance-metric-card', `finance-metric-${tone}`)}>
    <span className="finance-metric-label">{label}</span>
    <strong className="finance-metric-value">{value}</strong>
    {helper ? <small className="finance-metric-helper">{helper}</small> : null}
  </section>;
}

const statusTone: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  OPEN: 'warning', PARTIAL: 'info', SETTLED: 'success', CANCELLED: 'neutral', OVERDUE: 'danger',
};
const statusLabel: Record<string, string> = {
  OPEN: 'Em aberto', PARTIAL: 'Parcial', SETTLED: 'Quitado', CANCELLED: 'Cancelado', OVERDUE: 'Vencido',
};

export function FinanceStatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = statusTone[status] || 'neutral';
  return <span className={cx('finance-status-badge', `finance-status-${tone}`)}>{label || statusLabel[status] || status}</span>;
}

export function FinanceToolbar({
  search,
  onSearchChange,
  placeholder = 'Buscar...',
  filters,
  actions,
  searchTestId,
}: {
  search?: string;
  onSearchChange?: (value: string) => void;
  placeholder?: string;
  filters?: ReactNode;
  actions?: ReactNode;
  searchTestId?: string;
}) {
  return <div className="finance-toolbar">
    <div className="finance-toolbar-main">
      {onSearchChange ? <label className="finance-search-control">
        <Search size={16}/>
        <input data-testid={searchTestId} aria-label={placeholder} value={search || ''} onChange={(event)=>onSearchChange(event.target.value)} placeholder={placeholder}/>
      </label> : null}
      {filters ? <div className="finance-toolbar-filters">{filters}</div> : null}
    </div>
    {actions ? <div className="finance-toolbar-actions">{actions}</div> : null}
  </div>;
}

export function FinanceEmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="finance-empty-state">
    <strong>{title}</strong>
    <p>{description}</p>
    {action ? <div>{action}</div> : null}
  </div>;
}

export function FinanceDrawer({
  open,
  title,
  description,
  onClose,
  children,
  testId,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  if (!open) return null;
  return <div className="finance-drawer-layer" data-testid={testId}>
    <button className="finance-drawer-backdrop" type="button" aria-label="Fechar painel" onClick={onClose}/>
    <aside className="finance-drawer" role="dialog" aria-modal="true" aria-label={title}>
      <header className="finance-drawer-header">
        <div><p className="eyebrow">Ação</p><h3>{title}</h3>{description ? <p className="muted">{description}</p> : null}</div>
        <button className="finance-icon-button" type="button" aria-label="Fechar" onClick={onClose}><X size={18}/></button>
      </header>
      <div className="finance-drawer-body">{children}</div>
    </aside>
  </div>;
}
