import { parseFlowMetadata, findNodesInsideLoop } from '../flowParser.js';
import { log } from '../util/logger.js';

const HIGH_CONTENTION_OBJECTS = new Set([
  'Account',
  'Contact',
  'Opportunity',
  'Lead',
  'Case',
  'Task',
  'Event',
  'Order',
  'OrderItem',
  'OpportunityLineItem',
  'User',
]);

const RECORD_OP_TYPES = new Set([
  'recordLookups',
  'recordCreates',
  'recordUpdates',
  'recordDeletes',
]);

const DEFINITE_CALLOUT_TYPES = new Set(['externalService', 'emailSimple']);
const POTENTIAL_CALLOUT_TYPES = new Set(['submit', 'customNotificationAction']);
const APEX_CALLOUT_PATTERNS = [
  /callout/i,
  /^send(To|Email|Sms|Notification)?$/i,
  /notify/i,
  /^post(To|Slack|Teams|Webhook)/i,
  /webhook/i,
  /invoke(Service|Api)/i,
  /external(Service|Api|Call)/i,
  /integrat/i,
  /sync(Data|To|From)/i,
  /http(Request|Call|Post|Get)/i,
];

// Cross-file registry for detecting multiple flows on same object/trigger
let flowRegistry = [];

export function resetRegistry() {
  flowRegistry = [];
}

export function getRegistry() {
  return [...flowRegistry];
}

/**
 * Detect Pattern 1: Record-Triggered Flow without entry filter.
 */
function detectNoEntryFilter(parsed) {
  const { triggerInfo, label } = parsed;

  // Only applies to record-triggered flows
  if (!triggerInfo.type || !triggerInfo.type.startsWith('Record')) return [];

  if (triggerInfo.hasFilters || triggerInfo.filterFormula) return [];

  const isHighContention = HIGH_CONTENTION_OBJECTS.has(triggerInfo.object);

  return [
    {
      analyzer: 'flowAnalyzer',
      pattern: 'RT_FLOW_NO_ENTRY_FILTER',
      name: 'Record-Triggered Flow without entry filter',
      severity: 'warning',
      confidence: isHighContention ? 'high' : 'medium',
      description: `Flow "${label}" runs on every ${triggerInfo.recordTriggerType || 'trigger'} of ${triggerInfo.object} with no entry conditions. This causes unnecessary executions and consumes governor limits.`,
      flowLabel: label,
      triggerObject: triggerInfo.object,
      triggerType: triggerInfo.type,
      recordTriggerType: triggerInfo.recordTriggerType,
      relatedSignals: ['total_cpu_time', 'apex_execution_time', 'concurrent_apex_errors'],
    },
  ];
}

/**
 * Detect Pattern 2: Record operations (Get/Create/Update/Delete) inside a Loop.
 */
function detectRecordOpsInLoop(parsed) {
  const { loops, label, triggerInfo, _flowRoot } = parsed;
  if (!loops || loops.length === 0) return [];

  const findings = [];

  for (const loopNode of loops) {
    const nodesInLoop = findNodesInsideLoop(loopNode, _flowRoot);
    const recordOps = nodesInLoop.filter((n) => RECORD_OP_TYPES.has(n.type));

    for (const op of recordOps) {
      findings.push({
        analyzer: 'flowAnalyzer',
        pattern: 'FLOW_RECORD_OP_IN_LOOP',
        name: 'Record operation inside Flow loop',
        severity: 'critical',
        confidence: 'high',
        description: `Flow "${label}": ${op.type
          .replace('record', '')
          .replace(/([A-Z])/g, ' $1')
          .trim()} element "${op.name}" runs inside loop "${loopNode.name}". Each iteration is a separate DML/SOQL operation, hitting governor limits.`,
        flowLabel: label,
        triggerObject: triggerInfo?.object || null,
        loopName: loopNode.name,
        operationName: op.name,
        operationType: op.type,
        relatedSignals: [
          'total_cpu_time',
          'apex_execution_time',
          'slow_transactions',
          'concurrent_apex_errors',
        ],
      });
    }
  }

  return findings;
}

/**
 * Detect Pattern 3: Synchronous callouts in Record-Triggered Flows.
 */
function detectSynchronousCallouts(parsed, filePath) {
  const { actionCallDetails, triggerInfo, label } = parsed;
  if (!actionCallDetails || actionCallDetails.length === 0) return [];

  const findings = [];
  const isBeforeSave = triggerInfo.type === 'RecordBeforeSave';
  const isHighContention = HIGH_CONTENTION_OBJECTS.has(triggerInfo.object);

  for (const action of actionCallDetails) {
    const classification = classifyCalloutAction(action);
    if (!classification.isCallout) continue;

    let severity = 'warning';
    let confidence = classification.confidence;
    const notes = [classification.reason];

    if (isBeforeSave) {
      severity = 'critical';
      confidence = 'high';
      notes.push(
        'Callouts are not permitted in before-save triggered flows. This will fail at runtime.'
      );
    } else if (isHighContention) {
      severity = 'critical';
      if (confidence === 'medium') confidence = 'high';
      notes.push(
        `${triggerInfo.object} is a high-contention object — callout fires on every save.`
      );
    }

    findings.push({
      analyzer: 'flowAnalyzer',
      pattern: 'FLOW_SYNC_CALLOUT',
      name: `${action.name} (${action.actionType})`,
      severity,
      confidence,
      description:
        'Record-Triggered Flow performs a synchronous callout on every record save. This blocks the transaction, consumes CPU while waiting, and produces timeout errors under bulk operations.',
      contextNote: notes.join(' '),
      file: filePath,
      line: 1,
      flowLabel: label,
      triggerObject: triggerInfo.object,
      triggerType: triggerInfo.type,
      actionName: action.name,
      actionType: action.actionType,
      actionReference: action.actionName,
      snippet: `Flow: ${label}\nObject: ${triggerInfo.object}\nTrigger: ${triggerInfo.type}\nAction: ${action.name} (${action.actionType})\nReference: ${action.actionName || 'N/A'}\nDetection: ${classification.reason}`,
      relatedSignals: [
        'callout_time',
        'total_callout_errors',
        'average_request_time',
        'ui_request_time',
      ],
    });
  }

  return findings;
}

function classifyCalloutAction(action) {
  if (DEFINITE_CALLOUT_TYPES.has(action.actionType)) {
    return {
      isCallout: true,
      confidence: 'high',
      reason: `Action type "${action.actionType}" is a direct external service call.`,
    };
  }
  if (POTENTIAL_CALLOUT_TYPES.has(action.actionType)) {
    return {
      isCallout: true,
      confidence: 'medium',
      reason: `Action type "${action.actionType}" may involve a synchronous network call.`,
    };
  }
  if (action.actionType === 'apex' && action.actionName) {
    const matched = APEX_CALLOUT_PATTERNS.find((p) => p.test(action.actionName));
    if (matched) {
      return {
        isCallout: true,
        confidence: 'medium',
        reason: `Apex action "${action.actionName}" suggests HTTP behavior. Verify the Apex class.`,
      };
    }
  }
  return { isCallout: false };
}

export function analyze(filePath, fileContent) {
  if (!filePath.endsWith('.flow-meta.xml')) return [];

  const parsed = parseFlowMetadata(fileContent, filePath);
  if (!parsed || parsed.skipped) {
    log.info('flowAnalyzer', `Skipped: ${filePath}`, parsed?.reason || 'parse failure');
    return [];
  }

  // Register for cross-file analysis
  if (parsed.triggerInfo.type && parsed.triggerInfo.type.startsWith('Record')) {
    flowRegistry.push({
      filePath,
      label: parsed.label,
      object: parsed.triggerInfo.object,
      triggerType: parsed.triggerInfo.type,
      recordTriggerType: parsed.triggerInfo.recordTriggerType,
    });
  }

  const findings = [
    ...detectNoEntryFilter(parsed),
    ...detectRecordOpsInLoop(parsed),
    ...detectSynchronousCallouts(parsed, filePath),
  ];

  log.info('flowAnalyzer', `${filePath}: ${findings.length} findings`);
  return findings;
}

/**
 * Cross-file finalize pass — detects multiple RT flows on the same object+trigger.
 * Call after all files have been analyzed.
 */
export function finalizePass() {
  const findings = [];

  // Group registry entries by object + triggerType + recordTriggerType
  const groups = new Map();
  for (const entry of flowRegistry) {
    const key = `${entry.object}|${entry.triggerType}|${entry.recordTriggerType || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  for (const [key, entries] of groups) {
    if (entries.length < 2) continue;

    const [object, triggerType, recordTriggerType] = key.split('|');
    const isHighContention = HIGH_CONTENTION_OBJECTS.has(object);
    const flowLabels = entries.map((e) => e.label);
    const flowFiles = entries.map((e) => e.filePath);

    findings.push({
      analyzer: 'flowAnalyzer',
      pattern: 'MULTIPLE_RT_FLOWS_SAME_TRIGGER',
      name: 'Multiple Record-Triggered Flows on same object',
      severity: entries.length >= 3 ? 'critical' : 'warning',
      confidence: isHighContention ? 'high' : 'medium',
      description: `${entries.length} active Record-Triggered Flows fire on ${object} ${recordTriggerType || triggerType}. Multiple flows on the same trigger increase execution order unpredictability and governor limit consumption.`,
      triggerObject: object,
      triggerType,
      recordTriggerType: recordTriggerType || null,
      flowCount: entries.length,
      flowLabels,
      flowFiles,
      relatedSignals: [
        'total_cpu_time',
        'apex_execution_time',
        'concurrent_apex_errors',
        'concurrent_requests',
      ],
    });
  }

  log.info(
    'flowAnalyzer.finalize',
    `${findings.length} cross-file findings from ${flowRegistry.length} registered flows`
  );
  return findings;
}

export const metadata = {
  id: 'flowAnalyzer',
  name: 'Flow Analyzer',
  targetFiles: ['.flow-meta.xml'],
  signals: [
    'total_cpu_time',
    'apex_execution_time',
    'concurrent_apex_errors',
    'slow_transactions',
    'callout_time',
    'total_callout_errors',
    'average_request_time',
    'ui_request_time',
  ],
};
