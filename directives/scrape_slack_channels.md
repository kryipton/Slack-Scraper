# Slack Channel Scraper — Directive

## Purpose
Scrape messages from one or more Slack channels using the **Multi-Channel Slack Message Scraper** Chrome extension (in `Slack Scraper/`), then export the results to a Google Sheet for downstream analysis.

---

## Inputs

| Input | Source | Notes |
|-------|--------|-------|
| Channel list | User provides | One `#channel-name` per line |
| Start date | User provides | ISO date (YYYY-MM-DD) |
| End date | User provides | ISO date (YYYY-MM-DD); defaults to today |
| Target spreadsheet | `.env` → `TARGET_SPREADSHEET_ID` | Leave blank to create a new sheet |

---

## Tools / Scripts

| Script | Purpose |
|--------|---------|
| `execution/validate_json_export.py` | Validate & normalise the JSON files exported by the extension |
| `execution/json_to_gsheets.py` | Upload normalised data to Google Sheets |
| `execution/merge_exports.py` | Merge multiple per-channel JSON files into one dataset |

---

## Step-by-Step Process

### 1. Scrape via Browser Extension
1. Open Chrome and navigate to your Slack workspace (`*.slack.com`).
2. Click the **Slack Message Scraper** extension icon → **Open Scraper Panel**.
3. In the floating panel:
   - Paste channel names (one per line, e.g. `#general`).
   - Set start and end dates.
   - Click **Start Multi-Channel Scraping**.
4. Wait for scraping to finish. The extension will add files to its **Download Queue**.
5. Click **Download All** — JSON files land in your browser's default downloads folder.
6. Move the downloaded JSON files into `.tmp/raw/`.

### 2. Validate & Normalise
```
python execution/validate_json_export.py --input .tmp/raw/ --output .tmp/normalised/
```
- Checks required fields: `channel`, `timestamp`, `user`, `text`.
- Deduplicates by `(channel, timestamp, user)`.
- Writes clean JSON to `.tmp/normalised/`.

### 3. Merge (if multiple channels)
```
python execution/merge_exports.py --input .tmp/normalised/ --output .tmp/merged.json
```

### 4. Upload to Google Sheets
```
python execution/json_to_gsheets.py \
  --input .tmp/merged.json \
  --spreadsheet-id "$TARGET_SPREADSHEET_ID"   # blank = create new
```
- Authenticates via OAuth (see `.env` for credential paths).
- First run opens a browser window for consent; token cached in `token.json`.
- Creates a new tab per channel, or dumps all to a single sheet.
- Prints the final spreadsheet URL.

---

## Outputs

| Output | Location |
|--------|---------- |
| Raw extension exports | `.tmp/raw/*.json` |
| Normalised data | `.tmp/normalised/*.json` |
| Merged dataset | `.tmp/merged.json` |
| **Deliverable** | Google Sheet URL (printed to stdout) |

---

## Edge Cases & Known Issues

- **Slack lazy-loads messages**: the extension handles this by scrolling & expanding "Show more" buttons before extracting. If messages are missing, try re-running on just that channel.
- **Pagination**: the extension navigates all result pages automatically. If it stalls, click **Test Navigation** in the panel to diagnose.
- **Rate limits**: Slack's web search UI has no published rate limit, but rapid repeated scrapes of the same workspace may trigger CAPTCHAs. Add a 60 s delay between channel runs if this happens.
- **Private channels**: the extension can only see channels the logged-in user has access to. It will silently return 0 messages for channels where access is denied.
- **Large date ranges**: scraping >6 months of a busy channel can take 20+ minutes. Break into quarterly chunks when needed.
- **Google OAuth first run**: `credentials.json` must exist in the project root (download from Google Cloud Console → OAuth 2.0 Client IDs → Desktop app).

---

## Learning Log
_Update this section whenever you discover new constraints, errors, or better approaches._

| Date | Finding |
|------|---------|
| — | (no entries yet) |
