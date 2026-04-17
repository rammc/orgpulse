import { walkDirectory } from './directoryPicker.js';
import { detectProjectLayout } from './projectDetector.js';
import { log } from '../util/logger.js';

export async function runDiagnosticScan(dirHandle) {
  const layout = await detectProjectLayout(dirHandle);
  const extensionStats = {};
  const folderStats = { classes: 0, triggers: 0, lwc: 0, flows: 0, objects: 0 };
  const largestFiles = [];
  let totalFiles = 0;

  for await (const { path, handle } of walkDirectory(dirHandle)) {
    totalFiles++;
    const lastDotIndex = path.lastIndexOf('.');
    const ext = lastDotIndex === -1 ? '(none)' : path.substring(lastDotIndex).toLowerCase();
    extensionStats[ext] = (extensionStats[ext] || 0) + 1;

    // Track folder-specific counts
    if (path.includes('/classes/') && ext === '.cls') folderStats.classes++;
    if (path.includes('/triggers/') && ext === '.trigger') folderStats.triggers++;
    if (path.includes('/lwc/') && (ext === '.js' || ext === '.html')) folderStats.lwc++;
    if (path.includes('/flows/') && ext === '.xml') folderStats.flows++;
    if (path.includes('/objects/') && ext === '.xml') folderStats.objects++;

    try {
      const file = await handle.getFile();
      largestFiles.push({ path, size: file.size });
    } catch {
      /* skip */
    }
  }

  largestFiles.sort((a, b) => b.size - a.size);

  const result = {
    layout,
    totalFiles,
    extensionStats: Object.entries(extensionStats).sort((a, b) => b[1] - a[1]),
    folderStats,
    largestFiles: largestFiles.slice(0, 10),
  };

  log.info('diagnostic', 'Scan complete', result);
  return result;
}
