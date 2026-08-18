---
name: deploy-checklist
description: Pre-merge/deploy checklist for StackChips — migration-and-code shipping together, verifying a real production deploy, and checking for concurrent-session commits before opening a PR. Use before merging a PR to main, applying a Supabase migration, or opening a PR on this repo.
---

# Deploy / migration checklist

Migrated from the root `CLAUDE.md` (2026-08-17).

Learned the expensive way: `credit_gold`'s calling code shipped to production before its migration
was applied, so every credit threw and was silently swallowed by a `.catch()` — a day of cash-outs
and buy-in refunds paid nothing.

- A migration and the code that calls it are one change; ship together. Before merging, run
  `supabase migration list --linked` and confirm the migration is on the remote.
- `main` is Vercel's production branch, not any feature branch — pushing elsewhere only produces a
  Preview deploy. Verify a real deploy via `gh api repos/Nikkayowill/poker/deployments` (Production
  environment) and against the live site itself, not just that the merge succeeded.
- Run `git log origin/main..HEAD` before opening a PR — this tree is shared with concurrent Claude
  sessions, and a clean `git status` says nothing about what's already committed on your branch.
