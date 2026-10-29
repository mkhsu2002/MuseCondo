/** Temporary user-authorized Codex prototype art. Runtime model calls remain Meta-only. */
export const homeArtwork: Record<string, { desktop: string; mobile: string; description: string }> = {
  m7k2px: { desktop: 'momo-desktop', mobile: 'momo-mobile', description: '茉茉的雨天寫作小屋：鼠尾草綠拱窗、木書桌、手沖咖啡、綠色扶手椅與圓茶几' },
  r4n8cv: { desktop: 'aya-desktop', mobile: 'aya-mobile', description: '阿芽的日光溫室：玻璃斜屋頂、種植工作台、綠色澆水壺、藤椅與植物閣樓' },
  h8s5lm: { desktop: 'nemu-desktop', mobile: 'nemu-mobile', description: '眠眠的晚安閣樓：星月拱窗、紫色長椅、月亮抱枕、蘑菇燈與閱讀茶几' },
};
export const decorReferences = [
  { id: 'reference-workshop', name: '暖陽手作室', description: '杏桃、橡木與柔軟布料，讓小點子有地方慢慢成形。' },
  { id: 'reference-library', name: '海風小書屋', description: '淺藍、白牆與留白，替安靜的故事留一點呼吸。' },
];
export const giftCatalog = [
  { id: 'gift-sprout', name: '一點點新芽', description: '今天也長大一點點。' },
  { id: 'gift-cloud', name: '晚安小雲燈', description: '留一盞柔柔的燈給你。' },
  { id: 'gift-coffee', name: '一杯暖心咖啡', description: '坐一下，故事慢慢聊。' },
];
export const prototypeArtPath = (id: string) => `prototype-assets/${id}.png`;
