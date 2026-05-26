import { Room, Client } from "colyseus";
import { MultiplayerState, MultiplayerPlayerState } from "./schema/MultiplayerState.js";

type Role = "host" | "player";

type Question = {
  prompt: string;
  answer: number;
};

type MatchPair = {
  playerAId: string;
  playerBId: string;
};

function makeRoomCode(length = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < length; i++)
    code += chars[Math.floor(Math.random() * chars.length)];

  return code;
}

export class MultiplayerRoom extends Room {
  maxClients = 33;
  state = new MultiplayerState();

  private activeMatches: MatchPair[] = [];
  private activePlayerIds: string[] = [];
  private eliminatedIds = new Set<string>();

  private roundNumber = 0;
  private currentQuestion: Question | null = null;
  private questionIndex = 0;

  private roundTimer: NodeJS.Timeout | null = null;
  private questionTimer: NodeJS.Timeout | null = null;
  private roundEndsAt = 0;

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

      this.broadcastPlayers();
      this.broadcastStatus(`${player.name} joined`);
    });

    this.onMessage("startGame", () => {
      if (!this.canStart()) {
        this.broadcastStatus("Not ready yet");
        return;
      }

      this.startKnockoutTournament();
    });

    this.onMessage("submitAnswer", (client, message: { answer?: string }) => {
      this.handleSubmitAnswer(client, message);
    });

    this.onMessage("attack", (client) => {
      this.handleAttack(client);
    });

    this.onMessage("heal", (client) => {
      this.handleHeal(client);
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
      client.send("controllerMode", "solo_multiplayer");
    }

    this.broadcastPlayers();
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.eliminatedIds.add(client.sessionId);
    this.broadcastPlayers();
  }

  private startKnockoutTournament() {
    this.state.status = "in_match";
    this.roundNumber = 0;
    this.eliminatedIds.clear();

    this.activePlayerIds = this.shuffle(
      this.getPlayers().map(p => p.id)
    );

    this.startNextRound(this.activePlayerIds);
  }

  private startNextRound(playerIds: string[]) {
    this.roundNumber++;

    const survivors = playerIds.filter(id => {
      const p = this.state.players.get(id);
      return p && !this.eliminatedIds.has(id);
    });

    if (survivors.length <= 1) {
      this.endTournament(survivors[0]);
      return;
    }

    this.activePlayerIds = this.shuffle(survivors);
    this.activeMatches = this.createPairs(this.activePlayerIds);

    for (const id of this.activePlayerIds) {
      const p = this.state.players.get(id);
      if (!p) continue;

      p.health = this.state.startingHealth;
      p.storedDamage = 0;
      p.healCharge = 0;
      p.questionIndex = 0;
    }

    this.questionIndex = 0;

    this.broadcast("gameStarted");
    this.broadcast("roundStarted", {
      roundNumber: this.roundNumber,
      players: this.activePlayerIds,
      matches: this.activeMatches
    });

    this.roundEndsAt = Date.now() + this.state.timerMinutes * 60 * 1000;

    if (this.roundTimer) clearTimeout(this.roundTimer);

    if (this.state.timerMinutes > 0) {
      this.roundTimer = setTimeout(() => {
        this.finishRoundByHealth();
      }, this.state.timerMinutes * 60 * 1000);
    }

    this.sendNextQuestion();
    this.broadcastGameState();
  }

  private createPairs(playerIds: string[]) {
    const pairs: MatchPair[] = [];

    for (let i = 0; i < playerIds.length; i += 2) {
      const a = playerIds[i];
      const b = playerIds[i + 1];

      if (!b) {
        // Bye: player automatically survives
        continue;
      }

      pairs.push({
        playerAId: a,
        playerBId: b
      });
    }

    return pairs;
  }

  private sendNextQuestion() {
    this.questionIndex++;
    this.currentQuestion = this.generateQuestion();

    for (const id of this.activePlayerIds) {
      const client = this.clients.find(c => c.sessionId === id);
      if (!client) continue;

      client.send("question", {
        index: this.questionIndex,
        prompt: this.currentQuestion.prompt
      });
    }
  }

  private handleSubmitAnswer(client: Client, message: { answer?: string }) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !this.currentQuestion) return;

    if (this.eliminatedIds.has(player.id)) return;

    const submitted = Number(message?.answer);

    if (!Number.isFinite(submitted)) {
      client.send("answerFeedback", { message: "Enter a number." });
      return;
    }

    if (submitted !== this.currentQuestion.answer) {
      client.send("answerFeedback", { message: "Not quite!" });
      return;
    }

    player.questionIndex++;
    player.storedDamage += 2;
    player.healCharge = Math.min(player.healCharge + 1, 10);

    client.send("answerFeedback", { message: "Correct! Attack charged." });

    this.broadcastGameState();

    // Everyone gets the same next question after a correct answer.
    this.sendNextQuestion();
  }

  private handleAttack(client: Client) {
    const attacker = this.state.players.get(client.sessionId);
    if (!attacker || attacker.storedDamage <= 0) return;

    const opponent = this.getOpponent(attacker.id);
    if (!opponent) return;

    const damage = attacker.storedDamage;
    attacker.storedDamage = 0;

    opponent.health = Math.max(0, opponent.health - damage);

    this.broadcast("attackResult", {
      attackerId: attacker.id,
      attackerName: attacker.name,
      defenderId: opponent.id,
      damage
    });

    if (opponent.health <= 0) {
      this.eliminatedIds.add(opponent.id);

      this.broadcast("matchEnded", {
        winnerId: attacker.id,
        winnerName: attacker.name,
        loserId: opponent.id
      });

      this.checkRoundComplete();
    }

    this.broadcastGameState();
  }

  private handleHeal(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.healCharge <= 0) return;

    const healAmount = player.healCharge;
    player.healCharge = 0;

    player.health = Math.min(this.state.startingHealth, player.health + healAmount);

    client.send("answerFeedback", {
      message: `Healed for ${healAmount}!`
    });

    this.broadcastGameState();
  }

  private checkRoundComplete() {
    const survivors: string[] = [];

    for (const match of this.activeMatches) {
      const a = this.state.players.get(match.playerAId);
      const b = this.state.players.get(match.playerBId);

      if (!a || !b) continue;

      if (a.health > 0 && b.health <= 0) survivors.push(a.id);
      else if (b.health > 0 && a.health <= 0) survivors.push(b.id);
      else return;
    }

    // Add bye players
    for (const id of this.activePlayerIds) {
      const inMatch = this.activeMatches.some(m => m.playerAId === id || m.playerBId === id);
      if (!inMatch) survivors.push(id);
    }

    setTimeout(() => {
      this.startNextRound(survivors);
    }, 2500);
  }

  private finishRoundByHealth() {
    const survivors: string[] = [];

    for (const match of this.activeMatches) {
      const a = this.state.players.get(match.playerAId);
      const b = this.state.players.get(match.playerBId);

      if (!a || !b) continue;

      if (a.health >= b.health) survivors.push(a.id);
      else survivors.push(b.id);
    }

    for (const id of this.activePlayerIds) {
      const inMatch = this.activeMatches.some(m => m.playerAId === id || m.playerBId === id);
      if (!inMatch) survivors.push(id);
    }

    this.startNextRound(survivors);
  }

  private endTournament(winnerId?: string) {
    if (this.roundTimer) clearTimeout(this.roundTimer);

    const winner = winnerId ? this.state.players.get(winnerId) : null;

    this.state.status = "ended";

    this.broadcast("matchEnded", {
      winnerId: winner?.id || "",
      winnerName: winner?.name || "Winner"
    });
  }

  private getOpponent(playerId: string) {
    const match = this.activeMatches.find(m =>
      m.playerAId === playerId || m.playerBId === playerId
    );

    if (!match) return null;

    const opponentId = match.playerAId === playerId
      ? match.playerBId
      : match.playerAId;

    return this.state.players.get(opponentId) || null;
  }

  private broadcastGameState() {
    const allPlayers = this.getPlayers();

    for (const client of this.clients) {
      const me = this.state.players.get(client.sessionId);
      if (!me || me.role !== "player") continue;

      const opponent = this.getOpponent(me.id);

      client.send("gameState", {
        startingHealth: this.state.startingHealth,
        healingEnabled: true,
        timerEnabled: this.state.timerMinutes > 0,
        timeRemainingMs: Math.max(0, this.roundEndsAt - Date.now()),
        players: [
          {
            id: me.id,
            name: me.name,
            health: me.health,
            storedDamage: me.storedDamage,
            healCharge: me.healCharge
          },
          opponent ? {
            id: opponent.id,
            name: opponent.name,
            health: opponent.health,
            storedDamage: opponent.storedDamage,
            healCharge: opponent.healCharge
          } : null
        ].filter(Boolean)
      });
    }
  }

  private generateQuestion(): Question {
    const types = ["add", "subtract", "multiply", "divide", "bedmas"];
    const type = types[Math.floor(Math.random() * types.length)];

    let a = this.rand(1, 12);
    let b = this.rand(1, 12);
    let c = this.rand(1, 6);

    if (type === "add") {
      return {
        prompt: `${a} + ${b}`,
        answer: a + b
      };
    }

    if (type === "subtract") {
      if (b > a) [a, b] = [b, a];

      return {
        prompt: `${a} - ${b}`,
        answer: a - b
      };
    }

    if (type === "multiply") {
      return {
        prompt: `${a} × ${b}`,
        answer: a * b
      };
    }

    if (type === "divide") {
      const answer = this.rand(1, 12);
      const divisor = this.rand(1, 12);
      const dividend = answer * divisor;

      return {
        prompt: `${dividend} ÷ ${divisor}`,
        answer
      };
    }

    return {
      prompt: `${a} + ${b} × ${c}`,
      answer: a + b * c
    };
  }

  private rand(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private shuffle<T>(items: T[]) {
    const copy = [...items];

    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
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
      this.broadcastStatus("Ready to start!");
    } else {
      this.broadcastStatus(`Waiting for ${this.state.requiredPlayers} players`);
    }
  }

  canStart() {
    const players = this.getPlayers();
    return players.length >= this.state.requiredPlayers;
  }

  broadcastStatus(message: string) {
    this.broadcast("statusMessage", message);
  }
}