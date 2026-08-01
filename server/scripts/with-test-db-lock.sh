#!/usr/bin/env bash
# with-test-db-lock.sh — run the test suite while holding the shared test-db lock.
#
# All tests run against one shared Neon test branch (TEST_DATABASE_URL); two
# concurrent runs corrupt each other. This wrapper serializes them:
#
#   AGENT_ID=agent-my-task bash server/scripts/with-test-db-lock.sh          # runs `npm test` in server/
#   AGENT_ID=agent-my-task bash server/scripts/with-test-db-lock.sh <cmd...> # runs <cmd...> instead
#
# Behavior:
#   - Lock file: <primary-checkout>/.agent-coordination/test-db.lock (shared
#     across all worktrees via the git common dir).
#   - Acquisition is atomic (noclobber create); exactly one contender wins.
#   - A lock older than STALE_SECONDS (600s) is treated as abandoned and
#     reclaimed atomically (mv, so two reclaimers cannot both succeed).
#   - If the lock is held and fresh: prints the holder and exits 75
#     (EX_TEMPFAIL) WITHOUT running anything. Retry later.
#   - The lock is released on exit (including failure/interrupt), but only if
#     this process still owns it.

set -euo pipefail

STALE_SECONDS=600
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COORD_DIR="$(cd "$(git -C "$REPO_DIR" rev-parse --git-common-dir)/.." && pwd)/.agent-coordination"
LOCK_FILE="$COORD_DIR/test-db.lock"
AGENT_ID="${AGENT_ID:-$(git -C "$REPO_DIR" branch --show-current 2>/dev/null || echo unknown-agent)}"
LOCK_TOKEN="$AGENT_ID/pid-$$/$(date -u +%s)"

mkdir -p "$COORD_DIR"

# File mtime in seconds since epoch (BSD/macOS stat first, then GNU).
mtime_of() {
  stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null
}

lock_age_seconds() {
  local mtime
  mtime="$(mtime_of "$LOCK_FILE")" || return 1
  echo $(( $(date +%s) - mtime ))
}

# Atomic create: succeeds only if the file does not already exist.
try_acquire() {
  ( set -o noclobber
    printf 'token=%s\nagent=%s\npid=%s\nacquired=%s\n' \
      "$LOCK_TOKEN" "$AGENT_ID" "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      > "$LOCK_FILE"
  ) 2>/dev/null
}

release_if_owner() {
  if [ -f "$LOCK_FILE" ] && grep -q "token=$LOCK_TOKEN" "$LOCK_FILE" 2>/dev/null; then
    rm -f "$LOCK_FILE"
  fi
}

acquire_or_bail() {
  if try_acquire; then
    return 0
  fi

  # Lock exists (or vanished between our create attempt and now).
  local age
  if ! age="$(lock_age_seconds)"; then
    # Holder released it in the last instant; try once more.
    try_acquire && return 0
    age="$(lock_age_seconds || echo 0)"
  fi

  if [ "$age" -ge "$STALE_SECONDS" ]; then
    # Stale: reclaim atomically. mv succeeds for exactly one contender.
    local graveyard="$LOCK_FILE.stale.$$"
    if mv "$LOCK_FILE" "$graveyard" 2>/dev/null; then
      echo "with-test-db-lock: reclaimed stale lock (age ${age}s >= ${STALE_SECONDS}s):" >&2
      sed 's/^/  /' "$graveyard" >&2 || true
      rm -f "$graveyard"
    fi
    # Whether we won the mv or someone else did, race for the fresh lock.
    try_acquire && return 0
  fi

  echo "with-test-db-lock: test-db lock is HELD and fresh (age ${age:-?}s < ${STALE_SECONDS}s). Not running tests." >&2
  echo "with-test-db-lock: current holder:" >&2
  sed 's/^/  /' "$LOCK_FILE" >&2 || true
  echo "with-test-db-lock: do non-test work and retry later." >&2
  exit 75  # EX_TEMPFAIL
}

acquire_or_bail
trap release_if_owner EXIT INT TERM

echo "with-test-db-lock: lock acquired by $AGENT_ID (pid $$)." >&2

status=0
if [ "$#" -gt 0 ]; then
  "$@" || status=$?
else
  ( cd "$REPO_DIR/server" && npm test ) || status=$?
fi

exit "$status"
