import { useState, useRef } from 'react'
import { Upload, Play, X } from 'lucide-react'
import { usePipeline } from '../hooks/usePipeline'
import { useAppState } from '../store'

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
  const fileRef = useRef<HTMLInputElement>(null)
  const { processManualInput } = usePipeline()
  const { state } = useAppState()
  const isLoading = ['openfigi', 'prices', 'justetf'].includes(state.fetchStatus.phase)

  const handleLoad = () => {
    if (!text.trim() || isLoading) return
    processManualInput(text, false)
  }

  const handleFile = async (file: File) => {
    const content = await file.text()
    const isCSV = file.name.endsWith('.csv') || file.type.includes('csv')
    processManualInput(content, isCSV)
    setText(content.substring(0, 200) + (content.length > 200 ? '...' : ''))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
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
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 border border-accent/30 text-accent text-xs font-mono font-semibold rounded hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Play size={11} />
          Load
        </button>

        <button
          onClick={() => fileRef.current?.click()}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border text-muted text-xs font-mono rounded hover:text-gray-300 hover:border-gray-500 disabled:opacity-40 transition-colors"
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
    </div>
  )
}
