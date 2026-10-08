# Changelog

Co se ve hře změnilo, z pohledu hráče. Každá novinka má záznam ve stejném commitu, ve kterém vzniká (viz CLAUDE.md). Nejnovější nahoře.

## Nevydáno

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
