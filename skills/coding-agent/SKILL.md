---
name: coding-agent
description: Run Codex CLI, Claude Code, OpenCode, or Pi Coding Agent via direct CLI commands. Simple bash execution, no MCP wrapper needed.
metadata:
  {
    "openclaw": { "emoji": "🧩", "requires": { "anyBins": ["claude", "codex", "opencode", "pi"] } },
  }
---

# Coding Agent (Direct CLI)

Use **direct CLI commands** via bash for all coding agent work. Simple, fast, and effective.

**No MCP wrapper needed** - just exec the commands directly with the right flags.

## ⚠️ PTY Mode Required!

Coding agents (Codex, Claude Code, Pi) are **interactive terminal applications** that need a pseudo-terminal (PTY) to work correctly. Without PTY, you'll get broken output, missing colors, or the agent may hang.

**Always use `pty:true`** when running coding agents:

```bash
# ✅ Correct - with PTY
bash pty:true command:"codex exec 'Your prompt'"

# ❌ Wrong - no PTY, agent may break
bash command:"codex exec 'Your prompt'"
```

### Bash Tool Parameters

| Parameter    | Type    | Description                                                                 |
| ------------ | ------- | --------------------------------------------------------------------------- |
| `command`    | string  | The shell command to run                                                    |
| `pty`        | boolean | **Use for coding agents!** Allocates a pseudo-terminal for interactive CLIs |
| `workdir`    | string  | Working directory (agent sees only this folder's context)                   |
| `background` | boolean | Run in background, returns sessionId for monitoring                         |
| `timeout`    | number  | Timeout in seconds (kills process on expiry)                                |
| `elevated`   | boolean | Run on host instead of sandbox (if allowed)                                 |

### Process Tool Actions (for background sessions)

| Action      | Description                                          |
| ----------- | ---------------------------------------------------- |
| `list`      | List all running/recent sessions                     |
| `poll`      | Check if session is still running                    |
| `log`       | Get session output (with optional offset/limit)      |
| `write`     | Send raw data to stdin                               |
| `submit`    | Send data + newline (like typing and pressing Enter) |
| `send-keys` | Send key tokens or hex bytes                         |
| `paste`     | Paste text (with optional bracketed mode)            |
| `kill`      | Terminate the session                                |

---

## Quick Start: One-Shot Tasks

For quick prompts/chats, create a temp git repo and run:

```bash
# Quick chat (Codex needs a git repo!)
SCRATCH=$(mktemp -d) && cd $SCRATCH && git init && codex exec "Your prompt here"

# Or in a real project - with PTY!
bash pty:true workdir:~/Projects/myproject command:"codex exec 'Add error handling to the API calls'"
```

**Why git init?** Codex refuses to run outside a trusted git directory. Creating a temp repo solves this for scratch work.

---

## The Pattern: workdir + background + pty

For longer tasks, use background mode with PTY:

```bash
# Start agent in target directory (with PTY!)
bash pty:true workdir:~/project background:true command:"codex exec --full-auto 'Build a snake game'"
# Returns sessionId for tracking

# Monitor progress
process action:log sessionId:XXX

# Check if done
process action:poll sessionId:XXX

# Send input (if agent asks a question)
process action:write sessionId:XXX data:"y"

# Submit with Enter (like typing "yes" and pressing Enter)
process action:submit sessionId:XXX data:"yes"

# Kill if needed
process action:kill sessionId:XXX
```

**Why workdir matters:** Agent wakes up in a focused directory, doesn't wander off reading unrelated files (like your soul.md 😅).

---

## Codex CLI

**Model:** `gpt-5.2-codex` is the default (set in ~/.codex/config.toml)

### Flags

| Flag            | Effect                                             |
| --------------- | -------------------------------------------------- |
| `exec "prompt"` | One-shot execution, exits when done                |
| `--full-auto`   | Sandboxed but auto-approves in workspace           |
| `--yolo`        | NO sandbox, NO approvals (fastest, most dangerous) |

### Building/Creating

```bash
# Quick one-shot (auto-approves) - remember PTY!
bash pty:true workdir:~/project command:"codex exec --full-auto 'Build a dark mode toggle'"

# Background for longer work
bash pty:true workdir:~/project background:true command:"codex --yolo 'Refactor the auth module'"
```

### Reviewing PRs

**⚠️ CRITICAL: Never review PRs in OpenClaw's own project folder!**
Clone to temp folder or use git worktree.

```bash
# Clone to temp for safe review
REVIEW_DIR=$(mktemp -d)
git clone https://github.com/user/repo.git $REVIEW_DIR
cd $REVIEW_DIR && gh pr checkout 130
bash pty:true workdir:$REVIEW_DIR command:"codex review --base origin/main"
# Clean up after: trash $REVIEW_DIR

# Or use git worktree (keeps main intact)
git worktree add /tmp/pr-130-review pr-130-branch
bash pty:true workdir:/tmp/pr-130-review command:"codex review --base main"
```

### Batch PR Reviews (parallel army!)

```bash
# Fetch all PR refs first
git fetch origin '+refs/pull/*/head:refs/remotes/origin/pr/*'

# Deploy the army - one Codex per PR (all with PTY!)
bash pty:true workdir:~/project background:true command:"codex exec 'Review PR #86. git diff origin/main...origin/pr/86'"
bash pty:true workdir:~/project background:true command:"codex exec 'Review PR #87. git diff origin/main...origin/pr/87'"

# Monitor all
process action:list

# Post results to GitHub
gh pr comment <PR#> --body "<review content>"
```

---

## Claude Code

**Direct CLI method** (preferred over MCP):

```bash
# Non-interactive mode with auto-approve (no PTY needed!)
npx @anthropic-ai/claude-code -p --dangerously-skip-permissions "Your task here"

# Select model (haiku, sonnet, opus)
npx @anthropic-ai/claude-code -p --dangerously-skip-permissions --model sonnet "Your task"

# With effort level (low/medium/high)
npx @anthropic-ai/claude-code -p --dangerously-skip-permissions --model haiku --effort low "Quick task"

# In a specific directory
bash workdir:~/project command:"npx @anthropic-ai/claude-code -p --dangerously-skip-permissions --model haiku 'Your task'"

# Background for longer tasks
bash workdir:~/project background:true command:"npx @anthropic-ai/claude-code -p --dangerously-skip-permissions --model sonnet 'Your task'"

# With budget limit and fallback model
npx @anthropic-ai/claude-code -p --dangerously-skip-permissions --model sonnet --fallback-model haiku --max-budget-usd 1.00 "Task"
```

### Key Flags

| Flag                             | Effect                                                            |
| -------------------------------- | ----------------------------------------------------------------- |
| `-p, --print`                    | Non-interactive mode - prints output and exits                    |
| `--dangerously-skip-permissions` | Bypasses ALL permission checks (auto-approve everything)          |
| `--model <model>`                | Select model: `haiku`, `sonnet`, `opus`, or full name             |
| `--effort <level>`               | Effort level: `low`, `medium`, `high`                             |
| `--fallback-model <model>`       | Auto-fallback when primary overloaded (only with `-p`)            |
| `--max-budget-usd <amount>`      | Spending limit in USD (only with `-p`)                            |
| `--system-prompt <prompt>`       | Custom system prompt                                              |
| `--append-system-prompt <text>`  | Append to default system prompt                                   |
| `--tools <tools>`                | Specify tools: `""` (none), `"default"` (all), or names           |
| `--output-format <format>`       | Output: `text` (default), `json`, `stream-json` (only with `-p`)  |
| `--json-schema <schema>`         | JSON Schema for structured output validation                      |
| `--no-session-persistence`       | Don't save session to disk (only with `-p`)                       |
| `-c, --continue`                 | Continue most recent conversation in current directory            |
| `-r, --resume [id]`              | Resume by session ID or open picker                               |
| `--debug [filter]`               | Enable debug mode with optional category filter                   |

### Model Selection

Use aliases or full model names:
- `--model haiku` → Latest Haiku (fast, cheap)
- `--model sonnet` → Latest Sonnet (balanced)
- `--model opus` → Latest Opus (powerful)
- `--model claude-sonnet-4-5-20250929` → Specific version

### Effort Levels

- `--effort low` → Faster, less thorough
- `--effort medium` → Balanced (default)
- `--effort high` → More thorough, slower

### Structured Output

```bash
# Request JSON output with schema validation
npx @anthropic-ai/claude-code -p --dangerously-skip-permissions \
  --output-format json \
  --json-schema '{"type":"object","properties":{"summary":{"type":"string"},"count":{"type":"number"}},"required":["summary","count"]}' \
  "Analyze the codebase and return summary + file count"
```

**Note:** The `-p --dangerously-skip-permissions` combo makes Claude Code work like `codex --yolo` - fast, non-interactive, auto-approved. Perfect for automation.

### Interactive Mode (fallback)

```bash
# With PTY for proper terminal output
bash pty:true workdir:~/project command:"claude --model haiku 'Your task'"

# Background
bash pty:true workdir:~/project background:true command:"claude --model sonnet 'Your task'"
```

---

## OpenCode

```bash
bash pty:true workdir:~/project command:"opencode run 'Your task'"
```

---

## Pi Coding Agent

```bash
# Install: npm install -g @mariozechner/pi-coding-agent
bash pty:true workdir:~/project command:"pi 'Your task'"

# Non-interactive mode (PTY still recommended)
bash pty:true command:"pi -p 'Summarize src/'"

# Different provider/model
bash pty:true command:"pi --provider openai --model gpt-4o-mini -p 'Your task'"
```

**Note:** Pi now has Anthropic prompt caching enabled (PR #584, merged Jan 2026)!

---

## Parallel Issue Fixing with git worktrees

For fixing multiple issues in parallel, use git worktrees:

```bash
# 1. Create worktrees for each issue
git worktree add -b fix/issue-78 /tmp/issue-78 main
git worktree add -b fix/issue-99 /tmp/issue-99 main

# 2. Launch Codex in each (background + PTY!)
bash pty:true workdir:/tmp/issue-78 background:true command:"pnpm install && codex --yolo 'Fix issue #78: <description>. Commit and push.'"
bash pty:true workdir:/tmp/issue-99 background:true command:"pnpm install && codex --yolo 'Fix issue #99: <description>. Commit and push.'"

# 3. Monitor progress
process action:list
process action:log sessionId:XXX

# 4. Create PRs after fixes
cd /tmp/issue-78 && git push -u origin fix/issue-78
gh pr create --repo user/repo --head fix/issue-78 --title "fix: ..." --body "..."

# 5. Cleanup
git worktree remove /tmp/issue-78
git worktree remove /tmp/issue-99
```

---

## 🐛 Debugging Hanging Commands

If a command hangs with no output:

1. **Add verbose/debug flags** if available
2. **Check stderr** - use `2>&1` to combine stderr with stdout
3. **Add print statements** in the command wrapper to see progress
4. **Use timeout** parameter to prevent infinite hangs

Example:
```bash
# Redirect stderr to see errors
bash command:"npx @anthropic-ai/claude-code -p --dangerously-skip-permissions 'task' 2>&1"

# With timeout (kills after 60s)
bash timeout:60 command:"npx @anthropic-ai/claude-code -p --dangerously-skip-permissions 'task'"
```

## ⚠️ Rules

1. **PTY for interactive agents** - use `pty:true` for interactive terminal UIs
2. **No PTY for print mode** - Claude Code with `-p` doesn't need PTY
3. **Respect tool choice** - if user asks for Codex, use Codex.
   - Orchestrator mode: do NOT hand-code patches yourself.
   - If an agent fails/hangs, respawn it or ask the user for direction, but don't silently take over.
3. **Be patient** - don't kill sessions because they're "slow"
4. **Monitor with process:log** - check progress without interfering
5. **--full-auto for building** - auto-approves changes
6. **vanilla for reviewing** - no special flags needed
7. **Parallel is OK** - run many Codex processes at once for batch work
8. **NEVER start Codex in ~/clawd/** - it'll read your soul docs and get weird ideas about the org chart!
9. **NEVER checkout branches in ~/Projects/openclaw/** - that's the LIVE OpenClaw instance!

---

## Progress Updates (Critical)

When you spawn coding agents in the background, keep the user in the loop.

- Send 1 short message when you start (what's running + where).
- Then only update again when something changes:
  - a milestone completes (build finished, tests passed)
  - the agent asks a question / needs input
  - you hit an error or need user action
  - the agent finishes (include what changed + where)
- If you kill a session, immediately say you killed it and why.

This prevents the user from seeing only "Agent failed before reply" and having no idea what happened.

---

## Auto-Notify on Completion

For long-running background tasks, append a wake trigger to your prompt so OpenClaw gets notified immediately when the agent finishes (instead of waiting for the next heartbeat):

```
... your task here.

When completely finished, run this command to notify me:
openclaw system event --text "Done: [brief summary of what was built]" --mode now
```

**Example:**

```bash
bash pty:true workdir:~/project background:true command:"codex --yolo exec 'Build a REST API for todos.

When completely finished, run: openclaw system event --text \"Done: Built todos REST API with CRUD endpoints\" --mode now'"
```

This triggers an immediate wake event — Skippy gets pinged in seconds, not 10 minutes.

---

## Learnings (Jan 2026)

- **PTY is essential:** Coding agents are interactive terminal apps. Without `pty:true`, output breaks or agent hangs.
- **Git repo required:** Codex won't run outside a git directory. Use `mktemp -d && git init` for scratch work.
- **exec is your friend:** `codex exec "prompt"` runs and exits cleanly - perfect for one-shots.
- **submit vs write:** Use `submit` to send input + Enter, `write` for raw data without newline.
- **Sass works:** Codex responds well to playful prompts. Asked it to write a haiku about being second fiddle to a space lobster, got: _"Second chair, I code / Space lobster sets the tempo / Keys glow, I follow"_ 🦞
