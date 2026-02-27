#!/usr/bin/env python3
"""
json_to_gsheets.py
------------------
Layer 3 execution script: upload a merged Slack messages JSON file to
Google Sheets.

Usage:
    # Upload to existing sheet
    python execution/json_to_gsheets.py \
        --input .tmp/merged.json \
        --spreadsheet-id "1BxiMVs0XRA..." 

    # Create a new spreadsheet
    python execution/json_to_gsheets.py \
        --input .tmp/merged.json

Dependencies (install once):
    pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib

Credentials:
    - Download OAuth 2.0 credentials from Google Cloud Console as credentials.json
    - On first run, a browser window opens for consent; token.json is cached.

Sheet layout:
    - A separate tab per channel (named by channel).
    - Columns: Date, Timestamp, Channel, User, Text, Link
"""

import argparse
import json
import os
import sys
from pathlib import Path
from collections import defaultdict

try:
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except ImportError:
    print(
        "ERROR: Google API libraries not installed.\n"
        "Run: pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib",
        file=sys.stderr,
    )
    sys.exit(1)

# ── Constants ──────────────────────────────────────────────────────────────────

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
CREDENTIALS_PATH = os.environ.get("GOOGLE_CREDENTIALS_PATH", "credentials.json")
TOKEN_PATH = os.environ.get("GOOGLE_TOKEN_PATH", "token.json")

SHEET_COLUMNS = ["Date", "Timestamp", "Channel", "User", "Text", "Link"]

# ── Auth ───────────────────────────────────────────────────────────────────────


def get_credentials() -> Credentials:
    """Return valid user credentials, refreshing or requesting consent as needed."""
    creds = None

    if Path(TOKEN_PATH).exists():
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not Path(CREDENTIALS_PATH).exists():
                raise FileNotFoundError(
                    f"credentials.json not found at '{CREDENTIALS_PATH}'. "
                    "Download it from Google Cloud Console → APIs & Services → "
                    "Credentials → OAuth 2.0 Client IDs."
                )
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
            creds = flow.run_local_server(port=0)

        with open(TOKEN_PATH, "w") as f:
            f.write(creds.to_json())

    return creds


# ── Sheets helpers ─────────────────────────────────────────────────────────────


def create_spreadsheet(service, title: str) -> str:
    """Create a new Google Spreadsheet and return its ID."""
    body = {"properties": {"title": title}}
    resp = service.spreadsheets().create(body=body, fields="spreadsheetId").execute()
    return resp["spreadsheetId"]


def ensure_sheet_tab(service, spreadsheet_id: str, tab_name: str) -> int:
    """Ensure a tab named `tab_name` exists. Returns the sheet ID."""
    meta = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    for sheet in meta.get("sheets", []):
        if sheet["properties"]["title"] == tab_name:
            return sheet["properties"]["sheetId"]

    # Create the tab
    body = {
        "requests": [
            {"addSheet": {"properties": {"title": tab_name}}}
        ]
    }
    resp = (
        service.spreadsheets()
        .batchUpdate(spreadsheetId=spreadsheet_id, body=body)
        .execute()
    )
    return resp["replies"][0]["addSheet"]["properties"]["sheetId"]


def write_to_tab(service, spreadsheet_id: str, tab_name: str, rows: list[list]) -> None:
    """Write rows (including header) to the named tab, replacing existing content."""
    range_name = f"'{tab_name}'!A1"
    body = {"values": rows}
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=range_name,
        valueInputOption="USER_ENTERED",
        body=body,
    ).execute()


def format_header_row(service, spreadsheet_id: str, sheet_id: int) -> None:
    """Bold the first row."""
    body = {
        "requests": [
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 0,
                        "endRowIndex": 1,
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "textFormat": {"bold": True},
                            "backgroundColor": {"red": 0.9, "green": 0.9, "blue": 0.9},
                        }
                    },
                    "fields": "userEnteredFormat(textFormat,backgroundColor)",
                }
            }
        ]
    }
    service.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body=body).execute()


# ── Main ───────────────────────────────────────────────────────────────────────


def message_to_row(msg: dict) -> list:
    return [
        msg.get("date") or msg.get("timestamp", "")[:10],
        msg.get("timestamp", ""),
        msg.get("channel", ""),
        msg.get("user", ""),
        msg.get("text", ""),
        msg.get("link", ""),
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload Slack messages JSON to Google Sheets")
    parser.add_argument("--input", required=True, help="Path to merged JSON file")
    parser.add_argument("--spreadsheet-id", default="", help="Existing spreadsheet ID (blank = create new)")
    parser.add_argument("--title", default="Slack Export", help="Title if creating a new spreadsheet")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    with open(input_path, encoding="utf-8") as f:
        messages = json.load(f)

    if not messages:
        print("ERROR: No messages found in input file.", file=sys.stderr)
        sys.exit(1)

    print(f"Loaded {len(messages)} messages from {input_path}.")

    # Group by channel
    by_channel: dict[str, list] = defaultdict(list)
    for msg in messages:
        ch = msg.get("channel", "unknown")
        by_channel[ch].append(msg)

    print(f"Channels: {', '.join(sorted(by_channel.keys()))}")

    # Authenticate
    print("\nAuthenticating with Google...")
    creds = get_credentials()
    service = build("sheets", "v4", credentials=creds)

    # Create or reuse spreadsheet
    spreadsheet_id = args.spreadsheet_id.strip()
    if not spreadsheet_id:
        print(f"Creating new spreadsheet: '{args.title}'...")
        spreadsheet_id = create_spreadsheet(service, args.title)
        print(f"  Created: https://docs.google.com/spreadsheets/d/{spreadsheet_id}")
    else:
        print(f"Using existing spreadsheet: {spreadsheet_id}")

    # Write each channel to its own tab
    for channel, msgs in sorted(by_channel.items()):
        tab_name = channel.lstrip("#")[:100]  # Sheet names max 100 chars
        print(f"\nWriting {len(msgs)} messages to tab '{tab_name}'...")

        sheet_id = ensure_sheet_tab(service, spreadsheet_id, tab_name)
        rows = [SHEET_COLUMNS] + [message_to_row(m) for m in msgs]
        write_to_tab(service, spreadsheet_id, tab_name, rows)
        format_header_row(service, spreadsheet_id, sheet_id)

        print(f"  ✅  Done ({len(msgs)} rows written).")

    sheet_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}"
    print(f"\n🎉 All done!\nSpreadsheet: {sheet_url}")


if __name__ == "__main__":
    main()
