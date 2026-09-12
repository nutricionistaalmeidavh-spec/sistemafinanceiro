export const UTILIDADES_COMMIT = '1c8d00810dcaa9010330ce7adc2877c90484d17d';

export const ARTISYS_MODULES = Object.freeze([
  { id: 'desktop-shell', package: '@artisys/desktop-shell', path: 'modules/artisys-desktop-shell', required: true, kind: 'runtime' },
  { id: 'eventbus', package: '@artisys/eventbus', path: 'modules/artisys-eventbus', required: true, kind: 'runtime' },
  { id: 'dashboard', package: '@artisys/dashboard', path: 'modules/artisys-dashboard', required: true, kind: 'runtime' },
  { id: 'pdf', package: '@artisys/pdf', path: 'modules/artisys-pdf', required: true, kind: 'runtime' },
  { id: 'qa', package: '@artisys/qa', path: 'modules/artisys-qa', required: true, kind: 'dev-gate' },
  { id: 'security', package: null, path: 'modules/artisys-security', required: true, kind: 'dev-gate' },
  { id: 'release', package: '@artisys/release', path: 'modules/artisys-release', required: true, kind: 'dev-gate' },
]);
