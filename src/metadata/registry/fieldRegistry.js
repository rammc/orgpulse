const ALWAYS_INDEXED_STANDARD_FIELDS = new Set([
  'Id',
  'OwnerId',
  'CreatedDate',
  'SystemModstamp',
  'LastModifiedDate',
  'RecordTypeId',
]);

const HEAP_HEAVY_TYPES = new Set(['LongTextArea', 'Html']);

let registry = new Map();

function keyFor(object, field) {
  return `${object}.${field}`;
}

export function register(entry) {
  if (!entry?.object || !entry?.field) return;
  registry.set(keyFor(entry.object, entry.field), entry);
}

export function getField(object, field) {
  if (!object || !field) return null;
  return registry.get(keyFor(object, field)) || null;
}

export function hasHeapHeavyField(object) {
  if (!object) return null;
  for (const entry of registry.values()) {
    if (entry.object !== object) continue;
    if (HEAP_HEAVY_TYPES.has(entry.type)) return entry;
  }
  return null;
}

export function isFieldIndexed(object, field) {
  if (!field) return false;
  if (ALWAYS_INDEXED_STANDARD_FIELDS.has(field)) return true;
  const entry = getField(object, field);
  if (!entry) return null;
  return entry.indexed === true;
}

export function isCustomField(field) {
  return typeof field === 'string' && field.endsWith('__c');
}

export function reset() {
  registry = new Map();
}

export function size() {
  return registry.size;
}

export function getAll() {
  return Array.from(registry.values());
}
