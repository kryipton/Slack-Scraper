# Slack Message Scraper

A robust Chrome Extension for scraping Slack messages from multiple channels and exporting them to JSON.

## Features

### Chrome Extension (v4)
- **Multi-Channel Scraping:** Scrape messages from multiple channels sequentially.
- **Smart Channel Picker:** Automatically reads your Slack sidebar, expands collapsed categories, and allows you to select public/private channels via a searchable UI.
- **Manual Input Fallback:** Paste a list of channels manually if needed.
- **Adaptive Loading:** Handles cold-cache Slack searches to avoid missing channels on the first run.
- **Dark Mode UI:** A slick, draggable panel that blends nicely with Slack's native dark theme.
- **JSON Export:** Downloads aggregated message data into structured `.json` files.

## Installation 

### Chrome Extension
1. Open Google Chrome and go to `chrome://extensions/`.
2. Turn on **Developer mode** (toggle in the top right corner).
3. Click **Load unpacked** and select the `/Slack Scraper/` directory in this repository.
4. Go to any Slack workspace page.
5. Click the extension icon in your toolbar, then click **▶ Open Scraper Panel**.

## Usage

### Scraping Messages
1. In Slack, open the scraper panel.
2. In the **Channels** section, select channels from your sidebar (or use the Manual tab).
3. Set your desired **Date Range**.
4. Click **Start Scraping**.
5. Once finished, download the resulting exported JSON files from the Downloads section of the panel.

## Development

- When modifying `content.js` or `styles.css`: You just need to reload the Slack web page.
- When modifying `manifest.json` or `background.js`: You must click the **↺ refresh** icon for the extension in `chrome://extensions/` before reloading the page.

## Notes
- To prevent API blocking from Slack natively, the extension automates the web UI instead of performing direct API calls.
- Extension permissions involve reading from the active Slack tab and managing downloads. Ensure you comply with internal workspace privacy codes.
