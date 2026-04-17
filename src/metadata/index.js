/**
 * Public API of the metadata analyzer module.
 * Only loaded in local builds — tree-shaken out of public builds.
 */

export { runMetadataAnalysis } from './orchestration.js';
export { runDiagnosticScan } from './fs/diagnosticScan.js';
export { detectProjectLayout } from './fs/projectDetector.js';
export { pickProjectDirectory } from './fs/directoryPicker.js';
export { SIGNAL_CATEGORIES, categorizeSignal } from './signals/signalTypes.js';
