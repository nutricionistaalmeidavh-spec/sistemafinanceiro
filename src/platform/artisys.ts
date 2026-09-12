import { createDesktopShellManifest } from '@artisys/desktop-shell';
import { DomainEventBus } from '@artisys/eventbus';
import { validateDashboardLayout } from '@artisys/dashboard';
import { normalizePdfInputs } from '@artisys/pdf';
import { ARTISYS_MODULES, UTILIDADES_COMMIT } from './artisys-manifest.mjs';

export { ARTISYS_MODULES, UTILIDADES_COMMIT };

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
