#!/bin/sh
# Installs or updates /Applications/Rally.app from the latest GitHub release using the gh CLI.
set -eu

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

gh release download --repo TannerYohe/rally --pattern '*-arm64.zip' --dir "$work"
osascript -e 'quit app "Rally"' 2>/dev/null || true
rm -rf /Applications/Rally.app
ditto -x -k "$work"/*.zip /Applications
echo "Installed Rally $(defaults read /Applications/Rally.app/Contents/Info CFBundleShortVersionString)"
