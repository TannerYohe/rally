# Rally

A local desktop dashboard for the GitHub PRs you review. It drives a Claude Code review skill of your choice to draft reviews, and you refine and submit them without leaving the app.

> [!WARNING]
> Only use Rally on PRs from people you trust, such as teammates in your own organization. Rally has no strong prompt injection protection, so a malicious PR can steer the review session. That session can read any file your user can (SSH keys, cloud credentials, your GitHub token via `gh auth status --show-token`), call read tools on every MCP server you have connected (Slack, Jira, Notion, Datadog, and so on), and send what it finds out through `curl` GET URLs, `WebFetch`, or interpreters like `python` and `node`. See [Guardrails](#guardrails) for what the tool policy does block.

## Install

Prerequisites:

- An Apple Silicon Mac.
- `gh` CLI signed in (`gh auth login`). Rally reads its token with `gh auth token`.
- Claude Code signed in (`claude` then `/login`). The Agent SDK reuses that login.
- A PR review skill for Claude Code. Rally doesn't include one; see [Review skill](#review-skill).

Install or update to the latest release:

```bash
gh api repos/TannerYohe/rally/contents/scripts/install.sh -H 'Accept: application/vnd.github.raw' | sh
```

The script downloads the macOS release zip with `gh`, quits Rally if it is running, and replaces `/Applications/Rally.app`. After the first install, Settings → About can update Rally in place; see [Updates](#updates). The app is ad-hoc signed, not notarized. Files that `gh` downloads are not quarantined, so it opens without a Gatekeeper prompt. If you download the zip or dmg from the release page in a browser instead, macOS blocks the first launch: open it once, then allow it under System Settings → Privacy & Security → Open Anyway.

## Development

Development needs Node 22.14+.

```bash
npm install      # on macOS, postinstall renames the dev Electron.app to Rally for the dock and menu bar
npm run dev      # launch with hot reload
npm test         # unit tests
npm run typecheck
npm run dist     # package for the current OS (see below)
npm run icons    # regenerate resources/icon.png from resources/icon.svg
```

`npm run dist` builds for the OS it runs on, because npm installs the Agent SDK's Claude Code binary for that platform only:

- macOS: `dist/Rally-<version>-arm64.zip` and `.dmg`
- Windows: `dist/Rally-<version>-x64.exe` (per-user installer) and `.zip`. The Windows build is unsigned, so SmartScreen warns on first launch.

`electron-builder.yml` configures packaging. The Claude Code binary from the Agent SDK's platform package is unpacked from `app.asar` so it can be spawned, and `src/main/claude/executable.ts` points the SDK at it.

## Releases

Every push to `main` runs `.github/workflows/release.yml`: typecheck, tests, then [semantic-release](https://semantic-release.gitbook.io/). semantic-release reads the [Conventional Commits](https://www.conventionalcommits.org/) since the last `v*` tag to pick the next version, sets it in `package.json` in the CI checkout, runs `npm run dist`, and creates a GitHub release with the macOS zip and dmg attached. A second job then checks out the new tag on a Windows runner, builds the Windows installer and zip, and uploads them to the same release. If that job fails, the macOS release is already out; re-run the failed job to add the Windows files. Nothing is committed back to `main`, so `package.json` stays at `0.0.0-development` in the repo.

| Commit | Release |
|---|---|
| `fix: ...` | patch |
| `feat: ...` | minor |
| `feat!: ...` or a `BREAKING CHANGE:` footer | major |
| `chore:`, `docs:`, `refactor:`, `test:`, `ci:`, ... | none |

PRs are squash-merged, so the PR title becomes the commit semantic-release reads. The `pr-title` job in `.github/workflows/ci.yml` fails a PR whose title is not a Conventional Commit.

## How it works

### Dashboard

Rally lists open PRs that match **(author in your list AND repo in your list)**, plus any PR where your review is requested directly or that you have already reviewed, excluding your own PRs. A repo entry can be `owner/name` or `owner/*` for every repo in an org. An empty author or repo list means "any". Configure the lists in Settings → Pull requests. Rally refreshes on an interval and on demand.

Each row shows author, title, repo, age, phase, and a one-line summary. Claude Haiku writes the summary, and it is cached per head SHA. If summarizing fails, the row shows **Summary unavailable** with the error on hover, and Rally retries on the next refresh.

The phase chips above the list show a count per phase and toggle that phase on or off. **Filters** narrows the list by author, repo, and draft state, with a count next to each option. **Sort** orders by phase, opened, updated, size (lines changed), author, or repo, ascending or descending; ties fall back to the oldest PR first. Filters and sort are saved between launches.

Hovering a row shows **Snooze** and **Hide**, which are also on the PR page:

- **Snooze** hides the PR until its head commit changes, or until the author requests your review when no request was open at snooze time. Use it for a PR you know needs more work before your next round.
- **Hide** keeps the PR hidden until you unhide it. Use it for a PR you'll never review.

Hidden PRs leave the main list and the phase counts and collect in a collapsed **hidden** section at the bottom, which respects the author, repo, and draft filters. Each shows how it was hidden and an **Unhide** button. A PR with a review in progress always shows in the main list and hides again once the review is submitted or discarded. Hides are stored in `hidden-prs.json`. A snooze is dropped when its PR no longer appears in the list; a hide is kept for 30 days after its PR was last listed, so narrowing the repo or author lists doesn't lose it.

### Phases

In progress comes from Rally's own review sessions and takes precedence. The other phases come from GitHub, where only your submitted reviews count. Pending (unsubmitted) and dismissed reviews are ignored, and so are thread replies: Comment reviews with an empty body whose comments all reply to existing threads. A reply-only review that Rally submitted still counts, since it is a review of the PR. Rally keeps the ids of the reviews it submits in `rally-reviews.json`, so this holds after a follow-up review or **Start over** replaces the session. If your last 20 reviews are all thread replies, the latest reply counts, since an earlier real review is out of view.

| Phase | Rule |
|---|---|
| In progress | You have a Rally review session for the PR that hasn't been submitted. This includes sessions that errored or were cancelled. **Start over** clears it. |
| Unreviewed | You have no submitted review. |
| Awaiting re-review | The author re-requested your review, or the head SHA differs from the commit your latest review was on and that head appeared after you submitted. The head's time is the force-push time when there is one, else when Rally first saw it. |
| Approved | Your latest approval or change request is an approval, and nothing changed since. Comment-only reviews don't change it. |
| Pending changes | Anything else: you reviewed and nothing new has happened. |

The logic lives in `src/main/github/phase.ts`.

### Review skill

Rally doesn't include a review skill; bring your own. Install it where Claude Code loads skills, for example `~/.claude/skills/<name>/`, and set its name in Settings → Reviews. The default is `review-pr`. Rally starts each review with `/<skill> <PR URL>`, so the skill should:

- Take a PR URL as its argument and review that PR.
- Produce a report and draft comments: inline comments on diff lines, an optional summary body, and optional replies to existing threads. Rally's system prompt tells Claude to send these to the app with `mcp__rally__publish_drafts`, so the skill doesn't need to know about Rally.
- Leave posting to Rally. GitHub writes are blocked until you click **Post and submit**, and the submit turn posts the drafts with `gh api` without relying on the skill.

### Reviews

On a PR's detail page, **Start review** opens a Claude Agent SDK session whose first prompt is `/<skill> <url>`. The page shows the session's activity: commands, subagents, and turn cost. An in-process MCP tool, `mcp__rally__publish_drafts`, carries the report and draft comments back to the app as structured data.

The review is split into four tabs: **Activity** (the session timeline), **Report** (the verdict and report), **Threads** (earlier comments in a follow-up review), and **Drafts** (draft comments and the review body). The Drafts tab counts the drafts you're keeping, and the Threads tab counts the threads selected to resolve, when there are any. Activity shows while Claude is working and Drafts when a turn finishes; a tab you pick during a turn stays until that turn ends. The feedback box and **Post and submit** stay below the tabs.

You can edit or drop drafts inline, rewrite, add, or clear the review body, or type feedback, then press Enter (or click **Send to Claude**) for another turn; Shift+Enter adds a new line. Sending switches to the Activity tab and follows new entries until the turn ends or you scroll up. In a follow-up review, the **Threads** tab lists each of your prior comments with Claude's verdict. Open threads you started that were addressed, moot, or accepted pushback are pre-checked; **Resolve selected** resolves them right away, and **Post and submit** resolves the selection after the review posts. The submitted banner shows how many threads were resolved and how many failed; click the failure count to open the Threads tab. Rally resolves threads itself, only on threads you started on that PR, and posts no reply. While it's resolving, **Start follow-up review** and **Start over** wait for it to finish. The review header shows when the session started and flags when the PR has been updated since Claude's last turn started. Turns are unlimited, and every turn resumes the same SDK session, so a review survives an app restart.

**Post and submit** sends a final `SUBMIT` turn. In that turn Claude first deletes any pending review of yours on the PR, including a draft you started on GitHub, because GitHub allows only one per reviewer. It then creates a pending review, adds any thread replies to it, submits the review with the event you picked (Comment, Approve, or Request changes), and confirms through `mcp__rally__review_submitted`. If a step fails after the pending review exists, Claude deletes it. If an earlier submit in the same session never confirmed, Claude first checks whether one of your reviews was submitted after that attempt started; if so, it reports that review and posts nothing. A Comment review with no body, no kept drafts, and no extra instructions is rejected before the turn starts; use **Resolve selected** to resolve threads without posting a review. Rally then re-fetches the PR from GitHub to recompute its phase.

A submitted session stays on the PR page with a link to the review on GitHub. **Start follow-up review** discards that session and starts a new one that runs the review skill again. A skill that reads your earlier review on GitHub can use it to do a follow-up review.

Each session runs in its own temp directory, with `TMPDIR` pointed at it, so the skill's work directory lands inside it. Rally deletes the directory after the review is submitted or discarded.

Settings → Reviews picks the review skill, and the model and effort for the review session and, separately, for its reviewer subagents. Each defaults to **System default**, which uses your Claude Code settings (`~/.claude/settings.json`); subagents otherwise inherit the review model. Subagent choices are passed as `CLAUDE_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_SUBAGENT_EFFORT`.

### Updates

Settings → About shows the app version, the Electron, Chromium, and Node.js versions, and the data folder. **Check for updates** reads the latest release from the GitHub API without signing in, and gives up after 15 seconds. When the release is newer than the running version, the page shows its date and notes and **Download and install**, which downloads the release asset for this machine and shows progress. A download that receives nothing for 30 seconds fails, and you can try again. Rally only downloads an asset whose name is a plain file name and whose URL, once parsed, is exactly `https://github.com/TannerYohe/rally/releases/download/<tag>/<name>` for the release's tag, with no query or fragment; otherwise the page says why and offers **Check again**.

- macOS: the `arm64` zip. Rally extracts it with `ditto`, checks it with `codesign --verify --deep --strict`, and checks that its bundle id matches the running app's. Rally then quits, and a detached shell script waits for it to exit, moves the old app aside to `Rally.previous.app`, moves the new one into place, and reopens it. If the new app can't move into place, the script restores the old one. `Rally.previous.app` stays until the new version starts. If the new release fails to launch, delete `Rally.app` and rename `Rally.previous.app` back to `Rally.app` rather than opening it in place, since the next update would treat it as the current app and leave a `Rally.previous.previous.app`. Rally only installs when it can write to the folder holding `Rally.app` and macOS has not translocated it; otherwise the page says why.
- Windows: the `x64` installer, run silently with `--force-run` so it reopens Rally. A detached PowerShell command runs it and records its exit code. Rally passes the command with `-EncodedCommand`, which execution policy doesn't apply to, so a Group Policy restriction doesn't stop it.

On both platforms Rally writes a hand-off line to `update.log` in the data folder before starting the script, and the script appends its result. The release's signature is ad-hoc, so the `codesign` check catches a corrupt download, not a build someone re-signed.

Before handing off, Rally records the version it is installing in `update.json` in the data folder. If the next launch isn't on that version, the dashboard shows that the update didn't install, and Settings → About points to `update.log`. On launch, Rally also removes its own leftover download folders from the temp directory. Their names include a hash of the data folder, so a test instance with a different `RALLY_USER_DATA_DIR` doesn't touch another instance's download.

Quitting stops any running Claude turn; the review shows as interrupted and resumes when you send feedback. The development build checks for updates but doesn't install them. A relaunched test instance keeps its `RALLY_USER_DATA_DIR`. The logic lives in `src/main/update/`.

### Guardrails

The tool policy is a guardrail against accidental writes and destructive commands, not a sandbox; see the warning at the top. The review session can run interpreters, build tools, tests, and shells so it can explore the code. Every tool call goes through `src/main/claude/toolPolicy.ts` as a `PreToolUse` hook:

- GitHub writes are blocked until the submit turn, and in that turn only review creation, review events, deleting a pending review, and review-comment GraphQL mutations (including thread replies into the pending review) are allowed. The REST review writes must target the PR under review; the GraphQL mutations take opaque node ids, so Rally can't tie them to a PR. `gh` is checked behind wrappers (`timeout`, `xargs`, `env`, `winpty`), `sh -c`, `eval`, and `find -exec`. On Windows, commands run through `cmd` or `powershell` are not checked. `git push` is always blocked.
- Write, Edit, and Bash file writes (`rm`, `mv`, `cp`, `tee`, `sed -i`, `find -delete`, output redirects) only land under the temp directory. Paths resolve against the working directory, including `cd`, with `..` and symlinks followed, and `$WORK` counts as temp only in the command that assigns it from `mktemp` or a temp path. Paths that `xargs` supplies are unknown, so file-writing commands behind `xargs` are blocked. Git commands that change a checkout, and `gh pr checkout`, only run in temp repos. `git config --global` is read-only.
- `curl` and `wget` requests with a body or a non-GET method (`curl -d`, `curl -X POST`, `wget --post-data`) are blocked. This is not an exfiltration control: GET URLs, `WebFetch`, and interpreters can still send data out.
- `ssh`/`scp`, live infrastructure CLIs (`kubectl`, `aws`, `gcloud`, `az`, `terraform`, `helm`), and `sudo` are blocked.
- Read-only MCP tools (actions starting with a verb like `get`, `list`, `search`, or `read`), `WebSearch`, `WebFetch`, and `LSP` are allowed. MCP tools that write are blocked.

`src/main/claude/shellCommand.ts` parses comments, heredocs, substitutions, and redirects so the policy sees every command in a Bash call. Blocked calls appear in the activity timeline.

### Skins

Settings → Appearance switches the skin: **Classic**, **Centre Court** (tennis), **Special Stage** (rally motorsport), or **Pep Rally**. Picking a skin previews it, and Save stores it in `config.json` with the other settings; Discard, or leaving Settings without saving, reverts the preview. Components use the `ink`, `primary`, `secondary`, and `highlight` color scales from `src/renderer/src/index.css` instead of raw Tailwind palettes; `src/renderer/src/skins.css` remaps those scales per skin and adds an optional backdrop pattern and wordmark style. Status colors (success, error, warning) and the repo chips in `src/renderer/src/lib/theme.ts` stay on fixed palettes in every skin. To add a skin, add its id to the `SkinId` union in `src/shared/types.ts`, an entry in `SKINS` in `src/renderer/src/lib/skins.ts`, and a `:root[data-skin='<id>']` block in `skins.css` that defines every scale; `skins.test.ts` checks the block.

## Data

Rally stores config, the PR cache, and summaries as JSON in Electron's `userData` directory (`~/Library/Application Support/rally` on macOS), and each review session as its own file under `sessions/` there. Set `RALLY_USER_DATA_DIR` to use a different directory, for example for a test instance. Only one Rally instance can run per data directory. Claude session transcripts live where Claude Code keeps them.

## License

Rally is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). You can use, change, and share it for noncommercial purposes as long as every copy keeps the `Required Notice` line from `LICENSE.md`. Commercial use, including using Rally for work at a for-profit company, needs separate permission from the copyright holder.
