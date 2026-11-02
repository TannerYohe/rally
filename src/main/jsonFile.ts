import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, path)
}

export class JsonFile<T> {
  private value: T

  constructor(
    private readonly path: string,
    fallback: T,
  ) {
    this.value = existsSync(path) ? { ...fallback, ...readJson<T>(path) } : fallback
  }

  get(): T {
    return this.value
  }

  set(value: T): void {
    this.value = value
    writeJson(this.path, value)
  }
}

export class JsonDir<T> {
  constructor(private readonly dir: string) {}

  readAll(): T[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => readJson<T>(join(this.dir, name)))
  }

  write(key: string, value: T): void {
    writeJson(this.pathOf(key), value)
  }

  remove(key: string): void {
    rmSync(this.pathOf(key), { force: true })
  }

  private pathOf(key: string): string {
    return join(this.dir, `${encodeURIComponent(key)}.json`)
  }
}
