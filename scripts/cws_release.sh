#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_PATH="$ROOT_DIR/manifest.json"

required_vars=(
  CWS_CLIENT_ID
  CWS_CLIENT_SECRET
  CWS_REFRESH_TOKEN
  CWS_EXTENSION_ID
  CWS_PUBLISHER_ID
)

for var in "${required_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing required env var: $var" >&2
    exit 1
  fi
done

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "manifest.json not found at $MANIFEST_PATH" >&2
  exit 1
fi

MANIFEST_VERSION=$(MANIFEST_PATH="$MANIFEST_PATH" python3 - <<'PY'
import json
import os

manifest_path = os.environ.get("MANIFEST_PATH")
with open(manifest_path, "r", encoding="utf-8") as f:
    data = json.load(f)
print(data.get("version", ""))
PY
)

if [[ -z "$MANIFEST_VERSION" ]]; then
  echo "manifest.json is missing a version field" >&2
  exit 1
fi

if [[ -n "${GITHUB_REF_NAME:-}" ]]; then
  TAG_NAME="$GITHUB_REF_NAME"
  TAG_VERSION="$TAG_NAME"
  if [[ "$TAG_NAME" == v* ]]; then
    TAG_VERSION="${TAG_NAME#v}"
  fi

  if [[ "$TAG_VERSION" != "$MANIFEST_VERSION" ]]; then
    echo "Tag version ($TAG_VERSION) does not match manifest version ($MANIFEST_VERSION)" >&2
    exit 1
  fi
fi

ZIP_BASE_DIR="${RUNNER_TEMP:-/tmp}"
ZIP_PATH="${ZIP_PATH:-$ZIP_BASE_DIR/chrome-auto-pip-${MANIFEST_VERSION}.zip}"

cd "$ROOT_DIR"

echo "Packaging extension -> $ZIP_PATH"
zip -r "$ZIP_PATH" . \
  -x ".git/*" ".github/*" "node_modules/*" "tests/*" "test-results/*" "*.log" "*.map" "*.zip"

echo "Requesting access token"
TOKEN_RESPONSE=$(curl -fsS "https://oauth2.googleapis.com/token" \
  -d "client_id=$CWS_CLIENT_ID&client_secret=$CWS_CLIENT_SECRET&refresh_token=$CWS_REFRESH_TOKEN&grant_type=refresh_token")

ACCESS_TOKEN=$(python3 - <<'PY'
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    print("Failed to parse token response", file=sys.stderr)
    sys.exit(1)

token = data.get("access_token")
if not token:
    print("Token response missing access_token", file=sys.stderr)
    print(data, file=sys.stderr)
    sys.exit(1)

print(token)
PY
<<<"$TOKEN_RESPONSE")

UPLOAD_URL="https://chromewebstore.googleapis.com/upload/v2/publishers/$CWS_PUBLISHER_ID/items/$CWS_EXTENSION_ID:upload"
PUBLISH_URL="https://chromewebstore.googleapis.com/v2/publishers/$CWS_PUBLISHER_ID/items/$CWS_EXTENSION_ID:publish"

echo "Uploading package"
UPLOAD_RESPONSE=$(curl -fsS -H "Authorization: Bearer $ACCESS_TOKEN" -X POST -T "$ZIP_PATH" "$UPLOAD_URL")

python3 - <<'PY'
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    print("Failed to parse upload response", file=sys.stderr)
    sys.exit(1)

state = data.get("uploadState")
if state and state != "SUCCESS":
    print("Upload failed:", data, file=sys.stderr)
    sys.exit(1)

print("Upload state:", state or "unknown")
PY
<<<"$UPLOAD_RESPONSE"

echo "Publishing"
PUBLISH_RESPONSE=$(curl -fsS -H "Authorization: Bearer $ACCESS_TOKEN" -X POST "$PUBLISH_URL")

python3 - <<'PY'
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    print("Failed to parse publish response", file=sys.stderr)
    sys.exit(1)

print("Publish response:", data)
PY
<<<"$PUBLISH_RESPONSE"

echo "Release complete"
