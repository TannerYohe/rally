import { useState } from 'react'
import { parsePrRef } from '@shared/linkedPrs'
import { keyOf } from '@shared/prUnit'
import type { Pr, PrRef } from '@shared/types'
import { useActionRunner } from '../lib/hooks'
import { FIELD_CLASS, SECONDARY_BUTTON_CLASS, SMALL_BUTTON_CLASS } from '../lib/theme'

/** Unlinks a PR from the other PRs of its unit by hand. */
export function UnlinkButton({ pr, unit }: { pr: Pr; unit: Pr[] }) {
  const { error, run } = useActionRunner()
  const others = unit.filter((member) => member.id !== pr.id).map(keyOf)
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-rose-300">{error}</span>}
      <button
        className={SMALL_BUTTON_CLASS}
        title="Review this PR on its own, even though the descriptions link it"
        onClick={() => run(() => window.rally.unlinkPr(keyOf(pr), others))}
      >
        Unlink
      </button>
    </span>
  )
}

function OneSidedLink({ pr, target }: { pr: Pr; target: PrRef }) {
  const { error, run } = useActionRunner()
  const [busy, setBusy] = useState(false)
  const act = (action: () => Promise<void>) => {
    setBusy(true)
    void run(action).finally(() => setBusy(false))
  }
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span>
        {keyOf(pr)} links{' '}
        <a className="underline" href={target.url} target="_blank" rel="noreferrer">
          {keyOf(target)}
        </a>
        , but that PR doesn't link back, so they aren't reviewed together.
      </span>
      <span className="ml-auto flex items-center gap-2">
        {error && <span className="text-xs text-rose-300">{error}</span>}
        <button className={SMALL_BUTTON_CLASS} disabled={busy} onClick={() => act(() => window.rally.linkPrs(keyOf(pr), target))}>
          Link anyway
        </button>
        <button className={SMALL_BUTTON_CLASS} disabled={busy} onClick={() => act(() => window.rally.unlinkPr(keyOf(pr), [keyOf(target)]))}>
          Dismiss
        </button>
      </span>
    </li>
  )
}

/** Lists links that only one side makes, with Link anyway and Dismiss for each. */
export function OneSidedLinks({ prs }: { prs: Pr[] }) {
  const links = prs.flatMap((pr) => (pr.unreciprocatedLinks ?? []).map((target) => ({ pr, target })))
  if (links.length === 0) return null
  return (
    <ul className="space-y-1 rounded-xl bg-ink-900/60 px-4 py-3 text-sm text-ink-300 ring-1 ring-white/5">
      {links.map(({ pr, target }) => (
        <OneSidedLink key={`${keyOf(pr)}>${keyOf(target)}`} pr={pr} target={target} />
      ))}
    </ul>
  )
}

/** Links the PR by hand with a PR typed as a URL or owner/repo#N. */
export function LinkPrForm({ pr }: { pr: Pr }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const { error, run } = useActionRunner()
  const target = parsePrRef(text)
  const link = async () => {
    setBusy(true)
    const linked = await run(async () => {
      if (!target) throw new Error('Enter a PR URL or owner/repo#number.')
      await window.rally.linkPrs(keyOf(pr), target)
    })
    setBusy(false)
    if (linked) {
      setText('')
      setOpen(false)
    }
  }
  if (!open) {
    return (
      <button className={SMALL_BUTTON_CLASS} title="Review this PR together with a PR in another repo" onClick={() => setOpen(true)}>
        Link PR…
      </button>
    )
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        void link()
      }}
    >
      <input
        autoFocus
        className={`${FIELD_CLASS} w-80 text-sm`}
        value={text}
        placeholder="PR URL or owner/repo#number"
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className={SECONDARY_BUTTON_CLASS} disabled={busy || !target}>
        {busy ? 'Linking…' : 'Link'}
      </button>
      <button type="button" className="text-sm text-ink-400 hover:text-ink-200" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </form>
  )
}
