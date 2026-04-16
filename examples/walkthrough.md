# Walkthrough: Using OrgPulse

This guide walks you through analyzing a Salesforce Scale Center screenshot with OrgPulse.

## Prerequisites

- A screenshot from Salesforce Scale Center (PNG or JPG)
- A modern browser (Chrome, Firefox, Safari, Edge)
- (Optional) An Anthropic API key for Deep Analysis Mode

## Step 1: Open OrgPulse

Navigate to OrgPulse in your browser. If running locally:

```bash
cd orgpulse
npm install
npm run dev
```

You'll see the main screen with the upload zone and the 9-field prioritization matrix below.

<!-- Screenshot placeholder: main screen -->

## Step 2: Upload a Scale Center Screenshot

Take a screenshot of your Salesforce Scale Center dashboard. Make sure the counter area at the top is visible (Successful Logins, Failed Logins, Concurrent Apex Errors, etc.).

**Option A:** Drag and drop the screenshot onto the upload zone.

**Option B:** Click the upload zone to browse for the file.

After uploading, you'll see a preview thumbnail with the file name and size.

<!-- Screenshot placeholder: uploaded preview -->

## Step 3: Choose Analysis Mode

Use the toggle to select your analysis mode:

### Basic Mode (Free)
- Runs entirely in your browser
- Uses Tesseract.js OCR to extract counter values
- No data leaves your machine
- No API key required

### Deep Analysis Mode (~$0.02)
- Sends the screenshot to Anthropic Claude Vision API
- Interprets charts, trends, and patterns
- Requires your own API key (see Step 3a)

<!-- Screenshot placeholder: mode toggle -->

### Step 3a: Configure API Key (Deep Mode Only)

1. Click the gear icon in the top-right corner
2. Enter your Anthropic API key (starts with `sk-ant-`)
3. Click "Save Key Locally"
4. The key is stored in your browser's LocalStorage only

<!-- Screenshot placeholder: settings modal -->

## Step 4: Run Analysis

Click the **Analyze** button. You'll see a progress bar:

- **Basic Mode:** OCR engine loads, then text recognition runs (5-15 seconds)
- **Deep Mode:** Image is sent to Claude API, response is processed (3-8 seconds)

<!-- Screenshot placeholder: progress bar -->

## Step 5: Review Detection Summary

After analysis, the Detection Summary panel appears showing:

- **Counter values** extracted from the screenshot
- **Detected signals** (color-coded by severity)
- **Confidence indicator** for the analysis

<!-- Screenshot placeholder: detection summary -->

## Step 6: Explore the Matrix

Relevant matrix cells are now **highlighted with a pulse animation**. The number badge on each cell shows how many signals map to it.

Click any cell to open the detail panel with:

- Detected signals that triggered this cell
- Scale Center hints for further investigation
- Actionable recommendations with Salesforce documentation links

<!-- Screenshot placeholder: highlighted matrix with detail panel -->

## Step 7: Take Action

Review the recommendations in priority order:

1. **Green cells (Quick Wins, Prioritize, Take Along):** Address these first
2. **Yellow cells (Strategic, Evaluate, Opportunistic):** Plan and evaluate
3. **Orange cells (Weigh Up, Defer):** Only with clear ROI
4. **Red cell (Skip):** Consciously decide not to pursue

Each recommendation includes tags, descriptions, and links to official Salesforce documentation.

## Tips

- **Multiple screenshots:** Clear the current analysis and upload another screenshot to compare different time periods
- **Save findings:** Take note of highlighted cells and recommendations before clearing
- **Share with your team:** The matrix provides a common language for prioritization discussions
- **Contribute:** If you have recommendations to add, see [Contributing Recommendations](../docs/contributing-recommendations.md)
