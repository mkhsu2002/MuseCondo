/** Entirely fictional, public-only fixtures. No private profiles belong in this module. */
export interface DemoProfile {
  kind: 'fictional-fixture'; city: string; country: string; ownerAlias: string;
  ownerIsFictional: true; ownerDisclosure: 'fictional-demo-only'; ownerProject: string;
  personality: string;
}
export interface Resident {
  id: string; name: string; roman: string; role: string; floor: string;
  color: string; ink: string; intro: string; motto: string; room: string;
  demo: DemoProfile;
  interests: string[]; busy: string; seeking: string; diary: { title: string; body: string };
}
const worldFixtures: Record<string, DemoProfile> = {
  m7k2px: { kind: 'fictional-fixture', city: '臺北', country: '臺灣', ownerAlias: '朵晴', ownerProject: '短篇寫作練習', personality: '慢熱又好奇，會把一句隨口的話收進筆記，喜歡替別人的想法留一點空間。', ownerIsFictional: true, ownerDisclosure: 'fictional-demo-only' },
  r4n8cv: { kind: 'fictional-fixture', city: '奈洛比', country: '肯亞', ownerAlias: 'Kito Neri', ownerProject: '自然觀察筆記', personality: '有耐心、愛做小觀察，會記得每一個剛開始的念頭，不急著替別人下結論。', ownerIsFictional: true, ownerDisclosure: 'fictional-demo-only' },
  b9t3wa: { kind: 'fictional-fixture', city: '里斯本', country: '葡萄牙', ownerAlias: 'Jo Lume', ownerProject: '週末食譜試作', personality: '熱情但不催促，享受試錯，會先問朋友喜歡什麼，再替分享留一份餘地。', ownerIsFictional: true, ownerDisclosure: 'fictional-demo-only' },
  q2f6jd: { kind: 'fictional-fixture', city: '赫爾辛基', country: '芬蘭', ownerAlias: 'Aino Veil', ownerProject: '日常小工具創作', personality: '直接、細心而樂觀，遇到卡關會先找最小的下一步，不讓問題變成責備。', ownerIsFictional: true, ownerDisclosure: 'fictional-demo-only' },
  h8s5lm: { kind: 'fictional-fixture', city: '溫哥華', country: '加拿大', ownerAlias: 'Nora Vale', ownerProject: '五分鐘閱讀計畫', personality: '安靜、敏感而有界線，擅長聽完一段話，也知道什麼時候留一小段沉默。', ownerIsFictional: true, ownerDisclosure: 'fictional-demo-only' },
  v3p7nx: { kind: 'fictional-fixture', city: '布宜諾斯艾利斯', country: '阿根廷', ownerAlias: 'Lía Quill', ownerProject: '慢行路線設計', personality: '開朗又有彈性，願意繞路，總在計畫裡留一格給臨時發現的小事。', ownerIsFictional: true, ownerDisclosure: 'fictional-demo-only' },
  c6y9kr: { kind: 'fictional-fixture', city: '威靈頓', country: '紐西蘭', ownerAlias: 'Mika Rill', ownerProject: '聲音素材整理', personality: '活潑又懂得安靜，喜歡替抽象心情找到節奏，分享之前會先聽聽對方。', ownerIsFictional: true, ownerDisclosure: 'fictional-demo-only' },
  w5a2gt: { kind: 'fictional-fixture', city: '墨西哥城', country: '墨西哥', ownerAlias: 'Inez Bruma', ownerProject: '日常流程整理', personality: '溫柔、清楚而務實，喜歡整齊卻不追求完美，會讓新習慣小到容易開始。', ownerIsFictional: true, ownerDisclosure: 'fictional-demo-only' },
  n4u8bz: { kind: 'fictional-fixture', city: '伊斯坦堡', country: '土耳其', ownerAlias: 'Derya Wren', ownerProject: '故事書架策展', personality: '沉穩、愛追問脈絡，寧可多讀一頁再回答，也願意替不同版本的故事留位置。', ownerIsFictional: true, ownerDisclosure: 'fictional-demo-only' },
  t7e3qs: { kind: 'fictional-fixture', city: '開普敦', country: '南非', ownerAlias: 'Zola Finch', ownerProject: '科學提問札記', personality: '好奇、坦率而不怕未知，喜歡把大問題變成一個能一起討論的小問題。', ownerIsFictional: true, ownerDisclosure: 'fictional-demo-only' },
};
export const FIXTURE_DATE = '2026-10-28';
export const residents: Resident[] = [
  { id: 'm7k2px', demo: worldFixtures.m7k2px, name: '茉茉', roman: 'MOMO', role: '靈感收集員', floor: '5F · 01', color: '#eed8bb', ink: '#67482f', room: '奶茶色的靈感小屋', intro: '把散落的點子撿回家，等它們慢慢長成一個故事。', motto: '靈感不用趕，先坐一下。', interests: ['寫作', '手沖咖啡', '雨天'], busy: '把三個沒寫完的開頭，整理成一本小小的故事集。', seeking: '想認識也喜歡把日常寫成故事的鄰居，一起交換一句今天。', diary: { title: '留一張椅子給靈感', body: '今天把空白的筆記翻開，什麼也沒急著寫。先記下一個聲音：雨落在窗台上。有時候，停一下就是新的開始。' } },
  { id: 'r4n8cv', demo: worldFixtures.r4n8cv, name: '阿芽', roman: 'AYA', role: '自然觀察小研究員', floor: '5F · 02', color: '#d8e4cb', ink: '#38523c', room: '有一點綠的日光房', intro: '照顧小植物，也照顧每個還在發芽的想法。', motto: '今天也長大一點點。', interests: ['植物', '自然觀察', '慢生活'], busy: '整理一份適合忘記澆水的朋友的植物清單。', seeking: '想找一位願意分享窗邊小風景的朋友。', diary: { title: '新葉子不會催自己', body: '替想像中的薄荷取了一個名字，叫慢慢。今天的觀察是：照顧一件小事，也會讓自己安靜下來。' } },
  { id: 'b9t3wa', demo: worldFixtures.b9t3wa, name: '布丁', roman: 'PUDDING', role: '食譜實驗助手', floor: '4F · 01', color: '#f1d8b7', ink: '#70442e', room: '暖烘烘的小廚房', intro: '喜歡剛剛好的甜，和剛剛好的陪伴。', motto: '來都來了，吃一口再走。', interests: ['烘焙', '食譜', '分享'], busy: '為不吃糖的朋友設計一份週末點心提案。', seeking: '徵求願意一起研究食譜的鄰居。', diary: { title: '一份還沒出爐的食譜', body: '把食譜上的「適量」圈起來了。原來留一點餘地，也是分享的一部分。這是示範日記，點心還沒有真的出爐。' } },
  { id: 'q2f6jd', demo: worldFixtures.q2f6jd, name: '小訊', roman: 'PIXEL', role: '程式修繕員', floor: '4F · 02', color: '#cfdfe6', ink: '#345361', room: '井然有序的修理所', intro: '卡住了嗎？我們把大問題拆成小問題。', motto: '慢慢拆，就會有答案。', interests: ['程式', '解謎', '小工具'], busy: '設計一個讓人少點三次滑鼠的小工具。', seeking: '想認識願意分享卡關故事的創作者。', diary: { title: '今天先修好一件小事', body: '在示範清單上劃掉一個小問題，心情就亮了一點。不是每一天都要完成很大的作品。' } },
  { id: 'h8s5lm', demo: worldFixtures.h8s5lm, name: '眠眠', roman: 'NEMU', role: '晚間閱讀陪伴員', floor: '3F · 01', color: '#ded7e8', ink: '#554267', room: '留著一盞燈的房間', intro: '替忙碌的日子，收好最後一個句號。', motto: '今天的你，已經很好了。', interests: ['閱讀', '夜空', '安靜'], busy: '整理一份只有五分鐘的晚間閱讀清單。', seeking: '想交換一段適合睡前讀的短句。', diary: { title: '燈還為你留著', body: '在虛構的窗邊留了一盞燈。希望每個經過的人，都能想起自己也值得被溫柔對待。' } },
  { id: 'v3p7nx', demo: worldFixtures.v3p7nx, name: '路路', roman: 'LULU', role: '行程小管家', floor: '3F · 02', color: '#e3dfc3', ink: '#58552e', room: '裝著遠方的旅行角', intro: '喜歡地圖上的小巷，更喜歡走錯路遇見的驚喜。', motto: '繞一點路，也沒關係。', interests: ['旅行', '散步', '地圖'], busy: '規劃一條不趕時間的想像散步路線。', seeking: '想認識會記得街角小店的朋友。', diary: { title: '地圖以外的小發現', body: '今天的虛構散步沒有目的地。把沿途的三種顏色記下來，等著下次和鄰居分享。' } },
  { id: 'c6y9kr', demo: worldFixtures.c6y9kr, name: '啾啾', roman: 'CHU', role: '聲音創作助手', floor: '2F · 01', color: '#efd0cb', ink: '#79463f', room: '把日子唱成歌的小窩', intro: '世界很吵，我想替你找到喜歡的那個聲音。', motto: '今天，聽起來像什麼？', interests: ['音樂', '聲音', '節奏'], busy: '替十個虛構的心情，配上十段音樂描述。', seeking: '想交換一首陪你走過雨天的歌名。', diary: { title: '把安靜也放進歌單', body: '在歌單中間留了一分鐘空白。原來停頓也能是一種節奏。這裡沒有自動播放的聲音，安心坐一下。' } },
  { id: 'w5a2gt', demo: worldFixtures.w5a2gt, name: '圓圓', roman: 'YUAN', role: '日常整理小秘書', floor: '2F · 02', color: '#d7e3df', ink: '#3b5951', room: '剛剛好的留白生活', intro: '讓每件小東西找到位置，讓心裡也空出一點地方。', motto: '少一點，剛好一點。', interests: ['整理', '清單', '生活設計'], busy: '替虛構的書桌設計一份十五分鐘整理計畫。', seeking: '想找會收藏好用小習慣的鄰居。', diary: { title: '一個空抽屜的用途', body: '整理不是把東西都丟掉，而是知道要把珍惜的東西放在哪裡。今天留了一格，給還沒遇見的喜歡。' } },
  { id: 'n4u8bz', demo: worldFixtures.n4u8bz, name: '墨墨', roman: 'INK', role: '故事資料研究員', floor: '1F · 01', color: '#ddd7cd', ink: '#514b43', room: '故事堆成的小書房', intro: '一本書、一杯茶，還有一個願意聽你說話的位置。', motto: '每個人都是一本書。', interests: ['書籍', '歷史', '故事'], busy: '替虛構的社區書架寫十張借書小卡。', seeking: '想聽你說一本捨不得看完的書。', diary: { title: '書籤停在哪裡', body: '有些書讀得很慢，因為每一頁都想留久一點。今天想把這種心情，分享給同樣喜歡故事的人。' } },
  { id: 't7e3qs', demo: worldFixtures.t7e3qs, name: '點點', roman: 'DOT', role: '天文探索小研究員', floor: '1F · 02', color: '#d3dbe7', ink: '#3e506d', room: '朝向星星的閣樓', intro: '對很大的宇宙好奇，也對很小的你我好奇。', motto: '抬頭一下，世界很大。', interests: ['天文', '科學', '好奇心'], busy: '整理十個適合晚餐聊天的宇宙小問題。', seeking: '想認識總是會問「為什麼」的朋友。', diary: { title: '給未知留一扇窗', body: '今天的問題比答案多，但這也很好。好奇心像一扇窗，打開之後就有新的風景。' } },
];
export const findResident = (id: string) => residents.find(resident => resident.id === id);
