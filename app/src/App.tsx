import { useEffect, useState } from 'react'

type CheckState = 'pending' | 'ok' | 'fail'

function Check({ label, state, detail }: { label: string; state: CheckState; detail?: string }) {
  const icon = state === 'ok' ? '✅' : state === 'fail' ? '❌' : '⏳'
  return (
    <li className="flex items-baseline gap-2 py-1">
      <span>{icon}</span>
      <span className="font-medium">{label}</span>
      {detail && <span className="text-sm text-gray-500">{detail}</span>}
    </li>
  )
}

export default function App() {
  const [indexedDb, setIndexedDb] = useState<CheckState>('pending')
  const [idbDetail, setIdbDetail] = useState<string>('')

  useEffect(() => {
    const req = indexedDB.open('ww-selfcheck', 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('ping')) {
        req.result.createObjectStore('ping', { keyPath: 'id' })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('ping', 'readwrite')
      tx.objectStore('ping').put({ id: 1, at: Date.now() })
      tx.oncomplete = () => {
        setIndexedDb('ok')
        setIdbDetail(`v${db.version}`)
        db.close()
      }
      tx.onerror = () => {
        setIndexedDb('fail')
        setIdbDetail(String(tx.error))
        db.close()
      }
    }
    req.onerror = () => {
      setIndexedDb('fail')
      setIdbDetail(String(req.error))
    }
  }, [])

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">WestWorld V2</h1>
      <p className="mt-1 text-sm text-gray-500">步骤 0 · 工程脚手架自检</p>

      <ul className="mt-6 divide-y divide-gray-100 rounded border border-gray-200 p-4">
        <Check label="React 渲染" state="ok" />
        <Check label="Tailwind 样式" state="ok" detail="这行文字应当居中、有边框" />
        <Check label="IndexedDB" state={indexedDb} detail={idbDetail} />
      </ul>

      <p className="mt-6 text-sm text-gray-500">
        三条全绿说明脚手架可用，可以进入步骤 1（TypeBox Schema 层）。
      </p>
    </div>
  )
}
