import { useEffect } from 'react'
import { getEventBus } from '@/core/events/bus.ts'
import { AssetsPanel } from '@/features/assets/AssetsPanel.tsx'
import { PlayPanel } from '@/features/play/PlayPanel.tsx'
import { SettingsPanel } from '@/features/settings/SettingsPanel.tsx'
import { useCompileStore } from '@/features/store/compile-store.ts'
import { useUiStore, type ActiveView } from '@/features/store/ui-store.ts'

const TABS: Array<{ key: ActiveView; label: string }> = [
  { key: 'assets', label: '资产' },
  { key: 'play', label: '游玩' },
  { key: 'settings', label: '设置' },
]

/**
 * 顶层外壳：三个界面用 tab 切换（ADR-016 —— 本地单机应用，不做路由）。
 *
 * 事件总线在这里**唯一一次**订阅，把事件折进 compileStore；
 * 日志窗口、进度条各自订阅 store，互不耦合。
 */
export function AppShell() {
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const applyEvent = useCompileStore((s) => s.applyEvent)

  useEffect(() => {
    const bus = getEventBus()
    return bus.on(applyEvent)
  }, [applyEvent])

  return (
    <div className="flex h-screen flex-col bg-neutral-50 text-neutral-900">
      <header className="flex items-center gap-1 border-b border-neutral-200 bg-white px-4 py-2">
        <span className="mr-4 text-sm font-semibold tracking-wide">WestWorld V2</span>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveView(t.key)}
            className={
              'rounded px-3 py-1 text-sm transition ' +
              (activeView === t.key
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:bg-neutral-100')
            }
          >
            {t.label}
          </button>
        ))}
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {activeView === 'assets' && <AssetsPanel />}
        {activeView === 'play' && <PlayPanel />}
        {activeView === 'settings' && <SettingsPanel />}
      </main>
    </div>
  )
}
