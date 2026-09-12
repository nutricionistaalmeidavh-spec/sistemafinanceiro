/// <reference types="vite/client" />

declare global {
  type FinanceiroRole = 'ADMIN' | 'FINANCE' | 'MANAGER' | 'READONLY';
  type FinanceiroKind = 'PAYABLE' | 'RECEIVABLE';
  type CategoryNature = 'REVENUE' | 'EXPENSE';

  interface FinanceiroUser {
    id: string;
    login: string;
    name: string;
    role: FinanceiroRole;
    active: boolean;
    createdAt?: string;
    updatedAt?: string;
  }

  interface FinanceiroSession {
    user: FinanceiroUser;
    permissions: string[];
  }

  interface FinanceiroHealth {
    ok: boolean;
    storage: 'sqlite';
    userVersion: number;
    path: string;
  }

  interface FinanceAccount {
    id: string;
    name: string;
    type: 'CASH' | 'BANK' | 'CARD' | 'OTHER';
    active: boolean;
  }

  interface FinanceSettlement {
    id: string;
    entryId: string;
    amountCents: number;
    method?: string | null;
    note?: string | null;
    occurredAt: string;
    createdAt: string;
    reversedAt?: string | null;
  }

  interface FinanceEntry {
    id: string;
    kind: FinanceiroKind;
    description: string;
    categoryId?: string | null;
    accountId?: string | null;
    customerId?: string | null;
    creditorId?: string | null;
    amountCents: number;
    issueAt?: string | null;
    dueAt: string;
    status: 'OPEN' | 'PARTIAL' | 'SETTLED' | 'CANCELLED';
    notes?: string | null;
    settledCents: number;
    openCents: number;
    isOverdue: boolean;
    settlements: FinanceSettlement[];
  }

  interface FinancialSummary {
    payableTotalCents: number;
    payableSettledCents: number;
    payableOpenCents: number;
    receivableTotalCents: number;
    receivableSettledCents: number;
    receivableOpenCents: number;
    overduePayableCents: number;
    overdueReceivableCents: number;
  }

  interface PartyRecord {
    id: string;
    name: string;
    document?: string | null;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
    active: boolean;
  }

  interface FinancialCategory {
    id: string;
    name: string;
    nature: CategoryNature;
    dreGroup: string;
    active: boolean;
  }

  interface Window {
    financeiro?: {
      system: { health(): Promise<FinanceiroHealth> };
      auth: {
        needsBootstrap(): Promise<boolean>;
        bootstrap(input: { name?: string; password: string }): Promise<FinanceiroUser>;
        login(login: string, password: string): Promise<{ token: string; expiresAt: number; user: FinanceiroUser; permissions: string[] }>;
        session(token: string): Promise<FinanceiroSession>;
        logout(token: string): Promise<void>;
        listUsers(token: string): Promise<FinanceiroUser[]>;
        createUser(token: string, input: { name: string; login: string; password: string; role: FinanceiroRole }): Promise<FinanceiroUser>;
        setUserActive(token: string, userId: string, active: boolean): Promise<FinanceiroUser>;
      };
      finance: {
        listAccounts(token: string, filters?: { includeInactive?: boolean }): Promise<FinanceAccount[]>;
        createAccount(token: string, input: { name: string; type: FinanceAccount['type'] }): Promise<FinanceAccount>;
        listEntries(token: string, filters?: Record<string, unknown>): Promise<FinanceEntry[]>;
        createEntry(token: string, input: Record<string, unknown>): Promise<FinanceEntry>;
        settleEntry(token: string, entryId: string, input: { amountCents: number; method?: string; occurredAt?: string }): Promise<{ settlement: FinanceSettlement; entry: FinanceEntry }>;
        reverseSettlement(token: string, settlementId: string, reason: string): Promise<{ settlement: FinanceSettlement; entry: FinanceEntry }>;
        cancelEntry(token: string, entryId: string, reason: string): Promise<FinanceEntry>;
        summary(token: string, filters?: Record<string, unknown>): Promise<FinancialSummary>;
      };
      registry: {
        listCustomers(token: string, filters?: Record<string, unknown>): Promise<PartyRecord[]>;
        saveCustomer(token: string, input: Partial<PartyRecord> & { name: string }): Promise<PartyRecord>;
        setCustomerActive(token: string, id: string, active: boolean): Promise<PartyRecord>;
        listCreditors(token: string, filters?: Record<string, unknown>): Promise<PartyRecord[]>;
        saveCreditor(token: string, input: Partial<PartyRecord> & { name: string }): Promise<PartyRecord>;
        setCreditorActive(token: string, id: string, active: boolean): Promise<PartyRecord>;
        listCategories(token: string, filters?: { nature?: CategoryNature; includeInactive?: boolean }): Promise<FinancialCategory[]>;
        saveCategory(token: string, input: Partial<FinancialCategory> & { name: string; nature: CategoryNature }): Promise<FinancialCategory>;
        setCategoryActive(token: string, id: string, active: boolean): Promise<FinancialCategory>;
      };
    };
  }
}

export {};
