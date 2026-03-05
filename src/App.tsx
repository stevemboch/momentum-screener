import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ManualInput } from './components/ManualInput'
import { PortfolioPanel } from './components/PortfolioPanel'
import { XetraPanel } from './components/XetraPanel'
import { RankingTable } from './components/RankingTable'
import { FilterBar } from './components/FilterBar'
import { SettingsPanel } from './components/SettingsPanel'
import { RegimeBanner } from './components/RegimeBanner'

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <div className="h-screen flex flex-col bg-bg text-gray-200 font-sans overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-semibold tracking-wider text-gray-100">
            MOMENTUM<span className="text-accent">_</span>SCREENER
          </span>
          <span className="text-[10px] font-mono text-muted border border-border rounded px-1.5 py-0.5">
            XETRA + MANUAL
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SettingsPanel />
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside
          className={`border-r border-border bg-surface flex flex-col shrink-0 transition-all duration-200 ${
            sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'
          }`}
        >
          <div className="flex flex-col gap-4 p-4 overflow-y-auto flex-1 min-w-[256px]">
            {/* Manual input section */}
            <section className="rounded border border-border bg-bg/40 p-3">
              <SectionHeader label="Manual Input" />
              <ManualInput />
            </section>

            {/* Portfolio section */}
            <section className="rounded border border-border bg-bg/40 p-3">
              <SectionHeader label="Portfolio" />
              <PortfolioPanel />
            </section>

            {/* Xetra section */}
            <section className="rounded border border-border bg-bg/40 p-3">
              <SectionHeader label="Xetra Universe" />
              <XetraPanel />
            </section>
          </div>
        </aside>

        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex items-center justify-center w-4 bg-surface border-r border-border text-muted hover:text-gray-300 hover:bg-surface2 shrink-0 transition-colors"
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {sidebarOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
        </button>

        {/* Main content */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Filter bar */}
          <div className="px-4 py-2 border-b border-border bg-surface shrink-0">
            <FilterBar />
          </div>

          <RegimeBanner />

          {/* Table */}
          <RankingTable onOpenSidebar={() => setSidebarOpen(true)} />
        </main>
      </div>
    </div>
  )
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="text-[10px] font-mono text-muted uppercase tracking-widest mb-2">
      {label}
    </div>
  )
}
