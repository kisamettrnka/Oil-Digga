# Claude Code: nastavení, pluginy a šetření tokenů

Příručka pro libovolný tarif (Pro, Max 5x, Max 20x). Nastavení na 15 minut, pak návyky. Co se liší podle tarifu, je v tabulce v sekci 1.

---

## 1. Co zapnout podle tarifu

| | Pro | Max 5x | Max 20x |
|---|---|---|---|
| Výchozí model | Sonnet | Sonnet, Opus na plánování (`opusplan`) | Opus |
| Caveman | `full` vždy | `full` | podle chuti (`lite`) |
| Blok „Token budget“ v `CLAUDE.md` (sekce 4) | ano | ano | volitelně |
| `permissions.deny` na generované soubory (sekce 3) | ano | ano | ano (rychlejší i přesnější) |
| Superpowers | jen když ho opravdu používáš (viz níž) | ano | ano |
| Output styly Explanatory / Learning | ne | ne | když se chceš učit |
| Samo-vytváření skillů (sekce 5) | ano | ano | ano |

Superpowers při každém startu vkládá do kontextu svůj úvodní skill a nutí Clauda brainstormovat a plánovat. Na Pro to znatelně ujídá limit; na větších tarifech se to vrací v kvalitě.

---

## 2. Pluginy

Většina je z oficiálního marketplace Anthropicu (je přidaný automaticky). V terminálu:

```bash
claude plugin install superpowers@claude-plugins-official
claude plugin install frontend-design@claude-plugins-official
claude plugin install code-review@claude-plugins-official
claude plugin install claude-md-management@claude-plugins-official
claude plugin install feature-dev@claude-plugins-official
```

Caveman (vlastní marketplace):

```bash
claude plugin marketplace add JuliusBrussee/caveman
claude plugin install caveman@caveman
```

Plannotator (potřebuje i CLI):

```bash
curl -fsSL https://plannotator.ai/install.sh | bash
claude plugin marketplace add backnotprop/plannotator
claude plugin install plannotator@plannotator
```

Po instalaci restartuj Claude Code. Totéž jde interaktivně přes `/plugin`.

| Plugin | K čemu |
|---|---|
| **Superpowers** | Procesní skilly: brainstorming před stavbou, plán, TDD, systematické ladění, ověření před „hotovo“, psaní vlastních skillů (`writing-skills`). |
| **Frontend design** | Vede UI práci k vlastnímu vizuálnímu stylu místo generických šablon. |
| **Code review** | `/code-review` nad diffem nebo PR, hledá skutečné chyby. |
| **Caveman** | Stručné odpovědi bez omáčky, ~polovina až tři čtvrtiny výstupních tokenů pryč. `/caveman lite|full|ultra`, vypnout „normal mode“. `/caveman:compress CLAUDE.md` zkomprimuje paměťový soubor. |
| **Claude md management** | Audit a údržba `CLAUDE.md`, `/revise-claude-md` uloží poznatky ze session. |
| **Plannotator** | Plán nebo diff otevře v prohlížeči, kde ho okomentuješ jako v code review a pošleš zpět Claudovi. |
| **Feature dev** | `/feature-dev`: řízený postup přes průzkum kódu, architekturu a implementaci. |

Pluginy, které nepoužíváš, vypni (`/plugin`). MCP servery, které zrovna nepotřebuješ, vypni přes `/mcp`: každý nese definice nástrojů do kontextu.

---

## 3. `~/.claude/settings.json`

```json
{
  "model": "sonnet",
  "permissions": {
    "deny": [
      "Read(./node_modules/**)",
      "Read(./dist/**)",
      "Read(./build/**)",
      "Read(./.next/**)",
      "Read(./coverage/**)",
      "Read(./package-lock.json)",
      "Read(./yarn.lock)",
      "Read(./pnpm-lock.yaml)"
    ]
  }
}
```

- `model`: na Max 20x klidně `"opus"`, na Max 5x `"opusplan"` (Opus plánuje, Sonnet píše kód).
- `deny` vynucuje sám Claude Code, takže na rozdíl od pokynů v `CLAUDE.md` platí vždy.

---

## 4. Blok do `~/.claude/CLAUDE.md`

Globální soubor, platí ve všech projektech. Anglicky, protože se jím Claude řídí spolehlivěji. Na Max 20x můžeš sekci „Token budget“ vynechat a nechat jen „Skills“ ze sekce 5.

```markdown
# Token budget

## Output
- Be terse. No preamble, no recap of what you did, no "let me know if...".
- Do not explain code unless asked. Show only changed parts, not whole files.
- After finishing: one line on what changed and where, no summary tables.
- Ask at most one clarifying question, only when truly blocked.

## Exploration
- Search before reading: Grep/Glob for the symbol, then Read only the relevant range (offset/limit).
- Never read node_modules, dist, build, lockfiles, minified or generated files.
- Do not re-read a file you already read or just edited.
- Start from the files the user named; do not explore the whole repo unless asked.
- Use subagents only when a task really spans many files; each one costs a full context.

## Commands
- Trim command output: `| tail -40`, `| head -40`, `--quiet`, `-q`, `--silent`.
- Run only the relevant test file or test case, not the whole suite.
- Do not start dev servers or builds just to "check" unless asked.

## Work style
- Smallest change that solves the task. No drive-by refactors, extra features or new docs unless asked.
- If a task is big, propose a short plan first and wait for OK.
```

---

## 5. Claude si sám dělá skilly

Skill je složka se `SKILL.md`: popis + postup. Do kontextu se trvale načítá jen jeho jméno a jednořádkový popis; celý obsah až když se použije. Proto je levnější naučit Clauda opakovaný postup jednou do skillu, než mu ho pokaždé vysvětlovat nebo ho nechat znovu objevovat.

Přidej do `~/.claude/CLAUDE.md`:

```markdown
# Skills

- When you notice a workflow that repeats (the user asked for the same kind of task twice,
  or you rediscovered the same steps, commands or project quirks), propose turning it into a skill.
  Create it after the user says yes.
- Write skills with the superpowers `writing-skills` skill (or `skill-creator` if available).
- Location: project-specific -> `.claude/skills/<name>/SKILL.md` (commit it so the team gets it);
  personal and cross-project -> `~/.claude/skills/<name>/SKILL.md`.
- Keep a skill short: frontmatter `name` + a `description` that says WHEN to use it
  (trigger words), then the exact steps, commands and pitfalls. No background essays.
- Before starting a task, check whether an existing skill covers it and use it.
- When a skill turns out wrong or outdated, fix the skill in the same session.
```

Ruční vytvoření: napiš Claudovi „udělej z toho, co jsme teď dělali, skill“. Vyplatí se třeba na nasazení, release, přidání nové API routy, generování migrace nebo specifické testování projektu.

---

## 6. Návyky (tady je největší úspora)

| Dělej | Proč |
|---|---|
| `/clear` mezi nesouvisejícími úkoly | Každá zpráva znovu posílá celou historii. Nový úkol = čistý kontext. |
| `/compact zachovej jen X a Y` u dlouhé session | Shrne historii a řekneš, co je důležité. |
| `/context` občas | Ukáže, co žere kontext (MCP, pluginy, `CLAUDE.md`, soubory). |
| `/usage` | Kolik zbývá z limitu. |
| Dávej cesty a řádky, nebo `@soubor` | Claude nemusí hledat po celém repu. |
| Velký úkol → plan mode (Shift+Tab), plán zkontroluj (Plannotator) | Opravit plán je levnější než opravit hotový kód. |
| Špatný směr → Esc Esc (rewind) a přeformuluj | Lepší než pět oprav navršených na sebe. |
| Z logů vkládej jen relevantní řádky | Celý log zůstane v historii a platí se v každé další zprávě. |
| Obrázky jen když nutné | Screenshot stojí hodně a zůstává v historii. |
| Neměň model uprostřed session, nedělej dlouhé pauzy | Obojí rozbíjí prompt cache, další zpráva se platí celá. |
| Drobnosti (přejmenování, překlep) udělej sám | Nejlevnější token je nepoužitý token. |

---

## 7. Kontrola, že to funguje

1. Nová session → odpovědi krátké a bez úvodu (Caveman běží).
2. `/plugin` → pluginy ze sekce 2 jsou zapnuté.
3. `/context` → MCP a pluginy nezabírají většinu kontextu.
4. `/model` → model podle tabulky v sekci 1.
5. Zadej dvakrát podobný úkol → Claude navrhne vytvořit skill.
