import streamDeck, {
  action,
  KeyDownEvent,
  KeyUpEvent,
  SendToPluginEvent,
  SingletonAction,
  WillAppearEvent
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import { midiHelper } from "./midi-helper";

type MessageType = "note" | "cc" | "program" | "raw";
type ReleaseMode = "none" | "noteOff" | "zero";
type FeedbackMode = "errors" | "all" | "none";
type MidiSettings = {
  port?: string;
  messageType?: MessageType;
  channel?: number;
  number?: number;
  value?: number;
  releaseMode?: ReleaseMode;
  rawPress?: string;
  rawRelease?: string;
  feedbackMode?: FeedbackMode;
};

const defaults: Required<Omit<MidiSettings, "port">> = {
  messageType: "note",
  channel: 1,
  number: 60,
  value: 127,
  releaseMode: "noteOff",
  rawPress: "F0 F7",
  rawRelease: "",
  feedbackMode: "errors"
};
const dataByte = (value: number | undefined, fallback: number): number =>
  Math.max(0, Math.min(127, Math.round(Number(value ?? fallback))));
const midiChannel = (value: number | undefined): number =>
  Math.max(1, Math.min(16, Math.round(Number(value ?? 1))));

export function parseRawMidi(text: string): number[] {
  const normalized = text.trim().replace(/0x/gi, "").replace(/[\s,;:-]+/g, " ");
  if (!normalized) throw new Error("Raw MIDI data is empty.");
  const tokens = normalized.split(" ");
  if (tokens.some((token) => !/^[0-9a-fA-F]{1,2}$/.test(token))) {
    throw new Error("Raw MIDI must contain hexadecimal bytes, for example F0 01 02 F7.");
  }
  const bytes = tokens.map((token) => Number.parseInt(token, 16));
  if (bytes[0] === 0xF0) {
    if (bytes.at(-1) !== 0xF7) throw new Error("SysEx must end with F7.");
  } else if (bytes.length > 3) {
    throw new Error("Non-SysEx raw MIDI messages may contain no more than 3 bytes.");
  }
  return bytes;
}

function pressBytes(settings: Required<Omit<MidiSettings, "port">>): number[] {
  if (settings.messageType === "raw") return parseRawMidi(settings.rawPress);
  const channel = midiChannel(settings.channel) - 1;
  const number = dataByte(settings.number, 60);
  const value = dataByte(settings.value, 127);
  if (settings.messageType === "cc") return [0xB0 | channel, number, value];
  if (settings.messageType === "program") return [0xC0 | channel, number];
  return [0x90 | channel, number, value];
}

function releaseBytes(settings: Required<Omit<MidiSettings, "port">>): number[] | undefined {
  if (settings.messageType === "raw") {
    return settings.rawRelease.trim() ? parseRawMidi(settings.rawRelease) : undefined;
  }
  if (settings.releaseMode === "none" || settings.messageType === "program") return undefined;
  const channel = midiChannel(settings.channel) - 1;
  const number = dataByte(settings.number, 60);
  if (settings.messageType === "cc") {
    return settings.releaseMode === "zero" ? [0xB0 | channel, number, 0] : undefined;
  }
  return [0x80 | channel, number, 0];
}

@action({ UUID: "com.koop.streamdeck-midi.send" })
export class SendMidi extends SingletonAction<MidiSettings> {
  override async onWillAppear(ev: WillAppearEvent<MidiSettings>): Promise<void> {
    const settings = { ...defaults, ...ev.payload.settings };
    if (JSON.stringify(settings) !== JSON.stringify(ev.payload.settings)) await ev.action.setSettings(settings);
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, MidiSettings>): Promise<void> {
    if (!(ev.payload instanceof Object) || !("event" in ev.payload) || ev.payload.event !== "getPorts") return;
    try {
      const ports = await midiHelper.getPorts();
      await streamDeck.ui.sendToPropertyInspector({
        event: "getPorts",
        items: ports.length
          ? ports.map((port) => ({ label: port, value: port }))
          : [{ label: "No MIDI output ports found", value: "", disabled: true }]
      });
    } catch (error) {
      streamDeck.logger.error(`Could not list MIDI outputs: ${String(error)}`);
      await streamDeck.ui.sendToPropertyInspector({
        event: "getPorts",
        items: [{ label: "Could not read MIDI outputs", value: "", disabled: true }]
      });
    }
  }

  override async onKeyDown(ev: KeyDownEvent<MidiSettings>): Promise<void> { await this.send(ev, true); }
  override async onKeyUp(ev: KeyUpEvent<MidiSettings>): Promise<void> { await this.send(ev, false); }

  private async send(ev: KeyDownEvent<MidiSettings> | KeyUpEvent<MidiSettings>, isPress: boolean): Promise<void> {
    const settings = { ...defaults, ...ev.payload.settings };
    try {
      if (!settings.port) throw new Error("No MIDI output is selected.");
      const bytes = isPress ? pressBytes(settings) : releaseBytes(settings);
      if (!bytes) return;
      await midiHelper.send(settings.port, bytes);
      if (settings.feedbackMode === "all") await ev.action.showOk();
    } catch (error) {
      streamDeck.logger.error(`MIDI ${isPress ? "press" : "release"} failed: ${String(error)}`);
      if (settings.feedbackMode !== "none") await ev.action.showAlert();
    }
  }
}
