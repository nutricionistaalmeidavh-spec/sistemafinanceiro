export function brl(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100);
}

export function toCents(value: string) {
  const normalized = value.trim().replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed === 0) throw new Error('Informe um valor válido.');
  return Math.round(parsed * 100);
}

export function today() { return new Date().toISOString().slice(0, 10); }

export function can(session: FinanceiroSession, permission: string) {
  return session.permissions.includes('*') || session.permissions.includes(permission);
}
