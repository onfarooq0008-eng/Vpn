#!/usr/bin/env bash
# Pulls the official "OpenVPN for Android" remote-API interface files so the app can control it.
set -euo pipefail
T=$(mktemp -d)
git clone --depth 1 https://github.com/schwabe/ics-openvpn.git "$T"
AIDL_DIR=$(dirname "$(find "$T" -name IOpenVPNAPIService.aidl | head -1)")
mkdir -p app/src/main/aidl/de/blinkt/openvpn/api app/src/main/java/de/blinkt/openvpn/api
cp "$AIDL_DIR"/*.aidl app/src/main/aidl/de/blinkt/openvpn/api/
cp "$(find "$T" -name APIVpnProfile.java | head -1)" app/src/main/java/de/blinkt/openvpn/api/
echo "AIDL files:"; ls app/src/main/aidl/de/blinkt/openvpn/api
