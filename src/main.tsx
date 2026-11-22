import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './ui/App'

// Dev-only screenshots of the group scenes (`/?groupPreview`). `import.meta.env.DEV` is false in the production
// build, so this branch and the chunk behind it are dropped from it.
const GroupPreview = import.meta.env.DEV && new URLSearchParams(location.search).has('groupPreview') ? lazy(() => import('./ui/dev/GroupPreview')) : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {GroupPreview ? (
      <Suspense fallback={null}>
        <GroupPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
