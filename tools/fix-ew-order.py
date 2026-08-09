#!/usr/bin/env python3
"""Backfill: swap ew_pair.players into [W, E] in archived club_games payloads.

Until 2026-08-09 every extension adapter emitted ew_pair.players as [E, W],
while every consumer reads [W, E] (builder.rs, and findPlayerSeat / partnerOf /
the seat tags in the Game Analysis app). Captures saved before the fix are
therefore stored with West and East transposed, and will keep rendering that way
until they are re-captured or corrected here.

WHAT IT TOUCHES
    tournaments[].events[].sessions[].boards[].results[].ew_pair.players

    and nothing else. `user_pair.players` and the optional session `pairs`
    directory were never reversed by the bug, so they are left alone.

WHAT IT SKIPS, and why each matters
    - payloads whose provider.id is not "bridge-classroom-fetch". Games loaded
      from BWS+PBN come through the Rust parser service, which always wrote
      [W, E]. Swapping those would break correct data.
    - rows written at or after --cutoff, i.e. re-captured with the fixed
      extension. Those are already right; swapping would re-break them.
    - soft-deleted rows (deleted_at IS NOT NULL).
    - any ew_pair whose players array is not exactly 2 entries (sit-outs and
      synthesized pairs carry []).

RUNNING IT TWICE WOULD RE-BREAK THE DATA. There is no marker in the payload
saying "already fixed", so the cutoff is the only guard. It is checked against
updated_at (falling back to created_at), and the script refuses to touch a row
whose timestamp it cannot parse. Take the backup.

    python3 fix-ew-order.py --db /path/to/bridge_classroom.db --dry-run
    python3 fix-ew-order.py --db /path/to/bridge_classroom.db --backup ./before.db --apply

Add --owner <user-id> to limit it to one account.
"""

import argparse
import json
import shutil
import sqlite3
import sys
from datetime import datetime, timezone

# The extension deploy that fixed the emitted order (commit 2805737). Rows
# stamped at or after this were captured correctly and must not be swapped.
DEFAULT_CUTOFF = '2026-08-09T00:00:00Z'

EXTENSION_PROVIDER = 'bridge-classroom-fetch'


def parse_ts(value):
    """Parse an RFC3339 timestamp, or return None if it isn't one."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None


def iter_results(payload):
    """Yield every result object in the envelope, defensively."""
    for tournament in payload.get('tournaments') or []:
        for event in tournament.get('events') or []:
            for session in event.get('sessions') or []:
                for board in session.get('boards') or []:
                    for result in board.get('results') or []:
                        if isinstance(result, dict):
                            yield result


def swap_payload(payload):
    """Reverse every result-level ew_pair.players. Returns the swap count."""
    swapped = 0
    for result in iter_results(payload):
        pair = result.get('ew_pair')
        if not isinstance(pair, dict):
            continue
        players = pair.get('players')
        # Exactly two, or we do not know what we are looking at.
        if isinstance(players, list) and len(players) == 2:
            pair['players'] = [players[1], players[0]]
            swapped += 1
    return swapped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True, help='path to bridge_classroom.db')
    ap.add_argument('--owner', help='limit to one owner id')
    ap.add_argument('--cutoff', default=DEFAULT_CUTOFF,
                    help=f'skip rows stamped at/after this (default {DEFAULT_CUTOFF})')
    ap.add_argument('--backup', help='copy the db here before writing (required with --apply)')
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument('--dry-run', action='store_true')
    group.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    cutoff = parse_ts(args.cutoff)
    if cutoff is None:
        sys.exit(f'--cutoff is not a timestamp I can read: {args.cutoff}')

    if args.apply and not args.backup:
        sys.exit('--apply requires --backup. This edit cannot be undone from the payload alone.')

    if args.apply:
        shutil.copy2(args.db, args.backup)
        print(f'backed up {args.db} -> {args.backup}')

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    sql = ('SELECT id, owner, event_name, event_date, payload, created_at, updated_at '
           'FROM club_games WHERE deleted_at IS NULL')
    params = []
    if args.owner:
        sql += ' AND owner = ?'
        params.append(args.owner)

    rows = conn.execute(sql, params).fetchall()

    changed, skipped, updates = 0, {}, []

    def skip(reason):
        skipped[reason] = skipped.get(reason, 0) + 1

    for row in rows:
        try:
            payload = json.loads(row['payload'])
        except (json.JSONDecodeError, TypeError):
            skip('payload is not JSON')
            continue

        provider = (payload.get('provider') or {}).get('id')
        if provider != EXTENSION_PROVIDER:
            skip(f'not extension-produced (provider={provider!r})')
            continue

        stamp = parse_ts(row['updated_at']) or parse_ts(row['created_at'])
        if stamp is None:
            skip('unreadable timestamp — refusing to guess')
            continue
        if stamp.astimezone(timezone.utc) >= cutoff.astimezone(timezone.utc):
            skip('written after the fix — already correct')
            continue

        n = swap_payload(payload)
        if n == 0:
            skip('no two-player EW pairs found')
            continue

        changed += 1
        updates.append((json.dumps(payload, separators=(',', ':')), row['id']))
        print(f"  {row['id']}  {row['event_date'] or '?':10}  "
              f"{(row['event_name'] or '?')[:40]:40}  {n:5} results")

    print(f'\n{len(rows)} live rows examined, {changed} to change')
    for reason, count in sorted(skipped.items()):
        print(f'  skipped {count:4}  {reason}')

    if args.dry_run:
        print('\ndry run — nothing written')
        return

    # updated_at is deliberately left alone: it records when the user last
    # captured the game, not when this script touched it, and moving it forward
    # past the cutoff would hide these rows from a re-run that needed to see them.
    conn.executemany('UPDATE club_games SET payload = ? WHERE id = ?', updates)
    conn.commit()
    print(f'\nwrote {changed} rows')


if __name__ == '__main__':
    main()
