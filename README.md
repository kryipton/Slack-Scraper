# Slack Message Scraper

A robust Chrome Extension and Python backend toolset for scraping Slack messages from multiple channels and exporting them to Google Sheets. 

## Features

### Chrome Extension (v4)
- **Multi-Channel Scraping:** Scrape messages from multiple channels sequentially.
- **Smart Channel Picker:** Automatically reads your Slack sidebar, expands collapsed categories, and allows you to select public/private channels via a searchable UI.
- **Manual Input Fallback:** Paste a list of channels manually if needed.
- **Adaptive Loading:** Handles cold-cache Slack searches to avoid missing channels on the first run.
- **Dark Mode UI:** A slick, draggable panel that blends nicely with Slack's native dark theme.
- **JSON Export:** Downloads aggregated message data into structured `.json` files.

### Python Backend Tools
- **Data Validation (`validate_json_export.py`):** Ensures exported JSON files are well-formed, deduplicates messages, and sorts them by timestamp.
- **Data Merging (`merge_exports.py`):** Combines multiple channel export files into a single unified dataset.
- **Google Sheets Upload (`json_to_gsheets.py`):** Authenticates via Google API and uploads merged Slack datasets to a Google Spreadsheet.

## Installation 

### 1. Chrome Extension
1. Open Google Chrome and go to `chrome://extensions/`.
2. Turn on **Developer mode** (toggle in the top right corner).
3. Click **Load unpacked** and select the `/Slack Scraper/` directory in this repository.
4. Go to any Slack workspace page.
5. Click the extension icon in your toolbar, then click **▶ Open Scraper Panel**.

### 2. Python Environment
This assumes you have Python 3.8+ installed.

1. Navigate to the root directory.
2. Install the required Google dependencies:
   ```bash
   pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib
   ```
3. Copy the example `.env` file and configure it:
   ```bash
   cp .env.example .env
   ```
4. Place your Google API `credentials.json` file in the correct location as specified in your `.env` file.

## Usage

### Scraping Messages
1. In Slack, open the scraper panel.
2. In the **Channels** section, select channels from your sidebar (or use the Manual tab).
3. Set your desired **Date Range**.
4. Click **Start Scraping**.
5. Once finished, download the resulting exported JSON files from the Downloads section of the panel.

### Processing & Uploading to Google Sheets
Move your downloaded JSON files into the appropriate temporary directory (e.g., `.tmp/raw_exports/`) and run the scripts in order:

1. **Format and validate the downloaded files:**
   ```bash
   python execution/validate_json_export.py
   ```
2. **Merge validated files into one:**
   ```bash
   python execution/merge_exports.py
   ```
3. **Upload to Google Sheets:**
   ```bash
   python execution/json_to_gsheets.py
   ```

## Development

- When modifying `content.js` or `styles.css`: You just need to reload the Slack web page.
- When modifying `manifest.json` or `background.js`: You must click the **↺ refresh** icon for the extension in `chrome://extensions/` before reloading the page.

## Notes
- To prevent API blocking from Slack natively, the extension automates the web UI instead of performing direct API calls.
- Extension permissions involve reading from the active Slack tab and managing downloads. Ensure you comply with internal workspace privacy codes.
