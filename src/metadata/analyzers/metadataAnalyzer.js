import { log } from '../util/logger.js';
import { isHighContention } from '../util/highContentionObjects.js';
import * as fieldRegistry from '../registry/fieldRegistry.js';

let triggerRegistry = new Map();

export function resetRegistry() {
  triggerRegistry = new Map();
  fieldRegistry.reset();
}

export function getRegistry() {
  return new Map(triggerRegistry);
}

export function analyze(filePath, fileContent) {
  if (filePath.endsWith('.field-meta.xml')) {
    return analyzeFieldMetadata(filePath, fileContent);
  }
  if (filePath.endsWith('.workflow-meta.xml')) {
    return analyzeWorkflowMetadata(filePath, fileContent);
  }
  if (filePath.endsWith('.trigger-meta.xml')) {
    registerTriggerMetaStatus(filePath, fileContent);
    return [];
  }
  if (filePath.endsWith('.trigger')) {
    registerTriggerTargetObject(filePath, fileContent);
    return [];
  }
  return [];
}

function parseXml(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') return null;
  try {
    const parser = new DOMParser();
    const xmlNoNs = xmlString.replace(/xmlns="[^"]*"/g, '');
    const doc = parser.parseFromString(xmlNoNs, 'text/xml');
    if (doc.querySelector('parsererror')) return null;
    return doc;
  } catch (_err) {
    return null;
  }
}

function directChildText(parent, tagName) {
  if (!parent) return null;
  const children = parent.children;
  for (let i = 0; i < children.length; i++) {
    if (children[i].tagName === tagName) {
      const txt = children[i].textContent.trim();
      return txt.length ? txt : null;
    }
  }
  return null;
}

/**
 * Extract parent object API name from a field-meta.xml path.
 * Expected layout: .../objects/<ParentObject>/fields/<FieldName>.field-meta.xml
 */
function parentObjectFromFieldPath(filePath) {
  const match = filePath.match(/\/objects\/([^/]+)\/fields\//);
  return match ? match[1] : null;
}

/**
 * Extract object API name from a workflow file name.
 * Expected layout: .../workflows/<ObjectApi>.workflow-meta.xml
 */
function objectFromWorkflowPath(filePath) {
  const match = filePath.match(/\/workflows\/([^/]+)\.workflow-meta\.xml$/);
  return match ? match[1] : null;
}

/**
 * Extract trigger API name from a .trigger or .trigger-meta.xml path.
 */
function triggerNameFromPath(filePath) {
  const match = filePath.match(/\/triggers\/([^/]+?)\.trigger(?:-meta\.xml)?$/);
  return match ? match[1] : null;
}

// --------------------------------------------------------------------------
// Field metadata: roll-up summary on high-contention parent
// --------------------------------------------------------------------------

function analyzeFieldMetadata(filePath, fileContent) {
  const doc = parseXml(fileContent);
  if (!doc) return [];

  const root = doc.querySelector('CustomField');
  if (!root) return [];

  registerFieldForCrossRef(filePath, root);

  const type = directChildText(root, 'type');
  if (type !== 'Summary') return [];

  const parentObject = parentObjectFromFieldPath(filePath);
  if (!parentObject) return [];
  if (!isHighContention(parentObject)) return [];

  const fullName = directChildText(root, 'fullName');
  const summaryOp = directChildText(root, 'summaryOperation');
  const summarizedField = directChildText(root, 'summarizedField');
  const foreignKey = directChildText(root, 'summaryForeignKey');

  return [
    {
      analyzer: 'metadataAnalyzer',
      pattern: 'ROLLUP_SUMMARY_HOT_PARENT',
      name: 'Roll-up summary on high-contention parent',
      severity: 'warning',
      confidence: 'high',
      description: `Roll-up summary "${fullName}" on ${parentObject} recomputes on every child DML. ${parentObject} is a high-contention object — expect row-lock contention and added CPU on parent updates under bulk load.`,
      file: filePath,
      parentObject,
      fieldName: fullName,
      summaryOperation: summaryOp,
      summarizedField,
      foreignKey,
      relatedSignals: ['row_lock_errors', 'concurrent_dml', 'total_cpu_time'],
    },
  ];
}

function registerFieldForCrossRef(filePath, root) {
  const object = parentObjectFromFieldPath(filePath);
  const field = directChildText(root, 'fullName');
  if (!object || !field) return;
  const type = directChildText(root, 'type');
  const lengthRaw = directChildText(root, 'length');
  const isExternalId = directChildText(root, 'externalId') === 'true';
  const isUnique = directChildText(root, 'unique') === 'true';
  const isRelationship = type === 'Lookup' || type === 'MasterDetail';
  fieldRegistry.register({
    object,
    field,
    type,
    length: lengthRaw ? parseInt(lengthRaw, 10) : null,
    indexed: isExternalId || isUnique || isRelationship,
    externalId: isExternalId,
    unique: isUnique,
  });
}

// --------------------------------------------------------------------------
// Workflow metadata: active rules + field updates on hot objects
// --------------------------------------------------------------------------

function analyzeWorkflowMetadata(filePath, fileContent) {
  const doc = parseXml(fileContent);
  if (!doc) return [];

  const root = doc.querySelector('Workflow');
  if (!root) return [];

  const object = objectFromWorkflowPath(filePath);
  const hotObject = object ? isHighContention(object) : false;

  const findings = [];

  const rules = Array.from(root.querySelectorAll(':scope > rules'));
  for (const rule of rules) {
    const active = directChildText(rule, 'active');
    if (active !== 'true') continue;
    const ruleName = directChildText(rule, 'fullName') || directChildText(rule, 'name');

    findings.push({
      analyzer: 'metadataAnalyzer',
      pattern: 'ACTIVE_WORKFLOW_RULE',
      name: 'Active legacy Workflow rule',
      severity: hotObject ? 'warning' : 'info',
      confidence: 'high',
      description: `Workflow rule "${ruleName}"${
        object ? ` on ${object}` : ''
      } is active. The workflow engine runs as a separate phase after Apex/Flow triggers — adds CPU overhead per DML. ${
        hotObject
          ? `${object} is a high-contention object, amplifying the cost.`
          : 'Migrate to Record-Triggered Flow when feasible.'
      }`,
      file: filePath,
      triggerObject: object,
      ruleName,
      relatedSignals: ['total_cpu_time', 'apex_execution_time'],
    });
  }

  if (hotObject) {
    const fieldUpdates = Array.from(root.querySelectorAll(':scope > fieldUpdates'));
    for (const fu of fieldUpdates) {
      const fuName = directChildText(fu, 'fullName') || directChildText(fu, 'name');
      const targetField = directChildText(fu, 'field');
      const reevaluate = directChildText(fu, 'reevaluateOnChange');

      findings.push({
        analyzer: 'metadataAnalyzer',
        pattern: 'WORKFLOW_FIELD_UPDATE_HOT_OBJECT',
        name: 'Workflow field update on high-contention object',
        severity: 'warning',
        confidence: reevaluate === 'true' ? 'high' : 'medium',
        description: `Workflow field update "${fuName}" on ${object}${
          targetField ? ` targets ${targetField}` : ''
        }${
          reevaluate === 'true'
            ? ' with reevaluateOnChange=true — can trigger recursive workflow execution under bulk DML, compounding row-lock contention.'
            : '. On a high-contention object, field updates add CPU + DML per invocation.'
        }`,
        file: filePath,
        triggerObject: object,
        fieldUpdateName: fuName,
        targetField,
        reevaluateOnChange: reevaluate === 'true',
        relatedSignals: ['row_lock_errors', 'concurrent_dml', 'total_cpu_time'],
      });
    }
  }

  return findings;
}

// --------------------------------------------------------------------------
// Trigger registry (cross-file finalize pass)
// --------------------------------------------------------------------------

function registerTriggerTargetObject(filePath, fileContent) {
  const triggerName = triggerNameFromPath(filePath);
  if (!triggerName) return;
  const match = fileContent.match(/\btrigger\s+\w+\s+on\s+(\w+)\s*\(/i);
  if (!match) return;
  const targetObject = match[1];
  const existing = triggerRegistry.get(triggerName) || { filePath, triggerName };
  triggerRegistry.set(triggerName, { ...existing, targetObject, bodyFilePath: filePath });
}

function registerTriggerMetaStatus(filePath, fileContent) {
  const triggerName = triggerNameFromPath(filePath);
  if (!triggerName) return;
  const doc = parseXml(fileContent);
  if (!doc) return;
  const root = doc.querySelector('ApexTrigger');
  if (!root) return;
  const status = directChildText(root, 'status');
  const existing = triggerRegistry.get(triggerName) || { triggerName };
  triggerRegistry.set(triggerName, { ...existing, status, metaFilePath: filePath });
}

export function finalizePass() {
  const findings = [];

  const byObject = new Map();
  for (const entry of triggerRegistry.values()) {
    if (!entry.targetObject) continue;
    if (entry.status && entry.status !== 'Active') continue;
    if (!byObject.has(entry.targetObject)) byObject.set(entry.targetObject, []);
    byObject.get(entry.targetObject).push(entry);
  }

  for (const [object, entries] of byObject) {
    if (entries.length < 2) continue;
    const hotObject = isHighContention(object);

    findings.push({
      analyzer: 'metadataAnalyzer',
      pattern: 'MULTIPLE_ACTIVE_TRIGGERS_SAME_OBJECT',
      name: 'Multiple active triggers on same sObject',
      severity: entries.length >= 3 || hotObject ? 'critical' : 'warning',
      confidence: 'high',
      description: `${entries.length} active Apex triggers fire on ${object}. Execution order between triggers is undefined — causes unpredictable behavior and adds CPU from each trigger's handler initialization. Consolidate into a single trigger per object and use a handler/framework pattern.${
        hotObject ? ` ${object} is a high-contention object, amplifying the impact.` : ''
      }`,
      triggerObject: object,
      triggerCount: entries.length,
      triggerNames: entries.map((e) => e.triggerName),
      triggerFiles: entries.map((e) => e.bodyFilePath || e.metaFilePath),
      relatedSignals: [
        'total_cpu_time',
        'apex_execution_time',
        'concurrent_apex_errors',
        'concurrent_requests',
      ],
    });
  }

  log.info(
    'metadataAnalyzer.finalize',
    `${findings.length} cross-file findings from ${triggerRegistry.size} registered triggers`
  );
  return findings;
}

export const metadata = {
  id: 'metadataAnalyzer',
  name: 'Metadata Analyzer',
  targetFiles: ['.field-meta.xml', '.workflow-meta.xml', '.trigger-meta.xml', '.trigger'],
  signals: [
    'row_lock_errors',
    'concurrent_dml',
    'total_cpu_time',
    'apex_execution_time',
    'concurrent_apex_errors',
  ],
};
