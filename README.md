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

Every push to `main` runs `.github/workflows/release.yml`: typecheck, tests, then [semantic-release](https://semantic-release.gitbook.io/). semantic-release reads the [Conventional Commits](https://www.conventionalcommits.org/) since the last `v*` tag with its `conventionalcommits` preset to pick the next version, sets it in `package.json` in the CI checkout, runs `npm run dist`, and creates a GitHub release with the macOS zip and dmg attached. A second job then checks out the new tag on a Windows runner, builds the Windows installer and zip, and uploads them to the same release. If that job fails, the macOS release is already out; re-run the failed job to add the Windows files. Nothing is committed back to `main`, so `package.json` stays at `0.0.0-development` in the repo.

| Commit | Release |
|---|---|
| `fix: ...` | patch |
| `feat: ...` | minor |
| `feat!: ...` or a `BREAKING CHANGE:` footer | major |
| `chore:`, `docs:`, `refactor:`, `test:`, `ci:`, `build:`, ... | none |

PRs are squash-merged, so the PR title becomes the commit semantic-release reads. The `pr-title` job in `.github/workflows/ci.yml` fails a PR whose title is not a Conventional Commit.

## How it works

### Dashboard

The **Reviewing** tab lists open PRs that match **(author in your list AND repo in your list)**, plus any PR where your review is requested directly or that you have already reviewed, excluding your own PRs. A repo entry can be `owner/name` or `owner/*` for every repo in an org. An empty author or repo list means "any". Configure the lists in Settings → Pull requests. Rally refreshes on an interval and on demand. After you submit a review, Rally fetches that PR again, and a full refresh already in flight keeps that newer copy.

Each row shows author, title, repo, age, phase, and a one-line summary. Claude Haiku writes the summary, and it is cached per head SHA. If summarizing fails, the row shows **Summary unavailable** with the error on hover, and Rally retries on the next refresh.

The phase chips above the list show a count per phase and toggle that phase on or off. **Filters** narrows the list by author, repo, and draft state, with a count next to each option. **Sort** orders by phase, opened, updated, size (lines changed), author, or repo, ascending or descending; ties fall back to the oldest PR first. Filters and sort are saved between launches.

Hovering a row shows **Snooze** and **Hide**, which are also on the PR page:

- **Snooze** hides the PR until its head commit changes or the author requests your review again. A request that was already open when you snoozed doesn't count; a new one after it clears does. Use it for a PR you know needs more work before your next round.
- **Hide** keeps the PR hidden until you unhide it. Use it for a PR you'll never review.

Hidden PRs leave the main list and the phase counts and collect in a collapsed **hidden** section at the bottom, which respects the author, repo, and draft filters. Each shows how it was hidden and an **Unhide** button. A PR with a review in progress always shows in the main list and hides again once the review is submitted or discarded. Hides are stored in `hidden-prs.json`. A snooze is dropped when its PR no longer appears in the list; a hide is kept for 30 days after its PR was last listed, so narrowing the repo or author lists doesn't lose it.

### Phases

In progress comes from Rally's own review sessions and takes precedence. The other phases come from GitHub, where only your submitted reviews count. Pending (unsubmitted) and dismissed reviews are ignored, and so are thread replies: Comment reviews with an empty body whose comments all reply to existing threads. A reply-only review that Rally submitted still counts, since it is a review of the PR. Rally keeps the ids of the reviews it submits in `rally-reviews.json`, so this holds after a follow-up review or **Start over** replaces the session. Rally reads your reviews 20 at a time, newest first, and when a page holds only thread replies it reads older pages until it finds a real review, up to 10 pages (200 reviews). Pending drafts and dismissed reviews don't stop the search, since they don't count either. If none turns up, the PR counts as unreviewed. If an older page fails to load, Rally computes the phase from the reviews it already has. Paging stops at your newest review that counts, so an approval more than 20 reviews back can fall out of view: if you approve, reply on 20 or more threads, then leave a Comment review, the PR shows Pending changes instead of Approved.

| Phase | Rule |
|---|---|
| In progress | You have a Rally review session for the PR that hasn't been submitted. This includes sessions that errored or were cancelled. **Start over** clears it. |
| Unreviewed | You have no submitted review. |
| Awaiting re-review | The author re-requested your review, or the head SHA differs from the commit your latest review was on and that head appeared after you submitted. The head's time is the force-push time when there is one, else when Rally first saw it. |
| Approved | Your latest approval or change request is an approval, and nothing changed since. Comment-only reviews don't change it. |
| Pending changes | Anything else: you reviewed and nothing new has happened. |

Phase rules live in `src/main/github/phase.ts`, and which of your reviews Rally fetches lives in `src/main/github/queries.ts`.

### Review skill

Rally doesn't include a review skill; bring your own. Install it where Claude Code loads skills, for example `~/.claude/skills/<name>/`, and set its name in Settings → Reviews. The default is `review-pr`. Rally starts each review with `/<skill> <PR URL>`, so the skill should:

- Take a PR URL as its argument and review that PR.
- Produce a report and draft comments: inline comments on diff lines, an optional summary body, and optional replies to existing threads. Rally's system prompt tells Claude to send these to the app with `mcp__rally__publish_drafts`, so the skill doesn't need to know about Rally.
- Leave posting to Rally. Claude can't write to GitHub; when you click **Post and submit**, Rally posts the published drafts itself without relying on the skill.

### Reviews

On a PR's detail page, **Start review** opens a Claude Agent SDK session whose first prompt is `/<skill> <url>`. The page shows the session's activity: commands, subagents, and turn cost. An in-process MCP tool, `mcp__rally__publish_drafts`, carries the report and draft comments back to the app as structured data.

The review is split into four tabs: **Activity** (the session timeline), **Report** (the verdict and report), **Threads** (earlier comments in a follow-up review), and **Drafts** (draft comments and the review body). The Drafts tab counts the drafts you're keeping, and the Threads tab counts the threads selected to resolve, when there are any. Activity shows while Claude is working and Drafts when a turn finishes; a tab you pick during a turn stays until that turn ends. The feedback box and **Post and submit** stay below the tabs.

Each time Claude publishes drafts, Rally looks up the comment each thread reply answers, and it looks again when you open a review whose replies are still missing that lookup, such as after a failed lookup. The reply's header names that comment's author and `path:line`, and the card quotes the start of its text, linked to the comment on GitHub. A reply with no comment id, or whose comment isn't in a review thread on the PR, is flagged, since **Post and submit** will put it in the review body.

You can edit or drop drafts inline, rewrite, add, or clear the review body, or type feedback, then press Enter (or click **Send to Claude**) for another turn; Shift+Enter adds a new line. Sending switches to the Activity tab and follows new entries until the turn ends or you scroll up. In a follow-up review, the **Threads** tab lists each of your prior comments with Claude's verdict. Open threads you started that were addressed, moot, or accepted pushback are pre-checked; **Resolve selected** resolves them right away, and **Post and submit** resolves the selection after the review posts. The submitted banner shows how many threads were resolved and how many failed; click the failure count to open the Threads tab. Rally resolves threads itself, only on threads you started on that PR, and posts no reply. While it's resolving, **Start follow-up review** and **Start over** wait for it to finish. The review header shows when the session started and flags when the PR has been updated since Claude's last successful turn started; a turn that errors or is cancelled doesn't clear the flag. **Pull in changes** next to that flag sends Claude a turn to pull in everything that changed on the PR since that successful turn started, including new commits, comments, replies, reviews, and description edits. Claude lists what changed and updates the report and drafts to match. The turn carries any pending edits and typed feedback along with it. Turns are unlimited, and every turn resumes the same SDK session, so a review survives an app restart.

**Post and submit** posts the review through the GitHub API, with no Claude turn, so it costs no tokens. Rally applies your inline edits, drops, and review-body rewrite to the published drafts. It first deletes any pending review of yours on the PR, including a draft you started on GitHub, because GitHub allows only one per reviewer. It then creates a pending review on the PR's head commit, adds each inline comment and thread reply to it, and submits it with the event you picked (Comment, Approve, or Request changes). A comment or reply GitHub rejects as invalid, such as one on a line outside the diff, moves into the review body under its `path:line` or the comment it replies to, and so do a draft with no file or line and a reply whose comment isn't in a review thread. The submitted banner lists the drafts GitHub couldn't place; a draft written as a general point isn't listed. A folded reply links to the comment it answers. GitHub returning no comment for a request counts as a rejection. A draft whose final text is blank counts as dropped. Any other error, such as a rate limit, fails the submit: Rally deletes the pending review and shows the error. Rally saves the id of the pending review it creates until the review is submitted or deleted. If a submit is interrupted or its cleanup fails, the next submit first checks that review on GitHub; if it was submitted, Rally records it and posts nothing. **Post and submit** is disabled while the feedback box has text, since only Claude can apply free-text feedback: send it first, or clear it. A Comment review with no body and no kept drafts is rejected before anything posts; use **Resolve selected** to resolve threads without posting a review. Rally then re-fetches the PR from GitHub to recompute its phase. The posting logic lives in `src/main/github/submitReview.ts`.

A submitted session stays on the PR page with a link to the review on GitHub. **Start follow-up review** discards that session and starts a new one that runs the review skill again. A skill that reads your earlier review on GitHub can use it to do a follow-up review.

Each session runs in its own temp directory, with `TMPDIR` pointed at it, so the skill's work directory lands inside it. Rally deletes the directory after the review is submitted or discarded.

Settings → Reviews picks the review skill, and the model and effort for the review session and, separately, for its reviewer subagents. Each defaults to **System default**, which uses your Claude Code settings (`~/.claude/settings.json`); subagents otherwise inherit the review model. Subagent choices are passed as `CLAUDE_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_SUBAGENT_EFFORT`.

### My PRs

The **My PRs** tab in the header lists your own open PRs, independent of the author and repo lists in Settings. It has its own filters, sort, hides, and summaries. Each card shows how many comments are unanswered, who requested changes, and who approved, instead of the author.

Reviewers resolve their own threads, so a comment counts as answered once you acknowledge it:

- A review thread is acknowledged while its latest comment is yours or carries your reaction. It stays listed until it's resolved.
- A PR comment or review body is acknowledged once you react to it or a comment of yours links to it. Rally's replies always link to it.
- Empty review bodies, hidden comments, and PR comments and review bodies from bots don't need a response. Review threads from bots, such as code scanning alerts, do.

| Phase | Rule |
|---|---|
| In progress | Your Rally session for the PR has a running turn, an error, unpushed commits, or unposted replies. |
| Needs response | A review thread, PR comment, or review body isn't acknowledged. This outranks Approved. |
| Awaiting reviews | Anything else that isn't approved, including a change request whose comments you've all acknowledged. |
| Approved | GitHub's review decision is Approved, or, in a repo that requires no reviews, a reviewer approved. |

The list reads a PR's first 100 threads and its last 100 PR comments and reviews. A PR with more counts as Needs response and its card says so, since some feedback went unread; the PR page reads everything, including every comment in long threads. The My PRs search fetches 10 PRs per page to keep its GitHub rate-limit cost low. The logic lives in `src/main/github/authorPhase.ts` and `src/main/github/acknowledgment.ts`.

The PR page lists each unresolved review thread and each unacknowledged PR comment and review body, newest first. Threads that wait on the reviewer collapse into a **waiting on reviewers** group at the bottom. **👍 Acknowledge** reacts 👍 on GitHub right away, with no Claude turn, for a comment that needs no reply. Or pick one action per comment, with an optional note for Claude:

- **Investigate**: Claude checks whether the comment holds against the code and gives a verdict (valid, partly valid, not valid, unclear) with evidence. When it doesn't hold, Claude drafts the reply you'd post. No code changes.
- **Fix**: Claude makes the change, runs quick checks, and lists the files it changed with a commit message. After the turn, Rally commits each fix separately and puts the commit's short sha into the reply where Claude wrote `{commit}`.
- **Push back**: Claude drafts a reply explaining why not. No code changes.
- **Answer**: for a question or remark rather than a problem, Claude drafts a reply that answers it, reading the code when needed. No code changes.

**Run** sends every picked action in one Claude turn. The first run clones the PR's head branch into the session's temp directory; later runs fetch it and move it to GitHub's head, even after a force push, when it holds no commits or uncommitted edits of its own. Rally passes `gh`'s credentials to its own git commands, and gives clones 10 minutes and fetches and pushes 3 before timing out. Rally only clones PRs you opened. In the clone, Claude can only run git commands that read; Rally makes every commit and merge. Edits from a turn that errors or is cancelled aren't committed, even by a later turn: they show as uncommitted changes in the **Changes** tab, and the affected fixes say they weren't committed. A fix whose files fail to commit says why without stopping the others. Clones live in the temp folder, which macOS clears after a few days; if a clone with unpushed commits disappears, Rally says so instead of cloning again, and **Start over** clears it. Claude's verdict, summary, commits, and reply draft show on each comment. Edit or drop a reply there, or tick **Resolve thread after posting**, which is off by default. The text box below sends Claude a free-form message instead when nothing is picked. Rally doesn't commit edits Claude makes for a free-form message; they show as uncommitted changes too. The **Changes** tab lists uncommitted files with a commit message box, **Commit N files**, which commits every edit in the clone as one commit, and **Discard**.

The **Changes** tab shows the clone's uncommitted files, its unpushed commits, and their diff against where they branched from GitHub. Its main button is **Commit N files** while there are uncommitted files and **Push to GitHub** once there are none. **Push to GitHub** pushes the commits to the head branch without force. If the branch moved on GitHub, Rally merges it into the clone first, and refuses while uncommitted changes would block the merge. If the branch was force-pushed, Rally replays its own commits onto the new head instead, updates the replies that name them, and refuses if they don't apply cleanly. Rally saves the merged or replayed state before pushing, so a push that fails can be retried without losing it. A fix left waiting for a commit when Rally quits is marked as not committed on the next launch. When that merge conflicts, Rally starts a Claude turn to resolve the conflicted files and commits the merge when the turn ends, refusing while conflict markers remain; then push again. While a merge is open, the tab offers **Resolve with Claude** and **Abort merge**, and Run, Self-review, and messages to Claude are disabled. Claude never pushes; the tool policy still blocks `git push`.

**Post replies** posts every pending reply through the GitHub API, with no Claude turn, and asks first. It is disabled while commits are unpushed, so replies never point at code reviewers can't see; next to it, **Review changes** opens the **Changes** tab and **Push N commits** pushes them. A thread reply goes on the thread; a reply to a PR comment or review body posts as a PR comment that links it. A reply that fails stays pending so you can post it again. A reply that still has `{commit}`, because Rally had nothing to commit for it, must be edited first. A thread that was resolved on GitHub after Claude drafted its reply stays listed until you post or drop the reply.

**Re-request review from people I reply to**, next to **Post replies** and on by default, queues the author of each comment you replied to, leaving out you and bots. People whose latest review is an approval are never re-requested and leave the queue. Rally re-requests a queued person's review as soon as none of their comments are left unanswered: right after posting, or later when another reply or a **👍 Acknowledge** answers their last one. Acknowledging alone never queues anyone. Rally requests each person separately. Someone GitHub refuses with a 422, such as a non-collaborator, leaves the queue; any other error keeps them queued. The page shows who was re-requested, who is still queued, and the errors.

**Self-review** runs your review skill from Settings on the PR. Nothing is posted: the report shows in the **Self-review** tab, and each draft comment becomes a finding in the comment list with Investigate, Fix, and Dismiss. **Start over** discards the session, its clone, unpushed commits, and unposted replies. Once a PR leaves My PRs, Rally removes its session and clone the same way, unless it still has work: a running turn, unpushed commits, unposted replies, an open merge, or queued re-requests. A last turn that failed or was cancelled doesn't keep it. The logic lives in `src/main/claude/authorSessions.ts`, and the git steps in `src/main/git/prClone.ts`.

### Sounds

Rally plays a short sound for three cues, each with its own sound in every skin:

| Cue | When it plays |
|---|---|
| Claude finishes a turn | A turn in a review, a self-review, or a My PRs response session ends or errors. A cancelled turn plays nothing. Set it to play after every turn, only when no other turn is still running in either tab, or never. |
| A PR needs your attention | In **Reviewing**, a PR is newly listed as unreviewed, or moves to unreviewed or awaiting re-review. In **My PRs**, a PR is newly listed as needs response, or moves to it. A PR leaving In progress doesn't count, since that only follows your own work in Rally, and its phase can lag until the refresh after a submit lands. Drafts and hidden PRs stay quiet until they show up: a draft marked ready, or a hidden PR that resurfaces or that you unhide, counts as newly listed. |
| A PR is approved | In **Reviewing**, a new approval of yours appears, whether you submitted it in Rally or on GitHub. In **My PRs**, a reviewer who hadn't approved before approves. |

One PR list update plays at most one sound, and an approval outranks a PR needing attention. The first refresh after launch compares against the list Rally cached when it last ran, so changes made while Rally was closed play once.

Settings → Sounds turns sounds on or off, sets the volume, toggles each cue, and plays a preview of each. The sound set follows the skin unless you pick one. The sounds are synthesized with the Web Audio API, so Rally ships no audio files. The main process decides when a cue fires (`src/main/soundCues.ts`), taking its baseline after the lists recompute phases from your sessions at launch, and the window plays it (`src/renderer/src/lib/sounds.ts`), so sounds play only while Rally's window is open. A sound that fails to play is logged to the window's console.

### Updates

Settings → About shows the app version, the Electron, Chromium, and Node.js versions, and the data folder. **Check for updates** reads the latest release from the GitHub API without signing in, and gives up after 15 seconds. When the release is newer than the running version, the page shows its date and notes and **Download and install**, which downloads the release asset for this machine and shows progress. A download that receives nothing for 30 seconds fails, and you can try again. Rally only downloads an asset whose name is a plain file name and whose URL, once parsed, is exactly `https://github.com/TannerYohe/rally/releases/download/<tag>/<name>` for the release's tag, with no query or fragment; otherwise the page says why and offers **Check again**.

- macOS: the `arm64` zip. Rally extracts it with `ditto`, checks it with `codesign --verify --deep --strict`, and checks that its bundle id matches the running app's. Rally then quits, and a detached shell script waits for it to exit, moves the old app aside to `Rally.previous.app`, moves the new one into place, and reopens it. If the new app can't move into place, the script restores the old one. `Rally.previous.app` stays until the new version starts. If the new release fails to launch, delete `Rally.app` and rename `Rally.previous.app` back to `Rally.app` rather than opening it in place, since the next update would treat it as the current app and leave a `Rally.previous.previous.app`. Rally only installs when it can write to the folder holding `Rally.app` and macOS has not translocated it; otherwise the page says why.
- Windows: the `x64` installer, started as a detached process with `--updated /S --force-run` so it runs silently, closes Rally if it is still running, and reopens it. Rally starts the installer directly rather than through PowerShell, because PowerShell started as a detached process exits without running its command.

On both platforms Rally writes a hand-off line to `update.log` in the data folder before starting the install. On macOS the script appends its result; the Windows installer doesn't write to the log. The release's signature is ad-hoc, so the `codesign` check catches a corrupt download, not a build someone re-signed.

Before handing off, Rally records the version it is installing in `update.json` in the data folder. If the next launch isn't on that version, the dashboard shows that the update didn't install, and Settings → About points to `update.log` on macOS, or to the release page on Windows so you can run the installer yourself. On launch, Rally also removes its own leftover download folders from the temp directory. Their names include a hash of the data folder, so a test instance with a different `RALLY_USER_DATA_DIR` doesn't touch another instance's download.

Quitting stops any running Claude turn; the review shows as interrupted and resumes when you send feedback. The development build checks for updates but doesn't install them. A relaunched test instance keeps its `RALLY_USER_DATA_DIR`. The logic lives in `src/main/update/`.

### Guardrails

The tool policy is a guardrail against accidental writes and destructive commands, not a sandbox; see the warning at the top. The review session can run interpreters, build tools, tests, and shells so it can explore the code. Every tool call goes through `src/main/claude/toolPolicy.ts` as a `PreToolUse` hook:

- GitHub writes are always blocked: every `gh api` request other than a GET, every GraphQL mutation, and `gh` subcommands that write. Rally posts reviews and replies, resolves threads, and pushes fixes on your own PRs itself, outside the session. `gh` is checked behind wrappers (`timeout`, `xargs`, `env`, `winpty`), `sh -c`, `eval`, and `find -exec`. On Windows, commands run through `cmd` or `powershell` are not checked. `git push` is always blocked.
- In a My PRs session, git commands that change Rally's clone of the PR, such as `commit`, `checkout`, `merge`, or `fetch`, are blocked; only commands that read run there. Rally commits and merges itself.
- Write, Edit, and Bash file writes (`rm`, `mv`, `cp`, `tee`, `sed -i`, `find -delete`, output redirects) only land under the temp directory. Paths resolve against the working directory, including `cd`, with `..` and symlinks followed, and `$WORK` counts as temp only in the command that assigns it from `mktemp` or a temp path. Paths that `xargs` supplies are unknown, so file-writing commands behind `xargs` are blocked. Git commands that change a checkout, and `gh pr checkout`, only run in temp repos. `git config --global` is read-only.
- `curl` and `wget` requests with a body or a non-GET method (`curl -d`, `curl -X POST`, `wget --post-data`) are blocked. This is not an exfiltration control: GET URLs, `WebFetch`, and interpreters can still send data out.
- `ssh`/`scp`, live infrastructure CLIs (`kubectl`, `aws`, `gcloud`, `az`, `terraform`, `helm`), and `sudo` are blocked.
- Read-only MCP tools (actions starting with a verb like `get`, `list`, `search`, or `read`), `WebSearch`, `WebFetch`, and `LSP` are allowed. MCP tools that write are blocked.

`src/main/claude/shellCommand.ts` parses comments, heredocs, substitutions, and redirects so the policy sees every command in a Bash call. Blocked calls appear in the activity timeline.

### Skins

Settings → Appearance switches the skin: **Classic**, **Centre Court** (tennis), **Special Stage** (rally motorsport), or **Pep Rally**. Picking a skin previews it, and Save stores it in `config.json` with the other settings; Discard, or leaving Settings without saving, reverts the preview. Components use the `ink`, `primary`, `secondary`, and `highlight` color scales from `src/renderer/src/index.css` instead of raw Tailwind palettes; `src/renderer/src/skins.css` remaps those scales per skin and adds an optional backdrop pattern and wordmark style. Status colors (success, error, warning) and the repo chips in `src/renderer/src/lib/theme.ts` stay on fixed palettes in every skin. To add a skin, add its id to the `SkinId` union in `src/shared/types.ts`, an entry in `SKINS` in `src/renderer/src/lib/skins.ts`, and a `:root[data-skin='<id>']` block in `skins.css` that defines every scale; `skins.test.ts` checks the block.

## Data

Rally stores config, the PR caches, and summaries as JSON in Electron's `userData` directory (`~/Library/Application Support/rally` on macOS), each review session as its own file under `sessions/` there, and each My PRs session under `author-sessions/`. The My PRs list keeps its own `authored-*.json` cache, summaries, seen heads, and hides. Set `RALLY_USER_DATA_DIR` to use a different directory, for example for a test instance. Only one Rally instance can run per data directory. Claude session transcripts live where Claude Code keeps them.

## License

Rally is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). You can use, change, and share it for noncommercial purposes as long as every copy keeps the `Required Notice` line from `LICENSE.md`. Commercial use, including using Rally for work at a for-profit company, needs separate permission from the copyright holder.
