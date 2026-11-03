# Rally

A local desktop dashboard for the GitHub PRs you review. It drives the `review-pr` Claude skill to draft reviews, and you refine and submit them without leaving the app.

> [!WARNING]
> Rally is designed for reviewing PRs from people you trust, such as teammates in your own organization. It does not have strong prompt injection protections. The review session reads the PR's code, description, and comments, and it can run shell commands and read files on your machine, so a malicious PR can steer it. Do not use Rally on PRs from untrusted contributors. See [Guardrails](#guardrails) for what the tool policy does and does not block.

## Install

Prerequisites:

- An Apple Silicon Mac.
- `gh` CLI signed in (`gh auth login`). Rally reads its token with `gh auth token`.
- Claude Code signed in (`claude` then `/login`). The Agent SDK reuses that login.
- The `review-pr` skill at `~/.claude/skills/review-pr/`.

Install or update to the latest release:

```bash
gh api repos/TannerYohe/rally/contents/scripts/install.sh -H 'Accept: application/vnd.github.raw' | sh
```

The script downloads the release zip with `gh`, quits Rally if it is running, and replaces `/Applications/Rally.app`. The app is ad-hoc signed, not notarized. Files that `gh` downloads are not quarantined, so it opens without a Gatekeeper prompt. If you download the zip or dmg from the release page in a browser instead, macOS blocks the first launch: open it once, then allow it under System Settings → Privacy & Security → Open Anyway.

## Development

Development needs Node 22.14+.

```bash
npm install      # on macOS, postinstall renames the dev Electron.app to Rally for the dock and menu bar
npm run dev      # launch with hot reload
npm test         # unit tests
npm run typecheck
npm run dist     # package dist/Rally-<version>-arm64.zip and .dmg
npm run icons    # regenerate resources/icon.png from resources/icon.svg
```

`electron-builder.yml` configures packaging. The Claude Code binary from the Agent SDK's platform package is unpacked from `app.asar` so it can be spawned, and `src/main/claude/executable.ts` points the SDK at it.

## Releases

Every push to `main` runs `.github/workflows/release.yml`: typecheck, tests, then [semantic-release](https://semantic-release.gitbook.io/). semantic-release reads the [Conventional Commits](https://www.conventionalcommits.org/) since the last `v*` tag to pick the next version, sets it in `package.json` in the CI checkout, runs `npm run dist`, and creates a GitHub release with the zip and dmg attached. Nothing is committed back to `main`, so `package.json` stays at `0.0.0-development` in the repo.

| Commit | Release |
|---|---|
| `fix: ...` | patch |
| `feat: ...` | minor |
| `feat!: ...` or a `BREAKING CHANGE:` footer | major |
| `chore:`, `docs:`, `refactor:`, `test:`, `ci:`, ... | none |

PRs are squash-merged, so the PR title becomes the commit semantic-release reads. The `pr-title` job in `.github/workflows/ci.yml` fails a PR whose title is not a Conventional Commit.

## How it works

### Dashboard

Rally lists open PRs that match **(author in your list AND repo in your list)**, plus any PR where your review is requested directly or that you have already reviewed, excluding your own PRs. A repo entry can be `owner/name` or `owner/*` for every repo in an org. An empty author or repo list means "any". Configure the lists in Settings. Rally refreshes on an interval and on demand.

Each row shows author, title, repo, age, phase, and a one-line summary. Claude Haiku writes the summary, and it is cached per head SHA. If summarizing fails, the row shows **Summary unavailable** with the error on hover, and Rally retries on the next refresh.

The phase chips above the list show a count per phase and toggle that phase on or off. **Filters** narrows the list by author, repo, and draft state, with a count next to each option. **Sort** orders by phase, opened, updated, size (lines changed), author, or repo, ascending or descending; ties fall back to the oldest PR first. Filters and sort are saved between launches.

### Phases

In progress comes from Rally's own review sessions and takes precedence. The other phases come from GitHub, where only your submitted reviews count. Pending (unsubmitted) and dismissed reviews are ignored, and so are thread replies: Comment reviews with an empty body whose comments all reply to existing threads. If your last 20 reviews are all thread replies, the latest reply counts, since an earlier real review is out of view.

| Phase | Rule |
|---|---|
| In progress | You have a Rally review session for the PR that hasn't been submitted. This includes sessions that errored or were cancelled. **Start over** clears it. |
| Unreviewed | You have no submitted review. |
| Awaiting re-review | The author re-requested your review, or the head SHA differs from the commit your latest review was on and that head appeared after you submitted. The head's time is the force-push time when there is one, else when Rally first saw it. |
| Approved | Your latest approval or change request is an approval, and nothing changed since. Comment-only reviews don't change it. |
| Pending changes | Anything else: you reviewed and nothing new has happened. |

The logic lives in `src/main/github/phase.ts`.

### Reviews

On a PR's detail page, **Start review** opens a Claude Agent SDK session whose first prompt is `/review-pr <url>`. The page shows the session's activity: commands, lens subagents, and turn cost. An in-process MCP tool, `mcp__rally__publish_drafts`, carries the report and draft comments back to the app as structured data.

You can edit or drop drafts inline, or type feedback, then click **Send to Claude** for another turn. Turns are unlimited, and every turn resumes the same SDK session, so a review survives an app restart.

**Post and submit** sends a final `SUBMIT` turn. In that turn Claude creates a pending review, posts any thread replies, submits the review with the event you picked (Comment, Approve, or Request changes), and confirms through `mcp__rally__review_submitted`. Rally then re-fetches the PR from GitHub to recompute its phase.

A submitted session stays on the PR page with a link to the review on GitHub. **Start follow-up review** discards that session and starts a new one that runs `/review-pr` again, which picks up the follow-up flow from your earlier review on GitHub.

Each session runs in its own temp directory, with `TMPDIR` pointed at it, so the skill's work directory lands inside it and the submit turn can clean it up by absolute path.

Settings → Reviews picks the model and effort for the review session and, separately, for its reviewer subagents. Each defaults to **System default**, which uses your Claude Code settings (`~/.claude/settings.json`); subagents otherwise inherit the review model. Subagent choices are passed as `CLAUDE_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_SUBAGENT_EFFORT`.

### Guardrails

The tool policy is a guardrail against accidental writes and destructive commands, not a sandbox, and it does not defend against prompt injection. The review session can run interpreters, build tools, tests, and shells so it can explore the code. Every tool call goes through `src/main/claude/toolPolicy.ts` as a `PreToolUse` hook:

- GitHub writes are blocked until the submit turn, and in that turn only review creation, review events, and thread replies are allowed. `gh` is checked behind wrappers (`timeout`, `xargs`, `env`), `sh -c`, `eval`, and `find -exec`. `git push` is always blocked.
- Write, Edit, and Bash file writes (`rm`, `mv`, `cp`, `tee`, `sed -i`, `find -delete`, output redirects) only land under the temp directory. Paths resolve against the working directory, including `cd`, with `..` and symlinks followed, and `$WORK` counts as temp only in the command that assigns it from `mktemp` or a temp path. Paths that `xargs` supplies are unknown, so file-writing commands behind `xargs` are blocked. Git commands that change a checkout, and `gh pr checkout`, only run in temp repos. `git config --global` is read-only.
- Network requests that send data (`curl -d`, `curl -X POST`, `wget --post-data`) are blocked; reads are allowed.
- `ssh`/`scp`, live infrastructure CLIs (`kubectl`, `aws`, `gcloud`, `az`, `terraform`, `helm`), and `sudo` are blocked.
- Read-only MCP tools (actions starting with a verb like `get`, `list`, `search`, or `read`), `WebSearch`, `WebFetch`, and `LSP` are allowed. MCP tools that write are blocked.

`src/main/claude/shellCommand.ts` parses comments, heredocs, substitutions, and redirects so the policy sees every command in a Bash call. Blocked calls appear in the activity timeline.

## Data

Rally stores config, the PR cache, and summaries as JSON in Electron's `userData` directory (`~/Library/Application Support/rally` on macOS), and each review session as its own file under `sessions/` there. Set `RALLY_USER_DATA_DIR` to use a different directory, for example for a test instance. Only one Rally instance can run per data directory. Claude session transcripts live where Claude Code keeps them.
