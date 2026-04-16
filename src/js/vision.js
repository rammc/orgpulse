import { getApiKey, hasApiKey } from './settings.js';

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
  "findings": [
    {
      "metric": "string (e.g. ui_request_time, db_cpu_time, apex_execution_time, concurrent_requests, login_rate, callout_errors, row_locks)",
      "severity": "warning|critical|info",
      "observation": "string description of what you see",
      "matrix_cell_id": "quick-wins|prioritize|strategic|take-along|evaluate|weigh-up|opportunistic|defer|skip",
      "confidence": 0.0 to 1.0
    }
  ],
  "correlations": ["string descriptions of correlations between metrics"],
  "summary": "string one-paragraph summary of the org's health"
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
      model: 'claude-sonnet-4-5-20241022',
      max_tokens: 1500,
      system:
        'You are an expert Salesforce Performance Engineer analyzing a Scale Center screenshot. Identify performance hotspots, anomalies in charts (CPU spikes, request time spikes, error patterns), and correlations between metrics. Return ONLY valid JSON matching the provided schema.',
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
              text: `Analyze this Salesforce Scale Center screenshot. Identify all performance hotspots, anomalies, and issues visible in the charts and counters. For each finding, suggest which prioritization matrix cell it maps to based on estimated impact and remediation effort.\n\n${schemaDescription}`,
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

  // Extract JSON from the response (handle potential markdown wrapping)
  let jsonStr = textContent.text.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const result = JSON.parse(jsonStr);
  result.timestamp = new Date().toISOString();

  onProgress(1, 'Complete');
  return result;
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
