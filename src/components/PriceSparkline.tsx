import React, { useMemo } from 'react'

interface PriceSparklineProps {
  closes: number[] | undefined
  width?: number
  height?: number
}

export const PriceSparkline = React.memo(({ closes, width = 80, height = 24 }: PriceSparklineProps) => {
  const points = useMemo(() => {
    if (!closes || closes.length < 2) return null

    // Get last 6 months (approx 125 trading days)
    const data = closes.slice(-125)
    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min

    if (range === 0) return null

    return data.map((val, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((val - min) / range) * height
      return `${x},${y}`
    }).join(' ')
  }, [closes, width, height])

  if (!points || !closes || closes.length < 2) {
    return <div style={{ width, height }} className="bg-surface2/30 rounded" />
  }

  const first = closes[Math.max(0, closes.length - 125)]
  const last = closes[closes.length - 1]
  const isPositive = last >= first
  const strokeColor = isPositive ? '#4ade80' : '#f87171' // green-400 : red-400

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  )
})

PriceSparkline.displayName = 'PriceSparkline'
