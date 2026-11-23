<p align="center"><img src="docs/icon.png" width="160" alt="Clara Writer"></p>

# Clara Writer

**Scrittura chiara, con l'AI al tuo fianco.**
*Clear writing, with AI by your side.*

*[Read in English](README.md)*

Clara Writer è un editor di testo per Windows pensato per chi vede poco: caratteri molto grandi,
colori ad alto contrasto, tutto comandato da tasti semplici, lettura e dettatura a voce.
Dentro c'è Claude, l'assistente AI di Anthropic, che aiuta a correggere, rileggere e organizzare
articoli e libri. **Il testo resta sempre dell'autore:** Claude non riscrive niente senza una richiesta.

## Cosa fa

- Testo grande e regolabile (Ctrl + e Ctrl −), tre temi ad alto contrasto, carattere Atkinson Hyperlegible Next.
- Cursore spesso e colorato e riga corrente evidenziata, per non perdere il punto quando si alza lo sguardo dalla tastiera.
- Pulsanti grandi per le funzioni principali in fondo allo schermo, in quattro famiglie di colore, per chi preferisce il mouse (Maiusc + F2 li nasconde).
- Freccia del mouse grande e ad alto contrasto dentro il programma.
- Conteggio di parole e battute, come chiedono le redazioni.
- Salvataggio automatico.
- Claude integrato: correzioni, consigli, ricerche, organizzazione di articoli e capitoli.
- Ogni modifica di Claude viene colorata e si annulla con un tasto (F8).
- Lettura a voce (F3) e dettatura (F5).
- Esportazione in Word con un tasto (F12) e importazione dei file Word che hai già.
- Richieste rapide a Claude con Ctrl + da 1 a 4, ricerca con Ctrl + F.

## Cosa serve

- Windows 10 o 11 e una connessione a Internet.
- Un abbonamento Claude (almeno **Pro**): ogni persona usa il proprio account.

## Installazione

1. Vai alla pagina [**Releases**](https://github.com/digima-web/clara-writer/releases/latest) e scarica **Install-Clara-Writer.bat**.
2. Fai doppio clic. Scarica Clara Writer, lo mette nella tua cartella utente e crea l'icona **Clara Writer** sul desktop e nel menu Start.
3. La prima volta Clara Writer installa da solo quello che serve (Git, Python, Pandoc, Claude Code)
   e chiede di accedere a Claude.

Windows può mostrare l'avviso "Windows ha protetto il PC": clicca **Ulteriori informazioni** e poi **Esegui comunque**.

**Gli aggiornamenti sono automatici:** a ogni avvio Clara Writer controlla se c'è una versione nuova e la installa.
I testi non vengono mai toccati: stanno in una cartella separata (Documenti\Clara Writer).

Istruzioni complete: [docs/INSTALL.it.md](docs/INSTALL.it.md).

## I tasti

| Tasto | Cosa fa |
| --- | --- |
| F1 | Dove sono? (Maiusc + F1: tutti i tasti, a voce) |
| F2 | Mostra o nasconde Claude (Maiusc + F2: la barra dei tasti) |
| F3 | Legge a voce dal cursore (Maiusc + F3: il paragrafo) |
| F4 | Chiedi a Claude |
| F5 | Dettatura: inizia e finisce |
| F6 | Apri un testo |
| F7 | Nuovo articolo, libro o capitolo, oppure importa file Word |
| F8 | Annulla le modifiche di Claude |
| F9 / F10 | Carattere / colori |
| Maiusc + F10 | Lingua |
| Ctrl + da 1 a 4 | Richieste rapide: ortografia, grammatica, ripetizioni, titoli |
| Ctrl + F / Ctrl + G | Trova / trova il successivo |
| F12 | Esporta in Word |

## Lingue

Clara Writer è disponibile in **inglese** e **italiano**. Segue la lingua di Windows e si cambia in qualsiasi momento con **Maiusc + F10**.

## Note

Clara Writer è un progetto indipendente: non è un prodotto di Anthropic.
"Claude" è un marchio di Anthropic.

Il carattere Atkinson Hyperlegible Next è del Braille Institute of America, con licenza SIL Open Font License (vedi `web/font/OFL.txt`).

## Licenza

Clara Writer è software libero, distribuito con licenza **GNU GPL v3** (vedi [LICENSE](LICENSE)):
puoi usarlo, studiarlo, modificarlo e condividerlo. Chi distribuisce una versione modificata
deve farlo con la stessa licenza, pubblicandone il codice.

© 2026 Francesco Bonomelli
