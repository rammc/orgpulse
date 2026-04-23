import { parseFlowMetadata, findNodesInsideLoop } from '../flowParser.js';
import { log } from '../util/logger.js';
import { HIGH_CONTENTION_OBJECTS } from '../util/highContentionObjects.js';
import * as fieldRegistry from '../registry/fieldRegistry.js';

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
let lookupRegistry = [];

export function resetRegistry() {
  flowRegistry = [];
  lookupRegistry = [];
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

    const subflows = nodesInLoop.filter((n) => n.type === 'subflows');
    for (const sf of subflows) {
      findings.push({
        analyzer: 'flowAnalyzer',
        pattern: 'FLOW_SUBFLOW_IN_LOOP',
        name: 'Subflow invoked inside Flow loop',
        severity: 'critical',
        confidence: 'high',
        description: `Flow "${label}": subflow "${sf.name}" is invoked inside loop "${loopNode.name}". Any DML or SOQL inside the subflow multiplies with loop iterations, hitting governor limits on bulk transactions.`,
        flowLabel: label,
        triggerObject: triggerInfo?.object || null,
        loopName: loopNode.name,
        operationName: sf.name,
        operationType: 'subflows',
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
 * Detect Pattern 5: recordLookups that re-query the trigger object by $Record.Id.
 * Wastes 1 SOQL per flow invocation — under bulk, hits the 100-query limit.
 */
function detectRedundantTriggerQuery(parsed) {
  const { recordLookups, triggerInfo, label } = parsed;
  if (!triggerInfo?.object || !recordLookups?.length) return [];

  const findings = [];
  for (const lookup of recordLookups) {
    const objectEl = directChild(lookup.element, 'object');
    if (!objectEl || objectEl.textContent.trim() !== triggerInfo.object) continue;

    const filters = lookup.element.querySelectorAll(':scope > filters');
    if (filters.length !== 1) continue;
    const filter = filters[0];
    const field = directChild(filter, 'field');
    const operator = directChild(filter, 'operator');
    if (!field || !operator) continue;
    if (field.textContent.trim() !== 'Id') continue;
    if (operator.textContent.trim() !== 'EqualTo') continue;
    const valueEl = directChild(filter, 'value');
    if (!valueEl) continue;
    const elementRef = directChild(valueEl, 'elementReference');
    if (!elementRef) continue;
    const ref = elementRef.textContent.trim();
    if (ref !== '$Record.Id' && ref !== '$Record__Prior.Id') continue;

    findings.push({
      analyzer: 'flowAnalyzer',
      pattern: 'FLOW_REDUNDANT_TRIGGER_QUERY',
      name: 'Redundant Get Records on trigger object',
      severity: 'warning',
      confidence: 'high',
      description: `Flow "${label}": Get Records "${lookup.name}" re-queries the trigger object ${triggerInfo.object} by $Record.Id. Use $Record.<Field> directly — the trigger already provides the record in memory. Saves 1 SOQL per invocation.`,
      flowLabel: label,
      triggerObject: triggerInfo.object,
      operationName: lookup.name,
      relatedSignals: ['total_cpu_time', 'apex_execution_time'],
    });
  }
  return findings;
}

/**
 * Detect Pattern 6: recordLookups without any filters.
 * Full-table scan risk; on >50K records hits SOQL row limits and times out.
 */
function detectUnfilteredGetRecords(parsed) {
  const { recordLookups, label, triggerInfo } = parsed;
  if (!recordLookups?.length) return [];

  const findings = [];
  for (const lookup of recordLookups) {
    const filters = lookup.element.querySelectorAll(':scope > filters');
    const filterFormula = directChild(lookup.element, 'filterFormula');
    const filterLogic = directChild(lookup.element, 'filterLogic');
    if (filters.length > 0 || filterFormula || filterLogic) continue;

    const objectEl = directChild(lookup.element, 'object');
    const object = objectEl ? objectEl.textContent.trim() : null;

    findings.push({
      analyzer: 'flowAnalyzer',
      pattern: 'FLOW_GET_RECORDS_NO_FILTER',
      name: 'Get Records without filter',
      severity: 'warning',
      confidence: 'high',
      description: `Flow "${label}": Get Records "${lookup.name}"${
        object ? ` on ${object}` : ''
      } has no filter — full-table scan risk. On tables with >50K records this will hit SOQL row limits or time out.`,
      flowLabel: label,
      triggerObject: triggerInfo?.object || null,
      operationName: lookup.name,
      queriedObject: object,
      relatedSignals: ['total_cpu_time', 'apex_execution_time', 'slow_transactions'],
    });
  }
  return findings;
}

/**
 * Detect Pattern 7: storeOutputAutomatically=true on recordLookups.
 * Retrieves ALL fields (including LongTextArea) → heap + CPU serialization cost,
 * plus potential FLS exposure.
 */
function detectStoreOutputAutomatically(parsed) {
  const { recordLookups, label, triggerInfo } = parsed;
  if (!recordLookups?.length) return [];

  const findings = [];
  for (const lookup of recordLookups) {
    const storeAuto = directChild(lookup.element, 'storeOutputAutomatically');
    if (!storeAuto || storeAuto.textContent.trim() !== 'true') continue;

    const objectEl = directChild(lookup.element, 'object');
    const object = objectEl ? objectEl.textContent.trim() : null;

    findings.push({
      analyzer: 'flowAnalyzer',
      pattern: 'FLOW_STORE_OUTPUT_AUTOMATICALLY',
      name: 'Get Records retrieves all fields',
      severity: 'info',
      confidence: 'high',
      description: `Flow "${label}": Get Records "${lookup.name}"${
        object ? ` on ${object}` : ''
      } uses storeOutputAutomatically=true — retrieves every field including LongTextArea. Increases heap usage and serialization CPU, especially in bulk triggers. Specify explicit queriedFields instead.`,
      flowLabel: label,
      triggerObject: triggerInfo?.object || null,
      operationName: lookup.name,
      queriedObject: object,
      relatedSignals: ['total_cpu_time', 'apex_execution_time'],
    });
  }
  return findings;
}

function directChild(parent, tagName) {
  if (!parent) return null;
  const children = parent.children;
  for (let i = 0; i < children.length; i++) {
    if (children[i].tagName === tagName) return children[i];
  }
  return null;
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

  registerLookupsForCrossRef(parsed, filePath);

  const findings = [
    ...detectNoEntryFilter(parsed),
    ...detectRecordOpsInLoop(parsed),
    ...detectSynchronousCallouts(parsed, filePath),
    ...detectRedundantTriggerQuery(parsed),
    ...detectUnfilteredGetRecords(parsed),
    ...detectStoreOutputAutomatically(parsed),
  ];

  log.info('flowAnalyzer', `${filePath}: ${findings.length} findings`);
  return findings;
}

function registerLookupsForCrossRef(parsed, filePath) {
  if (!parsed.recordLookups?.length) return;
  for (const lookup of parsed.recordLookups) {
    const objectEl = directChild(lookup.element, 'object');
    const object = objectEl ? objectEl.textContent.trim() : null;
    if (!object) continue;

    const storeAutoEl = directChild(lookup.element, 'storeOutputAutomatically');
    const storeOutputAutomatically = storeAutoEl?.textContent.trim() === 'true';

    const filters = Array.from(lookup.element.querySelectorAll(':scope > filters'));
    const filterFields = [];
    for (const f of filters) {
      const field = directChild(f, 'field');
      if (field) filterFields.push(field.textContent.trim());
    }

    lookupRegistry.push({
      filePath,
      flowLabel: parsed.label,
      triggerObject: parsed.triggerInfo?.object || null,
      lookupName: lookup.name,
      targetObject: object,
      storeOutputAutomatically,
      filterFields,
    });
  }
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

  findings.push(...detectUnindexedFilters());
  findings.push(...detectHeapRiskLookups());

  log.info(
    'flowAnalyzer.finalize',
    `${findings.length} cross-file findings from ${flowRegistry.length} flows, ${lookupRegistry.length} lookups`
  );
  return findings;
}

function detectUnindexedFilters() {
  const findings = [];
  for (const lookup of lookupRegistry) {
    for (const field of lookup.filterFields) {
      if (!fieldRegistry.isCustomField(field)) continue;
      const entry = fieldRegistry.getField(lookup.targetObject, field);
      if (!entry) continue;
      if (entry.indexed) continue;

      findings.push({
        analyzer: 'flowAnalyzer',
        pattern: 'FLOW_UNINDEXED_FILTER',
        name: 'Flow filters on non-indexed custom field',
        severity: 'warning',
        confidence: 'medium',
        description: `Flow "${lookup.flowLabel}": Get Records "${lookup.lookupName}" filters ${lookup.targetObject} by ${field}. The field is neither external ID nor unique nor a relationship — on tables with >100K rows this causes a full-table scan and query timeouts. Either add a custom index via Salesforce Support or filter on an indexed field first.`,
        file: lookup.filePath,
        flowLabel: lookup.flowLabel,
        triggerObject: lookup.triggerObject,
        operationName: lookup.lookupName,
        queriedObject: lookup.targetObject,
        unindexedField: field,
        relatedSignals: ['total_cpu_time', 'slow_transactions', 'average_request_time'],
      });
    }
  }
  return findings;
}

function detectHeapRiskLookups() {
  const findings = [];
  for (const lookup of lookupRegistry) {
    if (!lookup.storeOutputAutomatically) continue;
    const heapField = fieldRegistry.hasHeapHeavyField(lookup.targetObject);
    if (!heapField) continue;

    findings.push({
      analyzer: 'flowAnalyzer',
      pattern: 'FLOW_STORE_OUTPUT_HEAP_RISK',
      name: 'Get Records auto-loads heap-heavy field',
      severity: 'warning',
      confidence: 'high',
      description: `Flow "${lookup.flowLabel}": Get Records "${lookup.lookupName}" on ${lookup.targetObject} uses storeOutputAutomatically=true, and ${lookup.targetObject} has a ${heapField.type} field (${heapField.field}${heapField.length ? `, up to ${heapField.length} chars` : ''}). Under bulk triggers (200 records × up to 128KB each) this blows past the 6MB sync heap limit. Switch to explicit queriedFields and exclude large text fields.`,
      file: lookup.filePath,
      flowLabel: lookup.flowLabel,
      triggerObject: lookup.triggerObject,
      operationName: lookup.lookupName,
      queriedObject: lookup.targetObject,
      heapField: heapField.field,
      heapFieldType: heapField.type,
      heapFieldLength: heapField.length,
      relatedSignals: ['total_cpu_time', 'apex_execution_time'],
    });
  }
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
