// Vstup pro esbuild (npm run build): zabalí Discord Embedded App SDK do dist/discord-sdk.js
// jako globální window.OilDiscordSDK. Zbytek hry zůstává bez bundleru, SDK používá net.js.
export { DiscordSDK, Events, patchUrlMappings } from '@discord/embedded-app-sdk';
