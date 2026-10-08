# Oil digga

Ropný tycoon jako Discord Activity: kup pozemky, najdi ložiska, postav vrty a vozi ropu kupcům ve městě, které s tvou ropou roste.
V Discordu se hráči z hlasového kanálu sejdou v lobby a závodí na stejné mapě o nejvíc peněz za rok.

## Spuštění lokálně

```bash
npm install
cp .env.example .env      # doplň DISCORD_CLIENT_SECRET (jen pro Discord, lokálně není potřeba)
npm run dev               # server s hrou na http://localhost:3000, restartuje se při změně serveru
```

Lobby bez Discordu: otevři dvě záložky, každou s jiným jménem a stejnou místností:

- http://localhost:3000/?user=Alice&room=test
- http://localhost:3000/?user=Bob&room=test

`npm run static` spustí jen statický server bez lobby (hra pak běží sólo).

## Nastavení v Discord Developer Portalu

Aplikace: `1385652220707606668` (Application ID = Client ID, není tajné).

1. **OAuth2**: zkopíruj **Client Secret** do `.env` jako `DISCORD_CLIENT_SECRET`. Secret nikam necommituj a neposílej.
   V **Redirects** musí být aspoň jedna adresa, stačí `https://127.0.0.1`.
2. **Activities → Settings**: zapni Activities (Embedded App).
3. **Activities → URL Mappings**:

   | Prefix | Target |
   |---|---|
   | `/` | doména, kde běží server (bez `https://`), např. `xyz.trycloudflare.com` |
   | `/discord-cdn` | `cdn.discordapp.com` (avatary hráčů) |

4. Spusť aktivitu v hlasovém kanálu na serveru, kde je aplikace a kde jsi v **App Testers** (Activities → App Testers),
   dokud aplikace není veřejná.

### Lokální test v Discordu přes tunel

Discord potřebuje veřejnou HTTPS adresu. Nejrychlejší je Cloudflare tunel:

```bash
brew install cloudflared
npm run dev
cloudflared tunnel --url http://localhost:3000
```

Adresu `https://<něco>.trycloudflare.com` vlož (bez `https://`) do URL mappingu `/`. Při každém novém tunelu se mění.

### Nasazení na Render

Vercel nestačí: neumí WebSocket server, na kterém běží lobby. Na Renderu běží celý server (hra, přihlášení i lobby):

1. Kód musí být na GitHubu v `main` (Render nasazuje z něj, při každém pushi znovu).
2. https://dashboard.render.com → **New → Blueprint** → vyber repozitář. Render načte `render.yaml`
   a zeptá se na `DISCORD_CLIENT_SECRET`, vlož ho tam (ne do repa).
3. Po nasazení dostaneš adresu `https://oil-digga-xxxx.onrender.com`. Free tier služby po čtvrthodině uspává; workflow `.github/workflows/keepalive.yml` ji každých 10 minut pinguje, stačí v GitHubu nastavit proměnnou `RENDER_URL` (Settings → Secrets and variables → Actions → Variables) na tuto adresu bez lomítka na konci. V Developer Portalu v URL mappingu `/`
   nahraď adresu Vercelu touto (bez `https://`).

Zdarma tarif po ~15 minutách bez hráčů usne a první spuštění pak trvá desítky sekund. Kdyby to vadilo,
stačí na Renderu přepnout službu na placený tarif (Starter), kód se nemění.
