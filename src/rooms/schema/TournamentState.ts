import { Schema, MapSchema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("string") role: string = "";
  @type("boolean") connected: boolean = true;
  @type("number") health: number = 20;
  @type("number") storedDamage: number = 0;
  @type("number") healCharge: number = 0;
  @type("number") questionIndex: number = 0;
}

export class TournamentState extends Schema {
  @type("string") roomCode: string = "";
  @type("string") status: string = "lobby";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();

  @type("number") timeRemainingMs: number = 0;

  @type("string") difficulty: string = "easy";
  @type("boolean") timerEnabled: boolean = true;
  @type("number") timerMinutes: number = 3;
  @type("boolean") healingEnabled: boolean = true;
  @type("number") startingHealth: number = 20;
}