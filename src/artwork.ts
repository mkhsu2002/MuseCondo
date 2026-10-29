/** Temporary user-authorized Codex prototype art. Runtime model calls remain Meta-only. */
export const homeArtwork: Record<string, { desktop: string; mobile: string; description: string }> = {
  m7k2px: { desktop: 'momo-desktop', mobile: 'momo-mobile', description: '茉茉的雨天寫作小屋：鼠尾草綠拱窗、木書桌、手沖咖啡、綠色扶手椅與圓茶几' },
  r4n8cv: { desktop: 'aya-desktop', mobile: 'aya-mobile', description: '阿芽的日光溫室：玻璃斜屋頂、種植工作台、綠色澆水壺、藤椅與植物閣樓' },
  h8s5lm: { desktop: 'nemu-desktop', mobile: 'nemu-mobile', description: '眠眠的晚安閣樓：星月拱窗、紫色長椅、月亮抱枕、蘑菇燈與閱讀茶几' },
  b9t3wa: { desktop: 'pudding-desktop', mobile: 'pudding-mobile', description: '布丁的暖心烘焙小廚房：杏桃中島、奶油烤箱、攪拌碗、早餐角與小臥榻' },
  q2f6jd: { desktop: 'pixel-desktop', mobile: 'pixel-mobile', description: '小訊的藍色修理所：L 型工具桌、工作燈、木齒輪拼圖、分類收納與窗邊座位' },
  v3p7nx: { desktop: 'lulu-desktop', mobile: 'lulu-mobile', description: '路路的旅行閣樓：黃褐窗邊沙發、行李箱茶几、指南針、無字地圖與木梯' },
  c6y9kr: { desktop: 'chu-desktop', mobile: 'chu-mobile', description: '啾啾的珊瑚音樂小窩：奶油鋼琴、黑膠唱盤、唱片架、半圓沙發與橢圓窗' },
  w5a2gt: { desktop: 'yuan-desktop', mobile: 'yuan-mobile', description: '圓圓的薄荷留白生活：大圓窗、低臥榻、橢圓書桌、整齊收納與奶油地毯' },
  n4u8bz: { desktop: 'ink-desktop', mobile: 'ink-mobile', description: '墨墨的圓形故事書房：雙層環繞書架、滑梯、胡桃木閱讀桌、茶具與地球儀' },
  t7e3qs: { desktop: 'dot-desktop', mobile: 'dot-mobile', description: '點點的靛藍星空閣樓：圓頂天窗、黃銅望遠鏡、軌道模型、弧形書桌與星空長椅' },
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
