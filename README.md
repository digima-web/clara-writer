<p align="center"><img src="docs/icon.png" width="160" alt="Clara Writer"></p>

# Clara Writer

**Clear writing, with AI by your side.**

*[Leggi in italiano](README.it.md)*

Clara Writer is a writing app for Windows designed for people with low vision: very large text,
high-contrast colours, simple keyboard commands, read-aloud and dictation.
It has Claude, Anthropic's AI assistant, built in to help you correct, review and organise
your articles and books. **Your words stay yours:** Claude never rewrites anything unless you ask.

## What it does

- Large, adjustable text (Ctrl + and Ctrl −), three high-contrast themes, Atkinson Hyperlegible Next typeface.
- A thick, coloured cursor and the current line highlighted, so you don't lose your place when you look down at the keyboard.
- The main keys are always shown at the bottom of the screen.
- Word count and character count, as editors ask for.
- Automatic saving.
- Claude built in: corrections, suggestions, research, organising articles and chapters.
- Every change Claude makes is highlighted and can be undone with one key (F8).
- Read-aloud (F3) and dictation (F5).
- One-key export to Word (F12), and import of your existing Word files.
- Quick requests to Claude with Ctrl + 1 to 4, find with Ctrl + F.

## What you need

- Windows 10 or 11 and an internet connection.
- A Claude subscription (**Pro** or higher): each person uses their own account.

## Installation

1. Go to the [**Releases**](https://github.com/digima-web/clara-writer/releases/latest) page and download **Install-Clara-Writer.bat**.
2. Double-click it. It downloads Clara Writer, puts it in your user folder and creates a **Clara Writer** icon on the desktop and in the Start menu.
3. The first time, Clara Writer installs what it needs on its own (Git, Python, Pandoc, Claude Code)
   and asks you to sign in to Claude.

Windows may show the warning "Windows protected your PC": click **More info**, then **Run anyway**.

**Updates are automatic:** every time it starts, Clara Writer checks for a new version and installs it.
Your texts are never touched: they live in a separate folder (Documents\Clara Writer).

Full instructions: [docs/INSTALL.md](docs/INSTALL.md).

## Keys

| Key | What it does |
| --- | --- |
| F1 | Where am I? (Shift + F1: all the keys, read aloud) |
| F2 | Show or hide Claude (Shift + F2: the key bar) |
| F3 | Read aloud from the cursor (Shift + F3: the current paragraph) |
| F4 | Ask Claude |
| F5 | Dictation: start and stop |
| F6 | Open a text |
| F7 | New article, book or chapter, or import Word files |
| F8 | Undo Claude's changes |
| F9 / F10 | Typeface / colours |
| Shift + F10 | Language |
| Ctrl + 1 to 4 | Quick requests: spelling, grammar, repetitions, titles |
| Ctrl + F / Ctrl + G | Find / find next |
| F12 | Export to Word |

## Languages

Clara Writer is available in **English** and **Italian**. It follows the Windows language and can be changed at any time with **Shift + F10**.
Each language is a single file in `lang/`: to add one, translate `lang/en.json` and the rules in `templates/CLAUDE.en.md`.

## Notes

Clara Writer is an independent project and is not a product of Anthropic.
"Claude" is a trademark of Anthropic.

The Atkinson Hyperlegible Next typeface is by the Braille Institute of America, licensed under the
SIL Open Font License (see `web/font/OFL.txt`).

## Licence

Clara Writer is free software, released under the **GNU GPL v3** (see [LICENSE](LICENSE)):
you can use, study, modify and share it. If you distribute a modified version,
you must release it under the same licence, with its source code.

© 2026 Francesco Bonomelli
