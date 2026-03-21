import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from './auth/AuthProvider'
import { ManualInput } from './components/ManualInput'
import { PortfolioPanel } from './components/PortfolioPanel'
import { XetraPanel } from './components/XetraPanel'
import { RankingTable } from './components/RankingTable'
import { FilterBar } from './components/FilterBar'
import { SettingsPanel } from './components/SettingsPanel'
import { RegimeBanner } from './components/RegimeBanner'
import { AuthGate } from './components/AuthGate'
import { PanelShell } from './components/ui/PanelShell'
import { StatusBadge } from './components/ui/StatusBadge'

export default function App() {
  const { status, logout } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [portfolioOpen, setPortfolioOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)

  if (status !== 'authenticated') {
    return <AuthGate />
  }

  return (
    <div className="h-screen flex flex-col bg-bg text-gray-200 font-sans overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-semibold tracking-wider text-gray-100">
            MOMENTUM<span className="text-accent">_</span>SCREENER
          </span>
          <StatusBadge tone="muted">XETRA + MANUAL</StatusBadge>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void logout()}
            className="btn btn-sm btn-ghost focus-ring"
          >
            Logout
          </button>
          <SettingsPanel />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside
          className={`border-r border-border bg-surface flex flex-col shrink-0 transition-all duration-200 ${
            sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'
          }`}
        >
          <div className="flex flex-col gap-4 p-4 overflow-y-auto flex-1 min-w-[256px]">
            <PanelShell title="Xetra Universe">
              <XetraPanel />
            </PanelShell>

            <PanelShell
              title="Portfolio"
              collapsible
              open={portfolioOpen}
              onToggle={() => setPortfolioOpen((v) => !v)}
            >
              <PortfolioPanel />
            </PanelShell>

            <PanelShell
              title="Manual Input"
              collapsible
              open={manualOpen}
              onToggle={() => setManualOpen((v) => !v)}
            >
              <ManualInput />
            </PanelShell>
          </div>
        </aside>

        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="focus-ring flex items-center justify-center w-5 bg-surface border-r border-border text-muted hover:text-gray-300 hover:bg-surface2 shrink-0 transition-colors"
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {sidebarOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
        </button>

        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="px-4 py-2 border-b border-border bg-surface shrink-0">
            <FilterBar />
          </div>

          <RegimeBanner />

          <RankingTable onOpenSidebar={() => setSidebarOpen(true)} />
        </main>
      </div>
    </div>
  )
}
