#!/bin/bash
# Watch a fetch-replays.js run: prints a progress line every 60s with the
# current rate, time remaining, and projected finish clock time.
#
#   tools/watch-replays.sh <export.json> [interval_seconds]
#
# Counts lines in the journal rather than scraping the log, so it reports the
# same number the fetcher would resume from. Ctrl-C stops the watcher only —
# the fetch is a separate process and keeps running.

set -u

INPUT="${1:-}"
INTERVAL="${2:-60}"

if [ -z "$INPUT" ]; then
  echo "usage: $(basename "$0") <export.json> [interval_seconds]" >&2
  exit 1
fi

BASE="${INPUT%.json}"
JOURNAL="$BASE.replays.jsonl"

# Ask the fetcher itself how much work the current knobs imply, so the total
# matches whatever --max-per-board the run was started with.
TOTAL=$(node --max-old-space-size=8192 \
  "$(dirname "$0")/fetch-replays.js" status "$INPUT" ${MAX_PER_BOARD:+--max-per-board "$MAX_PER_BOARD"} 2>/dev/null \
  | awk '/replays wanted/ {print $3}')

if [ -z "$TOTAL" ]; then
  echo "could not read totals from $INPUT" >&2
  exit 1
fi

count() { [ -f "$JOURNAL" ] && wc -l < "$JOURNAL" | tr -d ' ' || echo 0; }

hms() { # seconds -> 12h34m
  local s=${1%.*}
  printf '%dh%02dm' $((s / 3600)) $(((s % 3600) / 60))
}

START_N=$(count)
START_T=$(date +%s)
PREV_N=$START_N
PREV_T=$START_T

echo "journal  $JOURNAL"
echo "total    $TOTAL replays"
echo "interval ${INTERVAL}s   (Ctrl-C stops this watcher, not the fetch)"
echo

while :; do
  sleep "$INTERVAL"
  NOW_N=$(count)
  NOW_T=$(date +%s)

  DN=$((NOW_N - PREV_N))
  DT=$((NOW_T - PREV_T))
  [ "$DT" -le 0 ] && DT=1

  # Recent rate drives the projection; overall rate is shown for contrast so a
  # slowdown from rate-limit backoff is visible rather than averaged away.
  RECENT=$(bc -l <<< "$DN / $DT")
  OVERALL=$(bc -l <<< "($NOW_N - $START_N) / ($NOW_T - $START_T + 0.001)")
  LEFT=$((TOTAL - NOW_N))
  PCT=$(bc -l <<< "100 * $NOW_N / $TOTAL")

  if (( $(bc -l <<< "$RECENT > 0.001") )); then
    ETA_S=$(bc -l <<< "$LEFT / $RECENT")
    REMAIN=$(hms "$ETA_S")
    ETD=$(date -v+"${ETA_S%.*}"S '+%a %H:%M')
  else
    REMAIN="stalled"
    ETD="--"
  fi

  printf '%s  %6d/%d  %5.1f%%  %.2f/s (avg %.2f)  %d/min  left %s  done ~%s\n' \
    "$(date '+%H:%M:%S')" "$NOW_N" "$TOTAL" "$PCT" \
    "$RECENT" "$OVERALL" "$(bc <<< "$DN * 60 / $DT")" "$REMAIN" "$ETD"

  if [ "$NOW_N" -ge "$TOTAL" ]; then
    echo
    echo "complete — merge with:"
    echo "  node --max-old-space-size=8192 $(dirname "$0")/fetch-replays.js merge \"$INPUT\""
    break
  fi

  if [ "$DN" -eq 0 ]; then
    pgrep -f "fetch-replays.js fetch" > /dev/null \
      || echo "  ^ no fetch process running — rerun the fetch command to resume"
  fi

  PREV_N=$NOW_N
  PREV_T=$NOW_T
done
