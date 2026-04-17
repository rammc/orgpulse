export const METADATA_ANALYZER_ENABLED = import.meta.env.VITE_BUILD_MODE === 'local';
export const BUILD_MODE = import.meta.env.VITE_BUILD_MODE || 'public';
export function isLocalMode() {
  return METADATA_ANALYZER_ENABLED;
}
export function getBuildInfo() {
  return {
    mode: BUILD_MODE,
    metadataAnalyzerEnabled: METADATA_ANALYZER_ENABLED,
  };
}
