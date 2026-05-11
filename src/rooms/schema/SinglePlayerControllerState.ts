import { Schema, type } from "@colyseus/schema";

export class SinglePlayerControllerState extends Schema {
  @type("string") roomCode: string = "";
  @type("string") status: string = "waiting";
  @type("boolean") phoneConnected: boolean = false;
}