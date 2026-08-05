import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiscoveryResult } from '../discoveryData'
import {
  isAbortError,
  type DiscoverySearchPage,
  type DiscoverySearchRequest,
  type DiscoverySearchState,
} from './types'
import type { DiscoverySearchRepository } from './DiscoverySearchRepository'

const INITIAL_STATE: DiscoverySearchState = {
  results: [],
  totalCount: 0,
  nextCursor: null,
  connection: 'not-requested',
  isLoading: false,
  error: null,
}

const appendUniqueResults = (
  current: readonly DiscoveryResult[],
  incoming: readonly DiscoveryResult[],
) => {
  const seenIds = new Set(current.map((result) => result.id))
  return [
    ...current,
    ...incoming.filter((result) => {
      if (seenIds.has(result.id)) return false
      seenIds.add(result.id)
      return true
    }),
  ]
}

export interface UseDiscoverySearchResult extends DiscoverySearchState {
  hasMore: boolean
  search: (
    request: DiscoverySearchRequest,
  ) => Promise<DiscoverySearchPage | null>
  loadMore: () => Promise<void>
  reset: () => void
}

export const useDiscoverySearch = (
  repository: DiscoverySearchRepository,
): UseDiscoverySearchResult => {
  const [state, setState] = useState<DiscoverySearchState>(INITIAL_STATE)
  const stateRef = useRef(state)
  const requestRef = useRef<DiscoverySearchRequest | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const sequenceRef = useRef(0)
  stateRef.current = state

  const run = useCallback(
    async (request: DiscoverySearchRequest, append: boolean) => {
      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller
      const sequence = sequenceRef.current + 1
      sequenceRef.current = sequence
      setState((current) => ({
        ...current,
        results: append ? current.results : [],
        totalCount: append ? current.totalCount : 0,
        nextCursor: append ? current.nextCursor : null,
        connection: append ? current.connection : 'not-requested',
        isLoading: true,
        error: null,
      }))

      try {
        const page = await repository.search(request, controller.signal)
        if (controller.signal.aborted || sequenceRef.current !== sequence) {
          return null
        }
        setState((current) => ({
          results: append
            ? appendUniqueResults(current.results, page.results)
            : page.results,
          totalCount: page.totalCount,
          nextCursor: page.nextCursor,
          connection: page.connection,
          isLoading: false,
          error: null,
        }))
        return page
      } catch (error) {
        if (
          controller.signal.aborted ||
          sequenceRef.current !== sequence ||
          isAbortError(error)
        ) {
          return null
        }
        setState({
          ...INITIAL_STATE,
          isLoading: false,
          error:
            error instanceof Error
              ? error
              : new Error('Discovery search failed'),
        })
        return null
      }
    },
    [repository],
  )

  const search = useCallback(
    async (request: DiscoverySearchRequest) => {
      requestRef.current = { ...request, cursor: null }
      return run(requestRef.current, false)
    },
    [run],
  )

  const loadMore = useCallback(async () => {
    const request = requestRef.current
    const { isLoading, nextCursor } = stateRef.current
    if (!request || isLoading || !nextCursor) return
    await run({ ...request, cursor: nextCursor }, true)
  }, [run])

  const reset = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    sequenceRef.current += 1
    requestRef.current = null
    setState(INITIAL_STATE)
  }, [])

  useEffect(
    () => () => {
      abortControllerRef.current?.abort()
      sequenceRef.current += 1
    },
    [],
  )

  return {
    ...state,
    hasMore: state.nextCursor !== null,
    search,
    loadMore,
    reset,
  }
}
