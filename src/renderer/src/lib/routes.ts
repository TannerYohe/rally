import type { PrListKind } from '@shared/types'

type PrPathTarget = { owner: string; repo: string; number: number }

export const LIST_ROOTS: Record<PrListKind, string> = {
  reviewing: '/',
  authored: '/mine',
}

export function prDetailPath(list: PrListKind, pr: PrPathTarget): string {
  switch (list) {
    case 'reviewing':
      return `/pr/${pr.owner}/${pr.repo}/${pr.number}`
    case 'authored':
      return `/mine/${pr.owner}/${pr.repo}/${pr.number}`
  }
}
