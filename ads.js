// Reklamy ve hře. Upravuje se jen tady, kód hry se nemění; změna platí po nasazení.
const OIL_ADS = {
    // Hlavní vypínač: false = vzducholoď létá bez transparentu a nejde na ni kliknout
    enabled: true,

    // Seznam reklam. Jediné místo je transparent za vzducholodí nad městem (klik otevře odkaz);
    // je-li reklam víc, každý přelet si vylosuje jednu.
    ads: [
        {
            url: 'https://priceguessr.eu',
            // Transparent: první část černě, druhá červeně; krátké, ať se vejde (cca do 30 znaků)
            banner: ['HÁDEJ CENY · ', 'priceguessr.eu']
        }
    ]
};
