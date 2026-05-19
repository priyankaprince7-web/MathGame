import { Room, Client } from "colyseus";
import { MultiplayerState, MultiplayerPlayerState } from "./schema/MultiplayerState.js";

type Role = "host" | "player";

function makeRoomCode(length = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
}

export class MultiplayerRoom extends Room {
  maxClients = 33;
  state = new MultiplayerState();

  onCreate(options: any) {
    this.roomId = makeRoomCode();
    this.state.roomCode = this.roomId;
    this.state.status = "lobby";

    this.state.mode = options?.mode || "solo";
    this.state.requiredPlayers = Math.max(2, Math.min(32, Number(options?.requiredPlayers ?? 2)));
    this.state.teamCount = Math.max(0, Math.min(8, Number(options?.teamCount ?? 0)));
    this.state.potMode = options?.potMode || "shared";
    this.state.startingHealth = Math.max(10, Math.min(100, Number(options?.startingHealth ?? 20)));
    this.state.timerMinutes = Math.max(0, Math.min(10, Number(options?.timerMinutes ?? 3)));

    this.onMessage("joinLobby", (client, message: { name?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.name = message?.name?.trim() || "Player";
      player.connected = true;

      if (this.state.mode === "solo") {
        player.teamId = 0;
      }

      this.broadcastPlayers();
      this.broadcastStatus(`${player.name} joined`);
    });

  this.onMessage("chooseTeam", (client, message: { teamId?: number }) => {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.role !== "player") return;

    const teamId = Number(message?.teamId ?? 1);
    const clampedTeamId = Math.max(1, Math.min(this.state.teamCount, teamId));

    const teamLimit = this.getTeamLimit();

    const currentTeamPlayers = this.getPlayers().filter(
      p => p.teamId === clampedTeamId && p.id !== player.id
    );

    if (currentTeamPlayers.length >= teamLimit) {
      client.send("statusMessage", `Army ${clampedTeamId} is full`);
      return;
    }

    player.teamId = clampedTeamId;

    this.broadcastPlayers();
    this.checkTeamSetupReady();
  });

    this.onMessage("randomTeams", () => {
      this.assignRandomTeams();
      this.broadcastPlayers();
      this.checkTeamSetupReady();
    });

    this.onMessage("chooseClass", (client, message: { classRole?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.role !== "player") return;

      const allowed = ["warrior", "healer", "tank", "trickster"];
      const role = message?.classRole || "";

      if (!allowed.includes(role)) return;

      player.classRole = role;
      player.roleReady = true;

      this.broadcastPlayers();
      this.checkTeamSetupReady();
    });

    this.onMessage("startGame", () => {
      if (!this.canStart()) {
        this.broadcastStatus("Not ready yet");
        return;
      }

      this.state.status = "in_match";
      this.broadcast("gameStarted");
      this.broadcastStatus("Game starting...");
    });
  }

  onJoin(client: Client, options: { role?: Role }) {
    const role: Role = options?.role === "host" ? "host" : "player";

    const player = new MultiplayerPlayerState();
    player.id = client.sessionId;
    player.name = role === "host" ? "Host" : "Joining...";
    player.role = role;
    player.connected = true;
    player.health = this.state.startingHealth;

    this.state.players.set(client.sessionId, player);

    if (role === "player") {
      client.send("controllerMode", this.state.mode === "team" ? "team_multiplayer" : "solo_multiplayer");
      client.send("multiplayerSettings", {
        mode: this.state.mode,
        requiredPlayers: this.state.requiredPlayers,
        teamCount: this.state.teamCount,
        potMode: this.state.potMode
      });
    }

    this.broadcastPlayers();
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.broadcastPlayers();
  }

  getPlayers() {
    return Array.from(this.state.players.values()).filter(p => p.role === "player");
  }

  broadcastPlayers() {
    const players = this.getPlayers().map(p => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      teamId: p.teamId,
      classRole: p.classRole,
      roleReady: p.roleReady
    }));

    this.broadcast("updatePlayers", players);

    if (this.getPlayers().length >= this.state.requiredPlayers) {
      if (this.state.mode === "team") {
        this.broadcast("teamSetupReady");
        this.broadcastStatus("Choose armies and roles");
      } else {
        this.broadcastStatus("Ready to start!");
      }
    } else {
      this.broadcastStatus(`Waiting for ${this.state.requiredPlayers} players`);
    }

    this.broadcast("teamInfo", {
      teamCount: this.state.teamCount,
      teamLimit: this.getTeamLimit(),
      requiredPlayers: this.state.requiredPlayers
    });

  }

  assignRandomTeams() {
    const players = this.getPlayers();
    const teamLimit = this.getTeamLimit();

    const teamCounts = new Map<number, number>();

    for (let i = 1; i <= this.state.teamCount; i++) {
      teamCounts.set(i, 0);
    }

    for (const p of players) {
      const availableTeams = [];

      for (let i = 1; i <= this.state.teamCount; i++) {
        if ((teamCounts.get(i) ?? 0) < teamLimit) {
          availableTeams.push(i);
        }
      }

      if (availableTeams.length === 0) return;

      const randomTeam =
        availableTeams[Math.floor(Math.random() * availableTeams.length)];

      p.teamId = randomTeam;
      teamCounts.set(randomTeam, (teamCounts.get(randomTeam) ?? 0) + 1);
    }
  }

  checkTeamSetupReady() {
    if (this.state.mode !== "team") return;

    const players = this.getPlayers();

    const ready =
      players.length >= this.state.requiredPlayers &&
      players.every(p => p.teamId > 0 && p.roleReady);

    if (ready) {
      this.broadcast("allRolesReady");
      this.broadcastStatus("All armies ready!");
    }
  }

  canStart() {
    const players = this.getPlayers();

    if (players.length < this.state.requiredPlayers)
      return false;

    if (this.state.mode === "solo")
      return true;

    return players.every(p => p.teamId > 0 && p.roleReady);
  }

  broadcastStatus(message: string) {
    this.broadcast("statusMessage", message);
  }

  getTeamLimit() {
    if (this.state.teamCount <= 0) return this.state.requiredPlayers;
    return Math.ceil(this.state.requiredPlayers / this.state.teamCount);
  }


}