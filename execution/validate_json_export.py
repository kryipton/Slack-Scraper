#!/usr/bin/env python3
"""
validate_json_export.py
-----------------------
Layer 3 execution script: validate and normalise JSON files produced by the
Multi-Channel Slack Message Scraper Chrome extension.

Usage:
    python execution/validate_json_export.py \
        --input  .tmp/raw/ \
        --output .tmp/normalised/

Outputs one normalised JSON file per input file, with:
  - Required fields guaranteed present (channel, timestamp, user, text)
  - Duplicates removed (keyed on channel + timestamp + user)
  - Messages sorted oldest-first
"""

import argparse
import json
import os
import sys
from pathlib import Path


REQUIRED_FIELDS = {"channel", "timestamp", "user", "text"}


def load_file(path: Path) -> list[dict]:
    """Load and parse a JSON export file. Returns a list of message dicts."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    # The extension may wrap messages under a key like "messages" or export
    # a bare list. Handle both.
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("messages", "results", "data"):
            if key in data and isinstance(data[key], list):
                return data[key]
        # Single message object
        return [data]
    raise ValueError(f"Unexpected JSON structure in {path}")


def validate_message(msg: dict, source_file: str) -> dict | None:
    """
    Ensure required fields exist. Returns a normalised message dict,
    or None if the record is too incomplete to salvage.
    """
    # Coerce channel: strip leading '#' for consistency, then re-add
    channel = msg.get("channel") or msg.get("channelName") or ""
    channel = "#" + channel.lstrip("#") if channel else ""

    timestamp = msg.get("timestamp") or msg.get("ts") or ""
    user = msg.get("user") or msg.get("username") or msg.get("author") or ""
    text = msg.get("text") or msg.get("message") or msg.get("body") or ""

    if not (channel and timestamp and user and text):
        return None  # Skip records missing core fields

    return {
        "channel": channel,
        "timestamp": timestamp,
        "user": user,
        "text": text,
        # Carry through optional enrichment fields if present
        "date": msg.get("date") or msg.get("formattedDate") or "",
        "link": msg.get("link") or msg.get("permalink") or "",
        "pageNumber": msg.get("pageNumber"),
        "source_file": source_file,
    }


def normalise_file(input_path: Path, output_path: Path) -> dict:
    """Process a single export file. Returns a stats dict."""
    raw_messages = load_file(input_path)
    seen: set[tuple] = set()
    clean: list[dict] = []
    skipped = 0

    for msg in raw_messages:
        normalised = validate_message(msg, input_path.name)
        if normalised is None:
            skipped += 1
            continue

        key = (normalised["channel"], normalised["timestamp"], normalised["user"])
        if key in seen:
            skipped += 1
            continue

        seen.add(key)
        clean.append(normalised)

    # Sort oldest-first (string sort works for ISO timestamps)
    clean.sort(key=lambda m: m["timestamp"])

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(clean, f, indent=2, ensure_ascii=False)

    return {
        "file": input_path.name,
        "raw": len(raw_messages),
        "clean": len(clean),
        "skipped": skipped,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate & normalise Slack export JSONs")
    parser.add_argument("--input", required=True, help="Directory containing raw JSON files")
    parser.add_argument("--output", required=True, help="Directory to write normalised files")
    args = parser.parse_args()

    input_dir = Path(args.input)
    output_dir = Path(args.output)

    if not input_dir.exists():
        print(f"ERROR: Input directory not found: {input_dir}", file=sys.stderr)
        sys.exit(1)

    json_files = sorted(input_dir.glob("*.json"))
    if not json_files:
        print(f"ERROR: No JSON files found in {input_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(json_files)} JSON file(s) to process.\n")

    total_raw = total_clean = total_skipped = 0
    for json_file in json_files:
        out_file = output_dir / json_file.name
        try:
            stats = normalise_file(json_file, out_file)
            total_raw += stats["raw"]
            total_clean += stats["clean"]
            total_skipped += stats["skipped"]
            print(
                f"  ✅  {stats['file']}: "
                f"{stats['raw']} raw → {stats['clean']} clean "
                f"({stats['skipped']} skipped)"
            )
        except Exception as e:
            print(f"  ❌  {json_file.name}: {e}", file=sys.stderr)

    print(
        f"\nDone. Total: {total_raw} raw → {total_clean} clean "
        f"({total_skipped} skipped/duped)."
    )
    print(f"Normalised files written to: {output_dir.resolve()}")


if __name__ == "__main__":
    main()
