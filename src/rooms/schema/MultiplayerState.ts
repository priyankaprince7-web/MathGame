import { Schema, MapSchema, type } from "@colyseus/schema";

export class MultiplayerPlayerState extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("string") role: string = "";
  @type("boolean") connected: boolean = true;

  @type("number") health: number = 20;
  @type("number") teamId: number = 0;

  @type("string") classRole: string = "";
  @type("boolean") roleReady: boolean = false;

  @type("number") storedDamage: number = 0;
  @type("number") healCharge: number = 0;
  @type("number") questionIndex: number = 0;
}

export class MultiplayerState extends Schema {
  @type("string") roomCode: string = "";
  @type("string") status: string = "lobby";

  @type("string") mode: string = "solo";
  @type("number") requiredPlayers: number = 2;
  @type("number") teamCount: number = 0;
  @type("string") potMode: string = "shared";

  @type("number") startingHealth: number = 20;
  @type("number") timerMinutes: number = 3;

  @type("boolean") timerEnabled: boolean = true;
  @type("boolean") healingEnabled: boolean = true;
  @type("string") difficulty: string = "easy";

  @type({ map: MultiplayerPlayerState })
  players = new MapSchema<MultiplayerPlayerState>();
}