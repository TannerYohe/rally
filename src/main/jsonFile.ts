import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export class JsonFile<T> {
  private value: T

  constructor(
    private readonly path: string,
    fallback: T,
  ) {
    this.value = existsSync(path) ? { ...fallback, ...JSON.parse(readFileSync(path, 'utf8')) } : fallback
  }

  get(): T {
    return this.value
  }

  set(value: T): void {
    this.value = value
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(value, null, 2))
    renameSync(tmp, this.path)
  }
}
