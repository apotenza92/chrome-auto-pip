#!/usr/bin/env bash
set -euo pipefail

SESSION_NAME="${1:-auto-pip-orchestrator}"
PROFILE="${2:-${ORCHESTRATOR_PROFILE:-focused}}"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node)}"

if [[ -z "${NODE_BIN}" ]]; then
  echo "node not found in PATH" >&2
  exit 1
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "tmux session '$SESSION_NAME' already exists"
  exit 0
fi

build_runner_cmd() {
  case "$PROFILE" in
    focused|lean)
      cat <<EOF
cd '$REPO_ROOT' && while true; do \
  '$NODE_BIN' tmp/orchestrator/host.js --target=fedora --flow=bootstrap --continue-on-failure --suspend-after-run; \
  '$NODE_BIN' tmp/orchestrator/scripts/refresh-status.js; \
  sleep 900; \
done
EOF
      ;;
    full)
      cat <<EOF
cd '$REPO_ROOT' && while true; do \
  '$NODE_BIN' tmp/orchestrator/host.js --target=windows --flow=full-extension-e2e --continue-on-failure --suspend-after-run; \
  '$NODE_BIN' tmp/orchestrator/scripts/refresh-status.js; \
  sleep 60; \
  '$NODE_BIN' tmp/orchestrator/host.js --target=fedora --vm-name="\${AUTO_PIP_FEDORA_VM_NAME:-Fedora}" --flow=full-extension-e2e --continue-on-failure --suspend-after-run; \
  '$NODE_BIN' tmp/orchestrator/scripts/refresh-status.js; \
  sleep 60; \
  '$NODE_BIN' tmp/orchestrator/host.js --target=macosTahoe --flow=full-extension-e2e --continue-on-failure --suspend-after-run; \
  '$NODE_BIN' tmp/orchestrator/scripts/refresh-status.js; \
  sleep 900; \
done
EOF
      ;;
    windows)
      cat <<EOF
cd '$REPO_ROOT' && while true; do \
  '$NODE_BIN' tmp/orchestrator/host.js --target=windows --flow=full-extension-e2e --continue-on-failure --suspend-after-run; \
  '$NODE_BIN' tmp/orchestrator/scripts/refresh-status.js; \
  sleep 900; \
done
EOF
      ;;
    fedora)
      cat <<EOF
cd '$REPO_ROOT' && while true; do \
  '$NODE_BIN' tmp/orchestrator/host.js --target=fedora --vm-name="\${AUTO_PIP_FEDORA_VM_NAME:-Fedora}" --flow=full-extension-e2e --continue-on-failure --suspend-after-run; \
  '$NODE_BIN' tmp/orchestrator/scripts/refresh-status.js; \
  sleep 900; \
done
EOF
      ;;
    macos)
      cat <<EOF
cd '$REPO_ROOT' && while true; do \
  '$NODE_BIN' tmp/orchestrator/host.js --target=macosTahoe --flow=full-extension-e2e --continue-on-failure --suspend-after-run; \
  '$NODE_BIN' tmp/orchestrator/scripts/refresh-status.js; \
  sleep 900; \
done
EOF
      ;;
    *)
      echo "Unknown tmux profile '$PROFILE'. Valid profiles: focused, lean, full, windows, fedora, macos" >&2
      exit 1
      ;;
  esac
}

RUNNER_CMD="$(build_runner_cmd)"
STATUS_CMD="cd '$REPO_ROOT' && while true; do '$NODE_BIN' tmp/orchestrator/scripts/refresh-status.js; clear; sed -n '1,260p' tmp/orchestrator/STATUS.md; sleep 300; done"
DOCS_CMD="cd '$REPO_ROOT' && exec \${SHELL:-/bin/bash}"

_tmux() { tmux "$@"; }

_tmux new-session -d -s "$SESSION_NAME" -n docs "$DOCS_CMD"
_tmux new-window -t "$SESSION_NAME" -n status "$STATUS_CMD"
_tmux new-window -t "$SESSION_NAME" -n runner "$RUNNER_CMD"
_tmux select-window -t "$SESSION_NAME":status

echo "Started tmux session: $SESSION_NAME"
echo "Profile: $PROFILE"
echo "Attach with: tmux attach -t $SESSION_NAME"
