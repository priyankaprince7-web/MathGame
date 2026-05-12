import { Room, Client } from "colyseus";
import { SinglePlayerControllerState } from "./schema/SinglePlayerControllerState.js";

type Role = "host" | "player";

function makeRoomCode(length = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
}

export class SinglePlayerControllerRoom extends Room {
  maxClients = 2;

  host: Client | null = null;
  phone: Client | null = null;

  onCreate() {
    this.roomId = makeRoomCode();

    this.setState(new SinglePlayerControllerState());

    const state = this.state as SinglePlayerControllerState;

    state.roomCode = this.roomId;
    state.status = "waiting";
    state.phoneConnected = false;

    this.onMessage("joinLobby", (client, message: { name?: string }) => {
      if (client !== this.phone) return;

      const name = message?.name?.trim() || "Player";

      if (this.host) {
        this.host.send("phoneConnected", name);
      }

      client.send("statusMessage", "Connected to single player game");
    });

    this.onMessage("submitAnswer", (client, message: { answer: string | number }) => {
      if (client !== this.phone || !this.host) return;

      this.host.send("phoneAnswer", {
        answer: String(message.answer)
      });
    });

    this.onMessage("singleQuestion", (client, message: { prompt: string; questionNumber?: number }) => {
      if (client !== this.host || !this.phone) return;

      this.phone.send("gameStarted", {});
      this.phone.send("question", {
        prompt: message.prompt,
        questionNumber: message.questionNumber || 1
      });
    });

    this.onMessage("singleStatus", (client, message: { text: string }) => {
      if (client !== this.host || !this.phone) return;

      this.phone.send("statusMessage", message.text);
    });
  }

  onJoin(client: Client, options: { role?: Role }) {
    const role: Role = options?.role === "host" ? "host" : "player";

    if (role === "host") {
      this.host = client;
      console.log("Single player host joined", this.roomId);
      return;
    }

    this.phone = client;
    const state = this.state as SinglePlayerControllerState;

    state.phoneConnected = true;
    state.status = "phone_connected";

    console.log("Single player phone joined", this.roomId);
  }

  onLeave(client: Client) {
    if (client === this.host) {
      this.host = null;
      this.disconnect();
      return;
    }

    if (client === this.phone) {
      this.phone = null;
      const state = this.state as SinglePlayerControllerState;

      state.phoneConnected = false;
      state.status = "waiting";

      if (this.host) {
        this.host.send("phoneDisconnected", {});
      }
    }
  }
}