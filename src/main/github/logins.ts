export const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function uniqueLogins(logins: string[]): string[] {
  return logins.filter((login, index) => logins.findIndex((other) => sameLogin(other, login)) === index)
}
