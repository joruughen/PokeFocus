import { Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs } from '../../components'
import { useAuth } from '../../store/auth'
import { useAdminNav } from './nav'
import { visibleTabs } from './tabs'

/**
 * Admin (`#/admin`, not in the menu): a container with tabs, one per tool (content, players, metrics, maintenance…).
 * The tabs live in `tabs.tsx`; each one is a panel in its own folder, loaded when opened. Support accounts see what
 * they can read; the server is the authority on every action.
 */
export default function Admin() {
  const { t } = useTranslation()
  const role = useAuth((s) => s.user?.role)
  const tabs = visibleTabs({ role })
  const [current, setCurrent] = useState<string | null>(null)
  const value = tabs.some((tab) => tab.id === current) ? current! : tabs[0]!.id
  // A link from another tab (an event's tied content) asks for the content tab.
  const wantsContent = useAdminNav((s) => s.contentVersionId !== null)
  useEffect(() => {
    if (wantsContent && tabs.some((tab) => tab.id === 'content')) setCurrent('content')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a request arrives
  }, [wantsContent])

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl">{t('admin.title')}</h1>
        <p className="max-w-[60ch] text-mist-300">{t('admin.intro')}</p>
      </header>
      <Tabs
        label={t('admin.tabs.label')}
        value={value}
        onValueChange={setCurrent}
        items={tabs.map(({ id, labelKey, component: Panel }) => ({
          value: id,
          label: t(labelKey),
          content: (
            <Suspense fallback={<p className="text-mist-300">{t('common.loading')}</p>}>
              <Panel />
            </Suspense>
          ),
        }))}
      />
    </div>
  )
}
