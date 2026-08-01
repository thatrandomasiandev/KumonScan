#!/usr/bin/env bash
# check-tree-quiescence.sh — answer "what is currently happening in this repo?"
#
# Run before starting any work:  bash scripts/check-tree-quiescence.sh
#
# Reports, across ALL worktrees of this repo:
#   1. Files modified in the last RECENT_SECONDS (someone is actively editing)
#   2. Uncommitted changes per worktree
#   3. .git/index.lock presence and age (a git operation in flight, or a crash)
#   4. The shared test-db lock: holder and age
#   5. Coordination-ledger rows still marked in-progress
#   6. Running dev/test processes (vite, vitest, node --watch, concurrently)
#
# Exit 0: tree is quiescent. Exit 1: activity detected; read the report.

set -uo pipefail

RECENT_SECONDS=600
STALE_LOCK_SECONDS=600
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMON_DIR="$(cd "$(git -C "$REPO_DIR" rev-parse --git-common-dir)" && pwd)"
PRIMARY_DIR="$(dirname "$COMMON_DIR")"
COORD_DIR="$PRIMARY_DIR/.agent-coordination"
LEDGER="$COORD_DIR/status.md"
TEST_DB_LOCK="$COORD_DIR/test-db.lock"

quiescent=1
flag_activity() { quiescent=0; }

mtime_of() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null; }
age_of() { echo $(( $(date +%s) - $(mtime_of "$1") )); }

worktree_paths() {
  git -C "$REPO_DIR" worktree list --porcelain | awk '/^worktree /{print $2}'
}

echo "=== Tree quiescence report ($(date -u +%Y-%m-%dT%H:%M:%SZ)) ==="

echo
echo "--- 1. Files modified in the last $((RECENT_SECONDS / 60)) minutes ---"
recent_total=0
while IFS= read -r wt; do
  [ -d "$wt" ] || continue
  recent="$(find "$wt" -type f -newermt "-${RECENT_SECONDS} seconds" \
    -not -path '*/node_modules/*' -not -path '*/.git/*' \
    -not -path '*/dist/*' -not -path '*/.agent-coordination/*' \
    -not -name '.DS_Store' 2>/dev/null)"
  if [ -n "$recent" ]; then
    count="$(printf '%s\n' "$recent" | wc -l | tr -d ' ')"
    recent_total=$((recent_total + count))
    echo "$wt: $count recently modified file(s):"
    printf '%s\n' "$recent" | head -15 | sed 's/^/  /'
    [ "$count" -gt 15 ] && echo "  ... and $((count - 15)) more"
  fi
done < <(worktree_paths)
if [ "$recent_total" -eq 0 ]; then
  echo "None. No file activity in any worktree."
else
  flag_activity
fi

echo
echo "--- 2. Uncommitted changes per worktree ---"
dirty_total=0
while IFS= read -r wt; do
  [ -d "$wt" ] || continue
  branch="$(git -C "$wt" branch --show-current 2>/dev/null || echo detached)"
  dirty="$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$dirty" -gt 0 ]; then
    dirty_total=$((dirty_total + dirty))
    echo "$wt [$branch]: $dirty uncommitted change(s)"
  else
    echo "$wt [$branch]: clean"
  fi
done < <(worktree_paths)
[ "$dirty_total" -gt 0 ] && flag_activity

echo
echo "--- 3. git index locks ---"
index_locks_found=0
for lock in "$COMMON_DIR/index.lock" "$COMMON_DIR"/worktrees/*/index.lock; do
  if [ -f "$lock" ]; then
    index_locks_found=1
    echo "PRESENT: $lock (age $(age_of "$lock")s) — a git operation is in flight, or a process crashed mid-write."
  fi
done
if [ "$index_locks_found" -eq 0 ]; then
  echo "None. No git operation in flight."
else
  flag_activity
fi

echo
echo "--- 4. Shared test-db lock ---"
if [ -f "$TEST_DB_LOCK" ]; then
  age="$(age_of "$TEST_DB_LOCK")"
  if [ "$age" -ge "$STALE_LOCK_SECONDS" ]; then
    echo "STALE (age ${age}s >= ${STALE_LOCK_SECONDS}s) — safe to reclaim via server/scripts/with-test-db-lock.sh:"
  else
    echo "HELD (age ${age}s) — do NOT run tests:"
    flag_activity
  fi
  sed 's/^/  /' "$TEST_DB_LOCK"
else
  echo "Free. No test run in progress."
fi

echo
echo "--- 5. Coordination ledger ($LEDGER) ---"
if [ -f "$LEDGER" ]; then
  in_progress="$(grep -E '\|\s*(in-progress|blocked' "$LEDGER" 2>/dev/null || true)"
  if [ -n "$in_progress" ]; then
    echo "Agents in-progress or blocked:"
    printf '%s\n' "$in_progress" | sed 's/^/  /'
    flag_activity
  else
    echo "No agents in-progress. Ledger exists with no active rows."
  fi
else
  echo "MISSING — no ledger yet. Create it per .cursor/rules/multi-agent-protocol.mdc before starting."
fi

echo
echo "--- 6. Running dev/test processes ---"
procs="$(pgrep -fl 'vitest|vite($| )|node --watch|concurrently|nodemon' 2>/dev/null | grep -v "pgrep" || true)"
if [ -n "$procs" ]; then
  echo "Found (verify none of these touch this repo before proceeding):"
  printf '%s\n' "$procs" | sed 's/^/  /'
  flag_activity
else
  echo "None."
fi

echo
if [ "$quiescent" -eq 1 ]; then
  echo "=== RESULT: QUIESCENT. Safe to start (register in the ledger first). ==="
  exit 0
else
  echo "=== RESULT: ACTIVITY DETECTED. Read the sections above before touching anything. ==="
  exit 1
fi
