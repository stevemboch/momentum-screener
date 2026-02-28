import type { Instrument } from '../types'

// ─── Provider Detection ───────────────────────────────────────────────────────

const PROVIDERS: { prefix: string; priority: number }[] = [
  { prefix: 'ISHARES', priority: 1 },
  { prefix: 'VANGUARD', priority: 2 },
  { prefix: 'AMUNDI', priority: 3 },
  { prefix: 'LYXOR', priority: 3 },
  { prefix: 'XTRACKERS', priority: 4 },
  { prefix: 'SPDR', priority: 5 },
  { prefix: 'INVESCO', priority: 6 },
  { prefix: 'UBS', priority: 7 },
  { prefix: 'DEKA', priority: 8 },
  { prefix: 'HSBC', priority: 9 },
  { prefix: 'WISDOMTREE', priority: 10 },
  { prefix: 'VANECK', priority: 11 },
  { prefix: 'PIMCO', priority: 12 },
  { prefix: 'FIDELITY', priority: 13 },
  { prefix: 'BLACKROCK', priority: 14 },
  { prefix: 'STATESTREET', priority: 15 },
  { prefix: 'DIMENSIONAL', priority: 16 },
  { prefix: 'OSSIAM', priority: 17 },
  { prefix: 'FLOSSBACH', priority: 18 },
  { prefix: 'DWS', priority: 19 },
  { prefix: 'GLOBAL X', priority: 20 },
  { prefix: 'GLOBALX', priority: 20 },
  { prefix: 'FRANKLIN', priority: 21 },
  { prefix: 'LGIM', priority: 22 },
  { prefix: 'ABRDN', priority: 23 },
  { prefix: 'NOMURA', priority: 24 },
  { prefix: 'TABULA', priority: 25 },
]

const PROVIDER_ALIASES: [string, string][] = [
  ['ISHARES', 'ISHARES'],
  ['ISHS', 'ISHARES'],
  ['ISH', 'ISHARES'],
  ['IS ', 'ISHARES'],
  ['SS SPDR', 'SPDR'],
  ['SS ', 'SPDR'],
  ['SSGA', 'SPDR'],
  ['XTRACKERS', 'XTRACKERS'],
  ['XTRK', 'XTRACKERS'],
  ['XTRAC', 'XTRACKERS'],
  ['XTR', 'XTRACKERS'],
  ['X ', 'XTRACKERS'],
  ['LYXOR', 'LYXOR'],
  ['LYX', 'LYXOR'],
  ['AMUNDI', 'AMUNDI'],
  ['VANECK', 'VANECK'],
  ['WISDOMTREE', 'WISDOMTREE'],
  ['WT ', 'WISDOMTREE'],
  ['FRANKLIN', 'FRANKLIN'],
  ['FRK', 'FRANKLIN'],
  ['FTGF', 'FRANKLIN'],
  ['INVESCO', 'INVESCO'],
  ['INV', 'INVESCO'],
  ['GLX', 'GLOBALX'],
  ['VANGUARD', 'VANGUARD'],
  ['VAN', 'VANGUARD'],
  ['SPDR', 'SPDR'],
  ['UBS', 'UBS'],
  ['DEKA', 'DEKA'],
  ['HSBC', 'HSBC'],
  ['PIMCO', 'PIMCO'],
  ['LGIM', 'LGIM'],
]

// ─── Constants for Classification ───────────────────────────────────────────

const SECTOR_TERMS = new Set([
  'BASICRESOURCES', 'SEMICONDUCTOR', 'UTILITIES', 'HEALTHCARE', 'FINANCIALS',
  'CONSUMER', 'DISCRETIONARY', 'INDUSTRIALS', 'TECHNOLOGY', 'REALESTATE',
  'COMMUNICATIONS', 'ENERGY', 'MATERIALS', 'CYBERSECURITY', 'ROBOTICS',
  'WATER', 'CLEANENERGY', 'FUTUREMOBILITY', 'CLOUDCOMPUTING', 'BIOTECHNOLOGY',
  'PHARMACEUTICALS'
]);

const GEOGRAPHIC_TERMS = new Set([
  'GLOBAL', 'WORLD', 'INTERNATIONAL', 'EUROPE', 'AMERICA', 'ASIAPACIFIC', 'LATINAMERICA',
  'EMERGINGMARKETS', 'FRANCE', 'GERMANY', 'USA', 'UK', 'JAPAN', 'CHINA', 'INDIA',
  'CANADA', 'SWITZERLAND', 'IRELAND', 'FRONTIERMARKETS', 'EMERGINGASIA', 'ASIAEXJAPAN',
  'EUROPEEXUK', 'NORTHAMERICA', 'WORLDEXUS', 'PACIFICEXJAPAN', 'SOUTHEASTASIA',
  'EUROZONE', 'NORDIC'
]);

const STRATEGY_TERMS = new Set([
  'MINIMUMVOLATILITY', 'MINIMUMVARIANCE', 'LOWVOLATILITY', 'EQUALWEIGHT', 'GOVERNMENTBOND',
  'CORPORATEBOND', 'AGGREGATEBOND', 'BOND', 'EQUITY', 'MINERS', 'GOLDMINERS',
  'SILVERMINERS', 'HIGHYIELD', 'SHORTTERM', 'MIDTERM', 'LONGTERM', 'CONVERTIBLEBOND',
  'INFLATIONLINKED', 'SUSTAINABLEBOND', 'DEVELOPED', 'DIVIDEND', 'GROWTH', 'VALUE',
  'SMALLCAP', 'MIDCAP', 'LARGECAP', 'MEGACAP'
]);

const INDEX_IDENTIFIERS = new Set([
  'SP500', 'EUROSTOXX50', 'STOXX600', 'TECDAX', 'DAX', 'MDAX', 'SDAX', 'UST', 'SPTSX',
  'FTSEMIB', 'CAC40', 'IBEX35', 'ASX200', 'NIKKEI225', 'HANGSENGCHINA', 'CSI300',
  'KOSPI', 'SENSEX', 'MOEX', 'XETRA', 'RUSSELL2000', 'RUSSELL1000', 'NASDAQ100', 'DOWJONES'
]);

// ─── Abbreviation Expansion ───────────────────────────────────────────────────

const ABBREV: [string, string][] = [
  ["S&P 500", "SP500"],
  ["S&P500", "SP500"],
  ["SPTSE", "SPTSX"],
  ["ESTX50", "EUROSTOXX50"],
  ["EX600", "STOXX600"],
  ["EURSTX", "EUROSTOXX"],
  ["USTREASURY", "UST"],
  ["TRESURY", "UST"],
  ["TREASURY", "UST"],
  ["BASICRESOURCE", "BASICRESOURCES"],
  ["SEMICNDCT", "SEMICONDUCTOR"],
  ["HLTHCARE", "HEALTHCARE"],
  ["FINANCIALS", "FINANCIALS"],
  ["INDUSTRIALS", "INDUSTRIALS"],
  ["REALESTATE", "REALESTATE"],
  ["TECHNOLOGY", "TECHNOLOGY"],
  ["COMMUNICATIONS", "COMMUNICATIONS"],
  ["UTILITIES", "UTILITIES"],
  ["CONSUMERDISCRETIONARY", "CONSUMERDISCRETIONARY"],
  ["CONSUMERSTAPLES", "CONSUMERSTAPLES"],
  ["ENERGY", "ENERGY"],
  ["MATERIALS", "MATERIALS"],
  ["CYBERSECURITY", "CYBERSECURITY"],
  ["ROBOTICS", "ROBOTICS"],
  ["AI", "ARTIFICIALINTELLIGENCE"],
  ["WATER", "WATER"],
  ["CLEANENERGY", "CLEANENERGY"],
  ["FUTUREMOBILITY", "FUTUREMOBILITY"],
  ["CLOUDCOMPUTING", "CLOUDCOMPUTING"],
  ["BIOTECH", "BIOTECHNOLOGY"],
  ["PHARMA", "PHARMACEUTICALS"],
  ["GLOBAL", "GLOBAL"],
  ["WORLD", "WORLD"],
  ["EUROPE", "EUROPE"],
  ["USA", "USA"],
  ["US", "USA"],
  ["AMERICA", "AMERICA"],
  ["CANADA", "CANADA"],
  ["JAPAN", "JAPAN"],
  ["CHINA", "CHINA"],
  ["INDIA", "INDIA"],
  ["EMERGINGMARKETS", "EMERGINGMARKETS"],
  ["LATINAMERICA", "LATINAMERICA"],
  ["ASIAPACIFIC", "ASIAPACIFIC"],
  ["ASIA", "ASIA"],
  ["PACIFIC", "PACIFIC"],
  ["GERMANY", "GERMANY"],
  ["FRANCE", "FRANCE"],
  ["UK", "UK"],
  ["UNITEDKINGDOM", "UK"],
  ["SWITZERLAND", "SWITZERLAND"],
  ["IRELAND", "IRELAND"],
  ["PHYSICAL", "PHYSICAL"],
  ["MINERS", "MINERS"],
  ["GOLDMINERS", "GOLDMINERS"],
  ["SILVERMINERS", "SILVERMINERS"],
  ["MINVOL", "MINIMUMVOLATILITY"],
  ["MINVAR", "MINIMUMVARIANCE"],
  ["LOWVOL", "LOWVOLATILITY"],
  ["EQWT", "EQUALWEIGHT"],
  ["GOVERNMENTBOND", "GOVERNMENTBOND"],
  ["CORPORATEBOND", "CORPORATEBOND"],
  ["HIGHYIELD", "HIGHYIELD"],
  ["SHORTTERM", "SHORTTERM"],
  ["MIDTERM", "MIDTERM"],
  ["LONGTERM", "LONGTERM"],
  ["AGGREGATEBOND", "AGGREGATEBOND"],
  ["CONVERTIBLEBOND", "CONVERTIBLEBOND"],
  ["INFLATIONLINKED", "INFLATIONLINKED"],
  ["SUSTAINABLEBOND", "SUSTAINABLEBOND"],
  ["DEVELOPED", "DEVELOPED"],
  ["DIVIDEND", "DIVIDEND"],
  ["GROWTH", "GROWTH"],
  ["VALUE", "VALUE"],
  ["SMALLCAP", "SMALLCAP"],
  ["MIDCAP", "MIDCAP"],
  ["LARGESTOCKS", "LARGECAP"],
  ["MEGACAP", "MEGACAP"],
  ["FRONTIERMARKETS", "FRONTIERMARKETS"],
  ["EMERGINGASIA", "EMERGINGASIA"],
  ["ASIAEXJAPAN", "ASIAEXJAPAN"],
  ["EUROPEEXUK", "EUROPEEXUK"],
  ["NORTHAMERICA", "NORTHAMERICA"],
  ["WORLDEXUS", "WORLDEXUS"],
  ["PACIFICEXJAPAN", "PACIFICEXJAPAN"],
  ["SOUTHEASTASIA", "SOUTHEASTASIA"],
  ["FRONTIER", "FRONTIERMARKETS"],
  ["EUROZONE", "EUROZONE"],
  ["PANEUROPE", "EUROPE"],
  ["NORDIC", "NORDIC"],
  ["SRI", "SRI"],
  ["ESG", "ESG"],
  ["RUSSELL2000", "RUSSELL2000"],
  ["RUSSEL1000", "RUSSELL1000"],
  ["NASDAQ100", "NASDAQ100"],
];

const STRIP_WORDS = new Set([
  "UCITS", "ETF", "ETC", "ETP", "SWAP", "DR", "ACC", "DIST", "DISTRIBUTING",
  "ACCUMULATING", "CLASS", "SHARE", "SHARES", "FUND", "TRUST", "UNITS",
  "1C", "2C", "3C", "4C", "5C", "1D", "2D", "3D", "A", "B", "C", "D", "E",
  "DAILY", "MONTHLY", "QUARTERLY", "ANNUAL",
  "THE", "AN", "OF", "FOR", "AND", "WITH", "IN", "ON", "AT", "BY", "TO",
  "SICAV", "IBOXX", "JPMORGAN", "DE", "IE", "LU", "FR", "CH", "AT", "NL", "BE", "GB",
  "US", "CA", "JP", "CN", "EUROPE", "EUROPEAN", "CORE", "PRIME", "PLUS",
  "SELECT", "OPTIMAL", "ENHANCED", "QUALITY", "IMI", "LARGE", "MID", "SMALL",
  "CAP", "MEGA", "MICRO", "SCREENED", "LEADERS", "FILTERED", "FOCUSED",
  "UNIVERSAL", "BROAD", "NET", "TOTAL", "RETURN", "TR", "NR", "GR", "PR",
  "MARKET", "INDEX", "IDX", "ORDINARY", "VIRTUS", "OPPENHEIMER", "DEUTSCHE",
  ...PROVIDERS.map((p) => p.prefix.split(" ")[0]),
]);

// ─── Commodity Detection ──────────────────────────────────────────────────────

const COMMODITIES: { commodity: string; terms: string[] }[] = [
  { commodity: "GOLD", terms: ["GOLD", "XAU", "GOLDBARREN"] },
  { commodity: "SILVER", terms: ["SILVER", "XAG", "SILBER"] },
  { commodity: "PLATINUM", terms: ["PLATINUM", "XPT", "PLATIN"] },
  { commodity: "PALLADIUM", terms: ["PALLADIUM", "XPD"] },
  { commodity: "COPPER", terms: ["COPPER", "KUPFER"] },
  { commodity: "NICKEL", terms: ["NICKEL"] },
  { commodity: "ZINC", terms: ["ZINC", "ZINK"] },
  { commodity: "TIN", terms: ["TIN", "ZINN"] },
  { commodity: "ALUMINIUM", terms: ["ALUMINIUM", "ALUMINUM"] },
  { commodity: "COBALT", terms: ["COBALT"] },
  { commodity: "LITHIUM", terms: ["LITHIUM"] },
  { commodity: "OIL", terms: ["CRUDE OIL", "BRENT", "WTI", "PETROLEUM"] },
  { commodity: "GAS", terms: ["NATURAL GAS", "NAT GAS"] },
  { commodity: "WHEAT", terms: ["WHEAT", "WEIZEN"] },
  { commodity: "CORN", terms: ["CORN", "MAIS"] },
  { commodity: "SOYBEANS", terms: ["SOYBEAN", "SOYA"] },
  { commodity: "CARBON", terms: ["CARBON", "CO2", "EMISSION"] },
  { commodity: "PRECIOUS", terms: ["PRECIOUS METALS", "PRECIOUS MET"] },
  { commodity: "INDUSTRIALMETALS", terms: ["INDUSTRIAL METALS", "IND METALS"] },
  { commodity: "AGRICULTURE", terms: ["AGRICULTURE", "AGRICULTURAL"] },
  { commodity: "LIVESTOCK", terms: ["LIVESTOCK"] },
  { commodity: "BASKET", terms: ["BLOOMBERG COMMODITY", "BROAD COMMODITY", "DIVERSIFIED COMMODITY", "RICI", "COMMODITY"] },
];

const COMMODITY_MODS: { key: string; terms: string[] }[] = [
  { key: "HEDGED", terms: ["HEDGED", "HDG", "HDGD", "CURRENCY HEDGED"] },
  { key: "2X", terms: ["2X", "2EX", "DOUBLE LONG", "DAILY 2X"] },
  { key: "SHORT", terms: ["SHORT", "INVERSE", "-1X", "DAILY SHORT"] },
  { key: "MINERS", terms: ["MINERS", "MINING", "MINE"] },
];

function detectCommodity(upper: string): { commodity: string; mods: string } | null {
  let found: string | null = null;
  for (const { commodity, terms } of COMMODITIES) {
    for (const term of terms) {
      const regex = new RegExp(`\\b${term}\\b`, "i");
      if (regex.test(upper)) { found = commodity; break; }
    }
    if (found) break;
  }
  if (!found) return null;

  const mods: string[] = [];
  for (const { key, terms } of COMMODITY_MODS) {
    for (const term of terms) {
      const regex = new RegExp(`\\b${term}\\b`, "i");
      if (regex.test(upper)) { mods.push(key); break; }
    }
  }

  return { commodity: found, mods: mods.join("|") };
}

// ─── Provider Strip & Detection ──────────────────────────────────────────────

function stripAndDetectProvider(name: string): { stripped: string; priority: number } {
  const upper = name.toUpperCase();
  let bestMatch: { alias: string; canonical: string; priority: number } | null = null;

  for (const [alias, canonical] of PROVIDER_ALIASES) {
    const regex = new RegExp(`^${alias}\\b|\\b${alias}\\b`, "g");
    if (regex.test(upper)) {
      const prov = PROVIDERS.find((p) => p.prefix === canonical);
      if (prov) {
        if (!bestMatch || alias.length > bestMatch.alias.length) {
          bestMatch = { alias, canonical, priority: prov.priority };
        }
      }
    }
  }

  if (bestMatch) {
    const stripped = upper.replace(new RegExp(`\\b${bestMatch.alias}\\b`, 'g'), '').trim();
    return { stripped: stripped.replace(/^[-\\s]+/, ''), priority: bestMatch.priority };
  }
  return { stripped: name, priority: 99 };
}

// ─── Abbreviation Expansion ───────────────────────────────────────────────────

function expandAbbreviations(name: string): string {
  let result = name.toUpperCase();
  for (const [abbr, expansion] of ABBREV) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'g');
    result = result.replace(regex, expansion);
  }
  return result;
}

// ─── Tokenization and Noise Filtering ───────────────────────────────────────

const EXCLUDED_TERMS_REGEX = new RegExp([
  "UCITS", "ETF", "ETC", "ETP", "SWAP", "DR", "ACC", "DIST", "DISTRIBUTING",
  "ACCUMULATING", "CLASS", "SHARE", "SHARES", "FUND", "TRUST", "UNITS",
  "1C", "2C", "3C", "4C", "5C", "1D", "2D", "3D", "A", "B", "C", "D", "E",
  "DAILY", "MONTHLY", "QUARTERLY", "ANNUAL",
  "THE", "AN", "OF", "FOR", "AND", "WITH", "IN", "ON", "AT", "BY", "TO",
  "SICAV", "MSCI", "FTSE", "SP", "STOXX", "BLOOMBERG", "SOLACTIVE",
  "RUSSELL", "NASDAQ", "DJ", "DOWJONES", "NIKKEI", "CSI", "TOPIX", "HANGSENG",
  "IBOXX", "JPMORGAN", "DE", "IE", "LU", "FR", "CH", "AT", "NL", "BE", "GB",
  "US", "CA", "JP", "CN", "EUROPE", "EUROPEAN", "CORE", "PRIME", "PLUS",
  "SELECT", "OPTIMAL", "ENHANCED", "QUALITY", "IMI", "LARGE", "MID", "SMALL",
  "CAP", "MEGA", "MICRO", "SCREENED", "LEADERS", "FILTERED", "FOCUSED",
  "UNIVERSAL", "BROAD", "NET", "TOTAL", "RETURN", "TR", "NR", "GR", "PR",
  "MARKET", "INDEX", "IDX", "ORDINARY", "VIRTUS", "OPPENHEIMER", "DEUTSCHE",
  ...PROVIDERS.map((p) => p.prefix.split(" ")[0]),
].map(t => `\\b${t}\\b`).join("|"), "i");

const CURRENCY_CODES = new Set([
  "USD", "EUR", "GBP", "CHF", "JPY", "SEK", "DKK", "NOK", "AUD", "CAD", "HKD", "SGD", "MXN",
]);

function tokenizeAndFilter(text: string): string[] {
  return text.split(/[\\s\\-\\/\\(\\)\\,\\.]+/)
    .map(w => w.trim().toUpperCase())
    .filter((w) => {
      if (!w || w.length < 2) return false;
      if (EXCLUDED_TERMS_REGEX.test(w)) return false;
      if (/^\\d{1,2}$/.test(w)) return false;
      if (/^[A-Z]\\d+$/.test(w)) return false;
      if (/^\\d+(MO|YR|Y|M)$/.test(w)) return false;
      if (CURRENCY_CODES.has(w)) return false;
      return true;
    });
}

// ─── Overlay Detection ────────────────────────────────────────────────────────

const ESG_TERMS = [
  "ESG", "SRI", "PAB", "CTB", "CLIMATE", "SUSTAINABLE",
  "RESPONSIBLE", "GREEN", "IMPACT", "LOW CARBON", "NET ZERO", "PARIS ALIGNED",
  "FOSSIL FUEL FREE",
];
const HEDGED_TERMS = [
  "HEDGED", "HDG", "HDGD", "CURRENCY HEDGED", "EUR HEDGED", "USD HEDGED",
  "GBP HEDGED", "CHF HEDGED",
];

// ─── Exposure Key ────────────────────────────────────────────────────────────

function extractExposureKey(instrument: Instrument): string {
  const rawName = instrument.longName || instrument.displayName || "";
  const upperName = rawName.toUpperCase();

  const { stripped } = stripAndDetectProvider(upperName);
  const expanded = expandAbbreviations(stripped);

  const commodity = detectCommodity(expanded);
  if (commodity) {
    return commodity.mods
      ? `COMMODITY|${commodity.commodity}|${commodity.mods}`
      : `COMMODITY|${commodity.commodity}`;
  }

  let esg = "";
  for (const t of ESG_TERMS) {
    const regex = new RegExp(`\\b${t}\\b`, "i");
    if (regex.test(expanded)) { esg = "ESG"; break; }
  }

  let hedged = "";
  for (const t of HEDGED_TERMS) {
    const regex = new RegExp(`\\b${t}\\b`, "i");
    if (regex.test(expanded)) { hedged = "HEDGED"; break; }
  }

  const words = tokenizeAndFilter(expanded);
  const dimensions: Set<string> = new Set();

  words.forEach((w) => {
    if (INDEX_IDENTIFIERS.has(w)) dimensions.add(w);
    if (SECTOR_TERMS.has(w)) dimensions.add(w);
    if (GEOGRAPHIC_TERMS.has(w)) dimensions.add(w);
    if (STRATEGY_TERMS.has(w)) dimensions.add(w);
    
    const isKnownDimension = INDEX_IDENTIFIERS.has(w) || SECTOR_TERMS.has(w) || 
                             GEOGRAPHIC_TERMS.has(w) || STRATEGY_TERMS.has(w);
                             
    if (!isKnownDimension && w.length > 2 && !STRIP_WORDS.has(w)) {
      dimensions.add(w);
    }
  });

  if (instrument.type === "ETF" || instrument.type === "ETN") {
    if (expanded.includes("BOND")) {
      if (!dimensions.has("BOND") && !dimensions.has("GOVERNMENTBOND") && !dimensions.has("CORPORATEBOND")) {
        dimensions.add("BOND");
      }
    } else {
      if (!dimensions.has("EQUITY")) dimensions.add("EQUITY");
    }
  } else if (instrument.type === "ETC") {
    if (!dimensions.has("COMMODITY")) dimensions.add("COMMODITY");
  }

  const core = [...dimensions].sort().join(" ").trim();
  const parts = [core, esg, hedged].filter(Boolean);
  return parts.join("|") || upperName;
}

/** @internal */
export function __test_extractExposureKey(instrument: Instrument): string {
  return extractExposureKey(instrument);
}

// ─── Group ETFs/ETCs by Exposure ─────────────────────────────────────────────

export interface DedupGroup {
  key: string;
  candidates: Instrument[];
  winner: Instrument;
}

export function buildDedupGroups(instruments: Instrument[]): DedupGroup[] {
  const groups = new Map<string, Instrument[]>();

  for (const inst of instruments) {
    if (inst.type === "Stock") {
      groups.set(inst.isin, [inst]);
      continue;
    }

    const key = extractExposureKey(inst);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(inst);
  }

  const result: DedupGroup[] = [];

  for (const [key, candidates] of groups) {
    const sorted = [...candidates].sort((a, b) => {
      const pa = stripAndDetectProvider(a.longName || a.displayName).priority;
      const pb = stripAndDetectProvider(b.longName || b.displayName).priority;
      if (pa !== pb) return pa - pb;

      if (a.currency === "EUR" && b.currency !== "EUR") return -1;
      if (b.currency === "EUR" && a.currency !== "EUR") return 1;
      
      if (a.aum !== null && b.aum !== null) return b.aum! - a.aum!;
      if (a.aum === null && b.aum !== null) return 1;
      if (a.aum !== null && b.aum === null) return -1;
      
      if (a.ter !== null && b.ter !== null) return a.ter! - b.ter!;
      if (a.ter === null && b.ter !== null) return 1;
      if (a.ter !== null && b.ter === null) return -1;

      return 0;
    });

    result.push({ key, candidates: sorted, winner: sorted[0] });
  }

  return result;
}

export function applyDedupToInstruments(
  instruments: Instrument[],
  groups: DedupGroup[]
): Instrument[] {
  const winnerISINs = new Set(groups.map((g) => g.winner.isin));
  const groupByISIN = new Map<string, { key: string; candidateISINs: string[] }>();

  for (const g of groups) {
    const candidateISINs = g.candidates.map((c) => c.isin);
    for (const c of g.candidates) {
      groupByISIN.set(c.isin, { key: g.key, candidateISINs });
    }
  }

  return instruments.map((inst) => {
    const group = groupByISIN.get(inst.isin);
    return {
      ...inst,
      dedupGroup: group?.key,
      isDedupWinner: winnerISINs.has(inst.isin),
      dedupCandidates: group?.candidateISINs.filter((isin) => isin !== inst.isin),
    };
  });
}
