import { pickProjectDirectory, walkDirectory } from './fs/directoryPicker.js';
import { detectProjectLayout } from './fs/projectDetector.js';
import { readFile } from './fs/fileReader.js';
import { getAnalyzersForSignals } from './signals/signalToAnalyzer.js';
import { getAnalyzer } from './analyzers/index.js';
import { scoreFindings } from './findings/confidenceScorer.js';
import {
  resetRegistry as resetFlowRegistry,
  finalizePass as flowFinalizePass,
} from './analyzers/flowAnalyzer.js';
import { log } from './util/logger.js';

export async function runMetadataAnalysis(signals, onProgress, dirHandle = null) {
  if (!dirHandle) {
    dirHandle = await pickProjectDirectory();
    if (!dirHandle) return { cancelled: true };
  }

  onProgress?.({ stage: 'detecting', message: 'Detecting project layout...' });
  const layout = await detectProjectLayout(dirHandle);
  log.info('pipeline', 'Layout detected', layout);

  if (layout.layout === 'UNKNOWN') return { error: layout.error };

  const analyzerIds = getAnalyzersForSignals(signals);
  log.info('pipeline', 'Analyzers selected', { signals, analyzerIds });

  if (analyzerIds.length === 0) {
    return {
      findings: [],
      layout,
      analyzedCount: 0,
      fileCount: 0,
      reason: 'No signals mapped to available analyzers.',
    };
  }

  const analyzers = analyzerIds.map(getAnalyzer).filter(Boolean);
  const allTargetFiles = analyzers.flatMap((a) => a.metadata.targetFiles);
  log.info('pipeline', 'Target file patterns', allTargetFiles);

  // Reset cross-file state for flow analyzer
  if (analyzerIds.includes('flowAnalyzer')) {
    resetFlowRegistry();
  }

  onProgress?.({ stage: 'scanning', message: 'Scanning project files...' });
  const allFindings = [];
  let fileCount = 0;
  let analyzedCount = 0;
  const extensionStats = {};
  const skippedFiles = [];
  const analyzedFiles = [];

  for await (const { path, handle } of walkDirectory(dirHandle)) {
    fileCount++;
    // Extension stats (simple last-dot for stats display)
    const lastDotIndex = path.lastIndexOf('.');
    const simpleExt = lastDotIndex === -1 ? '' : path.substring(lastDotIndex).toLowerCase();
    extensionStats[simpleExt || '(none)'] = (extensionStats[simpleExt || '(none)'] || 0) + 1;

    // Match against analyzer target files (handles compound extensions like .flow-meta.xml)
    const lowerPath = path.toLowerCase();
    const matchingAnalyzers = analyzers.filter((a) =>
      a.metadata.targetFiles.some((tf) => lowerPath.endsWith(tf.toLowerCase()))
    );
    if (matchingAnalyzers.length === 0) continue;

    log.info('pipeline.match', `Matched: ${path}`, {
      analyzers: matchingAnalyzers.map((a) => a.metadata.id),
    });
    const fileResult = await readFile(handle);
    if (fileResult.skipped) {
      log.warn('pipeline.skip', `Skipped: ${path}`, { reason: fileResult.reason });
      skippedFiles.push({ path, reason: fileResult.reason });
      continue;
    }

    analyzedCount++;
    analyzedFiles.push(path);
    for (const analyzer of matchingAnalyzers) {
      const findings = analyzer.analyze(path, fileResult.content);
      log.info(
        'pipeline.analyze',
        `${analyzer.metadata.id}: ${findings.length} findings on ${path}`
      );
      allFindings.push(...findings);
    }

    if (analyzedCount % 10 === 0) {
      onProgress?.({
        stage: 'analyzing',
        message: `Analyzed ${analyzedCount} files, found ${allFindings.length} issues...`,
      });
    }
  }

  // Cross-file finalize pass for flow analyzer
  if (analyzerIds.includes('flowAnalyzer')) {
    const crossFileFindings = flowFinalizePass();
    allFindings.push(...crossFileFindings);
    log.info('pipeline.finalize', `Flow finalize: ${crossFileFindings.length} cross-file findings`);
  }

  log.info('pipeline.done', 'Analysis complete', {
    fileCount,
    analyzedCount,
    findings: allFindings.length,
    extensionStats,
  });

  return {
    layout,
    fileCount,
    analyzedCount,
    findings: scoreFindings(allFindings),
    signals,
    analyzersUsed: analyzerIds,
    diagnostics: {
      extensionStats,
      analyzedFiles,
      skippedFiles,
      targetFilePatterns: allTargetFiles,
    },
  };
}
