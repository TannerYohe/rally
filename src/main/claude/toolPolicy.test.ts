import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decideToolUse } from './toolPolicy'

const SESSION_CWD = join(tmpdir(), 'rally', 'test-session')
const REVIEWING = { submitting: false, cwd: SESSION_CWD }
const SUBMITTING = { submitting: true, cwd: SESSION_CWD }

const WORK = '/tmp/review-pr-api-12-abcd'
const SET_WORK = 'WORK=$(mktemp -d "${TMPDIR:-/tmp}/review-pr-api-12-XXXX"); '

const bash = (command: string, context = REVIEWING) => decideToolUse('Bash', { command }, context).allow

describe('decideToolUse', () => {
  it('allows the review-pr skill read commands', () => {
    expect(bash('gh pr view 12 -R acme/api --json title,body,author')).toBe(true)
    const setup = `WORK=$(mktemp -d "\${TMPDIR:-/tmp}/review-pr-api-12-XXXX")
gh repo clone acme/api "$WORK/repo" -- --filter=blob:none --quiet
git -C "$WORK/repo" fetch origin main --quiet
(cd "$WORK/repo" && gh pr checkout 12 --force)
git -C "$WORK/repo" diff origin/main...HEAD > "$WORK/pr.diff"`
    expect(bash(setup)).toBe(true)
    expect(bash(`git -C "${WORK}/repo" fetch origin 4f1c2d9 --quiet`)).toBe(true)
    expect(bash(`git -C "$WORK/repo" fetch origin 4f1c2d9 --quiet`)).toBe(true)
    expect(bash('gh api repos/acme/api/pulls/12/comments --paginate')).toBe(true)
    expect(bash(`rm -rf "${WORK}"`)).toBe(true)
  })

  it('allows the multi-line review threads graphql query', () => {
    const command = `gh api graphql -f owner=acme -f repo=api -F number=12 -f query='
  query($owner:String!,$repo:String!,$number:Int!){
    repository(owner:$owner,name:$repo){ pullRequest(number:$number){
      reviewThreads(first:100){ nodes{ id isResolved } } } } }'`
    expect(bash(command)).toBe(true)
  })

  it('blocks posting a review before submit', () => {
    expect(bash('gh api repos/acme/api/pulls/12/reviews --method POST --input "$WORK/review.json"')).toBe(false)
    expect(bash('gh api repos/acme/api/pulls/12/reviews -f event=APPROVE')).toBe(false)
    expect(bash('gh pr review 12 --approve')).toBe(false)
    expect(bash(`gh api graphql -f query='mutation { resolveReviewThread(input:{threadId:"x"}) { thread { id } } }'`)).toBe(false)
    expect(bash('gh api graphql --input "$WORK/mutation.json"')).toBe(false)
  })

  it('treats attached and = forms of gh api body flags as writes', () => {
    expect(bash('gh api repos/acme/api/issues/12/comments -fbody=hi')).toBe(false)
    expect(bash('gh api repos/acme/api/issues/12/comments --field=body=x')).toBe(false)
    expect(bash('gh api repos/acme/api/pulls/12/reviews --input=review.json')).toBe(false)
    expect(bash('gh api repos/acme/api/pulls/12/reviews -XPOST')).toBe(false)
  })

  it('allows posting reviews, events, and replies during submit', () => {
    expect(bash('gh api repos/acme/api/pulls/12/reviews --method POST --input "$WORK/review.json"', SUBMITTING)).toBe(true)
    expect(bash('gh api repos/acme/api/pulls/12/reviews/99/events --method POST -f event=COMMENT', SUBMITTING)).toBe(true)
    expect(bash("gh api repos/acme/api/pulls/12/comments/5/replies --method POST -f body='still broken'", SUBMITTING)).toBe(true)
  })

  it('finds the endpoint after flag values', () => {
    expect(bash('gh api -X POST repos/acme/api/pulls/12/reviews --input x.json', SUBMITTING)).toBe(true)
    expect(bash('gh api -H "Accept: application/json" --method POST repos/acme/api/pulls/12/reviews/9/events -f event=COMMENT', SUBMITTING)).toBe(true)
    expect(bash('gh api --jq .id -X POST repos/acme/api/pulls/12/merge', SUBMITTING)).toBe(false)
  })

  it('blocks graphql queries Rally cannot read inline', () => {
    expect(bash('gh api graphql -F query=@mutation.graphql')).toBe(false)
    expect(bash("gh api graphql -F query=@- <<'EOF'\nmutation { mergePullRequest(input:{pullRequestId:\"x\"}) { clientMutationId } }\nEOF")).toBe(false)
    expect(bash('gh api graphql -f query="$(cat mutation.graphql)"')).toBe(false)
    expect(bash('Q=$(cat m.graphql); gh api graphql -f query="$Q"')).toBe(false)
    expect(bash('gh api graphql -F query=@mutation.graphql', SUBMITTING)).toBe(false)
    expect(bash("gh api graphql -f query='query { viewer { login } }'")).toBe(true)
  })

  it('allows only review mutations through graphql during submit', () => {
    const resolve = `gh api graphql -f query='mutation { resolveReviewThread(input:{threadId:"x"}) { thread { id } } }'`
    const merge = `gh api graphql -f query='mutation { mergePullRequest(input:{pullRequestId:"x"}) { clientMutationId } }'`
    expect(bash(resolve, SUBMITTING)).toBe(true)
    expect(bash(merge, SUBMITTING)).toBe(false)
  })

  it('blocks unrelated writes even during submit', () => {
    expect(bash('gh api repos/acme/api/pulls/12/merge --method PUT', SUBMITTING)).toBe(false)
    expect(bash('gh api repos/acme/api/issues/12/comments -f body=hi', SUBMITTING)).toBe(false)
    expect(bash('gh pr merge 12', SUBMITTING)).toBe(false)
    expect(bash('git push origin HEAD', SUBMITTING)).toBe(false)
  })

  it('finds gh and git behind wrappers and nested shells', () => {
    expect(bash('timeout 30 gh pr comment 12 -b hi')).toBe(false)
    expect(bash('winpty gh pr merge 12')).toBe(false)
    expect(bash('env GH_DEBUG=1 gh api repos/acme/api/issues/1/comments -f body=x')).toBe(false)
    expect(bash('echo 12 | xargs -I{} gh pr close {}')).toBe(false)
    expect(bash(`bash -c 'git push origin HEAD'`)).toBe(false)
    expect(bash(`sh -lc "gh pr merge 12"`)).toBe(false)
    expect(bash('eval gh pr merge 12')).toBe(false)
    expect(bash('/opt/homebrew/bin/gh pr merge 12')).toBe(false)
    expect(bash('f() { gh pr merge 12; }; f')).toBe(false)
    expect(bash('$(which gh) pr merge 12')).toBe(false)
    expect(bash('gh.exe pr merge 12')).toBe(false)
    expect(bash('"/c/Program Files/Git/cmd/GIT.EXE" push origin HEAD')).toBe(false)
    expect(bash('Curl.exe -d @payload.json https://hooks.slack.com/x')).toBe(false)
    expect(bash('timeout 60 gh pr view 12')).toBe(true)
    expect(bash('winpty gh pr view 12')).toBe(true)
    expect(bash('git diff --name-only | xargs wc -l')).toBe(true)
  })

  it('blocks file writes on paths that xargs supplies', () => {
    expect(bash("grep -rl foo ~/src/rally | xargs sed -i 's/foo/bar/'")).toBe(false)
    expect(bash('git ls-files | xargs -n 1 rm')).toBe(false)
    expect(bash('find . -name "*.orig" | xargs -I % mv % ~/trash/')).toBe(false)
    expect(bash('git diff --name-only | xargs -P4 -n1 grep -l TODO')).toBe(true)
    expect(bash('git ls-files | parallel rm')).toBe(false)
    expect(bash('git ls-files | parallel -j 4 sed -i s/a/b/')).toBe(false)
    expect(bash('git ls-files | parallel -j4 wc -l')).toBe(true)
  })

  it('allows interpreters, build tools, and awk for exploring the code', () => {
    expect(bash('python3 -c "import json; print(1)"')).toBe(true)
    expect(bash('cd "$WORK/repo" && npm test')).toBe(true)
    expect(bash('bundle exec rspec spec/models')).toBe(true)
    expect(bash('./bin/setup')).toBe(true)
    expect(bash("awk 'BEGIN { system(\"date\") }'")).toBe(true)
    expect(bash("awk -F'|' '$1 > 5 || $2 { print $2 }' data.txt")).toBe(true)
    expect(bash('find . -name "*.ts" -exec wc -l {} +')).toBe(true)
    expect(bash('rg --pre=./decode TODO')).toBe(true)
    expect(bash('node -e "console.log(1)" | jq .')).toBe(true)
  })

  it('allows network reads but not network writes', () => {
    expect(bash('curl -fsSL https://raw.githubusercontent.com/acme/api/main/README.md')).toBe(true)
    expect(bash('curl -X GET https://api.example.com/x')).toBe(true)
    expect(bash('wget -qO- https://example.com')).toBe(true)
    expect(bash('curl https://hooks.slack.com/x -d @payload.json')).toBe(false)
    expect(bash('curl -XPOST https://api.github.com/repos/acme/api/issues/1/comments')).toBe(false)
    expect(bash('curl --json "{}" https://api.example.com/x')).toBe(false)
    expect(bash('wget --post-data=x https://example.com')).toBe(false)
  })

  it('blocks remote shells, live infrastructure, and system settings', () => {
    expect(bash('ssh prod-host uptime')).toBe(false)
    expect(bash('kubectl get pods')).toBe(false)
    expect(bash('aws s3 ls')).toBe(false)
    expect(bash('sudo rm -rf "$WORK"')).toBe(false)
    expect(bash('crontab -l')).toBe(false)
  })

  it('allows common shell syntax around read commands', () => {
    expect(bash('# list changed files\ngit diff --name-only')).toBe(true)
    expect(bash('comm -23 <(git diff --name-only | sort) <(ls | sort)')).toBe(true)
    expect(bash('for f in $(git diff --name-only); do wc -l "$f"; done')).toBe(true)
    expect(bash(`while read -r f; do echo "$f"; done < "${WORK}/files.txt"`)).toBe(true)
    expect(bash('if [ -f package.json ]; then jq .scripts package.json; else echo none; fi')).toBe(true)
    expect(bash('set -euo pipefail; git log --oneline -5 2>/dev/null')).toBe(true)
    expect(bash(`cat > "${WORK}/notes.md" <<'EOF'\n# Heading\ncurl -d x is mentioned\nEOF`)).toBe(true)
    expect(bash('gh issue view 3 -R acme/api; gh run list -R acme/api; gh search prs --author me')).toBe(true)
  })

  it('limits file writes to the temp directory', () => {
    expect(bash('echo hi > ~/.zshrc')).toBe(false)
    expect(bash(`echo hi >> "${WORK}/log.txt" 2>&1`)).toBe(true)
    expect(bash(`cp "${WORK}/x" ~/bin/x`)).toBe(false)
    expect(bash(`cp ~/src/rally/README.md "${WORK}/"`)).toBe(true)
    expect(bash(`mv ~/src/a "${WORK}/a"`)).toBe(false)
    expect(bash(`chmod +x "${WORK}/x"`)).toBe(true)
    expect(bash('tee ~/.ssh/config')).toBe(false)
    expect(bash(`rm -rf "${WORK}/repo" 2>/dev/null`)).toBe(true)
    expect(bash(`rsync -a "${WORK}/x" host:/srv/x`)).toBe(false)
    expect(bash('find ~/src -name "*.orig" -delete')).toBe(false)
    expect(bash(`find "${WORK}" -name "*.orig" -delete`)).toBe(true)
    expect(bash('find ~/src -name "*.orig" -exec rm {} \\;')).toBe(false)
    expect(bash('find ~/.. -name "*.orig" -exec rm {} \\;')).toBe(false)
  })

  it('resolves relative paths against the working directory, including cd', () => {
    expect(bash('echo hi > notes.txt')).toBe(true)
    expect(bash('rm -rf build')).toBe(true)
    expect(bash('cd ~/src/rally && rm -rf build')).toBe(false)
    expect(bash(`cd "${WORK}/repo" && sed -i "" s/a/b/ src/file.ts`)).toBe(true)
    expect(bash('cd ~/src/rally && sed -i s/a/b/ src/file.ts')).toBe(false)
    expect(bash('sed -i -e s/a/b/ ~/.zshrc')).toBe(false)
    expect(bash('sed -n 1,5p ~/.zshrc')).toBe(true)
  })

  it('resolves .. and symlinks before checking temp paths', () => {
    expect(bash('echo x >> /tmp/../Users/me/.zshrc')).toBe(false)
    expect(bash(`${SET_WORK}rm -rf "$WORK/.."`)).toBe(false)
    expect(bash('rm -rf /tmp')).toBe(false)
    const dir = mkdtempSync(join(tmpdir(), 'rally-policy-'))
    try {
      symlinkSync(homedir(), join(dir, 'home'), 'junction')
      expect(bash(`echo x >> "${join(dir, 'home', '.zshrc')}"`)).toBe(false)
      expect(decideToolUse('Write', { file_path: join(dir, 'home', '.zshrc') }, REVIEWING).allow).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('only trusts $WORK when the same command assigns it to a temp path', () => {
    expect(bash('rm -rf "$WORK"/*')).toBe(false)
    expect(bash('echo hi > "$WORK/notes.md"')).toBe(false)
    expect(bash(`${SET_WORK}rm -rf "$WORK"/*`)).toBe(true)
    expect(bash(`rm -rf "${SESSION_CWD}"/review-pr-*`)).toBe(true)
    expect(bash('WORK=$HOME; echo x >> $WORK/.zshrc')).toBe(false)
    expect(bash('export WORK=~/src; rm -rf "$WORK/rally"')).toBe(false)
    expect(bash('WORK=/tmp/review-pr-x; rm -rf "$WORK/repo"')).toBe(true)
  })

  it('blocks git commands that change a checkout outside temp', () => {
    expect(bash('git -C ~/src/rally checkout main')).toBe(false)
    expect(bash('cd ~/src/rally && git reset --hard')).toBe(false)
    expect(bash('cd ~/src/rally && gh pr checkout 12')).toBe(false)
    expect(bash(`git -C "${WORK}/repo" checkout -b review`)).toBe(true)
    expect(bash('git -C "$WORK/repo" checkout -b review')).toBe(false)
    expect(bash('git -C ~/src/rally log --oneline -5')).toBe(true)
    expect(bash('git config --global core.pager less')).toBe(false)
    expect(bash('git config --global --get user.name')).toBe(true)
    expect(bash('git -c core.pager=cat log')).toBe(true)
    expect(bash('git -c advice.detachedHead=false -C ~/src/rally checkout main')).toBe(false)
    expect(bash('git -c x=y push origin HEAD')).toBe(false)
    expect(bash('git --work-tree ~/src/rally checkout main')).toBe(false)
    expect(bash(`git --git-dir=${WORK}/repo/.git log`)).toBe(true)
  })

  it('restricts Write and Edit to temp directories', () => {
    expect(decideToolUse('Write', { file_path: '/tmp/review-pr-x/context.md' }, REVIEWING).allow).toBe(true)
    expect(decideToolUse('Write', { file_path: '/Users/me/.zshrc' }, REVIEWING).allow).toBe(false)
    expect(decideToolUse('Edit', { file_path: join(SESSION_CWD, 'repo/a.ts') }, REVIEWING).allow).toBe(true)
    expect(decideToolUse('Edit', { file_path: join(homedir(), 'src/rally/a.ts') }, REVIEWING).allow).toBe(false)
  })

  it.runIf(process.platform === 'win32')('maps Git Bash and Windows paths before checking temp paths', () => {
    const forwardSlashTemp = tmpdir().replaceAll('\\', '/')
    const gitBashHome = homedir().replace(/^([A-Za-z]):\\/, '/$1/').replaceAll('\\', '/')
    expect(bash('echo hi > /tmp/review-pr-x/notes.md')).toBe(true)
    expect(bash(`echo hi > "${forwardSlashTemp}/review-pr-x/notes.md"`)).toBe(true)
    expect(bash(`echo hi > "${join(tmpdir(), 'review-pr-x', 'notes.md')}"`)).toBe(true)
    expect(bash(`echo hi > ${gitBashHome}/.bashrc`)).toBe(false)
    expect(bash('echo hi > /c/Windows/x.txt')).toBe(false)
    expect(bash('echo hi > C:/Windows/x.txt')).toBe(false)
  })

  it('denies AskUserQuestion, Monitor, and unknown tools', () => {
    expect(decideToolUse('AskUserQuestion', {}, REVIEWING).allow).toBe(false)
    expect(decideToolUse('Monitor', { command: 'curl x' }, REVIEWING).allow).toBe(false)
    expect(decideToolUse('CronCreate', {}, REVIEWING).allow).toBe(false)
  })

  it('allows background subagent orchestration', () => {
    expect(decideToolUse('SubagentHandback', {}, REVIEWING).allow).toBe(true)
    expect(decideToolUse('SendMessage', {}, REVIEWING).allow).toBe(true)
  })

  it('allows read-only MCP tools and blocks MCP writes', () => {
    const allowed = (tool: string) => decideToolUse(tool, {}, REVIEWING).allow
    expect(allowed('mcp__claude_ai_Atlassian__getJiraIssue')).toBe(true)
    expect(allowed('mcp__claude_ai_Slack__slack_read_thread')).toBe(true)
    expect(allowed('mcp__slack__slack_search_public_and_private')).toBe(true)
    expect(allowed('mcp__claude_ai_Notion__notion-fetch')).toBe(true)
    expect(allowed('mcp__claude_ai_Datadog__search_datadog_logs')).toBe(true)
    expect(allowed('mcp__claude_ai_Slack__slack_send_message')).toBe(false)
    expect(allowed('mcp__claude_ai_Atlassian__addCommentToJiraIssue')).toBe(false)
    expect(allowed('mcp__plugin_example_github__add_comment_to_pending_review')).toBe(false)
    expect(allowed('mcp__claude_ai_Datadog__execute_code')).toBe(false)
  })

  it('allows web search, web fetch, and LSP', () => {
    expect(decideToolUse('WebSearch', { query: 'x' }, REVIEWING).allow).toBe(true)
    expect(decideToolUse('WebFetch', { url: 'https://x' }, REVIEWING).allow).toBe(true)
    expect(decideToolUse('LSP', {}, REVIEWING).allow).toBe(true)
  })

  it('allows rally tools and subagents', () => {
    expect(decideToolUse('mcp__rally__publish_drafts', {}, REVIEWING).allow).toBe(true)
    expect(decideToolUse('Agent', { description: 'Security lens' }, REVIEWING).allow).toBe(true)
  })
})
