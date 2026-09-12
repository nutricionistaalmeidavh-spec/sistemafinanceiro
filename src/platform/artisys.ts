import { createDesktopShellManifest } from '@artisys/desktop-shell';
import { DomainEventBus } from '@artisys/eventbus';
import { validateDashboardLayout } from '@artisys/dashboard';
import { normalizePdfInputs } from '@artisys/pdf';
import moduleLock from '../../vendor/artisys-modules.lock.json';

export const UTILIDADES_COMMIT = moduleLock.commit;
export const ARTISYS_MODULES = Object.freeze(
  moduleLock.modules.map((id) => ({ id: id.replace(/^artisys-/, ''), sourceId: id })),
);

export function createArtisysRuntime(userDataDir: string) {
  const desktop = createDesktopShellManifest({
    appId: 'br.com.artisys.sistemafinanceiro',
    userDataDir,
    deepLinkSchemes: ['artisys-financeiro'],
    telemetry: false,
  });
  const eventBus = new DomainEventBus();

  return {
    desktop,
    eventBus,
    dashboard: { validateLayout: validateDashboardLayout },
    pdf: { normalizeInputs: normalizePdfInputs },
  };
}
