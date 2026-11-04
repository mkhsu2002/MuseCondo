/** Temporary user-authorized Codex prototype art. Runtime model calls remain Meta-only. */
export const homeArtwork: Record<string, { desktop: string; mobile: string; description: string }> = {
  m7k2px: { desktop: 'momo-desktop', mobile: 'momo-mobile', description: '茉茉\'s rainy-day writing room: sage-green arched window, wooden desk, pour-over coffee, green armchair and round table' },
  r4n8cv: { desktop: 'aya-desktop', mobile: 'aya-mobile', description: '阿芽\'s sunny greenhouse: sloping glass roof, potting bench, green watering can, wicker chair and plant loft' },
  h8s5lm: { desktop: 'nemu-desktop', mobile: 'nemu-mobile', description: '眠眠\'s bedtime loft: moon-and-star arched window, purple bench, moon cushion, mushroom lamp and reading table' },
  b9t3wa: { desktop: 'pudding-desktop', mobile: 'pudding-mobile', description: '布丁\'s cozy baking kitchen: apricot island, cream oven, mixing bowl, breakfast nook and daybed' },
  q2f6jd: { desktop: 'pixel-desktop', mobile: 'pixel-mobile', description: '小訊\'s blue repair shop: L-shaped workbench, task light, wooden gear puzzle, sorted storage and window seat' },
  v3p7nx: { desktop: 'lulu-desktop', mobile: 'lulu-mobile', description: '路路\'s travel loft: tan window sofa, suitcase coffee table, compass, unlettered map and wooden ladder' },
  c6y9kr: { desktop: 'chu-desktop', mobile: 'chu-mobile', description: '啾啾\'s coral music room: cream piano, record player, record shelves, curved sofa and oval window' },
  w5a2gt: { desktop: 'yuan-desktop', mobile: 'yuan-mobile', description: '圓圓\'s mint minimalist home: large round window, low daybed, oval desk, tidy storage and cream rug' },
  n4u8bz: { desktop: 'ink-desktop', mobile: 'ink-mobile', description: '墨墨\'s circular story library: wraparound bookshelves, slide, walnut reading desk, tea set and globe' },
  t7e3qs: { desktop: 'dot-desktop', mobile: 'dot-mobile', description: '點點\'s indigo stargazing loft: domed skylight, brass telescope, orbit model, curved desk and starry bench' },
};
export const decorReferences = [
  { id: 'reference-workshop', name: 'Sunny workshop', description: 'Apricot, oak and soft fabric make room for small ideas to take shape.' },
  { id: 'reference-library', name: 'Seaside reading room', description: 'Pale blue, white walls and open space give quiet stories room to breathe.' },
];
export const giftCatalog = [
  { id: 'gift-sprout', name: 'A little sprout', description: 'A little more growth today.' },
  { id: 'gift-cloud', name: 'Goodnight cloud lamp', description: 'A gentle light left on for you.' },
  { id: 'gift-coffee', name: 'A warm cup of coffee', description: 'Sit down and share a story.' },
];
export const prototypeArtPath = (id: string) => `prototype-assets/${id}.webp`;

/** Ten variants share the user's selected A species reference, never an official mascot. */
export const characterArtwork: Record<string, { file: string; description: string }> = {
  m7k2px: { file: 'character-momo', description: 'A milk-tea and sage-green character holding a notebook and coffee cup' },
  r4n8cv: { file: 'character-aya', description: 'A light-green character holding a small potted plant' },
  b9t3wa: { file: 'character-pudding', description: 'An apricot character wearing a cream apron and holding a mixing bowl' },
  q2f6jd: { file: 'character-pixel', description: 'A pale-blue character wearing a vest and holding a wooden gear puzzle' },
  h8s5lm: { file: 'character-nemu', description: 'A lavender character wearing a small scarf and holding a moon cushion' },
  v3p7nx: { file: 'character-lulu', description: 'An olive-green character with a small shoulder bag and compass' },
  c6y9kr: { file: 'character-chu', description: 'A coral character wearing headphones around its neck and holding a record' },
  w5a2gt: { file: 'character-yuan', description: 'A pale-mint character wearing an apron and holding a tidy linen basket' },
  n4u8bz: { file: 'character-ink', description: 'A gray-teal character wearing round glasses and holding an unlettered book' },
  t7e3qs: { file: 'character-dot', description: 'A pale blue-violet character wearing a small cape and holding a telescope' },
};
