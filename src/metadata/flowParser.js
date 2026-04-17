import { log } from './util/logger.js';

/**
 * Parse a Flow metadata XML string and return structured data.
 * Returns null on parse failure, { skipped: true } for inactive/non-RT flows.
 */
export function parseFlowMetadata(xmlString, filePath) {
  if (!xmlString || typeof xmlString !== 'string') {
    log.warn('flowParser', `Empty or invalid content for ${filePath}`);
    return null;
  }

  try {
    const parser = new DOMParser();
    // Remove namespace for easier querying
    const xmlNoNs = xmlString.replace(/xmlns="[^"]*"/g, '');
    const doc = parser.parseFromString(xmlNoNs, 'text/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      log.warn('flowParser', `XML parse error in ${filePath}: ${parseError.textContent}`);
      return null;
    }

    const flow = doc.querySelector('Flow');
    if (!flow) {
      log.warn('flowParser', `No <Flow> root element in ${filePath}`);
      return null;
    }

    const label = getTextContent(flow, 'label');
    const apiVersion = getTextContent(flow, 'apiVersion');
    const status = getTextContent(flow, 'status');
    const processType = getTextContent(flow, 'processType');

    // Skip inactive flows
    if (status !== 'Active') {
      return { skipped: true, reason: 'inactive', status };
    }

    // Extract trigger info from <start>
    const start = flow.querySelector('start');
    const triggerInfo = {
      type: start ? getTextContent(start, 'triggerType') : null,
      object: start ? getTextContent(start, 'object') : null,
      recordTriggerType: start ? getTextContent(start, 'recordTriggerType') : null,
      hasFilters: start ? start.querySelectorAll('filters').length > 0 : false,
      filterFormula: start ? getTextContent(start, 'filterFormula') : null,
    };

    // Extract node arrays
    const loops = extractNodes(flow, 'loops');
    const recordLookups = extractNodes(flow, 'recordLookups');
    const recordCreates = extractNodes(flow, 'recordCreates');
    const recordUpdates = extractNodes(flow, 'recordUpdates');
    const recordDeletes = extractNodes(flow, 'recordDeletes');
    const decisions = extractNodes(flow, 'decisions');
    const actionCalls = extractNodes(flow, 'actionCalls');

    return {
      label,
      apiVersion,
      status,
      processType,
      triggerInfo,
      loops,
      recordLookups,
      recordCreates,
      recordUpdates,
      recordDeletes,
      decisions,
      actionCalls,
      actionCallDetails: actionCalls
        .map((ac) => extractActionCallDetails(ac.element))
        .filter(Boolean),
      _flowRoot: flow,
    };
  } catch (err) {
    log.error('flowParser', `Exception parsing ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * Given a loop node element, traverse the connector graph from its
 * nextValueConnector to find all nodes executed per-iteration.
 * Returns an array of { name, type } objects.
 */
export function findNodesInsideLoop(loopNode, flowRoot) {
  const nextValueConnector = loopNode.element.querySelector('nextValueConnector');
  if (!nextValueConnector) return [];

  const startRef = getTextContent(nextValueConnector, 'targetReference');
  if (!startRef) return [];

  const loopName = loopNode.name;
  const visited = new Set();
  const nodesInLoop = [];

  // Build a lookup of all named nodes in the flow
  const nodeMap = buildNodeMap(flowRoot);

  // BFS/DFS from startRef until we loop back to the loop node or reach a dead end
  const queue = [startRef];
  while (queue.length > 0) {
    const ref = queue.shift();
    if (!ref || visited.has(ref) || ref === loopName) continue;
    visited.add(ref);

    const node = nodeMap.get(ref);
    if (!node) continue;

    nodesInLoop.push({ name: ref, type: node.type });

    // Follow connectors
    const connectors = node.element.querySelectorAll('connector');
    for (const conn of connectors) {
      const target = getTextContent(conn, 'targetReference');
      if (target) queue.push(target);
    }

    // Follow faultConnector
    const faultConn = node.element.querySelector('faultConnector');
    if (faultConn) {
      const target = getTextContent(faultConn, 'targetReference');
      if (target) queue.push(target);
    }

    // Follow decision outcome connectors
    if (node.type === 'decisions') {
      const rules = node.element.querySelectorAll('rules');
      for (const rule of rules) {
        const ruleConn = rule.querySelector('connector');
        if (ruleConn) {
          const target = getTextContent(ruleConn, 'targetReference');
          if (target) queue.push(target);
        }
      }
      const defaultConn = node.element.querySelector('defaultConnector');
      if (defaultConn) {
        const target = getTextContent(defaultConn, 'targetReference');
        if (target) queue.push(target);
      }
    }
  }

  return nodesInLoop;
}

/**
 * Get the name attribute from a flow node element.
 */
export function getNodeName(nodeElement) {
  const nameEl = nodeElement.querySelector('name');
  return nameEl ? nameEl.textContent.trim() : null;
}

/**
 * Extract structured details from an actionCall element.
 * Returns { name, actionName, actionType, label } or null if missing required fields.
 */
export function extractActionCallDetails(element) {
  const name = getNodeName(element);
  const actionNameEl = element.querySelector('actionName');
  const actionTypeEl = element.querySelector('actionType');
  const labelEl = element.querySelector('label');
  const actionName = actionNameEl ? actionNameEl.textContent.trim() : null;
  const actionType = actionTypeEl ? actionTypeEl.textContent.trim() : null;
  const label = labelEl ? labelEl.textContent.trim() : null;
  if (!name || !actionType) return null;
  return { name, actionName, actionType, label };
}

// ---- Internal helpers ----

function getTextContent(parent, tagName) {
  // Only select direct children to avoid picking up nested elements
  const children = parent.children;
  for (let i = 0; i < children.length; i++) {
    if (children[i].tagName === tagName) {
      return children[i].textContent.trim() || null;
    }
  }
  return null;
}

function extractNodes(flowRoot, tagName) {
  const elements = flowRoot.querySelectorAll(tagName);
  return Array.from(elements).map((el) => ({
    name: getNodeName(el),
    label: getTextContent(el, 'label'),
    element: el,
  }));
}

function buildNodeMap(flowRoot) {
  const map = new Map();
  const nodeTypes = [
    'recordLookups',
    'recordCreates',
    'recordUpdates',
    'recordDeletes',
    'decisions',
    'assignments',
    'actionCalls',
    'loops',
    'screens',
    'subflows',
    'waits',
  ];
  for (const type of nodeTypes) {
    const elements = flowRoot.querySelectorAll(type);
    for (const el of elements) {
      const name = getNodeName(el);
      if (name) {
        map.set(name, { type, element: el });
      }
    }
  }
  return map;
}
