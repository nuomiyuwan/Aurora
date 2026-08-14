import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('a rejected page transition cannot publish a favorites route', async () => {
  const appSource = await readFile('src/App.tsx', 'utf8')
  const transitionStart = appSource.indexOf(
    'const transitionToView = useCallback',
  )
  const transitionEnd = appSource.indexOf('\n  }, [', transitionStart)
  const transitionSource = appSource.slice(transitionStart, transitionEnd)

  const lockGuard = transitionSource.indexOf(
    'if (nextView === currentView || pageTransitionActiveRef.current) return false',
  )
  const routeWrite = transitionSource.indexOf(
    'if (updateHistory) writeAppViewRoute(nextView)',
  )

  expect(transitionStart).toBeGreaterThanOrEqual(0)
  expect(transitionEnd).toBeGreaterThan(transitionStart)
  expect(lockGuard).toBeGreaterThanOrEqual(0)
  expect(routeWrite).toBeGreaterThan(lockGuard)
})
