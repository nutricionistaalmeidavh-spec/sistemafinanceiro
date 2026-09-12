/// <reference types="vite/client" />

type FinanceiroHealth = {
  ok: boolean;
  storage: 'sqlite';
  userVersion: number;
  path: string;
};

declare global {
  interface Window {
    financeiro?: {
      system: {
        health(): Promise<FinanceiroHealth>;
      };
    };
  }
}

export {};
