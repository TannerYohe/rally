/** Returns the count followed by the noun, in its plural form unless the count is one. */
export function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`
}
