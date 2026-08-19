#!/bin/bash
# Capture App Store screenshots from the iOS Simulator.
#
#   tools/capture-ios.sh iphone    # 1320x2868, Apple's 6.9-inch slot
#   tools/capture-ios.sh ipad      # 2064x2752, Apple's 13-inch slot
#
# Emits into screenshots/ios/<device>/ at exactly the size Apple asks for, with
# a clean status bar and no alpha channel.
#
# ONE-TIME SETUP PER SIMULATOR, which cannot be scripted — there is no simctl
# verb for either:
#
#   1. Settings ▸ Apps ▸ Safari ▸ Extensions        → enable Bridge Classroom Fetch
#   2. In Safari, open the page menu (bottom bar)   → allow it on every website
#
# Both persist in that simulator's data, so this is once per device, not once
# per run. Skip them and every shot is a page with no button on it.

set -euo pipefail
cd "$(dirname "$0")/.."

DEVICE_KIND="${1:-iphone}"
case "$DEVICE_KIND" in
  iphone) DEVICE_NAME="iPhone 17 Pro Max"; EXPECT="1320x2868" ;;
  ipad)   DEVICE_NAME="iPad Pro 13-inch (M5)"; EXPECT="2064x2752" ;;
  *) echo "usage: $0 [iphone|ipad]" >&2; exit 1 ;;
esac

OUT="screenshots/ios/$DEVICE_KIND"
mkdir -p "$OUT"

UDID=$(xcrun simctl list devices available | grep -F "$DEVICE_NAME (" | head -1 |
       sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
[ -n "$UDID" ] || { echo "no simulator named '$DEVICE_NAME'" >&2; exit 1; }
echo "==> $DEVICE_NAME  $UDID"

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true

# Apple's own marketing status bar. batteryState MUST be `discharging`:
# `charged` still draws the charging bolt, which reads as someone's phone
# rather than a product image.
xcrun simctl status_bar "$UDID" override \
  --time "9:41" \
  --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --operatorName "" \
  --batteryState discharging --batteryLevel 100

shoot() { # shoot <name> <url> <settle-seconds>
  local name="$1" url="$2" settle="${3:-6}"
  echo "    $name"
  xcrun simctl openurl "$UDID" "$url"
  sleep "$settle"                       # let the page load AND the redactor run
  local raw="$OUT/.$name.raw.png"
  xcrun simctl io "$UDID" screenshot --type=png "$raw" >/dev/null
  # Apple rejects any screenshot with an alpha channel, and simulator captures
  # carry one. -strip also drops metadata we have no reason to publish.
  magick "$raw" -alpha off -strip "PNG24:$OUT/$name.png"
  rm -f "$raw"
  local got
  got=$(magick identify -format "%wx%h" "$OUT/$name.png")
  [ "$got" = "$EXPECT" ] || echo "      WARNING: $got, expected $EXPECT" >&2
}

echo "==> capturing"
shoot "1-club-results-list" "https://my.acbl.org/club-results/233437" 8
shoot "2-club-game"         "https://my.acbl.org/club-results/details/1455416" 10
shoot "3-bbo-handviewer" \
  "https://www.bridgebase.com/tools/handviewer.html?bbo=y&lin=pn%7CSouth%2CWest%2CNorth%2CEast%7Cst%7C%7Cmd%7C3S789TQH5KD2C2478T%2CS2456JAH6TD57TKC6%2CS3H78JD4689JQC39J%2C%7Crh%7C%7Cah%7CBoard%201%7Csv%7Co%7Cmb%7Cp%7Cmb%7C2C%7Cmb%7C2S%7Cmb%7Cp%7Cmb%7Cp%7Cmb%7C3H%7Cmb%7Cp%7Cmb%7C3N%7Cmb%7Cp%7Cmb%7Cp%7Cmb%7Cp" 8

echo
echo "==> $OUT"
for f in "$OUT"/*.png; do
  printf "    %-26s %s alpha=%s\n" "$(basename "$f")" \
    "$(magick identify -format '%wx%h' "$f")" \
    "$(magick identify -format '%A' "$f")"
done
cat <<'NEXT'

Check every shot before uploading:
  • the "Analyze in Bridge Classroom" button is visible — if not, the extension
    is not enabled or has no permission for that site (see the setup note above)
  • no real names, addresses or emails survived the redactor
NEXT
