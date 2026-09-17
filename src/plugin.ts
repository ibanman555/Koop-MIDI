import streamDeck from "@elgato/streamdeck";
import { SendMidi } from "./send-midi";

streamDeck.logger.setLevel("info");
streamDeck.actions.registerAction(new SendMidi());
streamDeck.connect();
