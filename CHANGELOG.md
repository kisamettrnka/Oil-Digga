# Changelog

Co se ve hře změnilo, z pohledu hráče. Každá novinka má záznam ve stejném commitu, ve kterém vzniká (viz CLAUDE.md). Nejnovější nahoře.

## Nevydáno

### Rychlejší a úspornější hra
- Závod „každý svou mapu“ počítá server (svět na hráče ze stejného seedu), takže nejde podvádět hlášením peněz a žebříček je přesný.
- Akce na sdílené mapě se projeví hned, bez čekání na odpověď serveru.
- Server posílá každému hráči jen ložiska a rizika, která zná; cizí tajemství nejde vyčíst z prohlížeče a zprávy jsou kratší.
- Při pauze a otevřené mapě se scéna nepřekresluje naplno, záře se kreslí z předpřipravených kotoučů, HUD se obnovuje 4× za sekundu a při slabém výkonu hra sama sníží rozlišení plátna.

### Ostré plátno, větší ceníky, Soupeři na tlačítko
- Plátno se kreslí v rozlišení obrazovky (i na retině), takže scéna, cedule a ceníky už nejsou rozmazané.
- Ceníky kupců jsou větší a čitelnější.
- Panel Soupeři na sdílené mapě se otevírá tlačítkem vpravo nahoře nebo klávesou P, aby nezakrýval vrty.

### Ubývání ložiska
- Ložisko je dutina ve skále s hladinou ropy, která s těžbou klesá ode stropu ke dnu (s ryskami po čtvrtinách); vyčerpané zůstane prázdná tmavá dutina. Cedulka ložiska má ukazatel zbytku, pod čtvrtinou červený.

### Volba kupce, kalendář v multiplayeru, kratší dražby
- Vrtný protokol, Zakázky, Soupeři a průvodce jsou větší a čitelnější.
- Na každém ceníku je razítko „Vozit sem“: všechny tvé vozy pak jezdí k tomu kupci (dokud nezavře), další klik to zruší a vozy si zase vybírají podle ceny.
- V závodě a na sdílené mapě zmizelo ovládání času, zůstal jen kalendář; čas tam řídí server.
- Dražba claimu končí 7,5 s (tři čtvrtě dne) po posledním příhozu, bylo 2 dny.

### Kamera v nouzi
- Při přetlaku, plynovém kopanci a erupci na vlastním vrtu kamera na vrt najede a po 7 s se vrátí, pokud s ní hráč mezitím nehnul. V Předvolbách jde vypnout (Kamera: Zůstane).

### Průvodce první hrou
- Nová sólo hra vede hráče desíti radami na lístku pod lištou zdrojů: claim, vrt, trasa vrtu, preventer a korunka, povoz, kupci a sklady, tlak, zakázky, mapa, éry. Tlačítko, o kterém je řeč, pulzuje. Průvodce jde přeskočit, po dokončení se už neukáže, v Předvolbách jde vypnout.

### Dobové zprávy a nebe
- Mimořádné zprávy jsou z let 1880–1910: cla Kongresu, válka na Balkáně, vysychající Pensylvánie, gejzír v Texasu, Standard Oil, panika na burze, hurikán v Galvestonu. Některé chodí jen v určité éře (vozkové vs. šoféři, Edison, Ford).
- Nad táborem létá horkovzdušný balon, vzducholoď přiletí až s Železnicí a dvouplošník s Automobilem.

### Ropovod a vlečka
- Vrt může mít vlastní odbyt bez vozů: od Boomtownu ropovod k libovolnému kupci (cena podle vzdálenosti, 40 bbl/den), od Železnice vlečka na nádraží ($700, 100 bbl/den). Staví se z Vrtného protokolu, kupec platí za stálý odběr o 8 % víc a stávka na něj nemá vliv.
- Ropovod se zastaví, když má kupec zásobu na den a víc, aby mu nesrazil cenu (zásoba na půl dne); vozy mezitím odvezou zbytek jinam.

### Sdílená mapa: dražby, obchod, kartel a sabotáž
- Claim na sdílené mapě se nekupuje, ale draží: první zájemce přihodí cenu, ostatní mohou přihazovat, dražba končí tři čtvrtě dne po posledním příhozu. Kdo na konci nemá peníze, o claim přijde.
- Panel Soupeři: nabídni jinému hráči ropu ze svých zásobníků za pevnou cenu (přelije se mu do nádrží), navrhni kartel, nebo zaplať stávku jeho řidičů.
- Kartel: dohoda nevozit ropu jednomu kupci, aby mu vyschl sklad a cena vyletěla. Nic ho nevynucuje. Kdo tam přesto doveze, kartel rozbije a všichni se to dozví.
- Stávka: za $500 stojí vozy soupeře 1,5 dne. Ve 40 % případů se provalí, kdo platil.

### Claimy a mapa průzkumu
- Pozemky jsou nepravidelné claimy různé šířky s terénem: Rovina, Kopec (vrt a silo stojí 1,5×, claim levnější), Řeka (vtláčení vody za 35 %, claim dražší) a Skála (žula pod povrchem, pomalý začátek vrtu, claim nejlevnější). Cedule ukazuje terén a šířku, kopce, řeky s mostkem a balvany jsou vidět na desce.
- Nová mapa geologického průzkumu (tlačítko vpravo nahoře nebo klávesa G): papírový list s claimy, vrstvami hornin, známými ložisky, plynem a vodou, trasami vrtů a legendou. Kliknutím na claim ho koupíš nebo otevřeš protokol svého vrtu.

### Předvolby
- Nové tlačítko vpravo nahoře (nebo klávesa O) otevře formulář Předvolby: zvuk, hlasitost, otřesy obrazu, život ve scéně (plný, nebo úsporný bez chodců, provozu, letadel a ohňostrojů a s méně kouřem, šetří výkon), zvláštní vydání novin přes obrazovku nebo jen telegramem s titulkem a dopadem na trh a zobrazování reklam. Volby si hra pamatuje v prohlížeči.

### Reklamní vzducholoď
- Vzducholoď nad městem vleče plátěný transparent s lampami, reklamu na sesterský projekt priceguessr.eu. Klik na vzducholoď otevře web (v Discordu přes jeho vlastní dialog).

## 2026-10-08

### Město jako trh
- Místo dvou výkupců po stranách kupují čtyři podniky: Rafinerie (velký odběr), Petrolejka (málo, ale draze), Nádraží (export bez limitu, od éry Železnice) a Benzinka (nejdráž, od éry Automobil).
- Každý kupec má sklad, který město spotřebovává. Plný sklad znamená nižší cenu, prázdný vyšší.
- Vozy si kupce volí samy podle očekávané ceny. Ruční přidělování šipkami a kolečkem zmizelo, kolečko jen přibližuje.
- Zakázky chodí telegramem: dodej X barelů do N dní za pevnou cenu. Za propadlou zakázku je penále. Nejvýš dvě zakázky naráz.
- Město roste podle dodané ropy: Tábor → Boomtown → Železnice → Automobil. Stany se mění v boudy, domy, cihlové bloky s neony; ulice z prachu na asfalt; petrolejové lampy na elektrické; povozy na auta. Do éry Železnice vozí ropu koňské povozy, stavba trati stojí tam, kde později vyroste nádraží.
- Světové zprávy hýbou kupci různě (Hormuz zvedne hlavně export), přibyly zprávy Tuhá zima, Edison a Ford.

### Vrtání jako proces a živé ložisko
- Klikání do podzemí plánuje trasu, vrták po ní jede reálným časem a platí se za každý vyvrtaný metr podle horniny (jíl, pískovec, břidlice, vápenec, žula). Podzemí ukazuje vrstvy jako geologický řez.
- Korunka se opotřebovává, tupá zastaví vrták, výměna stojí peníze a čas.
- Plynové kapsy způsobí kopanec: pár sekund na zavření preventeru, jinak erupce s pokutou. Zvodnělé vrstvy zavodní vrt, cementace to spraví.
- Ložisko má tlak, který s těžbou klesá, hlubší ložiska jsou bohatší. Do jednoho ložiska smí víc vrtů. Vrt jde přepnout na vtláčení vody, které zvedne tlak ostatním vrtům. Sousední ložiska bývají propojená.
- Nový panel Vrtný protokol pro vybraný vrt.

### Vyvážení (boti)
- `npm run balance` nechá boty odehrát celé hry a vypíše peníze, ceny, podíly kupců, tempo ér a zakázky. Podle něj se ladila cena vtláčení, prahy ér, poptávka benzinky a výskyt plynu.

### Vzhled
- Celé UI jako tiskárna a telegraf na tmavém nočním papíru: telegramy, účetní kniha, noviny Pouštní kurýr, nástěnka pozemkového úřadu.
- Scéna jako 2.5D noční ropný boomtown s kamerou (zoom, posun), letadly, chodci a auty.

### Multiplayer
- Přihlášení přes Discord, lobby, závod na stejné mapě i sdílená mapa v reálném čase (až 4 hráči).
- Režimy Nejbohatší, Cíl a Přežití, volitelná délka závodu, barvy hráčů v žebříčku.
- Světové zprávy (cla, Hormuz, OPEC, stávky…) mění ceny a pravidla na pár dní.

### Přetlak a erupce
- Plný zásobník čerpajícího vrtu zvedá tlak; odpuštění ventilem, jinak erupce, kaluž a pokuta.

## 2026-10-02

- Cisterny, silnice, sila, grafy cen, částice a zvuk.
- Přidělování kamionů kolečkem myši (později nahrazeno automatickou volbou kupce).
- Cache busting pro Discord, opravy kamionů, kalendáře a krtka, restart hry.
