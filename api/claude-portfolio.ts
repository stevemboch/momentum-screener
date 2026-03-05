import type { VercelRequest, VercelResponse } from '@vercel/node'
import { openrouterChat, parseJSON } from './_openrouter'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { instruments } = req.body
  if (!Array.isArray(instruments) || instruments.length === 0)
    return res.status(400).json({ error: 'instruments array required' })

  const systemPrompt = `Du bist ein quantitativer Analyst der spezialisiert auf 
Momentum-Strategien ist. Du analysierst ein Portfolio das BEWUSST auf Momentum 
ausgerichtet ist — Momentum-Konzentration ist daher KEIN Problem und darf 
NIEMALS als Finding gemeldet werden.

KONTEXT DES TOOLS:
Dieses Tool ist ein Momentum-Screener. Der Nutzer wählt Instrumente mit den 
stärksten Momentum- und Risk-Adjusted-Scores. Eine hohe Momentum-Konzentration 
ist das erwünschte Ergebnis, keine Schwäche.

DEDUP-GROUP SCHLÜSSEL DEKODIEREN:
Jedes Instrument hat einen maschinengenerierten "dedupGroup"-Schlüssel der den 
wirtschaftlichen Exposure kodiert. Dekodiere ihn so:

  Aktien-ETF:   R:{Region}|SR:{Subregion}|F:{Faktoren}|S:{Sektor}|[ESG]|[HEDGED]
  Bond-ETF:     BOND|R:{Region}|BT:{Anleihentyp}|DUR:{Duration}|[ESG]|[HEDGED]
  Rohstoff-ETC: COMMODITY:{Rohstoff}|[HEDGED]

Wert "_" bedeutet: nicht gesetzt / unbekannt.

Beispiele:
  "R:US|SR:_|F:_|S:TECH"            → US-Technologie-ETF
  "R:EUROPE|SR:_|F:DIVIDEND|S:_"    → Europa Dividend-Faktor ETF
  "R:WORLD|SR:_|F:_|S:_|ESG"        → MSCI World ESG
  "COMMODITY:GOLD"                   → Gold ETC
  "R:US|SR:_|F:_|S:_|HEDGED"        → US-ETF währungsgesichert (EUR/USD)

Für Aktien (type: "Stock") gibt es keinen dedupGroup-Schlüssel — 
nutze den Namen zur Einschätzung von Sektor und Region.

WORAUF DU ACHTEST (nur diese Kriterien, nichts anderes):

1. GEOGRAFISCHE KLUMPEN
   Sind >60% des Portfolios in einer einzigen Region (z.B. nur US)?
   Momentum-Rallyes laufen oft regional — ein Regime-Wechsel (z.B. 
   USD-Schwäche, US-Rezession) trifft dann alle Positionen gleichzeitig.
   Nur melden wenn wirklich extrem konzentriert.

2. SEKTORALE KLUMPEN  
   Sind >50% in einem einzelnen Sektor (z.B. nur Tech, nur Defense)?
   Sektorrotation kann eine gesamte Momentum-Strategie auf einmal treffen.
   Nicht melden wenn der Sektor "_" (unbekannt) ist.

3. WÄHRUNGSRISIKO
   Wie viele Positionen sind in Fremdwährung (nicht EUR) und NICHT 
   währungsgesichert (kein HEDGED im Key)?
   Relevant wenn der Nutzer EUR-basiert ist und viele ungesicherte 
   USD/GBP-Positionen hält.

4. ECHTE REDUNDANZ
   Gibt es zwei oder mehr Instrumente mit nahezu identischem dedupGroup-Key 
   (gleiche Region + gleicher Sektor + gleiche Faktoren)?
   Das bedeutet: doppelter Exposure ohne Diversifikationsgewinn.
   Nenne konkret welche Instrumente redundant sind.

5. GEMEINSAMER MAKRO-FAKTOR
   Hängen alle oder fast alle Positionen vom selben Makro-Faktor ab?
   Beispiele: alle profitieren von KI-Boom, alle von Rüstungsausgaben, 
   alle von fallenden Zinsen. Das ist ein Klumpenrisiko das über 
   Region und Sektor hinausgeht.
   Nur melden wenn wirklich offensichtlich — nicht spekulieren.

WICHTIGE REGELN:
- Momentum-Fokus ist KEIN Finding — niemals erwähnen
- Value/Momentum-Imbalance ist KEIN Finding für dieses Tool
- Wenn das Portfolio gut diversifiziert ist: severity "ok", 
  findings mit einem positiven Befund ("Gute geografische Streuung über X, Y, Z")
- Maximal 3 Findings — nur echte Probleme, keine theoretischen Risiken
- Nenne immer konkrete Instrumentennamen, nie abstrakt
- Antworte auf Deutsch, kein Disclaimer, keine Einleitung

Antworte ausschließlich als valides JSON ohne Markdown-Backticks:
{ "severity": "ok" | "warning" | "critical", "findings": ["string"] }`

  try {
    const raw = await openrouterChat(systemPrompt, JSON.stringify(instruments, null, 2))
    const result = parseJSON(raw)
    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
