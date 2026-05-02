import { Schema, MapSchema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("string") role: string = "";
  @type("boolean") connected: boolean = true;

  // Default only before match starts — will be overridden
  @type("number") health: number = 0;

  @type("number") storedDamage: number = 0;
  @type("number") healCharge: number = 0;
  @type("number") questionIndex: number = 0;
}

export class TournamentState extends Schema {
  @type("string") roomCode: string = "";
  @type("string") status: string = "lobby";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();

  // -1 = no timer
  @type("number") timeRemainingMs: number = -1;

  // SETTINGS (all controlled by Unity)
  @type("string") difficulty: string = "easy";

  @type("boolean") timerEnabled: boolean = false;
  @type("number") timerMinutes: number = 0;

  @type("boolean") healingEnabled: boolean = false;

  @type("number") startingHealth: number = 0;
}