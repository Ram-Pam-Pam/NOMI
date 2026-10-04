// Oficjalne źródła informacji o atrakcjach.
// guide – oficjalny portal turystyczny Gminy Miejskiej Kraków (krakow.travel, prowadzony przez KBF na rzecz miasta): opisy i fakty.
// pages – oficjalne strony instytucji zarządzających obiektem: godziny otwarcia, ceny, zasady zwiedzania.
// Adresy zweryfikowane 2026-10-04 (treść renderowana po stronie serwera).

const KT = (path) => `https://krakow.travel/${path}`;
const MK = (branch) => `https://muzeumkrakowa.pl/oddzialy/${branch}`;
const MNK = (branch) => `https://mnk.pl/oddzial/${branch}`;
const WAWEL = (exhibition) => `https://wawel.krakow.pl/wystawa-stala/${exhibition}`;
// Wspólna strona godzin MNK – na stronach oddziałów godziny są w zakładce ładowanej skryptem.
const MNK_HOURS = "https://mnk.pl/informacje-praktyczne/godziny-otwarcia/";

export const OFFICIAL_SOURCES = {
  "rynek-sukiennice": { guide: [KT("55-krakow-rynek-glowny"), KT("54-krakow-sukiennice")], pages: [MNK("mnk-sukiennice"), MNK_HOURS] },
  mariacki: { guide: [KT("46-krakow-kosciol-mariacki")], pages: ["https://mariacki.com/zwiedzanie-bazyliki/", "https://mariacki.com/zwiedzanie-hejnalicy/"] },
  "wieza-ratuszowa": { guide: [KT("10-krakow-wieza-ratuszowa")], pages: [MK("wieza-ratuszowa")] },
  "sw-wojciech": { guide: [KT("355-krakow-kosciol-sw-wojciecha")], pages: ["https://ma.krakow.pl/wystawy/wystawy-stale/kosciol-sw-wojciecha-2/"] },
  "pomnik-mickiewicza": { guide: [KT("37084-krakow-pomnik-adama-mickiewicza")], pages: [] },
  "rynek-podziemny": { guide: [KT("397-krakow-rynek-podziemny")], pages: [MK("rynek-podziemny")] },
  krzysztofory: { guide: [KT("8-krakow-palac-krzysztofory")], pages: [MK("palac-krzysztofory")] },
  "collegium-maius": {
    guide: [KT("17706-krakow-collegium-maius-i-uniwersytet-jagiellonski")],
    pages: ["https://maius.uj.edu.pl/godziny-otwarcia", "https://maius.uj.edu.pl/zwiedzanie"],
  },
  "collegium-novum-planty": { guide: [KT("17779-krakow-planty")], pages: [] },
  "sw-anna": { guide: [KT("785-krakow-kosciol-sw-anny")], pages: ["https://kolegiata-anna.pl/"] },
  "brama-florianska": { guide: [KT("17748-krakow-brama-florianska")], pages: [] },
  barbakan: { guide: [KT("22-krakow-barbakan")], pages: [MK("barbakan")] },
  czartoryscy: { guide: [KT("36585-krakow-muzeum-ksiazat-czartoryskich")], pages: [MNK("mnk-muzeum-czartoryskich"), MNK_HOURS] },
  "teatr-slowackiego": { guide: [KT("17782-krakow-teatr-im-juliusza-slowackiego")], pages: [] },
  "pomnik-grunwaldzki": { guide: [KT("305-krakow-plac-matejki")], pages: [] },
  "stary-kleparz": { guide: [], pages: [] },
  franciszkanie: { guide: [KT("17726-krakow-kosciol-oo-franciszkanow")], pages: [] },
  "okno-papieskie": { guide: [KT("17715-krakow-palac-biskupi")], pages: [] },
  dominikanie: { guide: [KT("17723-krakow-kosciol-oo-dominikanow")], pages: [] },
  "piotr-pawel": { guide: [KT("238-krakow-kosciol-sw-sw-piotra-i-pawla")], pages: [] },
  "sw-andrzej": { guide: [KT("17711-krakow-kosciol-sw-andrzeja")], pages: [] },
  kanonicza: { guide: [KT("17719-krakow-ulica-kanonicza")], pages: [] },
  "wawel-zamek": {
    guide: [KT("17801-krakow-zamek-krolewski-na-wawelu"), KT("1-krakow-wzgorze-wawelskie")],
    pages: [WAWEL("wawel-najcenniejsze"), WAWEL("skarbiec-koronny")],
  },
  "katedra-wawelska": { guide: [KT("4-krakow-katedra-na-wawelu")], pages: ["https://www.katedra-wawelska.pl/katedra-wawelska/zaplanuj-wizyte/"] },
  "smok-wawelski": { guide: [KT("3-krakow-smocza-jama")], pages: [WAWEL("smocza-jama")] },
  skalka: { guide: [KT("327-krakow-kosciol-na-skalce")], pages: ["https://skalka.paulini.pl/dla-turystow/"] },
  "plac-nowy": { guide: [KT("17720-krakow-kazimierz-i-miasto-zydowskie")], pages: [] },
  "synagoga-stara": { guide: [KT("21-krakow-stara-synagoga")], pages: [MK("stara-synagoga")] },
  remuh: { guide: [KT("17798-krakow-synagoga-i-cmentarz-remuh")], pages: [] },
  tempel: { guide: [KT("271-krakow-synagoga-tempel")], pages: [] },
  "bozego-ciala": { guide: [KT("408-krakow-kosciol-bozego-ciala")], pages: [] },
  "kladka-bernatka": { guide: [KT("36690-krakow-kladka-ojca-bernatka")], pages: [] },
  "plac-bohaterow-getta": { guide: [KT("501-krakow-plac-bohaterow-getta"), KT("19-krakow-apteka-pod-orlem")], pages: [MK("apteka-pod-orlem")] },
  "schindler-mocak": {
    guide: [KT("20-krakow-fabryka-emalia-oskara-schindlera"), KT("348-krakow-mocak-muzeum-sztuki-wspolczesnej")],
    pages: [MK("fabryka-emalia-oskara-schindlera"), "https://mocak.pl/godziny-otwarcia", "https://mocak.pl/bilety"],
  },
  "kopiec-kosciuszki": {
    guide: [KT("17793-krakow-kopiec-kosciuszki")],
    pages: ["https://kopieckosciuszki.pl/godziny-otwarcia/", "https://kopieckosciuszki.pl/cennik-2/"],
  },
  "kopiec-krakusa": { guide: [KT("488-krakow-kopiec-krakusa")], pages: [] },
  "muzeum-narodowe": { guide: [KT("17787-krakow-gmach-glowny")], pages: [MNK("mnk-gmach-glowny"), MNK_HOURS] },
  blonia: { guide: [KT("239-krakow-blonia")], pages: [] },
  manggha: {
    guide: [KT("53-krakow-muzeum-sztuki-i-techniki-japonskiej-manggha")],
    pages: ["https://manggha.pl/informacje-praktyczne", "https://manggha.pl/bilety"],
  },
  "ogrod-botaniczny": { guide: [KT("197-krakow-ogrod-botaniczny")], pages: ["https://ogrod.uj.edu.pl/zwiedzanie/podstawowe-info"] },
  "maly-rynek": { guide: [KT("940-krakow-maly-rynek")], pages: [] },
  "nowa-huta": { guide: [KT("425-krakow-plac-centralny")], pages: [] },
  "muzeum-lotnictwa": { guide: [KT("249-krakow-muzeum-lotnictwa-polskiego")], pages: ["https://muzeumlotnictwa.pl/zwiedzanie/"] },
  zakrzowek: { guide: [KT("17717-krakow-zakrzowek-i-skalki-twardowskiego")], pages: [] },
  tyniec: { guide: [KT("380-krakow-opactwo-oo-benedyktynow-w-tyncu")], pages: [] },
};
