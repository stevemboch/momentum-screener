
import { buildDedupGroups, __test_extractExposureKey } from './src/utils/dedup';
import { Instrument } from './src/types';

const testInstruments: Partial<Instrument>[] = [
  {
    isin: 'IE00B4L5Y983',
    displayName: 'ISHARES CORE MSCI WORLD ACC',
    longName: 'iShares Core MSCI World UCITS ETF',
    type: 'ETF',
    currency: 'USD'
  },
  {
    isin: 'DE0005933931',
    displayName: 'ISHARES CORE DAX UCITS ETF (DE)',
    longName: 'iShares Core DAX UCITS ETF (DE)',
    type: 'ETF',
    currency: 'EUR'
  },
  {
    isin: 'IE00B5BMR087',
    displayName: 'ISHARES CORE S&P 500',
    longName: 'iShares Core S&P 500 UCITS ETF',
    type: 'ETF',
    currency: 'USD'
  }
];

testInstruments.forEach(inst => {
    // @ts-ignore
    console.log(`Name: ${inst.displayName} -> Key: ${__test_extractExposureKey(inst)}`);
});
