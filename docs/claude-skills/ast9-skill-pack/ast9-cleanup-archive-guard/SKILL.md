---
name: ast9-cleanup-archive-guard
description: "AST9/NeuCore guard for any file/folder deletion, archiving, cleanup, or git-worktree retirement. Use when cleaning the project folder, deleting old/generated files, archiving prototypes, removing smoke tooling, retiring repos, or removing .claude worktrees. Triggers: 'delete', 'clean up', 'remove old files', 'archive', 'rm', 'git clean', 'reset --hard', 'worktree remove', 'tidy the repo'. Enforces inventory-first, archive-before-delete, byte-identical verification, and exact-approved-path-only deletion. Prevents destroying unpushed/local-only work and the two-folder D:\\ASThub vs D:\\ASThub-current mix-up. DO NOT USE for normal commits/PR flow (use ast9-agent-boundary-git-guard)."
---

# AST9 — Cleanup / Archive / Worktree Safety Guard

Apply before deleting, archiving, or retiring anything on disk or any git worktree. Cleanup is **layered and approval-gated** — never a single broad sweep.

## Ground truth (folder layout)

- Per owner instruction, the **current source of truth is `D:\ASThub-current`**; treat `D:\ASThub` as the **stale/legacy** folder (it has held unpushed multi-agent work and a far-behind local `main`). If which folder is authoritative is ever unclear, **confirm with the owner before deleting anything.**
- Git worktrees live under `D:\ASThub\.claude\worktrees\`. They are retired **only** via `git worktree remove` after verifying status — never by manual deletion.

## Core invariants

1. **Inventory first** — list and classify before proposing any deletion.
2. **Archive before delete** — copy valuable/uncertain items to an archive outside the repo first.
3. **Verify byte-identical** copies (size + checksum) before deleting an original.
4. Delete only **exact, approved paths** — no wildcards standing in for an approval.
5. Never delete old repo folders blindly.
6. Never manually delete `.claude` worktree folders.
7. Use `git worktree remove` **only after** verifying the worktree is clean and not ahead of `origin` (and that the current working dir is not inside it).
8. Never run `git clean` or `git reset --hard` without explicit approval.
9. Never delete `.env`/secrets — and never "inspect" them to decide (no printing, reading, or echoing secret files).
10. Report what was deleted, preserved, archived, and verified.

## Anti-patterns — BLOCK these

```
rm -rf D:\ASThub                 # never blanket-delete the legacy repo folder
rm -rf .claude                   # never manually delete the worktree tree
manual deletion of any worktree  # use `git worktree remove` instead
git clean (-fd/-fdx)            # destroys untracked local-only work
git reset --hard                 # discards working-tree work
broad wildcard deletion standing in for explicit approval
deleting unarchived local-only work (it may be the only copy)
```

## Required process (every cleanup)

1. **Inventory (read-only):** enumerate candidates by category (generated junk / stale tracked edits / abandoned prototype / leftover tooling / large assets / worktrees). Report; stop for approval.
2. **Archive + verify:** copy to `…-archive\` outside any git repo; confirm size + md5 match the original. Stop for approval.
3. **Delete (approved paths only):** run exactly the approved `rm`/`git worktree remove` commands. Confirm 0 tracked files were deleted unless intended.
4. **Worktree retirement:**
   ```
   git -C <repo> worktree list
   git -C <worktree> status --short        # must be clean
   # confirm not ahead of origin; confirm CWD is NOT inside the worktree
   git -C <repo> worktree remove "<path>"  # never rm -rf
   ```
   Retire the worktree you are *inside* **last, from outside it**.
5. **Empty-folder cleanup:** only after a worktree is removed, and only with `rmdir` on a confirmed-empty dir (never `rm -rf`), approval-gated.

## Ownership / authority

- Deletions are the **owner's** call. Prepare exact commands, stop, and wait for explicit approval each layer.
- Coordinate worktree removal with any other agent that may be using it; confirm idle first.

## Required honesty

- Report exact paths deleted, archive locations, checksums verified, and a confirmation that **no tracked files** were removed (or which, if intended).
- If a copy could not be byte-verified, do **not** delete the original — say so and stop.
- Never claim a deletion was safe without showing the verification that proves it.
