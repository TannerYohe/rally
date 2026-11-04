import { useState } from 'react'

interface Props {
  login: string
  url: string | null
  ringClass?: string
  size?: 'sm' | 'md'
}

export function Avatar({ login, url, ringClass = 'ring-ink-700', size = 'md' }: Props) {
  const [failed, setFailed] = useState(false)
  const dimensions = size === 'md' ? 'h-10 w-10 text-sm' : 'h-6 w-6 text-[10px]'
  if (!url || failed) {
    return (
      <span className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-secondary-500 to-primary-500 font-semibold uppercase text-white ring-2 ${ringClass} ${dimensions}`}>
        {login.slice(0, 2)}
      </span>
    )
  }
  return <img src={url} alt={login} onError={() => setFailed(true)} className={`shrink-0 rounded-full ring-2 ${ringClass} ${dimensions}`} />
}
