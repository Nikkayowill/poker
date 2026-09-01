#!/usr/bin/env bash
#
# Cases for guard-shared-worktree.sh.
#
# Kept as a file rather than a one-liner for a reason that is itself a finding:
# a command that merely *contains* "git checkout main" as a string used to be
# blocked by the guard, so the test suite could not be typed at the shell
# without tripping the thing it was testing. The guard now anchors its patterns
# at the start of a segment, and the DOES-NOT-RUN-IT block below pins that.
#
# Run:  bash .claude/hooks/guard-shared-worktree.test.sh

set -uo pipefail
GUARD="$(cd "$(dirname "$0")" && pwd)/guard-shared-worktree.sh"

# Both trees are resolved explicitly rather than taken from the cwd, so the
# suite gives the same answer wherever it is run from -- including inside a
# worktree, where every case would otherwise pass vacuously (the guard would
# correctly allow everything, and the deny cases would silently invert).
# The shared tree is the directory holding the common .git.
SHARED=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
export CLAUDE_PROJECT_DIR="$SHARED"

# Any linked worktree will do; the guard only cares that it IS one.
WORKTREE=$(git worktree list --porcelain | awk '/^worktree/ {print $2}' | grep '/worktrees/' | head -1)
[ -z "$WORKTREE" ] && { echo "SKIP: no linked worktree to test the 'aimed elsewhere' cases against"; exit 0; }

printf 'shared tree: %s\nworktree:    %s\n\n' "$SHARED" "$WORKTREE"

pass=0
fail=0

check() {
  local want="$1" cmd="$2" out got
  out=$(jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' | bash "$GUARD")
  if [ -z "$out" ]; then got=allow; else got=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision'); fi
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL  want=%-5s got=%-5s  %s\n' "$want" "$got" "$cmd"
  fi
}

# --- Branch-level: moves the ground under every other session ---------------
check deny 'git checkout main'
check deny 'git checkout -b feat/x'
check deny 'git switch -c feat/x'
check deny 'git merge origin/main'
check deny 'git rebase main'
check deny 'git cherry-pick abc123'
check deny 'git revert abc123'
check deny 'git apply patch.diff'

# --- Destructive: eats uncommitted work that may not be yours ---------------
check deny 'git stash'
check deny 'git stash push -m wip'
check deny 'git stash pop'
check deny 'git reset --hard origin/main'
check deny 'git clean -fd'
check deny 'git restore .'
check deny 'git rm lib/x.ts'

# --- Sweeping: scoops up other sessions' work in progress -------------------
check deny 'git add -A'
check deny 'git add .'
check deny 'git add -u'
check deny 'git commit -am "x"'
check deny 'git commit -a -m "x"'
check deny 'git branch -D old'
check deny 'git worktree remove foo'

# --- Compound commands are judged segment by segment -----------------------
# The hole this closes: judged as one string, the permitted `stash list` at the
# front made the whole thing look fine.
check deny 'git stash list && git stash pop'
check deny 'npm test && git checkout main'
check deny 'git status; git reset --hard'
check deny 'git status && git clean -fd && echo done'

# --- Reads are never blocked ------------------------------------------------
check allow 'git status --porcelain'
check allow 'git log --oneline -5'
check allow 'git diff --stat'
check allow 'git fetch origin'
check allow 'git show HEAD:lib/x.ts'
check allow 'git rev-parse HEAD'
check allow 'git branch --list'
check allow 'git worktree list'
check allow 'git status --porcelain | head -2'

# --- Read-only forms of otherwise-guarded subcommands ----------------------
check allow 'git stash list'
check allow 'git stash show -p'
check allow 'git stash list; echo hi'
check allow 'git clean -n'
check allow 'git clean --dry-run'
check allow 'git apply --check patch.diff'
check allow 'git rm --dry-run x'

# --- Safe writes in the shared tree ----------------------------------------
check allow 'git add lib/foo.ts'
check allow 'git commit -m "named paths only"'
check allow 'git push -u origin feat/x'
check allow 'git worktree add -b feat/x .claude/worktrees/x origin/main'
check allow 'gh pr create --base main'
check allow 'npm run build'

# --- Aimed at a worktree: allowed, that is the whole point ------------------
check allow "cd $WORKTREE && git commit -am 'x'"
check allow "cd $WORKTREE && git stash && git checkout -b feat/z"
check allow "cd $WORKTREE && git clean -fd"
check allow "git -C $WORKTREE reset --hard"

# --- Mentioning a command is not running it --------------------------------
# This whole file is the motivating case.
check allow 'echo "run git checkout main to switch"'
check allow 'grep -rn "git stash" docs/'
check allow 'cat >> notes.md <<EOF
remember: git reset --hard is dangerous here
EOF'

# --- The deliberate override ------------------------------------------------
check allow 'ALLOW_SHARED_TREE=1 git checkout main'
check allow 'ALLOW_SHARED_TREE=1 git stash'

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
