import { callClaude } from '../../api/claudeClient.js';

const MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250929',
};

const PATTERN_INFO = {
  SOQL_IN_LOOP: {
    displayName: 'SOQL in loop',
    whyItMatters:
      'SOQL queries inside for-loops execute per iteration, hitting the 100 queries-per-transaction governor limit.',
  },
  DML_IN_LOOP: {
    displayName: 'DML in loop',
    whyItMatters: 'Each DML inside a loop counts against the 150 DML-per-transaction limit.',
  },
  DATABASE_DML_IN_LOOP: {
    displayName: 'Database.DML() in loop',
    whyItMatters: 'Database DML methods in loops hit the same 150 DML limit.',
  },
  NESTED_LOOP: {
    displayName: 'Nested loops',
    whyItMatters: 'O(n*m) complexity amplifies per-iteration cost.',
  },
  UPDATE_WITHOUT_FOR_UPDATE: {
    displayName: 'Read-then-write without FOR UPDATE',
    whyItMatters: 'Race conditions cause UNABLE_TO_LOCK_ROW errors.',
  },
  BATCH_WITHOUT_ORDER_BY: {
    displayName: 'Batch query without ORDER BY',
    whyItMatters: 'Non-deterministic ordering creates lock contention.',
  },
  RT_FLOW_NO_ENTRY_FILTER: {
    displayName: 'RT Flow without entry condition',
    whyItMatters: 'Executes on every save without filtering for relevant changes.',
  },
  FLOW_RECORD_OP_IN_LOOP: {
    displayName: 'Record operation inside Flow loop',
    whyItMatters: 'Each Get/Create/Update/Delete node executes per iteration.',
  },
  MULTIPLE_RT_FLOWS_SAME_TRIGGER: {
    displayName: 'Multiple RT Flows on same trigger',
    whyItMatters: 'Multiple flows compound CPU cost on every save.',
  },
  FLOW_SYNC_CALLOUT: {
    displayName: 'Synchronous callout in RT Flow',
    whyItMatters: 'Blocks the entire transaction until external service responds.',
  },
};

const SYSTEM_PROMPT = `You are an experienced Salesforce architect with deep expertise in Apex, Flow, and Salesforce performance optimization. You help developers fix specific code-level performance issues.

Your responses follow this exact structure:

## Diagnosis
One or two sentences explaining what this specific code snippet does wrong.

## Refactored snippet
A code block containing the fixed version. Include only the relevant lines. Preserve original variable names and business logic.

## Why this works
One paragraph explaining why this refactor solves the issue. Reference Salesforce limits or principles where relevant.

Rules:
- Keep the refactor minimal. Change only what's needed.
- Preserve the original method signature.
- Use idiomatic Apex (Maps for lookups, collections before DML, explicit ordering).
- Never invent helper methods not shown in the snippet.
- If the snippet is too minimal for a confident refactor, say so in Diagnosis.`;

function buildUserMessage(finding) {
  const info = PATTERN_INFO[finding.pattern] || {
    displayName: finding.pattern,
    whyItMatters: '',
  };
  const location = finding.method
    ? `in method ${finding.method}() at ${finding.file}:${finding.line}`
    : `at ${finding.file}:${finding.line || '?'}`;
  const flowMeta =
    finding.analyzer === 'flowAnalyzer' && finding.flowLabel
      ? `\nFlow: ${finding.flowLabel}\nTrigger object: ${finding.triggerObject || 'unknown'}`
      : '';
  const lang = finding.analyzer === 'flowAnalyzer' ? 'xml' : 'apex';

  return `A performance issue was detected in a Salesforce project:

**Pattern:** ${info.displayName}
**Why this pattern matters:** ${info.whyItMatters}

**Location:** ${location}${flowMeta}

**Code snippet:**
\`\`\`${lang}
${finding.snippet || '(no snippet available)'}
\`\`\`

Generate a fix suggestion following the required response structure.`;
}

export async function generateFixSuggestion({ finding, apiKey, model = 'haiku' }) {
  const result = await callClaude({
    apiKey,
    model: MODELS[model] || MODELS.haiku,
    systemPrompt: SYSTEM_PROMPT,
    userMessage: buildUserMessage(finding),
    maxTokens: 1024,
  });
  return {
    text: result.text,
    model,
    modelId: result.model,
    usage: result.usage,
    generatedAt: new Date().toISOString(),
  };
}
