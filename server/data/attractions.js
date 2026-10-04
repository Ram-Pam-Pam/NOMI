// Wyselekcjonowane atrakcje Krakowa. Współrzędne są przybliżone (±30 m) – można je doprecyzować.
// `radius` – odległość (m), z jakiej NOMI zaczyna automatycznie opowiadać o miejscu.
// `facts` – sprawdzone fakty, na których agent opiera narrację (zmniejsza ryzyko konfabulacji).

export const ATTRACTIONS = [
  {
    id: "rynek-sukiennice",
    name: { pl: "Rynek Główny i Sukiennice", en: "Main Market Square & Cloth Hall" },
    lat: 50.0617, lon: 19.9373, category: "square", district: "Stare Miasto",
    tags: ["history", "architecture", "art", "food"], radius: 110, visitMin: 45,
    summary: {
      pl: "Serce Krakowa – jeden z największych średniowiecznych placów Europy z renesansowymi Sukiennicami pośrodku.",
      en: "The heart of Kraków – one of Europe's largest medieval squares, with the Renaissance Cloth Hall in the middle.",
    },
    facts: [
      "Rynek wytyczono przy lokacji miasta na prawie magdeburskim w 1257 roku; ma około 4 hektarów.",
      "Sukiennice były halą handlową, głównie suknem; po pożarze w 1555 r. przebudowano je w stylu renesansowym z attyką.",
      "Neogotyckie podcienia dodano w latach 70. XIX wieku.",
      "Na piętrze Sukiennic działa Galeria Sztuki Polskiej XIX wieku Muzeum Narodowego, m.in. z „Pochodniami Nerona” Siemiradzkiego.",
      "Na parterze są stoiska z pamiątkami – bursztyn, wyroby z drewna, koronki.",
    ],
  },
  {
    id: "mariacki",
    name: { pl: "Bazylika Mariacka", en: "St. Mary's Basilica" },
    lat: 50.06164, lon: 19.93937, category: "church", district: "Stare Miasto",
    tags: ["history", "churches", "art", "architecture"], radius: 70, visitMin: 40,
    summary: {
      pl: "Gotycka bazylika z ołtarzem Wita Stwosza i wieżą, z której co godzinę grany jest hejnał.",
      en: "Gothic basilica with Veit Stoss's altarpiece and the tower from which the bugle call is played every hour.",
    },
    facts: [
      "Ołtarz Wita Stwosza powstał w latach 1477–1489 i jest jednym z największych gotyckich ołtarzy w Europie.",
      "Z wyższej wieży co godzinę grany jest hejnał mariacki, urywany w połowie melodii.",
      "Legenda mówi, że hejnalista został trafiony strzałą tatarską podczas ostrzegania miasta – stąd urwana melodia.",
      "Hejnał w południe transmituje Polskie Radio.",
      "Wieże mają różną wysokość; legenda wiąże to z rywalizacją dwóch braci budowniczych.",
      "Ołtarz jest zwykle uroczyście otwierany codziennie przed południem (ok. 11:50).",
    ],
    tips: "Zwiedzanie części turystycznej jest płatne; wejście dla turystów od strony Placu Mariackiego. Wieża hejnałowica jest otwarta sezonowo.",
  },
  {
    id: "wieza-ratuszowa",
    name: { pl: "Wieża Ratuszowa", en: "Town Hall Tower" },
    lat: 50.06139, lon: 19.93622, category: "monument", district: "Stare Miasto",
    tags: ["history", "architecture", "views"], radius: 50, visitMin: 25,
    summary: {
      pl: "Jedyna pozostałość gotyckiego ratusza, rozebranego w 1820 roku. Z góry widać cały Rynek.",
      en: "The only remnant of the Gothic town hall demolished in 1820. Great view over the square.",
    },
    facts: [
      "Ratusz rozebrano w 1820 roku – ocalała tylko wieża.",
      "Wieża jest lekko przechylona – skutek silnego wichru w 1703 roku.",
      "W piwnicach dawniej mieściło się więzienie i izba tortur, dziś działa tam teatr.",
    ],
  },
  {
    id: "sw-wojciech",
    name: { pl: "Kościół św. Wojciecha", en: "St. Adalbert's Church" },
    lat: 50.06086, lon: 19.93757, category: "church", district: "Stare Miasto",
    tags: ["history", "churches"], radius: 40, visitMin: 10,
    summary: {
      pl: "Mały romański kościółek na Rynku – starszy niż sam plac.",
      en: "A tiny Romanesque church on the square – older than the square itself.",
    },
    facts: [
      "To jeden z najstarszych kościołów Krakowa – jego początki sięgają XI wieku.",
      "Posadzka kościoła leży niżej niż płyta Rynku, co pokazuje, jak przez wieki podnosił się poziom placu.",
    ],
  },
  {
    id: "pomnik-mickiewicza",
    name: { pl: "Pomnik Adama Mickiewicza", en: "Adam Mickiewicz Monument" },
    lat: 50.0615, lon: 19.9381, category: "monument", district: "Stare Miasto",
    tags: ["history", "art"], radius: 35, visitMin: 5,
    summary: {
      pl: "Ulubione miejsce spotkań krakowian – „pod Adasiem”.",
      en: "Kraków's favourite meeting point – locals say “under Adaś”.",
    },
    facts: [
      "Pomnik odsłonięto w 1898 roku, w setną rocznicę urodzin poety; autorem jest Teodor Rygier.",
      "W grudniu obok pomnika odbywa się tradycyjny konkurs szopek krakowskich.",
    ],
  },
  {
    id: "rynek-podziemny",
    name: { pl: "Rynek Podziemny", en: "Rynek Underground Museum" },
    lat: 50.0619, lon: 19.9378, category: "museum", district: "Stare Miasto",
    tags: ["history", "museums", "kids"], radius: 30, visitMin: 90,
    summary: {
      pl: "Multimedialne muzeum pod płytą Rynku – średniowieczny Kraków odkryty przez archeologów.",
      en: "Multimedia museum beneath the square showing medieval Kraków uncovered by archaeologists.",
    },
    facts: [
      "Muzeum otwarto w 2010 roku po wieloletnich badaniach archeologicznych pod Rynkiem.",
      "To oddział Muzeum Krakowa; trasa prowadzi wśród oryginalnych reliktów średniowiecznych kramów i dróg.",
    ],
    tips: "Bilety na konkretną godzinę – w sezonie warto rezerwować wcześniej.",
  },
  {
    id: "krzysztofory",
    name: { pl: "Pałac Krzysztofory – Muzeum Krakowa", en: "Krzysztofory Palace – Museum of Kraków" },
    lat: 50.06223, lon: 19.93625, category: "museum", district: "Stare Miasto",
    tags: ["history", "museums", "art"], radius: 35, visitMin: 60,
    summary: {
      pl: "Siedziba główna Muzeum Krakowa przy Rynku.",
      en: "Main seat of the Museum of Kraków on the Main Square.",
    },
    facts: [
      "Pałac jest siedzibą główną Muzeum Krakowa.",
      "W piwnicach działała Galeria Krzysztofory związana z Tadeuszem Kantorem i Grupą Krakowską.",
      "W muzeum prezentowane są nagrodzone szopki krakowskie.",
    ],
  },
  {
    id: "collegium-maius",
    name: { pl: "Collegium Maius", en: "Collegium Maius" },
    lat: 50.06128, lon: 19.93368, category: "university", district: "Stare Miasto",
    tags: ["history", "museums", "architecture", "university"], radius: 45, visitMin: 45,
    summary: {
      pl: "Najstarszy budynek Uniwersytetu Jagiellońskiego z pięknym gotyckim dziedzińcem.",
      en: "The oldest building of the Jagiellonian University with a beautiful Gothic courtyard.",
    },
    facts: [
      "Uniwersytet Jagielloński założył Kazimierz Wielki w 1364 roku – to najstarsza uczelnia w Polsce.",
      "Na uniwersytecie studiował Mikołaj Kopernik.",
      "Na dziedzińcu znajduje się zegar z ruchomymi figurkami, które kilka razy dziennie przesuwają się przy muzyce.",
    ],
  },
  {
    id: "collegium-novum-planty",
    name: { pl: "Collegium Novum i Planty", en: "Collegium Novum & Planty Park" },
    lat: 50.0611, lon: 19.9330, category: "park", district: "Stare Miasto",
    tags: ["history", "nature", "university"], radius: 50, visitMin: 20,
    summary: {
      pl: "Neogotycki gmach główny UJ i Planty – park otaczający Stare Miasto.",
      en: "The neo-Gothic main building of the Jagiellonian University and the Planty park ring.",
    },
    facts: [
      "Collegium Novum zbudowano w latach 1883–1887 jako gmach główny uniwersytetu.",
      "Planty powstały w XIX wieku w miejscu rozebranych murów miejskich i otaczają Stare Miasto pierścieniem o długości około 4 km.",
    ],
  },
  {
    id: "sw-anna",
    name: { pl: "Kolegiata św. Anny", en: "St. Anne's Collegiate Church" },
    lat: 50.0623, lon: 19.9338, category: "church", district: "Stare Miasto",
    tags: ["churches", "architecture", "art"], radius: 35, visitMin: 15,
    summary: {
      pl: "Barokowy kościół akademicki Uniwersytetu Jagiellońskiego.",
      en: "The Baroque academic church of the Jagiellonian University.",
    },
    facts: ["Kościół zaprojektował Tylman z Gameren; zbudowano go na przełomie XVII i XVIII wieku."],
  },
  {
    id: "brama-florianska",
    name: { pl: "Brama Floriańska", en: "St. Florian's Gate" },
    lat: 50.06495, lon: 19.94137, category: "monument", district: "Stare Miasto",
    tags: ["history", "architecture", "art"], radius: 50, visitMin: 10,
    summary: {
      pl: "XIV-wieczna brama miejska – początek Drogi Królewskiej na Wawel.",
      en: "14th-century city gate – the start of the Royal Road to Wawel.",
    },
    facts: [
      "Brama jest częścią średniowiecznych fortyfikacji, z których większość rozebrano w XIX wieku.",
      "Tędy wjeżdżali do miasta królowie – Droga Królewska prowadziła ul. Floriańską, przez Rynek i ul. Grodzką na Wawel.",
      "Przy murach obok bramy artyści wystawiają i sprzedają obrazy.",
    ],
  },
  {
    id: "barbakan",
    name: { pl: "Barbakan", en: "Barbican" },
    lat: 50.06548, lon: 19.94179, category: "monument", district: "Stare Miasto",
    tags: ["history", "architecture", "kids"], radius: 55, visitMin: 20,
    summary: {
      pl: "Gotycka okrągła strażnica z końca XV wieku – jedna z niewielu zachowanych w Europie.",
      en: "A round Gothic outwork from the late 15th century – one of few surviving in Europe.",
    },
    facts: [
      "Barbakan zbudowano pod koniec XV wieku do obrony Bramy Floriańskiej.",
      "To jeden z nielicznych zachowanych barbakanów w Europie; dziś to oddział Muzeum Krakowa.",
    ],
  },
  {
    id: "czartoryscy",
    name: { pl: "Muzeum Książąt Czartoryskich", en: "Czartoryski Museum" },
    lat: 50.0647, lon: 19.9395, category: "museum", district: "Stare Miasto",
    tags: ["art", "museums", "history"], radius: 40, visitMin: 75,
    summary: {
      pl: "Tu wisi „Dama z gronostajem” Leonarda da Vinci.",
      en: "Home of Leonardo da Vinci's “Lady with an Ermine”.",
    },
    facts: [
      "Kolekcję zapoczątkowała księżna Izabela Czartoryska w Puławach na początku XIX wieku – to jedno z najstarszych muzeów w Polsce.",
      "Najcenniejszym dziełem jest „Dama z gronostajem” Leonarda da Vinci.",
      "Muzeum jest oddziałem Muzeum Narodowego w Krakowie.",
    ],
  },
  {
    id: "teatr-slowackiego",
    name: { pl: "Teatr im. Juliusza Słowackiego", en: "Juliusz Słowacki Theatre" },
    lat: 50.06441, lon: 19.94355, category: "theatre", district: "Stare Miasto",
    tags: ["architecture", "art"], radius: 50, visitMin: 10,
    summary: {
      pl: "Eklektyczny teatr z 1893 roku, wzorowany na paryskiej operze.",
      en: "An eclectic theatre from 1893 modelled on the Paris Opera.",
    },
    facts: ["Teatr otwarto w 1893 roku; projektował go Jan Zawiejski, inspirując się Operą Garnier w Paryżu."],
  },
  {
    id: "pomnik-grunwaldzki",
    name: { pl: "Pomnik Grunwaldzki", en: "Grunwald Monument" },
    lat: 50.06737, lon: 19.94163, category: "monument", district: "Kleparz",
    tags: ["history"], radius: 45, visitMin: 5,
    summary: {
      pl: "Pomnik na Placu Matejki upamiętniający bitwę pod Grunwaldem.",
      en: "Monument on Matejko Square commemorating the Battle of Grunwald.",
    },
    facts: [
      "Pomnik ufundował Ignacy Jan Paderewski; odsłonięto go w 1910 roku, w 500. rocznicę bitwy.",
      "Niemcy zniszczyli go w czasie II wojny światowej; odbudowano go w 1976 roku.",
    ],
  },
  {
    id: "stary-kleparz",
    name: { pl: "Targ Stary Kleparz", en: "Stary Kleparz Market" },
    lat: 50.0677, lon: 19.9391, category: "market", district: "Kleparz",
    tags: ["food"], radius: 45, visitMin: 30,
    summary: {
      pl: "Jeden z najstarszych targów Krakowa – owoce, warzywa, sery, kwiaty.",
      en: "One of Kraków's oldest markets – fruit, vegetables, cheese and flowers.",
    },
    facts: ["Targ na Kleparzu działa od średniowiecza; to dobre miejsce na lokalne produkty i oscypki."],
  },
  {
    id: "franciszkanie",
    name: { pl: "Bazylika Franciszkanów", en: "Franciscan Basilica" },
    lat: 50.05928, lon: 19.93533, category: "church", district: "Stare Miasto",
    tags: ["churches", "art", "history"], radius: 45, visitMin: 20,
    summary: {
      pl: "Gotycka bazylika z secesyjnymi witrażami Stanisława Wyspiańskiego.",
      en: "Gothic basilica with Art Nouveau stained glass by Stanisław Wyspiański.",
    },
    facts: [
      "Wnętrze zdobią polichromie i witraże Stanisława Wyspiańskiego, w tym słynny witraż „Bóg Ojciec – Stań się”.",
      "Jan Paweł II często modlił się tu, gdy był biskupem krakowskim.",
    ],
  },
  {
    id: "okno-papieskie",
    name: { pl: "Pałac Biskupi – Okno Papieskie", en: "Bishop's Palace – Papal Window" },
    lat: 50.05977, lon: 19.93491, category: "monument", district: "Stare Miasto",
    tags: ["history", "churches"], radius: 35, visitMin: 5,
    summary: {
      pl: "Okno, z którego Jan Paweł II rozmawiał z wiernymi podczas pielgrzymek.",
      en: "The window from which John Paul II spoke to crowds during his visits.",
    },
    facts: ["Podczas pielgrzymek Jan Paweł II wieczorami rozmawiał z ludźmi zgromadzonymi pod oknem przy ul. Franciszkańskiej 3."],
  },
  {
    id: "dominikanie",
    name: { pl: "Bazylika Dominikanów", en: "Dominican Basilica" },
    lat: 50.05935, lon: 19.93884, category: "church", district: "Stare Miasto",
    tags: ["churches", "history", "architecture"], radius: 45, visitMin: 20,
    summary: {
      pl: "XIII-wieczna gotycka bazylika Świętej Trójcy z pięknym krużgankiem.",
      en: "13th-century Gothic Basilica of the Holy Trinity with a lovely cloister.",
    },
    facts: ["Dominikanie przybyli do Krakowa w 1222 roku; obecna bazylika ma gotycki rodowód."],
  },
  {
    id: "piotr-pawel",
    name: { pl: "Kościół św. Piotra i Pawła", en: "Church of Sts. Peter and Paul" },
    lat: 50.05736, lon: 19.93866, category: "church", district: "Stare Miasto",
    tags: ["churches", "architecture", "history"], radius: 45, visitMin: 15,
    summary: {
      pl: "Pierwsza barokowa budowla Krakowa z figurami 12 apostołów przed fasadą.",
      en: "Kraków's first Baroque building with statues of the 12 apostles out front.",
    },
    facts: [
      "Kościół wznieśli jezuici na początku XVII wieku – to pierwsza w pełni barokowa budowla w mieście.",
      "Przed fasadą stoją figury dwunastu apostołów.",
      "W kościele organizowane są pokazy wahadła Foucaulta, a w kryptach powstał Panteon Narodowy.",
    ],
  },
  {
    id: "sw-andrzej",
    name: { pl: "Kościół św. Andrzeja", en: "St. Andrew's Church" },
    lat: 50.05681, lon: 19.93847, category: "church", district: "Stare Miasto",
    tags: ["churches", "history", "architecture"], radius: 35, visitMin: 10,
    summary: {
      pl: "Romański kościół-twierdza z XI wieku przy ul. Grodzkiej.",
      en: "An 11th-century Romanesque fortress-church on Grodzka Street.",
    },
    facts: [
      "Kościół zbudowano pod koniec XI wieku; ma charakter obronny.",
      "Według tradycji w czasie najazdu tatarskiego w 1241 roku schronili się w nim mieszkańcy i przetrwali.",
    ],
  },
  {
    id: "kanonicza",
    name: { pl: "Ulica Kanonicza", en: "Kanonicza Street" },
    lat: 50.0564, lon: 19.93745, category: "street", district: "Stare Miasto",
    tags: ["history", "architecture"], radius: 60, visitMin: 15,
    summary: {
      pl: "Jedna z najpiękniejszych i najstarszych ulic Krakowa, prowadząca pod Wawel.",
      en: "One of Kraków's oldest and most beautiful streets, leading to Wawel.",
    },
    facts: [
      "Przy ulicy mieszkali kanonicy kapituły wawelskiej – stąd nazwa.",
      "Karol Wojtyła mieszkał przy Kanoniczej; w kamienicach nr 19–21 działa dziś Muzeum Archidiecezjalne.",
    ],
  },
  {
    id: "wawel-zamek",
    name: { pl: "Zamek Królewski na Wawelu", en: "Wawel Royal Castle" },
    lat: 50.0541, lon: 19.93545, category: "castle", district: "Wawel",
    tags: ["history", "museums", "architecture", "art", "kids"], radius: 90, visitMin: 120,
    summary: {
      pl: "Rezydencja polskich królów z renesansowym arkadowym dziedzińcem i kolekcją arrasów.",
      en: "Residence of Polish kings with a Renaissance arcaded courtyard and famous tapestries.",
    },
    facts: [
      "Przez wieki Wawel był siedzibą polskich królów.",
      "Renesansowy dziedziniec z arkadami powstał na początku XVI wieku za Zygmunta Starego; pracowali tu włoscy architekci, m.in. Franciszek Florentczyk i Bartolomeo Berrecci.",
      "Zamek słynie z kolekcji arrasów (gobelinów) Zygmunta Augusta.",
    ],
    tips: "Wstęp na wzgórze jest bezpłatny; wystawy są biletowane osobno, w sezonie z limitami – warto kupić bilety wcześniej.",
  },
  {
    id: "katedra-wawelska",
    name: { pl: "Katedra Wawelska", en: "Wawel Cathedral" },
    lat: 50.05465, lon: 19.93521, category: "church", district: "Wawel",
    tags: ["history", "churches", "architecture", "views"], radius: 55, visitMin: 60,
    summary: {
      pl: "Miejsce koronacji i pochówku polskich królów, z Dzwonem Zygmunta i Kaplicą Zygmuntowską.",
      en: "Coronation and burial site of Polish kings, with the Sigismund Bell and Chapel.",
    },
    facts: [
      "W katedrze koronowano i chowano polskich królów.",
      "Dzwon Zygmunt odlano w 1520 roku; bije tylko w szczególnych okolicznościach.",
      "Kaplica Zygmuntowska ze złotą kopułą uchodzi za perłę renesansu na północ od Alp.",
      "W kryptach spoczywają m.in. Tadeusz Kościuszko, Adam Mickiewicz i Józef Piłsudski.",
    ],
  },
  {
    id: "smok-wawelski",
    name: { pl: "Smocza Jama i Smok Wawelski", en: "Dragon's Den & Wawel Dragon" },
    lat: 50.05303, lon: 19.93324, category: "monument", district: "Wawel",
    tags: ["kids", "history"], radius: 50, visitMin: 20,
    summary: {
      pl: "Jaskinia legendarnego smoka i ziejący ogniem pomnik nad Wisłą.",
      en: "The legendary dragon's cave and a fire-breathing statue by the Vistula.",
    },
    facts: [
      "Według legendy smoka pokonał szewczyk Skuba, podrzucając mu owcę wypchaną siarką.",
      "Pomnik smoka z brązu autorstwa Bronisława Chromego stoi od 1972 roku i co kilka minut zieje ogniem.",
    ],
  },
  {
    id: "skalka",
    name: { pl: "Skałka – Sanktuarium Paulinów", en: "Skałka Pauline Sanctuary" },
    lat: 50.0493, lon: 19.93808, category: "church", district: "Kazimierz",
    tags: ["churches", "history"], radius: 50, visitMin: 25,
    summary: {
      pl: "Miejsce męczeństwa św. Stanisława z Kryptą Zasłużonych.",
      en: "Site of St. Stanislaus's martyrdom with the Crypt of the Distinguished.",
    },
    facts: [
      "Według tradycji w 1079 roku zginął tu biskup Stanisław ze Szczepanowa.",
      "W Krypcie Zasłużonych spoczywają m.in. Jan Długosz, Stanisław Wyspiański, Jacek Malczewski, Karol Szymanowski i Czesław Miłosz.",
    ],
  },
  {
    id: "plac-nowy",
    name: { pl: "Plac Nowy i Okrąglak", en: "Plac Nowy & the Okrąglak" },
    lat: 50.0514, lon: 19.9447, category: "square", district: "Kazimierz",
    tags: ["food", "nightlife", "history"], radius: 60, visitMin: 30,
    summary: {
      pl: "Serce Kazimierza – słynne zapiekanki z okienek Okrąglaka, pchli targ i nocne życie.",
      en: "The heart of Kazimierz – famous zapiekanka stalls, a flea market and nightlife.",
    },
    facts: [
      "Okrągły budynek pośrodku placu (Okrąglak) zbudowano ok. 1900 roku jako halę targową; później działała tam rytualna rzeźnia drobiu.",
      "Dziś okienka Okrąglaka słyną z zapiekanek – kultowej przekąski.",
      "Wokół placu działa wiele kawiarni i barów; w weekendy odbywają się tu targi.",
    ],
  },
  {
    id: "synagoga-stara",
    name: { pl: "Stara Synagoga", en: "Old Synagogue" },
    lat: 50.05158, lon: 19.94886, category: "jewish", district: "Kazimierz",
    tags: ["jewish", "history", "museums"], radius: 45, visitMin: 40,
    summary: {
      pl: "Najstarsza zachowana synagoga w Polsce, dziś muzeum historii Żydów krakowskich.",
      en: "Poland's oldest surviving synagogue building, now a museum of Kraków's Jewish history.",
    },
    facts: [
      "Budynek pochodzi z XV wieku i jest najstarszą zachowaną synagogą w Polsce.",
      "Mieści oddział Muzeum Krakowa poświęcony historii i kulturze Żydów.",
      "Stoi przy ul. Szerokiej – dawnym centrum żydowskiego Kazimierza.",
    ],
  },
  {
    id: "remuh",
    name: { pl: "Synagoga Remuh i Stary Cmentarz", en: "Remuh Synagogue & Old Cemetery" },
    lat: 50.05275, lon: 19.94847, category: "jewish", district: "Kazimierz",
    tags: ["jewish", "history"], radius: 40, visitMin: 25,
    summary: {
      pl: "Czynna XVI-wieczna synagoga i jeden z najstarszych cmentarzy żydowskich w Europie.",
      en: "An active 16th-century synagogue and one of Europe's oldest Jewish cemeteries.",
    },
    facts: [
      "Synagogę zbudowano w XVI wieku; nazwa pochodzi od rabina Mojżesza Isserlesa zwanego Remuh.",
      "Grób Remuha na sąsiednim cmentarzu jest celem pielgrzymek.",
      "Mężczyźni powinni nakryć głowę przy wejściu.",
    ],
  },
  {
    id: "tempel",
    name: { pl: "Synagoga Tempel", en: "Tempel Synagogue" },
    lat: 50.0522, lon: 19.944, category: "jewish", district: "Kazimierz",
    tags: ["jewish", "architecture", "art"], radius: 35, visitMin: 20,
    summary: {
      pl: "Postępowa synagoga z XIX wieku o bogatym, mauretańskim wnętrzu.",
      en: "A 19th-century progressive synagogue with a rich Moorish-revival interior.",
    },
    facts: [
      "Synagogę wzniesiono w latach 60. XIX wieku dla postępowej gminy żydowskiej.",
      "Podczas Festiwalu Kultury Żydowskiej odbywają się tu koncerty.",
    ],
  },
  {
    id: "bozego-ciala",
    name: { pl: "Bazylika Bożego Ciała", en: "Corpus Christi Basilica" },
    lat: 50.04955, lon: 19.9445, category: "church", district: "Kazimierz",
    tags: ["churches", "history", "architecture"], radius: 45, visitMin: 20,
    summary: {
      pl: "Gotycka bazylika ufundowana przez Kazimierza Wielkiego w chrześcijańskiej części Kazimierza.",
      en: "Gothic basilica founded by King Casimir the Great in the Christian part of Kazimierz.",
    },
    facts: [
      "Miasto Kazimierz lokował Kazimierz Wielki w 1335 roku; kościół Bożego Ciała ufundował w 1340 roku.",
    ],
  },
  {
    id: "kladka-bernatka",
    name: { pl: "Kładka Ojca Bernatka", en: "Father Bernatek Footbridge" },
    lat: 50.0476, lon: 19.9493, category: "bridge", district: "Kazimierz/Podgórze",
    tags: ["views", "art", "architecture"], radius: 60, visitMin: 10,
    summary: {
      pl: "Kładka pieszo-rowerowa nad Wisłą z rzeźbami akrobatów, łącząca Kazimierz z Podgórzem.",
      en: "Pedestrian bridge over the Vistula with acrobat sculptures, linking Kazimierz and Podgórze.",
    },
    facts: [
      "Kładkę otwarto w 2010 roku; jej patronem jest ojciec Laetus Bernatek.",
      "Nad kładką balansują rzeźby akrobatów autorstwa Jerzego Kędziory.",
      "Zakochani wieszają tu kłódki.",
    ],
  },
  {
    id: "plac-bohaterow-getta",
    name: { pl: "Plac Bohaterów Getta i Apteka pod Orłem", en: "Ghetto Heroes Square & Eagle Pharmacy" },
    lat: 50.0468, lon: 19.9542, category: "memorial", district: "Podgórze",
    tags: ["jewish", "history", "ww2", "museums"], radius: 70, visitMin: 40,
    summary: {
      pl: "Miejsce pamięci krakowskiego getta – instalacja z pustych krzeseł i apteka Tadeusza Pankiewicza.",
      en: "Memorial of the Kraków Ghetto – the empty chairs installation and Tadeusz Pankiewicz's pharmacy.",
    },
    facts: [
      "W latach 1941–1943 w Podgórzu istniało getto, do którego Niemcy przesiedlili Żydów krakowskich.",
      "Na placu stoi instalacja z kilkudziesięciu krzeseł z brązu, upamiętniająca deportacje.",
      "Apteka pod Orłem Tadeusza Pankiewicza była jedyną apteką w getcie; aptekarz pomagał jego mieszkańcom. Dziś to oddział Muzeum Krakowa.",
    ],
  },
  {
    id: "schindler-mocak",
    name: { pl: "Fabryka Schindlera i MOCAK", en: "Schindler's Factory & MOCAK" },
    lat: 50.0477, lon: 19.9616, category: "museum", district: "Zabłocie",
    tags: ["history", "ww2", "museums", "art"], radius: 70, visitMin: 120,
    summary: {
      pl: "Muzeum okupacyjnego Krakowa w dawnej fabryce Oskara Schindlera i sąsiednie muzeum sztuki współczesnej.",
      en: "A museum of occupied Kraków in Oskar Schindler's former factory, next to the contemporary art museum.",
    },
    facts: [
      "Oskar Schindler prowadził tu fabrykę naczyń emaliowanych i ocalił około 1200 Żydów.",
      "Wystawa „Kraków – czas okupacji 1939–1945” to oddział Muzeum Krakowa.",
      "Obok działa MOCAK – Muzeum Sztuki Współczesnej, otwarte w 2011 roku.",
    ],
    tips: "Wejścia na wystawę w Fabryce Schindlera są o określonych godzinach – w sezonie bilety warto kupić z wyprzedzeniem.",
  },
  {
    id: "kopiec-kosciuszki",
    name: { pl: "Kopiec Kościuszki", en: "Kościuszko Mound" },
    lat: 50.05486, lon: 19.89335, category: "viewpoint", district: "Zwierzyniec",
    tags: ["views", "history", "nature"], radius: 120, visitMin: 60,
    summary: {
      pl: "Kopiec usypany w XIX wieku na cześć Tadeusza Kościuszki – jedna z najlepszych panoram Krakowa.",
      en: "A 19th-century mound honouring Tadeusz Kościuszko – one of the best panoramas of Kraków.",
    },
    facts: [
      "Kopiec usypano w latach 1820–1823; w jego wnętrzu złożono ziemię z pól bitewnych Kościuszki.",
      "Otacza go XIX-wieczny austriacki fort.",
      "Przy dobrej widoczności widać stąd Tatry.",
    ],
  },
  {
    id: "kopiec-krakusa",
    name: { pl: "Kopiec Krakusa", en: "Krakus Mound" },
    lat: 50.03803, lon: 19.95834, category: "viewpoint", district: "Podgórze",
    tags: ["views", "history", "nature"], radius: 100, visitMin: 40,
    summary: {
      pl: "Najstarszy kopiec Krakowa, według legendy grób założyciela miasta – bezpłatny punkt widokowy.",
      en: "Kraków's oldest mound, by legend the grave of the city's founder – a free viewpoint.",
    },
    facts: [
      "Kopiec ma prehistoryczne pochodzenie; legenda wiąże go z grobem króla Kraka.",
      "Wstęp jest bezpłatny; ze szczytu widać panoramę Starego Miasta i Wawelu.",
    ],
  },
  {
    id: "muzeum-narodowe",
    name: { pl: "Muzeum Narodowe – Gmach Główny", en: "National Museum – Main Building" },
    lat: 50.06042, lon: 19.9235, category: "museum", district: "Czarna Wieś",
    tags: ["art", "museums", "history"], radius: 60, visitMin: 120,
    summary: {
      pl: "Główny gmach Muzeum Narodowego z galerią sztuki polskiej XX wieku.",
      en: "The National Museum's main building with a gallery of 20th-century Polish art.",
    },
    facts: ["W Gmachu Głównym prezentowana jest m.in. sztuka polska XX i XXI wieku oraz kolekcja broni i barwy."],
  },
  {
    id: "blonia",
    name: { pl: "Błonia", en: "Błonia Meadow" },
    lat: 50.06, lon: 19.9105, category: "park", district: "Zwierzyniec",
    tags: ["nature", "kids"], radius: 200, visitMin: 30,
    summary: {
      pl: "Ogromna łąka w środku miasta – miejsce papieskich mszy, koncertów i spacerów.",
      en: "A huge meadow in the city – venue for papal masses, concerts and walks.",
    },
    facts: ["Błonia mają blisko 50 hektarów; odbywały się tu msze papieskie Jana Pawła II i Benedykta XVI."],
  },
  {
    id: "manggha",
    name: { pl: "Muzeum Manggha", en: "Manggha Museum" },
    lat: 50.05093, lon: 19.9321, category: "museum", district: "Dębniki",
    tags: ["art", "museums", "views"], radius: 50, visitMin: 60,
    summary: {
      pl: "Muzeum Sztuki i Techniki Japońskiej z widokiem na Wawel.",
      en: "Museum of Japanese Art and Technology with a view of Wawel.",
    },
    facts: [
      "Muzeum powstało z inicjatywy Andrzeja Wajdy; budynek zaprojektował Arata Isozaki, a otwarto je w 1994 roku.",
      "Podstawą kolekcji są zbiory Feliksa Jasieńskiego, który używał pseudonimu „Manggha”.",
    ],
  },
  {
    id: "ogrod-botaniczny",
    name: { pl: "Ogród Botaniczny UJ", en: "Jagiellonian University Botanic Garden" },
    lat: 50.06308, lon: 19.95604, category: "park", district: "Wesoła",
    tags: ["nature", "kids"], radius: 80, visitMin: 60,
    summary: {
      pl: "Najstarszy ogród botaniczny w Polsce, założony w 1783 roku.",
      en: "Poland's oldest botanic garden, founded in 1783.",
    },
    facts: ["Ogród założono w 1783 roku; ma szklarnie z roślinami tropikalnymi i historyczne drzewa."],
    tips: "Ogród jest otwarty sezonowo (zwykle wiosna–jesień); wstęp płatny.",
  },
  {
    id: "maly-rynek",
    name: { pl: "Mały Rynek", en: "Small Market Square" },
    lat: 50.06165, lon: 19.94085, category: "square", district: "Stare Miasto",
    tags: ["history", "food"], radius: 45, visitMin: 10,
    summary: {
      pl: "Kameralny plac za Bazyliką Mariacką, dawniej targ mięsny.",
      en: "A quiet square behind St. Mary's, once the meat market.",
    },
    facts: ["W średniowieczu na Małym Rynku handlowano m.in. mięsem; dziś to spokojniejsza alternatywa dla Rynku Głównego."],
  },
  {
    id: "nowa-huta",
    name: { pl: "Nowa Huta – Plac Centralny", en: "Nowa Huta – Central Square" },
    lat: 50.07207, lon: 20.03775, category: "square", district: "Nowa Huta",
    tags: ["history", "architecture"], radius: 120, visitMin: 90,
    summary: {
      pl: "Socrealistyczne miasto idealne budowane od 1949 roku wokół kombinatu metalurgicznego.",
      en: "A socialist-realist planned city built from 1949 around a steelworks.",
    },
    facts: [
      "Nowa Huta była budowana od 1949 roku jako wzorcowe socjalistyczne miasto przy kombinacie metalurgicznym.",
      "Plac Centralny nosi dziś imię Ronalda Reagana.",
    ],
  },
  {
    id: "muzeum-lotnictwa",
    name: { pl: "Muzeum Lotnictwa Polskiego", en: "Polish Aviation Museum" },
    lat: 50.0772, lon: 19.9955, category: "museum", district: "Czyżyny",
    tags: ["museums", "kids", "history"], radius: 120, visitMin: 120,
    summary: {
      pl: "Jedno z największych muzeów lotnictwa w Europie, na terenie dawnego lotniska Rakowice-Czyżyny.",
      en: "One of Europe's largest aviation museums, on the former Rakowice-Czyżyny airfield.",
    },
    facts: ["Muzeum mieści się na terenie jednego z najstarszych lotnisk w Europie; prezentuje ponad sto statków powietrznych."],
  },
  {
    id: "zakrzowek",
    name: { pl: "Zakrzówek", en: "Zakrzówek Lagoon" },
    lat: 50.0378, lon: 19.9118, category: "park", district: "Dębniki",
    tags: ["nature", "views"], radius: 150, visitMin: 60,
    summary: {
      pl: "Zalany dawny kamieniołom wapienia z turkusową wodą i skałami.",
      en: "A flooded former limestone quarry with turquoise water and cliffs.",
    },
    facts: ["To dawny kamieniołom wapienia wypełniony wodą; w sezonie letnim działa tu miejskie kąpielisko."],
  },
  {
    id: "tyniec",
    name: { pl: "Opactwo Benedyktynów w Tyńcu", en: "Tyniec Benedictine Abbey" },
    lat: 50.0197, lon: 19.8113, category: "church", district: "Tyniec",
    tags: ["history", "churches", "views", "nature"], radius: 150, visitMin: 90,
    summary: {
      pl: "Opactwo na wapiennej skale nad Wisłą, jedno z najstarszych w Polsce.",
      en: "An abbey on a limestone cliff above the Vistula, one of Poland's oldest.",
    },
    facts: ["Tradycja wiąże fundację opactwa z królem Kazimierzem Odnowicielem i rokiem 1044."],
  },
];

export const CATEGORY_LABELS = {
  square: { pl: "plac", en: "square" },
  church: { pl: "kościół", en: "church" },
  castle: { pl: "zamek", en: "castle" },
  museum: { pl: "muzeum", en: "museum" },
  monument: { pl: "zabytek", en: "monument" },
  street: { pl: "ulica", en: "street" },
  jewish: { pl: "dziedzictwo żydowskie", en: "Jewish heritage" },
  park: { pl: "park", en: "park" },
  viewpoint: { pl: "punkt widokowy", en: "viewpoint" },
  bridge: { pl: "kładka", en: "bridge" },
  market: { pl: "targ", en: "market" },
  memorial: { pl: "miejsce pamięci", en: "memorial" },
  theatre: { pl: "teatr", en: "theatre" },
  university: { pl: "uniwersytet", en: "university" },
};

export const attractionById = new Map(ATTRACTIONS.map((a) => [a.id, a]));
