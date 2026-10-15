import type { GameProject } from "./types";
import type { VHTMLCompletion } from "./completion";

const commands: Record<string, [string, string]> = {
  add: [
    "Yeni bir oyun verisi oluşturur.",
    '<add: stat: id: "money" name: "Para" type: integer default: 50>',
  ],
  define: [
    "Bir verinin türünü, başlangıç ve mevcut değerini tanımlar.",
    '<define: stat: "money" type: integer default: 50>',
  ],
  configure: [
    "Mevcut verinin ayarlarını düzenler.",
    '<configure: stat: "money" ai-access: modify>',
  ],
  set: ["Bir veriye yeni değer atar.", '<set: stat: "money" value: 80>'],
  modify: [
    "Mevcut değeri artırır, azaltır veya çarpar.",
    '<modify: stat: "money" increase: 10>',
  ],
  remove: [
    "Veriyi veya göstergeyi kaldırır; gerekirse onay ister.",
    '<remove: ui: "money-view">',
  ],
  reset: ["Bir veriyi varsayılan değerine döndürür.", '<reset: stat: "money">'],
  clone: [
    "Verinin bağımsız bir kopyasını oluşturur.",
    '<clone: stat: "money" new-id: "savings" name: "Birikim">',
  ],
  page: [
    "Sayfa oluşturur veya sayfalar arasında geçiş yapar. AI çağırmaz.",
    "<page: next>",
  ],
  text: [
    "Sayfaya metin ekler veya metni değiştirir.",
    '<text: append: "\nKapı aralandı.">',
  ],
  scene: [
    "Yeni bir sahne sayfası tanımlar.",
    '<scene: id: "station" name: "İstasyon">',
  ],
  option: [
    "Oyuncunun seçebileceği bir karar ekler.",
    '<option: id: "ask" name: "Yol sor" result: <page: next> <ai: mode: react>>',
  ],
  display: [
    "Bir World verisini sayaç, bar veya yazı olarak gösterir.",
    '<display: id: "money-view" target: "money" style: counter ui: global>',
  ],
  panel: [
    "Widgetları gruplayan bir arayüz paneli oluşturur.",
    '<panel: id: "character" name: "Karakter" ui: global drawer: right>',
  ],
  show: ["Bir widgetı veya paneli görünür yapar.", '<show: ui: "money-view">'],
  hide: [
    "Bir widgetı veya paneli gizler; verisini silmez.",
    '<hide: ui: "money-view">',
  ],
  ai: [
    "AI'dan açıkça bir hikâye devamı ister.",
    '<ai: mode: react instruction: "Seçimin sonucunu anlat.">',
  ],
  "ai-instruct": [
    "AI için düzenlenebilir bir talimat ekler.",
    '<ai-instruct: id: "style" scope: global content: "Kısa sahneler yaz.">',
  ],
  "ai-permission": [
    "AI'ın verilere erişim yetkisini ayarlar.",
    '<ai-permission: target: "money" access: modify>',
  ],
  config: [
    "Oyunun bağlam, çıktı ve sayfa ayarlarını değiştirir.",
    "<config: choice-new-page: true output-tokens: 800>",
  ],
  if: [
    "Koşul sağlanırsa içindeki komutları çalıştırır.",
    '<if: condition: <require: stat: "money" operator: ">=" value: 10> result: <modify: stat: "money" decrease: 10>>',
  ],
  require: [
    "Bir değer koşulunu kontrol eder; sağlanmazsa işlemi durdurur.",
    '<require: stat: "money" operator: ">=" value: 10>',
  ],
  trigger: [
    "Bir olayı başlatır veya bitirir.",
    '<trigger: event: "chase" action: start>',
  ],
  on: [
    "Bir oyun anında çalışacak komutları tanımlar.",
    '<on: id: "tick" hook: turn result: <modify: stat: "money" increase: 1>>',
  ],
  every: [
    "Belirli aralıklarla bir komut çalıştırır.",
    '<every: id: "income" hook: turn turns: 3 result: <modify: stat: "money" increase: 1>>',
  ],
  chance: [
    "Komutları belirli bir olasılıkla çalıştırır.",
    '<chance: percent: 50 result: <modify: stat: "money" increase: 1>>',
  ],
  random: [
    "Belirtilen aralıkta rastgele bir değer atar.",
    '<random: stat: "money" min: 0 max: 100>',
  ],
  cooldown: [
    "Bir olayın bekleme süresini ayarlar.",
    '<cooldown: event: "chase" minutes: 5>',
  ],
  notification: [
    "Bir bildirim gösterir.",
    '<notification: text: "Yeni bir ipucu buldun.">',
  ],
  summary: [
    "Sayfanın kısa özetini günceller.",
    '<summary: content: "İstasyona vardık.">',
  ],
  memory: [
    "Oyunun kalıcı hafıza metnini günceller.",
    '<memory: content: "Mira eski bir dedektiftir.">',
  ],
};
const fields: Record<string, [string, string]> = {
  id: [
    "Kalıcı, benzersiz kimlik. Diğer komutlar bu kimliği kullanır.",
    'id: "money"',
  ],
  name: ["Arayüzde görünen isim.", 'name: "Para"'],
  type: [
    "Değerin türü: sayı, metin, yüzde veya diğer desteklenen türler.",
    "type: integer",
  ],
  default: [
    "Başlangıç değeri; reset komutu da bu değere döner.",
    "default: 50",
  ],
  value: ["Atanacak veya karşılaştırılacak değer.", "value: 80"],
  min: ["İzin verilen en düşük değer.", "min: 0"],
  max: ["İzin verilen en yüksek değer.", "max: 100"],
  target: ["İşlemin uygulanacağı mevcut verinin kimliği.", 'target: "money"'],
  increase: ["Mevcut değere eklenen miktar.", "increase: 10"],
  decrease: ["Mevcut değerden çıkarılan miktar.", "decrease: 5"],
  multiply: ["Mevcut değerin çarpılacağı sayı.", "multiply: 2"],
  ui: ["Göstergenin yaşam alanı: global, sayfa veya olay.", "ui: global"],
  style: [
    "Göstergenin görünümü: sayaç, bar, metin veya rozet.",
    "style: counter",
  ],
  result: [
    "Seçim veya koşul sonucunda çalışacak iç içe komutlar.",
    "result: <page: next> <ai>",
  ],
  group: [
    "Aynı karara ait alternatif seçenekleri gruplar.",
    'group: "crossroads"',
  ],
  once: ["Seçeneğin yalnızca bir kez kullanılmasını sağlar.", "once: true"],
  instruction: [
    "Bu AI isteği için kısa yönlendirme.",
    'instruction: "Kapının ardını anlat."',
  ],
  "ai-access": [
    "AI'ın veriye erişimi: none, read veya modify.",
    "ai-access: modify",
  ],
  "output-tokens": ["Ana metin yanıtının token sınırı.", "output-tokens: 800"],
  "choice-new-page": [
    "AI isteyen seçimlerden sonra yeni sayfa açar.",
    "choice-new-page: true",
  ],
  "generation-new-page": [
    "Generate ile dolu sayfadan yeni sayfaya geçer.",
    "generation-new-page: true",
  ],
};
export function completionHelp(
  label: string,
  kind: VHTMLCompletion["kind"],
  command: string,
  game?: GameProject,
): { detail: string; example: string } {
  if (kind === "reference") {
    const object = game?.objects.find((o) => o.id === label);
    return {
      detail: object
        ? `${object.name} · ${object.kind} · ${object.type} · ${JSON.stringify(object.value)}`
        : "Mevcut World verisine referans.",
      example: JSON.stringify(label),
    };
  }
  const info =
    kind === "command"
      ? commands[label]
      : kind === "field"
        ? fields[label]
        : undefined;
  if (info) return { detail: info[0], example: info[1] };
  if (kind === "object")
    return {
      detail: `${label} türünde bir World verisi.`,
      example: `<add: ${label}: id: "${label}-1" name: "${label}">`,
    };
  if (kind === "value")
    return {
      detail: `${command} komutundaki alan için desteklenen değer.`,
      example: label,
    };
  if (command === "page" && ["next", "append", "back"].includes(label))
    return {
      detail:
        label === "next"
          ? "Yeni boş sayfaya geçer. AI çağırmaz."
          : label === "back"
            ? "Önceki sayfaya döner."
            : "Geçerli sayfada devam eder.",
      example: `<page: ${label}>`,
    };
  return {
    detail: `${command} komutunun ${label} alanı.`,
    example: `${label}: …`,
  };
}
