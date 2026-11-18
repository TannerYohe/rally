import { parseLinkedPrs } from './linkedPrs'
import { isSamePr, keyOf, type Phase, type Pr, type PrCoords, type PrHide, type PrLinks } from './types'

export const MAX_UNIT_SIZE = 5

/** A PR as the linker sees it: its key, coordinates, and the PRs its description links. */
export interface LinkNode {
  key: string
  coords: PrCoords
  targets: PrCoords[]
}

export function linkNode(pr: PrCoords & Pick<Pr, 'body'>, markers: string[]): LinkNode {
  const coords = { owner: pr.owner, repo: pr.repo, number: pr.number }
  return { key: keyOf(pr), coords, targets: parseLinkedPrs(pr.body, coords, markers) }
}

export function hasPair(pairs: [string, string][], a: string, b: string): boolean {
  return pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
}

function lists(node: LinkNode, other: LinkNode): boolean {
  return node.targets.some((target) => isSamePr(target, other.coords))
}

export function areLinked(a: LinkNode, b: LinkNode, links: PrLinks): boolean {
  if (hasPair(links.unlinked, a.key, b.key)) return false
  return (lists(a, b) && lists(b, a)) || hasPair(links.linked, a.key, b.key)
}

/** Returns the keys a PR was linked with by hand. */
export function handLinkedKeys(key: string, links: PrLinks): string[] {
  return links.linked.flatMap(([a, b]) => (a === key ? [b] : b === key ? [a] : []))
}

/** Returns the units the nodes form, as member keys in node order, for every unit of two or more. */
export function linkUnits(nodes: LinkNode[], links: PrLinks): string[][] {
  const parent = new Map(nodes.map((node) => [node.key, node.key]))
  const size = new Map(nodes.map((node) => [node.key, 1]))
  const root = (key: string): string => {
    const up = parent.get(key)!
    return up === key ? key : root(up)
  }
  nodes.forEach((a, i) => {
    for (const b of nodes.slice(i + 1)) {
      if (!areLinked(a, b, links)) continue
      const [ra, rb] = [root(a.key), root(b.key)]
      if (ra === rb || size.get(ra)! + size.get(rb)! > MAX_UNIT_SIZE) continue
      parent.set(rb, ra)
      size.set(ra, size.get(ra)! + size.get(rb)!)
    }
  })
  const units = new Map<string, string[]>()
  for (const node of nodes) {
    const r = root(node.key)
    units.set(r, [...(units.get(r) ?? []), node.key])
  }
  return [...units.values()].filter((unit) => unit.length > 1)
}

/** Returns, per node key, the nodes it links that don't link back and aren't in its unit or unlinked by hand. */
export function oneSidedLinks(nodes: LinkNode[], links: PrLinks, units: string[][]): Map<string, string[]> {
  const unitOf = new Map(units.flatMap((unit) => unit.map((key) => [key, unit] as const)))
  const result = new Map<string, string[]>()
  for (const node of nodes) {
    const oneSided = nodes.filter(
      (other) =>
        other !== node &&
        lists(node, other) &&
        !lists(other, node) &&
        !unitOf.get(node.key)?.includes(other.key) &&
        !hasPair(links.unlinked, node.key, other.key) &&
        !hasPair(links.linked, node.key, other.key),
    )
    if (oneSided.length > 0) result.set(node.key, oneSided.map((other) => other.key))
  }
  return result
}

/** Returns the hide a unit shows: the first member's when every member is hidden, else none. */
export function unitHide(members: Pick<Pr, 'hidden'>[]): PrHide | null {
  return members.every((member) => member.hidden) ? members[0].hidden : null
}

export interface PrUnit {
  key: string
  members: Pr[]
  phase: Phase
  hidden: PrHide | null
  createdAt: string
  updatedAt: string
  size: number
}

/** Returns the member phase that comes first in the phase order, so a unit is only as far along as its least reviewed member. */
export function unitPhase(members: Pick<Pr, 'phase'>[], phaseOrder: readonly Phase[]): Phase {
  const rank = (phase: Phase) => {
    const index = phaseOrder.indexOf(phase)
    return index === -1 ? phaseOrder.length : index
  }
  return members.reduce((first, member) => (rank(member.phase) < rank(first) ? member.phase : first), members[0].phase)
}

/** Returns the PR followed by the PRs its unit links it with, as found in byKey. */
export function membersOf<T extends Pick<Pr, 'linkedPrs'>>(pr: T, byKey: Map<string, T>): T[] {
  return [pr, ...(pr.linkedPrs ?? []).flatMap((key) => byKey.get(key) ?? [])]
}

export function toUnit(members: Pr[], phaseOrder: readonly Phase[]): PrUnit {
  return {
    key: keyOf(members[0]),
    members,
    phase: unitPhase(members, phaseOrder),
    hidden: unitHide(members),
    createdAt: members.map((m) => m.createdAt).reduce((a, b) => (b < a ? b : a)),
    updatedAt: members.map((m) => m.updatedAt).reduce((a, b) => (b > a ? b : a)),
    size: members.reduce((sum, m) => sum + m.additions + m.deletions, 0),
  }
}

/** Groups PRs by their settled links, in list order, each unit led by its first listed member. */
export function groupIntoUnits(prs: Pr[], phaseOrder: readonly Phase[]): PrUnit[] {
  const byKey = new Map(prs.map((pr) => [keyOf(pr), pr]))
  const grouped = new Set<string>()
  const units: PrUnit[] = []
  for (const pr of prs) {
    const key = keyOf(pr)
    if (grouped.has(key)) continue
    const members = membersOf(pr, byKey).filter((member) => !grouped.has(keyOf(member)))
    for (const member of members) grouped.add(keyOf(member))
    units.push(toUnit(members, phaseOrder))
  }
  return units
}

/** Returns the PR and the other members of its unit. */
export function unitMembers(prs: Pr[], pr: Pr): Pr[] {
  return membersOf(pr, new Map(prs.map((other) => [keyOf(other), other])))
}
