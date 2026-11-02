# Rally

A local desktop dashboard for the GitHub PRs you review. It drives the `review-pr` Claude skill to draft reviews, and you refine and submit them without leaving the app.

## Setup

Prerequisites:

- Node 20+
- `gh` CLI signed in (`gh auth login`). Rally reads its token with `gh auth token`.
- Claude Code signed in (`claude` then `/login`). The Agent SDK reuses that login.
- The `review-pr` skill at `~/.claude/skills/review-pr/`.

```bash
npm install      # on macOS, postinstall renames the dev Electron.app to Rally for the dock and menu bar
npm run dev      # launch with hot reload
npm test         # unit tests
npm run typecheck
npm run icons    # regenerate resources/icon.png and build/icon.icns from resources/icon.svg (macOS)
```

## How it works

### Dashboard

Rally lists open PRs that match **(author in your list AND repo in your list)**, plus any PR where your review is requested directly. A repo entry can be `owner/name` or `owner/*` for every repo in an org. An empty author or repo list means "any". Configure the lists in Settings. Rally refreshes on an interval and on demand.

Each row shows author, title, repo, age, phase, and a one-line summary. Claude Haiku writes the summary, and it is cached per head SHA.

### Phases

In progress comes from Rally's own review sessions and takes precedence. The other phases come from GitHub, where only your submitted reviews count; pending (unsubmitted) and dismissed reviews are ignored.

| Phase | Rule |
|---|---|
| In progress | You have a Rally review session for the PR that hasn't been submitted. This includes sessions that errored or were cancelled. **Start over** clears it. |
| Unreviewed | You have no submitted review. |
| Awaiting re-review | The author re-requested your review, or the head SHA moved past the commit your latest review was on. |
| Approved | Your latest review is an approval and nothing changed since. |
| Pending changes | Anything else: you reviewed and nothing new has happened. |

The logic lives in `src/main/github/phase.ts`.

### Reviews

On a PR's detail page, **Start review** opens a Claude Agent SDK session whose first prompt is `/review-pr <url>`. The page shows the session's activity: commands, lens subagents, and turn cost. An in-process MCP tool, `mcp__rally__publish_drafts`, carries the report and draft comments back to the app as structured data.

You can edit or drop drafts inline, or type feedback, then click **Send to Claude** for another turn. Turns are unlimited, and every turn resumes the same SDK session, so a review survives an app restart.

**Post and submit** sends a final `SUBMIT` turn. In that turn Claude creates a pending review, posts any thread replies, submits the review with the event you picked (Comment, Approve, or Request changes), and confirms through `mcp__rally__review_submitted`. Rally then re-fetches the PR from GitHub to recompute its phase.

### Safety

PR content is untrusted input to the session, so every tool call goes through `src/main/claude/toolPolicy.ts` as a `PreToolUse` hook:

- Bash runs any command except those on a denylist. The denylist covers programs that reach the network, run arbitrary code (interpreters, shells, package managers, build tools, command wrappers), or act on live infrastructure. It also covers flags that make safe tools run commands (`find -exec`, `rg --pre`, `git -c`), and programs hidden behind a path, variable, or substitution. `src/main/claude/shellCommand.ts` parses comments, heredocs, substitutions, and redirects so the policy sees every command that would run.
- Write, and Bash file writes (`rm`, `mv`, `cp`, `tee`, `sed -i`, output redirects), are limited to temp directories.
- Read-only MCP tools (actions starting with a verb like `get`, `list`, `search`, or `read`), `WebSearch`, and `LSP` are allowed. `WebFetch` and other tools are blocked.
- All GitHub writes are blocked until the submit turn. In that turn, only review creation, review events, and thread replies are allowed.

Blocked calls appear in the activity timeline.

## Data

Rally stores config, the PR cache, summaries, and review sessions as JSON in Electron's `userData` directory (`~/Library/Application Support/rally` on macOS). Set `RALLY_USER_DATA_DIR` to use a different directory, for example for a test instance. Only one Rally instance can run per data directory. Claude session transcripts live where Claude Code keeps them.
