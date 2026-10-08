// Reklamy ve hře. Upravuje se jen tady, kód hry se nemění; změna platí po nasazení.
const OIL_ADS = {
    // Hlavní vypínač: false = žádná reklama nikde, vzducholoď létá bez transparentu
    enabled: true,

    // Kde se reklamy smí ukazovat
    places: {
        blimp: true,        // transparent za vzducholodí nad městem, klik otevře odkaz
        breakingNews: true, // rámečkový inzerát v mimořádném vydání Pouštního kurýra
        results: true       // inzerát na výsledkové straně závodu
    },

    // Seznam reklam. Je-li jich víc, každý přelet vzducholodi a každé vydání novin si vylosuje jednu.
    // Reklama bez `banner` se na vzducholoď nedostane, bez `headline` se netiskne v novinách.
    ads: [
        {
            url: 'https://priceguessr.eu',
            // Transparent: první část černě, druhá červeně; krátké, ať se vejde (cca do 30 znaků)
            banner: ['HÁDEJ CENY · ', 'priceguessr.eu'],
            // Novinový inzerát
            kicker: 'Inzerce',
            headline: 'Uhodnete, co to stojí?',
            text: 'Zboží všeho druhu, cena tajná, tipuje celá osada. Zábava zdarma, v Čechách i za mořem.',
            sign: 'priceguessr.eu'
        }
    ]
};
