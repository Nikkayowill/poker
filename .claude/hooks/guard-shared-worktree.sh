#!/usr/bin/env bash
#
# Keeps concurrent Claude Code sessions from tripping over each other.
#
# Several sessions run against this one checkout at the same time. The primary
# worktree is shared between all of them, so a branch switch, a stash, a reset
# or a sweeping `git add -A` there is not a local action -- it lands underneath
# whoever else is mid-task, and it has cost real work more than once: five
# subagents lost their uncommitted changes to a sibling's stash, and a session
# once built a whole feature on files another session committed and merged out
# from under it.
#
# So: branch-level and destructive git is refused in the SHARED tree, and
# allowed everywhere else. Linked worktrees are per-task and nobody else is
# standing in them, which is exactly why the answer is always "make one".
#
# Reads are never blocked -- status, log, diff and fetch are how a session finds
# out what is going on, and a guard that hides that is worse than the problem.
#
# **Each segment of a compound command is judged on its own.** That is not
# tidiness: judging the whole string at once meant `git stash list && git stash
# pop` read as a permitted `stash list`, which is a hole big enough to drive the
# original bug through. Splitting on the shell's own separators also tracks a
# leading `cd <worktree>`, so the ordinary "cd into my worktree and work" shape
# is not caught.
#
# Escape hatch: put ALLOW_SHARED_TREE=1 in the command when you really do mean
# the shared tree. Deliberate, and impossible to hit by accident.

set -uo pipefail

payload=$(cat)
command=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$command" ] && exit 0

if printf '%s' "$command" | grep -qE '(^|[[:space:];&|(])ALLOW_SHARED_TREE=1([[:space:]]|$)'; then
  exit 0
fi

project="${CLAUDE_PROJECT_DIR:-$PWD}"

# Is this path a linked worktree rather than the shared tree? A linked
# worktree's git dir lives under .git/worktrees/<name>; the shared tree's is a
# plain .git. Nothing else tells them apart reliably, and this needs no
# hardcoded paths.
is_shared() {
  local dir="$1" gitdir
  case "$dir" in /*) ;; *) dir="$project/$dir" ;; esac
  gitdir=$(git -C "$dir" rev-parse --absolute-git-dir 2>/dev/null) || return 1
  case "$gitdir" in */worktrees/*) return 1 ;; *) return 0 ;; esac
}

deny() {
  jq -n --arg reason "$1
Work in your own worktree instead — nobody else is standing in it:

  git worktree add -b <branch> .claude/worktrees/<short-name> origin/main
  cd .claude/worktrees/<short-name>

Reads in the shared tree are fine (status, log, diff, show, fetch). If you
genuinely mean the shared tree, put ALLOW_SHARED_TREE=1 in the command." '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

# The two families that reach other sessions. The first changes what everyone
# else sees (the branch, the merge base); the second destroys uncommitted work
# that is not necessarily yours -- untracked files included, which is the shape
# that has actually bitten.
BRANCH_LEVEL='checkout|switch|merge|rebase|cherry-pick|revert|am|apply'
DESTRUCTIVE='stash|reset|clean|restore|rm'

# Read-only forms of the same subcommands. Matched against the segment on its
# own, so they cannot be used to smuggle a destructive one in beside them.
READ_ONLY='^git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+(stash[[:space:]]+(list|show)|clean[[:space:]]+([^[:space:]]+[[:space:]]+)*(-n|--dry-run)|apply[[:space:]]+([^[:space:]]+[[:space:]]+)*(--check|--stat|--numstat|--summary)|rm[[:space:]]+([^[:space:]]+[[:space:]]+)*(-n|--dry-run))([[:space:]]|$)'

# The directory the current segment acts on. A `cd` segment updates it for
# everything after, exactly as the shell would.
target="$project"

# Split on the shell's own separators. Newlines first so heredocs and
# multi-line scripts are segmented too.
while IFS= read -r segment; do
  segment=$(printf '%s' "$segment" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
  [ -z "$segment" ] && continue

  # Follow a `cd` so "cd into my worktree, then work" is judged where it lands.
  if printf '%s' "$segment" | grep -qE '^cd[[:space:]]'; then
    dest=$(printf '%s' "$segment" | sed -nE "s/^cd[[:space:]]+['\"]?([^'\"[:space:]]+)['\"]?.*/\1/p")
    if [ -n "$dest" ]; then
      case "$dest" in /*) target="$dest" ;; *) target="$target/$dest" ;; esac
    fi
    continue
  fi

  # Anchored: the segment must BE a git command, not merely mention one.
  # Optional leading VAR=value assignments are part of the invocation.
  printf '%s' "$segment" | grep -qE '^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git([[:space:]]|$)' || continue

  # `git -C <path>` redirects this segment only.
  seg_target="$target"
  git_c=$(printf '%s' "$segment" | sed -nE "s/.*git[[:space:]]+-C[[:space:]]+['\"]?([^'\"[:space:]]+)['\"]?.*/\1/p")
  [ -n "$git_c" ] && seg_target="$git_c"

  is_shared "$seg_target" || continue
  printf '%s' "$segment" | grep -qE "$READ_ONLY" && continue

  if printf '%s' "$segment" | grep -qE "^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git([[:space:]]+--?[a-zA-Z-]+([[:space:]]+[^-][^[:space:]]*)?)*[[:space:]]+($BRANCH_LEVEL)([[:space:]]|$)"; then
    deny "This is the SHARED primary worktree, and other Claude Code sessions are working in it right now. Switching or replaying branches here moves the ground under them mid-task."
  fi

  if printf '%s' "$segment" | grep -qE "^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git([[:space:]]+--?[a-zA-Z-]+([[:space:]]+[^-][^[:space:]]*)?)*[[:space:]]+($DESTRUCTIVE)([[:space:]]|$)"; then
    deny "This is the SHARED primary worktree, and other Claude Code sessions have uncommitted work in it right now. This discards working-tree state that is very likely not yours — a sibling's stash/reset has already wiped five agents' changes once."
  fi

  # Staging or committing NAMED paths is fine; sweeping everything up is not,
  # because "everything" here includes other sessions' work in progress.
  if printf '%s' "$segment" | grep -qE "^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git[[:space:]]+add[[:space:]]+(-A|--all|-u|--update|\.)([[:space:]]|$)"; then
    deny "This is the SHARED primary worktree. \`git add\` with -A/-u/. stages every other session's work in progress along with yours."
  fi

  if printf '%s' "$segment" | grep -qE "^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git[[:space:]]+commit[[:space:]]+([^[:space:]]+[[:space:]]+)*(-a|--all|-[a-zA-Z]*a[a-zA-Z]*)([[:space:]]|$)"; then
    deny "This is the SHARED primary worktree. \`git commit -a\` commits every modified file in it, including the ones other sessions are still working on."
  fi

  if printf '%s' "$segment" | grep -qE "^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git[[:space:]]+branch[[:space:]]+([^[:space:]]+[[:space:]]+)*-(D|d|m|M)([[:space:]]|$)"; then
    deny "Deleting or renaming a branch from the SHARED worktree can pull it out from under another session that is on it. Check \`git worktree list\` first."
  fi

  # `git worktree add` is the fix this hook points at, so it stays allowed.
  if printf '%s' "$segment" | grep -qE "^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git[[:space:]]+worktree[[:space:]]+(remove|prune)([[:space:]]|$)"; then
    deny "That worktree probably belongs to another running session. Confirm with \`git worktree list\` that it is yours and idle first."
  fi
done < <(printf '%s\n' "$command" | sed -E 's/\&\&/\n/g; s/\|\|/\n/g; s/;/\n/g; s/\|/\n/g')

exit 0
