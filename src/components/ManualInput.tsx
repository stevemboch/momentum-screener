import { useState, useRef } from 'react'
import { Upload, Play, X } from 'lucide-react'
import { usePipeline } from '../hooks/usePipeline'
import { useAppState } from '../store'
import { parseManualInput, parseCSVFileDetailed, type CSVParseMeta, type ParsedIdentifier } from '../utils/parsers'

const PLACEHOLDER = `Paste tickers, ISINs or WKNs here — one per line or comma-separated.

Examples:
IE00B4L5Y983
EUNL
VWCE.DE
A0RPWH
AAPL, MSFT, GOOGL`

export function ManualInput() {
  const [text, setText] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [lastParsed, setLastParsed] = useState<ParsedIdentifier[]>([])
  const [csvMeta, setCsvMeta] = useState<CSVParseMeta | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { processManualInput } = usePipeline()
  const { state } = useAppState()
  const isLoading = ['openfigi', 'prices', 'justetf'].includes(state.fetchStatus.phase)

  const handleLoad = () => {
    if (!text.trim() || isLoading) return
    setLastParsed(parseManualInput(text))
    setCsvMeta(null)
    processManualInput(text, false)
  }

  const handleFile = async (file: File) => {
    const content = await file.text()
    const isCSV = file.name.endsWith('.csv') || file.type.includes('csv')
    if (isCSV) {
      const parsed = parseCSVFileDetailed(content)
      setLastParsed(parsed.identifiers)
      setCsvMeta(parsed.meta)
    } else {
      setLastParsed(parseManualInput(content))
      setCsvMeta(null)
    }
    processManualInput(content, isCSV)
    setText(content.substring(0, 200) + (content.length > 200 ? '...' : ''))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const findInstrument = (id: ParsedIdentifier) => {
    const norm = id.normalized.toUpperCase()
    const normalizeWkn = (v?: string) => (v || '').replace(/^0+/, '').toUpperCase()
    return state.instruments.find((inst) => {
      if (id.type === 'ISIN') return inst.isin === norm
      if (id.type === 'WKN') return normalizeWkn(inst.wkn) === normalizeWkn(norm)
      const mnemonic = inst.mnemonic?.toUpperCase()
      const yahooBase = inst.yahooTicker?.split('.')[0]?.toUpperCase()
      return mnemonic === norm || yahooBase === norm
    })
  }

  const jumpTo = (isin: string) => {
    const el = document.getElementById(`row-${isin}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.click()
      return
    }
    // If this is a dedup candidate, jump to the winner row and expand
    const candidate = state.instruments.find((i) => i.isin === isin)
    if (candidate?.dedupGroup) {
      const winner = state.instruments.find((i) => i.dedupGroup === candidate.dedupGroup && i.isDedupWinner)
      if (winner) {
        const winEl = document.getElementById(`row-${winner.isin}`)
        if (winEl) {
          winEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
          winEl.click()
        }
      }
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`relative rounded border transition-colors ${
          isDragging ? 'border-accent bg-accent/5' : 'border-border bg-bg'
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          className="w-full h-32 bg-transparent text-gray-300 font-mono text-xs p-3 resize-none outline-none placeholder:text-muted"
          spellCheck={false}
        />
        {text && (
          <button
            onClick={() => setText('')}
            className="absolute top-2 right-2 text-muted hover:text-gray-300 p-1"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleLoad}
          disabled={!text.trim() || isLoading}
          className="flex items-center gap-1.5 btn btn-accent text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Play size={11} />
          Load
        </button>

        <button
          onClick={() => fileRef.current?.click()}
          disabled={isLoading}
          className="flex items-center gap-1.5 btn btn-muted bg-surface text-xs disabled:opacity-40"
        >
          <Upload size={11} />
          CSV
        </button>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
      </div>

      {lastParsed.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[11px] font-mono text-gray-300">
          {lastParsed.map((p) => {
            const inst = findInstrument(p)
            return (
              <div key={`${p.type}:${p.normalized}`} className="flex items-center gap-1.5 px-2 py-1 bg-surface border border-border rounded">
                <span className="text-muted">{p.raw}</span>
                {inst ? (
                  <button
                    onClick={() => jumpTo(inst.isin)}
                    className="text-accent hover:text-accent/80"
                  >
                    Jump
                  </button>
                ) : (
                  <span className="text-muted">…</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {csvMeta && (csvMeta.warnings.length > 0 || csvMeta.skipped > 0) && (
        <div className="text-[11px] font-mono text-amber-300">
          CSV: {csvMeta.accepted} accepted / {csvMeta.total} rows, {csvMeta.skipped} skipped
        </div>
      )}
    </div>
  )
}
