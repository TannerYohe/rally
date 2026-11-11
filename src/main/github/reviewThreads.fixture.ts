export interface ThreadsPage {
  threads: { id: string; commentIds: (number | null)[] }[]
  endCursor?: string
}

export const commentNodeId = (databaseId: number) => `PRRC_${databaseId}`

/** Builds a page of the review-thread scan response for tests, with comment node ids of `PRRC_<databaseId>`. */
export const threadsPage = ({ threads, endCursor }: ThreadsPage) => ({
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: Boolean(endCursor), endCursor: endCursor ?? null },
        nodes: threads.map((thread) => ({
          id: thread.id,
          comments: {
            nodes: thread.commentIds.map((databaseId, index) => ({
              id: databaseId === null ? `PRRC_${thread.id}_${index}` : commentNodeId(databaseId),
              databaseId,
            })),
          },
        })),
      },
    },
  },
})
