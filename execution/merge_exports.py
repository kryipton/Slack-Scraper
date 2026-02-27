#!/usr/bin/env python3
"""
merge_exports.py
----------------
Layer 3 execution script: merge multiple per-channel normalised JSON files
into a single dataset, deduplicating across files.

Usage:
    python execution/merge_exports.py \
        --input  .tmp/normalised/ \
        --output .tmp/merged.json
"""

import argparse
import json
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge normalised Slack export JSON files")
    parser.add_argument("--input", required=True, help="Directory of normalised JSON files")
    parser.add_argument("--output", required=True, help="Path for merged output JSON")
    args = parser.parse_args()

    input_dir = Path(args.input)
    output_path = Path(args.output)

    if not input_dir.exists():
        print(f"ERROR: Input directory not found: {input_dir}", file=sys.stderr)
        sys.exit(1)

    json_files = sorted(input_dir.glob("*.json"))
    if not json_files:
        print(f"ERROR: No JSON files found in {input_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"Merging {len(json_files)} file(s)...\n")

    seen: set[tuple] = set()
    all_messages: list[dict] = []
    channel_counts: dict[str, int] = {}

    for json_file in json_files:
        try:
            with open(json_file, encoding="utf-8") as f:
                messages = json.load(f)

            added = 0
            for msg in messages:
                key = (msg.get("channel", ""), msg.get("timestamp", ""), msg.get("user", ""))
                if key in seen:
                    continue
                seen.add(key)
                all_messages.append(msg)
                ch = msg.get("channel", "unknown")
                channel_counts[ch] = channel_counts.get(ch, 0) + 1
                added += 1

            print(f"  ✅  {json_file.name}: {len(messages)} records, {added} new")
        except Exception as e:
            print(f"  ❌  {json_file.name}: {e}", file=sys.stderr)

    # Sort merged dataset oldest-first
    all_messages.sort(key=lambda m: m.get("timestamp", ""))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_messages, f, indent=2, ensure_ascii=False)

    print(f"\n── Channel summary ──────────────────")
    for ch, count in sorted(channel_counts.items()):
        print(f"  {ch}: {count} messages")
    print(f"────────────────────────────────────")
    print(f"Total unique messages: {len(all_messages)}")
    print(f"Merged file written to: {output_path.resolve()}")


if __name__ == "__main__":
    main()
