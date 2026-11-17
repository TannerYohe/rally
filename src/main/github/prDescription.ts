import type { PrDescription, PrRef } from '@shared/types'
import { github, pullParams, timeoutRequest } from './client'

export async function fetchDescription(pr: PrRef): Promise<PrDescription> {
  const gh = await github()
  const { data } = await gh.rest.pulls.get({ ...pullParams(pr), request: timeoutRequest() })
  return { title: data.title, body: data.body ?? '' }
}

export async function updateDescription(pr: PrRef, description: PrDescription): Promise<void> {
  const gh = await github()
  await gh.rest.pulls.update({ ...pullParams(pr), title: description.title, body: description.body, request: timeoutRequest() })
}
