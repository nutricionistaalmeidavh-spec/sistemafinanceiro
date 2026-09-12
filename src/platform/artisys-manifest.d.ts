export const UTILIDADES_COMMIT: string;
export const ARTISYS_MODULES: ReadonlyArray<{
  id: string;
  package: string | null;
  path: string;
  required: true;
  kind: 'runtime' | 'dev-gate';
}>;
