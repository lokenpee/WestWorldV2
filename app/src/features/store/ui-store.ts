import { create } from 'zustand'

export type ActiveView = 'assets' | 'play' | 'settings'

interface UiState {
  activeView: ActiveView
  /** 当前正在看的书 / 世界线（null = 还没导入任何东西） */
  bookId: string | null
  /** 资产界面里选中的分类 */
  assetTab: 'characters' | 'locations' | 'nodes' | 'lines' | 'network'
  /** 选中的资产 id（右侧详情用） */
  selectedAssetId: string | null

  setActiveView: (v: ActiveView) => void
  setBookId: (id: string | null) => void
  setAssetTab: (t: UiState['assetTab']) => void
  setSelectedAssetId: (id: string | null) => void
}

/**
 * 只放**界面状态**（ADR-016）。
 * 业务数据一律在 IndexedDB 里，由 useLiveQuery 订阅 —— 不放这里，避免两份真相不同步。
 */
export const useUiStore = create<UiState>((set) => ({
  activeView: 'assets',
  bookId: null,
  assetTab: 'characters',
  selectedAssetId: null,
  setActiveView: (activeView) => set({ activeView }),
  setBookId: (bookId) => set({ bookId, selectedAssetId: null }),
  setAssetTab: (assetTab) => set({ assetTab, selectedAssetId: null }),
  setSelectedAssetId: (selectedAssetId) => set({ selectedAssetId }),
}))

