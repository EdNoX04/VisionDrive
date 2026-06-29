#!/usr/bin/env bash
#
# Fetch a small, openly-licensed traffic clip into web/public/sample.mp4 so the
# web app's "Load sample video" button works (and so it ships with the Vercel
# deploy). Run this once from anywhere:
#
#   bash tools/fetch_sample_video.sh
#
# Optionally pass your own URL:
#   bash tools/fetch_sample_video.sh https://example.com/my-traffic.mp4
#
set -e

# Default: a widely-used demo traffic video (Intel IoT sample-videos, Apache-2.0).
DEFAULT_URL="https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/car-detection.mp4"
URL="${1:-$DEFAULT_URL}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$SCRIPT_DIR/../web/public/sample.mp4"
mkdir -p "$(dirname "$DEST")"

echo "Downloading sample video..."
echo "  from: $URL"
echo "  to:   web/public/sample.mp4"

if command -v curl >/dev/null 2>&1; then
  curl -L --fail "$URL" -o "$DEST"
elif command -v wget >/dev/null 2>&1; then
  wget -O "$DEST" "$URL"
else
  echo "Error: need curl or wget installed." >&2
  exit 1
fi

echo "Done. Commit it so it deploys:"
echo "  git add web/public/sample.mp4 && git commit -m 'Add sample video'"
