import { getApiKey, hasApiKey } from './settings.js';
import { validateVisionResponse } from './validation.js';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getMediaType(file) {
  if (file.type === 'image/png') return 'image/png';
  return 'image/jpeg';
}

/**
 * Analyze a screenshot using Anthropic Claude Vision API.
 * @param {File} imageFile - The image file to analyze
 * @param {function} onProgress - Progress callback
 * @returns {Promise<object>} Structured analysis result
 */
export async function analyzeWithVision(imageFile, onProgress = () => {}) {
  if (!hasApiKey()) {
    throw new Error('NO_API_KEY');
  }

  onProgress(0.1, 'Preparing image for AI analysis...');
  const base64 = await fileToBase64(imageFile);
  const mediaType = getMediaType(imageFile);

  onProgress(0.2, 'Sending to Claude Vision API...');

  const schemaDescription = `Return ONLY valid JSON matching this schema:
{
  "mode": "deep",
  "counters": {
    "successful_logins": "<number or null if unreadable>",
    "failed_logins": "<number or null>",
    "concurrent_apex_errors": "<number or null>",
    "concurrent_ui_errors": "<number or null>",
    "row_lock_errors": "<number or null>",
    "total_callout_errors": "<number or null>"
  },
  "findings": [
    {
      "metric": "<MUST be from the allowed list above>",
      "severity": "info|warning|critical",
      "root_cause_type": "compute|data|concurrency|integration|configuration",
      "observation": "<what you see in the chart>",
      "recommendation_hint": "<brief remediation suggestion>",
      "matrix_cell_id": "quick-wins|prioritize|strategic|take-along|evaluate|weigh-up|opportunistic|defer|skip",
      "confidence": 0.0 to 1.0
    }
  ],
  "clearances": [
    {
      "metric": "<MUST be from the allowed list above>",
      "observation": "<why this is healthy>"
    }
  ],
  "layout_warning": "<optional string — set ONLY if the screenshot does not appear to be the standard Org Performance page>",
  "correlations": ["<describe correlations between metrics>"],
  "summary": "<overall assessment>"
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: `You are an expert Salesforce Performance Engineer analyzing a Scale Center Org Performance screenshot.

CRITICAL LAYOUT KNOWLEDGE:
Scale Center's Org Performance page has a FIXED structure. You MUST use ONLY the metric identifiers listed below. Do NOT invent or guess metric names. If you cannot confidently identify a chart, skip it.

COUNTER BAR (top of screenshot, six large numbers, left to right):
- successful_logins (1st counter)
- failed_logins (2nd counter)
- concurrent_apex_errors (3rd counter)
- concurrent_ui_errors (4th counter)
- row_lock_errors (5th counter)
- total_callout_errors (6th counter)

CHARTS (below counters, in order from top to bottom):
- total_execution_errors (1st chart: errors per 10 minutes)
- average_request_time (2nd chart: milliseconds, usually shows REST API and UI lines)
- total_request_volume (3rd chart: request counts per 10 minutes)
- total_cpu_time (4th chart: App CPU and DB CPU lines in milliseconds)
- total_logins (5th chart: login counts per 10 minutes)
- average_callout_time (6th chart: callout latency in milliseconds)
- total_callout_errors_detail (7th chart: detailed callout error breakdown)

IDENTIFICATION STRATEGY:
1. PRIMARY: Identify charts by their position (top to bottom) using the known order listed above.
2. VALIDATION: For each chart, also attempt to read the chart title text visible in the screenshot. If the title you can read CONTRADICTS the expected metric for that position, trust the readable title text and add a note in your observation field: "Position mismatch: expected [X] at position [N] but title reads [Y]".
3. If you see FEWER charts than the 7 listed above (e.g., a partial screenshot or a different Scale Center page), STOP using positional identification entirely. Instead, identify charts solely by whatever title text you can read. For any chart where the title is unreadable, skip it rather than guess.
4. If the screenshot does NOT appear to be the Scale Center Org Performance page (e.g., it shows Performance Analysis reports, ApexGuru insights, or a completely different layout), set a flag in your response: "layout_warning": "Screenshot does not appear to be the standard Org Performance page. Results may be less accurate."

ANALYSIS RULES:
1. Use ONLY the metric identifiers listed above. Never invent metric names.
2. Identify charts by their POSITION (top to bottom), not by trying to read small text labels.
3. For each chart, classify it as a FINDING (anomaly, spike, degradation) or CLEARANCE (normal, flat, healthy).
4. Only return FINDINGS in the "findings" array. Return healthy metrics in "clearances".
5. A flat or zero-value metric is ALWAYS a clearance, never a finding.
6. For each finding, specify root_cause_type: "compute", "data", "concurrency", "integration", or "configuration".
7. Read the counter values from the top bar. Report the actual numbers you see.
8. Your recommendations must be DIRECTLY CAUSED BY observable patterns in this screenshot. Do not suggest strategic initiatives (Data Cloud adoption, Agentforce implementation, customer unification) unless the metrics specifically demonstrate a performance problem that these solutions address. Stay within the scope of Scale Center performance diagnostics.
9. DO NOT recommend: security best practices (WITH USER_MODE migrations, Permission Set Groups), test coverage improvements, DevOps practice changes, or customer experience strategies. ONLY recommend performance remediations tied to anomalies you observed in this screenshot.

Return ONLY valid JSON matching the provided schema.`,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64,
              },
            },
            {
              type: 'text',
              text: `Analyze this Salesforce Scale Center Org Performance screenshot. Identify charts by their POSITION (top to bottom), not by reading labels. Read the six counter values from the top bar. For each metric, classify as FINDING or CLEARANCE. Map findings to matrix cells.\n\n${schemaDescription}`,
            },
          ],
        },
      ],
    }),
  });

  onProgress(0.8, 'Processing AI response...');

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const status = response.status;

    if (status === 401) {
      throw new Error('INVALID_API_KEY');
    } else if (status === 429) {
      throw new Error('RATE_LIMITED');
    } else {
      throw new Error(`API_ERROR: ${errorData.error?.message || `HTTP ${status}`}`);
    }
  }

  const data = await response.json();
  const textContent = data.content?.find((c) => c.type === 'text');

  if (!textContent) {
    throw new Error('API_ERROR: No text response from Claude');
  }

  onProgress(0.95, 'Parsing AI findings...');

  // Extract JSON from the response (handle markdown wrapping and edge cases)
  let jsonStr = textContent.text.trim();
  // Try multiple backtick patterns: ```json\n...\n```, ```\n...\n```, etc.
  const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  } else if (jsonStr.startsWith('```')) {
    // Fallback: strip leading/trailing backtick lines manually
    const lines = jsonStr.split('\n');
    const startIdx = lines[0].startsWith('```') ? 1 : 0;
    const endIdx = lines[lines.length - 1].trim() === '```' ? lines.length - 1 : lines.length;
    jsonStr = lines.slice(startIdx, endIdx).join('\n').trim();
  }
  // Final safety: if still starts with non-JSON char, find first { or [
  if (jsonStr.length > 0 && jsonStr[0] !== '{' && jsonStr[0] !== '[') {
    const braceIdx = jsonStr.indexOf('{');
    const bracketIdx = jsonStr.indexOf('[');
    const firstJson = Math.min(
      braceIdx === -1 ? Infinity : braceIdx,
      bracketIdx === -1 ? Infinity : bracketIdx
    );
    if (firstJson !== Infinity) {
      jsonStr = jsonStr.substring(firstJson);
    }
  }

  const result = JSON.parse(jsonStr);

  // Validate response against known metric vocabulary
  const validated = validateVisionResponse(result);
  validated.timestamp = new Date().toISOString();

  // Log validation results
  const v = validated.validation;
  if (v.rejectedFindings.length > 0) {
    console.warn(
      `OrgPulse: Rejected ${v.rejectedFindings.length} of ${v.originalFindingCount} findings (unknown metrics):`,
      v.rejectedFindings.map((f) => f.metric)
    );
  }
  if (v.counterCorrections.length > 0) {
    console.info('OrgPulse: Counter corrections:', v.counterCorrections);
  }

  // Filter out-of-scope recommendation hints
  const OUT_OF_SCOPE_PATTERNS = [
    /data cloud.*unif/i,
    /identity resolution/i,
    /agentforce/i,
    /customer 360/i,
    /unified customer profile/i,
    /marketing cloud/i,
    /commerce cloud/i,
    /permission set group/i,
    /test coverage/i,
    /code coverage/i,
    /WITH USER_MODE/i,
    /WITH SECURITY_ENFORCED/i,
    /devops/i,
  ];

  let filteredHintCount = 0;
  for (const finding of validated.findings) {
    if (finding.recommendation_hint) {
      for (const pattern of OUT_OF_SCOPE_PATTERNS) {
        if (pattern.test(finding.recommendation_hint)) {
          console.warn(
            `[OrgPulse] Out-of-scope hint filtered for ${finding.metric}: matched ${pattern}`
          );
          finding.recommendation_hint = '';
          filteredHintCount++;
          break;
        }
      }
    }
  }
  if (filteredHintCount > 0) {
    validated.validation.filteredHintCount = filteredHintCount;
  }

  onProgress(1, 'Complete');
  return validated;
}

/**
 * Get a user-friendly error message for Vision API errors.
 */
export function getVisionErrorMessage(error) {
  const msg = error.message || '';

  if (msg === 'NO_API_KEY') {
    return 'No API key configured. Open Settings to add your Anthropic API key.';
  }
  if (msg === 'INVALID_API_KEY') {
    return 'Invalid API key. Please check your key in Settings.';
  }
  if (msg === 'RATE_LIMITED') {
    return 'Rate limited by Anthropic API. Please wait a moment and try again.';
  }
  if (msg.startsWith('API_ERROR:')) {
    return msg.replace('API_ERROR: ', 'API Error: ');
  }
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
    return 'Network error. Please check your internet connection.';
  }

  return `Analysis failed: ${msg}`;
}
