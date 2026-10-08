# Oil digga v2: návrh pravidel

Cíl: přestat být Turmoil s jiným kabátem. Mění se hlavní slovesa hry (vrtat, řídit ložisko, obchodovat s městem), ne jen kulisy. Pořadí prací odpovídá fázím níže; každá fáze je samostatně hratelná a jde do `main` zvlášť.

## Fáze 1: vrtání jako proces

Místo okamžitě nakreslené trubky jede vrták reálným časem po trase, kterou hráč naklikal.

- **Trasa.** Klik do podzemí přidá bod trasy (`drill` akce). Vrták jede k bodům postupně, hráč může kdykoli přidat další bod (směrové vrtání) nebo trasu zkrátit na aktuální polohu (`drillStop`). Trasa nesmí stoupat strměji než ~20°.
- **Platí se za metr.** Žádná platba předem: každý vyvrtaný pixel stojí `DRILL_COST_PER_PX × cena horniny`. Když dojdou peníze, vrták stojí a pokračuje, až peníze přibydou.
- **Vrstvy hornin** (`world.strata`) se generují ze seedu: zvlněné vrstvy, tvrdší horniny spíš hlouběji.

  | hornina | rychlost | opotřebení korunky | cena |
  |---|---|---|---|
  | Jíl | 0,75 | 0,1 | 0,9 |
  | Pískovec | 1 | 0,25 | 1 |
  | Břidlice | 0,6 | 0,5 | 1,2 |
  | Vápenec | 0,42 | 0,8 | 1,4 |
  | Žula | 0,2 | 2,2 | 2 |

- **Korunka** se opotřebovává podle horniny. Na nule vrták stojí, výměna (`bit`) stojí peníze a pár sekund (vytahování soutyčí).
- **Rizika v hornině** (`world.hazards`, skrytá, georadar je odhalí):
  - *plynová kapsa*: plynový kopanec. Hráč má pár sekund na zavření preventeru (klik na vrt nebo tlačítko). Když to nestihne, přijde erupce s pokutou a zničenou korunkou. Když to stihne, plyn se spálí na fléře a vrtá se dál.
  - *zvodnělá vrstva*: vrt nabere vodu (podíl vody v těžbě). Jde zacementovat (`cement`) za peníze.
- **Hloubka = riziko i odměna.** Hlubší ložiska jsou bohatší a mají vyšší počáteční tlak. Plyn je hlouběji častější.

## Fáze 2: živé ložisko

- **Tlak ložiska** (`pocket.drive`) určuje průtok: `průtok = BASE_FLOW × tlak × (1 − podíl vody)`. Tlak klesá s vytěženým množstvím (`drive0 × naplnění^1,3`), takže vrt postupně slábne podle skutečné křivky poklesu.
- **Víc vrtů do jednoho ložiska** je povolené. Každý čerpá podle tlaku, ložisko se tedy vyprázdní rychleji. Na sdílené mapě soused „krade“ ropu.
- **Propojená pole** (`world.links`): některá sousední ložiska spojuje propustná vrstva. Ropa teče k méně naplněnému ložisku, takže vrt v jednom ložisku pomalu vysává i to druhé.
- **Vtláčení vody** (`inject`): vrt se přepne z těžby na vtláčení. Netěží, stojí peníze za sekundu, ale zvedá tlak celého ložiska (`pocket.boost`) a pomalu ho zavodňuje (`pocket.waterCut`). Vyplatí se, když jsou na ložisku další vrty.

## Fáze 3: město jako trh (a město, které roste)

- Místo dvou výkupců vlevo a vpravo kupují podniky ve městě. Poptávka se mění podle **éry**:

  | éra | co město chce | doprava |
  |---|---|---|
  | Tábor | petrolej do lamp | povozy |
  | Boomtown | petrolej, mazivo pro železnici | povozy, kamiony |
  | Železnice | export po železnici, topný olej | vlečka k vrtům |
  | Automobil | benzin, asfalt | vlastní potrubí |

- Éra se posouvá s časem a s tím, kolik ropy hráči do města dodali. Město tedy roste, protože ho hráči živí.
- **Zakázky přichází telegramem** („Dodejte 400 barelů do pátku, $1,6/barel“). Kdo nesplní, platí penále a ztrácí pověst.
- **Vizuálně** se město přestavuje s érou: stany a boudy → dřevěné domy s falešnými štíty → cihlové bloky, nádraží a vodárna → elektrické lampy, garáže, první automobily. Každá éra přidá budovy po stranách (město se rozšiřuje) a vymění starší (modernizuje se). Kreslí se ze stavu světa (`world.town`), ne z pevného seedu.

## Fáze 4: claimy a geologická mapa

- Pozemky jsou nepravidelné claimy různé šířky s terénem (kopec = dražší stavba, řeka = levná voda pro vtláčení, skála = žula pod povrchem).
- Výběr claimu na mapě geologického průzkumu. Podzemí po průzkumu vypadá jako ručně kreslená geologická mapa: šrafy podle horniny, legenda, vrstevnice. Šrafování vrstev je od fáze 1, legenda a mapa přibudou tady.

## Fáze 5: multiplayer postavený na Discordu

- **Smlouvy mezi hráči**: prodej ropy za pevnou cenu, pronájem kapacity (kamiony, potrubí).
- **Kartel**: hráči se dohodnou na omezení dodávek, cena roste. Kdo tajně dodá víc, vydělá nejvíc, dokud ho ostatní neodhalí.
- **Aukce claimů** v lobby před startem.
- **Sabotáž**: podplacená stávka, přeseknuté potrubí. Drahé a se stopou, ať to není jen otrava.
