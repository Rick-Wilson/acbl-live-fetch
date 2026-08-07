#!/bin/bash
# Watch a fetch-replays.js run: prints a progress line every 60s with the
# current rate, time remaining, and projected finish clock time.
#
#   tools/watch-replays.sh <export.json> [interval_seconds] [filter flags...]
#
# Pass the same filter flags the fetch was started with, so the total matches
# the run being watched:
#
#   tools/watch-replays.sh export.json 60 --same-contract --min-per-board 10 \
#     --max-per-board 10
#
# Ctrl-C stops the watcher only — the fetch is a separate process and keeps
# running.

set -u

INPUT="${1:-}"
if [ -z "$INPUT" ]; then
  echo "usage: $(basename "$0") <export.json> [interval_seconds] [filter flags...]" >&2
  exit 1
fi
shift

INTERVAL=60
if [ $# -gt 0 ] && [ -z "${1##[0-9]*}" ]; then
  INTERVAL="$1"
  shift
fi
# Kept as a plain string rather than an array: macOS ships bash 3.2, where
# expanding an empty array under `set -u` is an error. These flags are simple
# tokens, so word splitting is safe.
FILTERS="$*"

# With no flags given, inherit them from the running fetch so the denominator
# can't drift from the run being watched. Only selection-affecting flags are
# copied; --limit and throttle knobs don't change what the run is aiming at.
DETECTED=""
if [ -z "$FILTERS" ]; then
  # ps rather than `pgrep -a`: on macOS -a does not print arguments.
  RUNNING=$(ps -Ao args= 2>/dev/null | grep "fetch-replays\.js fetch" | grep -v grep | head -1 || true)
  if [ -n "$RUNNING" ]; then
    case "$RUNNING" in *--same-contract*) FILTERS="--same-contract" ;; esac
    for flag in --min-per-board --max-per-board; do
      if [[ "$RUNNING" =~ $flag[[:space:]]+([0-9]+) ]]; then
        FILTERS="$FILTERS $flag ${BASH_REMATCH[1]}"
      fi
    done
    [ -n "$FILTERS" ] && DETECTED=" (detected from running fetch)"
  fi
fi

BASE="${INPUT%.json}"
JOURNAL="$BASE.replays.jsonl"

# Ask the fetcher itself how much the current flags imply, so the denominator
# matches the run rather than the whole export.
STATUS=$(node --max-old-space-size=8192 \
  "$(dirname "$0")/fetch-replays.js" status "$INPUT" $FILTERS 2>/dev/null)
TOTAL=$(awk '/replays wanted/ {print $3}' <<< "$STATUS")
BASELINE=$(awk '/replays fetched/ {print $3}' <<< "$STATUS")

if [ -z "$TOTAL" ] || [ -z "$BASELINE" ]; then
  echo "could not read totals from $INPUT" >&2
  exit 1
fi

# The journal holds every replay ever fetched, including ones outside this
# run's selection, so its raw line count is not this run's progress. Take the
# in-selection count from status once, then track journal growth from here —
# the running fetch only appends rows it selected.
JOURNAL_AT_START=$([ -f "$JOURNAL" ] && wc -l < "$JOURNAL" | tr -d ' ' || echo 0)

count() {
  local now
  now=$([ -f "$JOURNAL" ] && wc -l < "$JOURNAL" | tr -d ' ' || echo 0)
  echo $((BASELINE + now - JOURNAL_AT_START))
}

hms() { # seconds -> 12h34m
  local s=${1%.*}
  printf '%dh%02dm' $((s / 3600)) $(((s % 3600) / 60))
}

START_N=$(count)
START_T=$(date +%s)
PREV_N=$START_N
PREV_T=$START_T

# Project from a trailing window rather than the last interval. At ~2s per
# request a 60s sample holds only ~28 of them, so one request landing either
# side of the tick swings the rate ~4% and the ETA by tens of minutes. Ten
# minutes of history smooths that out while still tracking a real slowdown from
# rate-limit backoff, which persists for minutes rather than seconds.
SMOOTH_SECONDS=600
SAMPLE_T=("$START_T")
SAMPLE_N=("$START_N")

echo "journal  $JOURNAL"
echo "total    $TOTAL replays${FILTERS:+  ($FILTERS)}$DETECTED"
echo "already  $BASELINE in selection at start"
echo "interval ${INTERVAL}s   (Ctrl-C stops this watcher, not the fetch)"
echo

while :; do
  sleep "$INTERVAL"
  NOW_N=$(count)
  NOW_T=$(date +%s)

  DN=$((NOW_N - PREV_N))
  DT=$((NOW_T - PREV_T))
  [ "$DT" -le 0 ] && DT=1

  # Last-interval rate, shown so a stall is immediately visible.
  RECENT=$(bc -l <<< "$DN / $DT")
  OVERALL=$(bc -l <<< "($NOW_N - $START_N) / ($NOW_T - $START_T + 0.001)")

  # Trailing-window rate, used for the projection.
  SAMPLE_T+=("$NOW_T")
  SAMPLE_N+=("$NOW_N")
  while [ ${#SAMPLE_T[@]} -gt 2 ] && [ $((NOW_T - ${SAMPLE_T[0]})) -gt $SMOOTH_SECONDS ]; do
    SAMPLE_T=("${SAMPLE_T[@]:1}")
    SAMPLE_N=("${SAMPLE_N[@]:1}")
  done
  WIN_DT=$((NOW_T - ${SAMPLE_T[0]}))
  WIN_DN=$((NOW_N - ${SAMPLE_N[0]}))
  [ "$WIN_DT" -le 0 ] && WIN_DT=$DT && WIN_DN=$DN
  SMOOTH=$(bc -l <<< "$WIN_DN / $WIN_DT")

  LEFT=$((TOTAL - NOW_N))
  PCT=$(bc -l <<< "100 * $NOW_N / $TOTAL")

  if (( $(bc -l <<< "$SMOOTH > 0.001") )); then
    ETA_S=$(bc -l <<< "$LEFT / $SMOOTH")
    REMAIN=$(hms "$ETA_S")
    ETD=$(date -v+"${ETA_S%.*}"S '+%a %H:%M')
  else
    REMAIN="stalled"
    ETD="--"
  fi

  printf '%s  %6d/%d  %5.1f%%  %.2f/s now  %.2f/s %dm  %.2f/s avg  left %s  done ~%s\n' \
    "$(date '+%H:%M:%S')" "$NOW_N" "$TOTAL" "$PCT" \
    "$RECENT" "$SMOOTH" "$((WIN_DT / 60))" "$OVERALL" "$REMAIN" "$ETD"

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
