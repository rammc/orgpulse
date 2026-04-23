export const HIGH_CONTENTION_OBJECTS = new Set([
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

export function isHighContention(objectApiName) {
  if (!objectApiName) return false;
  return HIGH_CONTENTION_OBJECTS.has(objectApiName);
}
