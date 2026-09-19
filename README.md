<p align="center">
  <img src="com.koop.streamdeck-midi.sdPlugin/imgs/plugin/icon@2x.png" width="192" alt="Stream Deck WinMidi MIDI DIN icon">
</p>

# Stream Deck WinMidi

Stream Deck WinMidi is a Windows Stream Deck plugin for sending MIDI messages directly
from Stream Deck keys. It supports standard channel messages, arbitrary raw
MIDI data, and System Exclusive messages without requiring Companion.

## Requirements

- Windows 10 or later
- Stream Deck 6.9 or later
- A physical or virtual Windows MIDI output

## Installation

1. Open the [latest release](https://github.com/ibanman555/Stream-Deck-WinMidi/releases/latest).
2. Download `com.koop.streamdeck-midi.streamDeckPlugin` from **Assets**.
3. Double-click the downloaded file and approve installation in Stream Deck.
4. Drag **Stream Deck WinMidi → Send MIDI** onto a key.
5. Choose a MIDI output and configure the message.

Do not download GitHub's automatically generated source archive if you only
want to install the plugin. Use the `.streamDeckPlugin` file under **Assets**.

## Supported messages

- Note On with optional Note Off on release
- Control Change with optional value `0` on release
- Program Change
- Raw MIDI entered as hexadecimal bytes
- System Exclusive (SysEx)
- Optional separate raw message on key release
- Selectable feedback: errors only, success and errors, or none

MIDI channels are displayed as 1–16. Note, CC, Program, velocity, and value
numbers are entered as 0–127.

## Bome MIDI Translator

Bome virtual MIDI ports appear in the plugin's **MIDI Output** menu. Select the
Bome virtual input that should receive the Stream Deck messages, open Bome's
MIDI log, and press the Stream Deck key to verify the transmitted bytes.

## Raw MIDI and SysEx

Choose **Raw MIDI / SysEx**, then enter hexadecimal bytes separated by spaces,
commas, semicolons, colons, or dashes. `0x` prefixes are also accepted.

```text
F0 00 20 29 01 F7
```

SysEx must begin with `F0` and end with `F7`. The optional **Raw Release** field
can send a different raw message when the key is released.

## Visual feedback

- **Errors only** — default; shows a red warning for unavailable ports, invalid
  data, rejected messages, helper failures, or timeouts.
- **Success and errors** — also shows a green check after a successful send.
- **None** — disables key feedback.

## Build from source

Install Node.js, clone the repository, and run:

```powershell
npm install
npm run build
npm run validate
npm run pack
```

The project uses the official Elgato Stream Deck SDK and CLI. The generated
installer is excluded from source control and distributed through Releases.

## Support and contributions

Use [GitHub Issues](https://github.com/ibanman555/Stream-Deck-WinMidi/issues) for bug
reports and feature requests. See [CONTRIBUTING.md](CONTRIBUTING.md) for build
and testing guidance.

## License

Stream Deck WinMidi is released under the [MIT License](LICENSE).

Stream Deck is a trademark of Elgato. Stream Deck WinMidi is an independent project and
is not affiliated with or endorsed by Elgato.
