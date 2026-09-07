#!/usr/bin/env bash
# Capture the App Store screenshots on the iOS simulator (docs/app-store/SCREENSHOTS.md).
#
# Mac only. Usage:
#   apps/light/scripts/ios-screenshots.sh "path/to/CViper Light.app"
#
# Boots each device, installs the app, launches it, then waits for Enter
# before each shot so you can arrange the screen. Nothing here is run in CI.
set -euo pipefail

APP="${1:?path to the simulator .app (unsigned build) is required}"
BUNDLE_ID="com.cviper.light"
OUT_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)/docs/app-store/screenshots"
DEVICES=("iPhone 17 Pro Max" "iPad Pro 13-inch (M5)")
SHOTS=5

for device in "${DEVICES[@]}"; do
  udid=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
name = sys.argv[1]
for runtime, devices in json.load(sys.stdin)["devices"].items():
    for d in devices:
        if d["name"] == name and d["isAvailable"]:
            print(d["udid"]); sys.exit(0)
sys.exit(1)' "$device") || { echo "No available simulator named '$device' — see: xcrun simctl list devicetypes"; exit 1; }

  slug=$(echo "$device" | tr -c 'A-Za-z0-9' '-' | sed 's/-*$//')
  out="$OUT_ROOT/$slug"
  mkdir -p "$out"

  echo "== $device ($udid)"
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b
  xcrun simctl install "$udid" "$APP"
  xcrun simctl launch "$udid" "$BUNDLE_ID" >/dev/null
  open -a Simulator --args -CurrentDeviceUDID "$udid"

  for n in $(seq 1 "$SHOTS"); do
    read -r -p "Arrange shot $n of $SHOTS on $device, then press Enter… "
    xcrun simctl io "$udid" screenshot "$out/$n.png"
    echo "   saved $out/$n.png"
  done

  xcrun simctl shutdown "$udid"
done

echo "Done. Upload from $OUT_ROOT — the folder is gitignored."
