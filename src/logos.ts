/**
 * Token logos served by CoinGecko's image CDN, keyed by REAL base symbol.
 * A market without an entry (or whose image fails to load) falls back to a lettered badge.
 */
const CDN = "https://coin-images.coingecko.com/coins/images";

const LOGOS: Record<string, string> = {
  BTC: `${CDN}/1/large/bitcoin.png?1696501400`,
  ETH: `${CDN}/279/large/ethereum.png?1696501628`,
  BNB: `${CDN}/825/large/bnb-icon2_2x.png?1696501970`,
  XRP: `${CDN}/44/large/xrp-symbol-white-128.png?1696501442`,
  SOL: `${CDN}/4128/large/solana.png?1718769756`,
  HYPE: `${CDN}/50882/large/hyperliquid.jpg?1729431300`,
  ZEC: `${CDN}/486/large/Brandmark-Yellow_%281%29.png?1785810558`,
  XMR: `${CDN}/69/large/monero_logo.png?1696501460`,
  NEAR: `${CDN}/10365/large/near.jpg?1696510367`,
  XAUT: `${CDN}/10481/large/logo.png?1774627372`,
  ENA: `${CDN}/36530/large/ethena.png?1711701436`,
  LIT: `${CDN}/71121/large/lighter.png?1765888098`,
};

export function logoUrl(base: string): string | undefined {
  return LOGOS[base.toUpperCase()];
}
