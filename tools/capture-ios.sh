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

# Wait until the screen stops changing. Two consecutive quiet frames, because
# one is not enough — a page can pause mid-render.
#
# The ceiling is deliberately low. Nothing on these pages takes long, so a long
# wait is not patience, it is a bug being tolerated: an early version of the
# redactor re-ran a whole-document pass on every mutation and left the club game
# page blank at seventy-five seconds. If this warns, fix what is slow rather
# than raising the number.
wait_stable() { # wait_stable <min-wait> <max-wait>
  local min="$1" max="$2" prev="" cur quiet=0 waited=0
  sleep "$min"; waited=$min
  prev="$(mktemp -t bcshot).png"
  xcrun simctl io "$UDID" screenshot --type=png "$prev" >/dev/null 2>&1
  while [ "$waited" -lt "$max" ]; do
    sleep 1; waited=$((waited + 1))
    cur="$(mktemp -t bcshot).png"
    xcrun simctl io "$UDID" screenshot --type=png "$cur" >/dev/null 2>&1
    local d
    d=$(magick compare -metric AE "$prev" "$cur" null: 2>&1 | awk '{print $1}' | cut -d. -f1)
    rm -f "$prev"; prev="$cur"
    case "$d" in (*[!0-9]*|'') d=999999 ;; esac
    if [ "$d" -lt 3000 ]; then
      quiet=$((quiet + 1))
      [ "$quiet" -ge 2 ] && { rm -f "$prev"; return 0; }
    else
      quiet=0
    fi
  done
  rm -f "$prev"
  echo "      WARNING: still changing after ${max}s — something is wrong, not slow" >&2
}

shoot() { # shoot <name> <url>
  local name="$1" url="$2"
  echo "    $name"
  xcrun simctl openurl "$UDID" "$url"
  wait_stable 2 15
  local raw="$OUT/.$name.raw.png"
  xcrun simctl io "$UDID" screenshot --type=png "$raw" >/dev/null
  # Apple rejects any screenshot with an alpha channel, and simulator captures
  # carry one. -strip also drops metadata we have no reason to publish.
  magick "$raw" -alpha off -strip "PNG24:$OUT/$name.png"
  rm -f "$raw"
  local got
  got=$(magick identify -format "%wx%h" "$OUT/$name.png")
  [ "$got" = "$EXPECT" ] || echo "      WARNING: $got, expected $EXPECT" >&2
  # A near-uniform frame is a page that never rendered. Cheap to check, and it
  # is the failure that looks fine in a listing folder until someone opens it.
  local sd
  sd=$(magick "$OUT/$name.png" -colorspace Gray -format "%[fx:standard_deviation*255]" info: | cut -d. -f1)
  [ "${sd:-0}" -gt 8 ] || echo "      WARNING: $name looks blank (sd=$sd)" >&2
}

echo "==> capturing"
shoot "1-club-results-list" "https://my.acbl.org/club-results/233437"
shoot "2-club-game"         "https://my.acbl.org/club-results/details/1455416"
shoot "3-bbo-handviewer" \
  "https://www.bridgebase.com/tools/handviewer.html?bbo=y&lin=pn%7CSouth%2CWest%2CNorth%2CEast%7Cst%7C%7Cmd%7C3S789TQH5KD2C2478T%2CS2456JAH6TD57TKC6%2CS3H78JD4689JQC39J%2C%7Crh%7C%7Cah%7CBoard%201%7Csv%7Co%7Cmb%7Cp%7Cmb%7C2C%7Cmb%7C2S%7Cmb%7Cp%7Cmb%7Cp%7Cmb%7C3H%7Cmb%7Cp%7Cmb%7C3N%7Cmb%7Cp%7Cmb%7Cp%7Cmb%7Cp%7Cpc%7CDQ%7Cpc%7CD3%7Cpc%7CD2%7Cpc%7CDK%7Cpc%7CHT%7Cpc%7CH7%7Cpc%7CH2%7Cpc%7CHK%7Cpc%7CST%7Cpc%7CS2%7Cpc%7CS3%7Cpc%7CSK%7Cpc%7CHA%7Cpc%7CH5%7Cpc%7CH6%7Cpc%7CH8%7Cpc%7CHQ%7Cpc%7CS7%7Cpc%7CS4%7Cpc%7CHJ%7Cpc%7CH9%7Cpc%7CS8%7Cpc%7CS5%7Cpc%7CD4%7Cpc%7CH4%7Cpc%7CS9%7Cpc%7CS6%7Cpc%7CD6%7Cpc%7CH3%7Cpc%7CSQ%7Cpc%7CSJ%7Cpc%7CD8%7Cpc%7CDA%7Cpc%7CC2%7Cpc%7CD5%7Cpc%7CD9%7Cpc%7CCA%7Cpc%7CC4%7Cpc%7CC6%7Cpc%7CC3%7Cpc%7CCK%7Cpc%7CC7%7Cpc%7CD7%7Cpc%7CC9%7Cpc%7CCQ%7Cpc%7CC8%7Cpc%7CDT%7Cpc%7CCJ%7Cpc%7CC5%7Cpc%7CCT%7Cpc%7CSA%7Cpc%7CDJ%7C"

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
