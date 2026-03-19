import type { Instrument } from '../types'

export function generateTfaSummary(inst: Instrument): string {
  const name = inst.displayName ?? inst.yahooTicker
  const phase = inst.tfaPhase
  const scenario = inst.tfaScenario

  // ── Hilfsfunktionen ────────────────────────────────────────────────────────

  const fmtPct = (v: number | null | undefined) =>
    v != null ? `${Math.abs(v * 100).toFixed(0)}%` : null

  const drawdown =
    scenario === '7y' ? fmtPct(inst.drawFrom7YHigh)
      : scenario === '5y' ? fmtPct(inst.drawFrom5YHigh)
        : fmtPct(inst.drawFromHigh)

  const drawdownLabel =
    scenario === '7y' ? '7-Jahres-Hoch'
      : scenario === '5y' ? '5-Jahres-Hoch'
        : '52-Wochen-Hoch'

  const crossMA = inst.maCrossover?.risingMa?.toUpperCase()
  const crossDays = inst.tfaCrossoverDaysAgo

  // Nächster MA über dem Kurs (für Monitoring)
  const lastClose = inst.closes?.[inst.closes.length - 1]
  let nearestMA: string | null = null
  let nearestPct: string | null = null
  if (lastClose != null) {
    const candidates = [
      { label: 'MA50', val: inst.ma50 },
      { label: 'MA100', val: inst.ma100 },
      { label: 'MA200', val: inst.ma200 },
    ].filter((c) => c.val != null && lastClose < (c.val as number))
    if (candidates.length > 0) {
      const nearest = candidates.reduce((a, b) =>
        Math.abs((a.val as number) - lastClose) < Math.abs((b.val as number) - lastClose) ? a : b
      )
      nearestMA = nearest.label
      nearestPct = `${(((nearest.val as number) - lastClose) / lastClose * 100).toFixed(1)}%`
    }
  }

  // Fundamentals kurz
  const pb = inst.pb != null ? `KBV ${inst.pb.toFixed(1)}` : null
  const upside = (() => {
    const tp = inst.targetPriceAdj ?? inst.targetPrice
    if (tp != null && lastClose != null && lastClose > 0) {
      const u = ((tp - lastClose) / lastClose * 100).toFixed(0)
      if (u === '0') return 'Kursziel 0%'
      return u.startsWith('-') ? `Kursziel ${u}%` : `Kursziel +${u}%`
    }
    return null
  })()

  // Gemini-Signale kurz
  const catalyst = inst.tfaCatalyst
  const topSignal = (() => {
    if (!catalyst) return null
    const signals: { label: string; val: number; conf: string }[] = [
      { label: 'Earnings Beat', val: catalyst.earningsBeatRecent?.value ?? 0, conf: catalyst.earningsBeatRecent?.confidence ?? 'not_found' },
      { label: 'Guidance erhöht', val: catalyst.guidanceRaised?.value ?? 0, conf: catalyst.guidanceRaised?.confidence ?? 'not_found' },
      { label: 'Analyst-Upgrade', val: catalyst.analystUpgrade?.value ?? 0, conf: catalyst.analystUpgrade?.confidence ?? 'not_found' },
      { label: 'Insider-Kauf', val: catalyst.insiderBuying?.value ?? 0, conf: catalyst.insiderBuying?.confidence ?? 'not_found' },
      { label: 'Restrukturierung', val: catalyst.restructuring?.value ?? 0, conf: catalyst.restructuring?.confidence ?? 'not_found' },
    ]
      .filter((s) => s.conf !== 'not_found' && s.val > 0)
      .sort((a, b) => b.val - a.val)
    if (signals.length === 0) return null
    const best = signals[0]
    const confLabel = best.conf === 'high' ? 'bestätigt'
      : best.conf === 'medium' ? 'wahrscheinlich' : 'möglicherweise'
    return `${best.label} ${confLabel}`
  })()

  // ── Phasen-spezifische Texte ───────────────────────────────────────────────

  if (phase === 'none') {
    if (inst.tfaRejectReason?.includes('Marktkapitalisierung')) {
      return `${name}: Zu klein für zuverlässige Daten (unter 50 Mio. Marktkapitalisierung).`
    }
    if (inst.tfaRejectReason?.includes('Zombie')) {
      return `${name}: Strukturelles Problem — sehr niedrige Profitabilität bei günstiger Bewertung.`
    }
    return `${name}: Kein TFA-Setup erkennbar.`
  }

  if (phase === 'monitoring') {
    // Sonderfall: vorher qualifiziert, Cross abgelaufen
    if (inst.tfaFetched && inst.tfaRejectReason?.includes('abgelaufen')) {
      return `${name}: Cross abgelaufen — Kurs unter MA zurückgefallen. Kandidat bleibt auf Watchlist.`
    }
    const parts: string[] = []
    if (drawdown && drawdownLabel) {
      parts.push(`${drawdown} unter dem ${drawdownLabel}`)
    }
    if (nearestMA && nearestPct) {
      parts.push(`noch ${nearestPct} bis ${nearestMA}-Ausbruch`)
    } else {
      parts.push('kein Ausbruchssignal bisher')
    }
    const fundParts = [pb, upside].filter(Boolean)
    if (fundParts.length > 0) parts.push(fundParts.join(', '))
    return `${name}: ${parts.join(' — ')}.`
  }

  if (phase === 'above_all_mas') {
    const parts: string[] = []
    if (drawdown) parts.push(`${drawdown} Rückgang`)
    parts.push('bereits über MA50/100/200')
    const fundParts = [pb, upside].filter(Boolean)
    if (fundParts.length > 0) parts.push(fundParts.join(', '))
    parts.push('Ausbruch bereits vollzogen — Einstieg mit Vorsicht')
    return `${name}: ${parts.join(' — ')}.`
  }

  if (phase === 'watch') {
    const parts: string[] = []
    if (drawdown) parts.push(`${drawdown} Rückgang`)
    if (crossMA) {
      parts.push(`${crossMA}-Ausbruch vor ${crossDays ?? '?'} Tag${crossDays === 1 ? '' : 'en'}`)
    }
    if (!inst.analystFetched) {
      parts.push('Fundamentaldaten werden geladen')
    } else {
      const fundParts = [pb, upside].filter(Boolean)
      if (fundParts.length > 0) parts.push(fundParts.join(', '))
    }
    return `${name}: ${parts.join(' — ')}.`
  }

  if (phase === 'fetching') {
    const parts: string[] = []
    if (drawdown) parts.push(`${drawdown} Rückgang`)
    if (crossMA) parts.push(`${crossMA}-Ausbruch`)
    parts.push('Katalysatoren werden geprüft...')
    return `${name}: ${parts.join(' — ')}.`
  }

  if (phase === 'qualified') {
    const parts: string[] = []
    if (drawdown) parts.push(`${drawdown} Rückgang`)
    if (crossMA) {
      parts.push(`${crossMA}-Ausbruch vor ${crossDays ?? '?'} Tag${crossDays === 1 ? '' : 'en'}`)
    }
    const fundParts = [pb, upside].filter(Boolean)
    if (fundParts.length > 0) parts.push(fundParts.join(', '))
    if (topSignal) parts.push(topSignal)
    else if (inst.tfaEScore == null) parts.push('Gemini: keine Daten')
    else if (inst.tfaEScore < 0.2) parts.push('keine starken Katalysatoren gefunden')
    return `${name}: ${parts.join(' — ')}.`
  }

  if (phase === 'rejected') {
    return `${name}: Abgelehnt — ${inst.tfaRejectReason ?? 'Kriterien nicht erfüllt'}.`
  }

  if (phase === 'ko') {
    const koSource = catalyst?.koRisk?.source
    return `${name}: KO-Risiko erkannt${koSource ? ` (${koSource})` : ''}.`
  }

  return `${name}: Status unbekannt.`
}
