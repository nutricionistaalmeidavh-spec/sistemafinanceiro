declare module '@artisys/desktop-shell' {
  export type DesktopShellManifest = {
    appId: string;
    userDataDir: string;
    logDir: string;
    updateChannel: string;
    deepLinkSchemes: string[];
    telemetry: boolean;
    capabilities: string[];
  };
  export function createDesktopShellManifest(value: {
    appId: string;
    userDataDir: string;
    logDir?: string;
    updateChannel?: string;
    deepLinkSchemes?: string[];
    telemetry?: boolean;
  }): DesktopShellManifest;
}

declare module '@artisys/eventbus' {
  export class DomainEventBus {
    subscribe(type: string, handler: (event: unknown) => unknown): () => void;
    publish(event: unknown): Promise<unknown> | unknown;
  }
}

declare module '@artisys/dashboard' {
  export function validateDashboardLayout<T extends { id: string; x: number; y: number; w: number; h: number }>(layout: T[]): T[];
}

declare module '@artisys/pdf' {
  export function normalizePdfInputs(inputs: Array<Record<string, unknown>>): Array<Record<string, string>>;
}
