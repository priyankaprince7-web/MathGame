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
  private questionBank: Question[] = [];

  private roundTimer: NodeJS.Timeout | null = null;
  private timerInterval: NodeJS.Timeout | null = null;
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

    this.state.timerEnabled = options?.timerEnabled !== false;
    this.state.healingEnabled = options?.healingEnabled !== false;
    this.state.difficulty = options?.difficulty || "easy";

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

    this.onMessage("roundIntroComplete", () => {
      this.beginRoundGameplay();
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
      client.send("multiplayerSettings", {
        mode: this.state.mode,
        requiredPlayers: this.state.requiredPlayers,
        startingHealth: this.state.startingHealth,
        timerEnabled: this.state.timerEnabled,
        timerMinutes: this.state.timerMinutes,
        healingEnabled: this.state.healingEnabled,
        difficulty: this.state.difficulty
      });
    }

    this.broadcastPlayers();
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.eliminatedIds.add(client.sessionId);
    this.broadcastPlayers();
  }

  private startKnockoutTournament() {
    this.clearRoundTimers();

    this.state.status = "in_match";
    this.roundNumber = 0;
    this.eliminatedIds.clear();

    this.activePlayerIds = this.shuffle(
      this.getPlayers().map(p => p.id)
    );

    this.startNextRound(this.activePlayerIds);
  }

  private startNextRound(playerIds: string[]) {
    this.clearRoundTimers();

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

    this.buildQuestionBank(100);

    for (const id of this.activePlayerIds) {
      const p = this.state.players.get(id);
      if (!p) continue;

      p.health = this.state.startingHealth;
      p.storedDamage = 0;
      p.healCharge = 0;
      p.questionIndex = 0;
    }

    this.broadcast("gameStarted");

    this.roundEndsAt = 0;

    this.broadcast("roundStarted", {
      roundNumber: this.roundNumber,
      players: this.activePlayerIds.map(id => {
        const p = this.state.players.get(id);

        return {
          id,
          name: p?.name || "Player",
          playerNumber: this.getPlayerNumber(id)
        };
      }),
      matches: this.activeMatches.map(m => {
        const a = this.state.players.get(m.playerAId);
        const b = this.state.players.get(m.playerBId);

        return {
          playerAId: m.playerAId,
          playerAName: a?.name || "Player A",
          playerANumber: this.getPlayerNumber(m.playerAId),

          playerBId: m.playerBId,
          playerBName: b?.name || "Player B",
          playerBNumber: this.getPlayerNumber(m.playerBId)
        };
      }),
      startingHealth: this.state.startingHealth,
      timerEnabled: this.state.timerEnabled,
      timerMinutes: this.state.timerMinutes,
      healingEnabled: this.state.healingEnabled,
      difficulty: this.state.difficulty
    });

  }

  private createPairs(playerIds: string[]) {
    const pairs: MatchPair[] = [];

    for (let i = 0; i < playerIds.length; i += 2) {
      const a = playerIds[i];
      const b = playerIds[i + 1];

      if (!b) continue;

      pairs.push({
        playerAId: a,
        playerBId: b
      });
    }

    return pairs;
  }

  private buildQuestionBank(count: number) {
    this.questionBank = [];

    for (let i = 0; i < count; i++) {
      this.questionBank.push(this.generateQuestion());
    }
  }

  private sendQuestionsToAllActivePlayers() {
    for (const id of this.activePlayerIds) {
      if (this.eliminatedIds.has(id)) continue;
      this.sendQuestionToPlayer(id);
    }
  }

  private sendQuestionToPlayer(playerId: string) {
    const player = this.state.players.get(playerId);
    if (!player) return;

    const client = this.clients.find(c => c.sessionId === playerId);
    if (!client) return;

    const question = this.questionBank[player.questionIndex];
    if (!question) return;

    client.send("question", {
      index: player.questionIndex + 1,
      prompt: question.prompt
    });
  }

  private handleSubmitAnswer(client: Client, message: { answer?: string }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (this.eliminatedIds.has(player.id)) return;

    const question = this.questionBank[player.questionIndex];
    if (!question) return;

    const submitted = Number(message?.answer);

    if (!Number.isFinite(submitted)) {
      client.send("answerFeedback", { message: "Enter a number." });
      return;
    }

    if (submitted !== question.answer) {
      client.send("answerFeedback", { message: "Not quite!" });
      return;
    }

    player.storedDamage += 2;

    if (this.state.healingEnabled) {
      player.healCharge = Math.min(player.healCharge + 1, 10);
    }

    player.questionIndex++;

    client.send("answerFeedback", { message: "Correct! Attack charged." });

    this.broadcastGameState();
    this.sendQuestionToPlayer(player.id);
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

      const attackerClient = this.clients.find(c => c.sessionId === attacker.id);
      const opponentClient = this.clients.find(c => c.sessionId === opponent.id);

      const matchEndedData = {
        winnerId: attacker.id,
        winnerName: attacker.name,
        loserId: opponent.id
      };

      attackerClient?.send("matchEnded", matchEndedData);
      opponentClient?.send("matchEnded", matchEndedData);

      this.broadcast("hostMatchEnded", matchEndedData);

      this.checkRoundComplete();
    }

    this.broadcastGameState();
  }

  private handleHeal(client: Client) {
    if (!this.state.healingEnabled) return;

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

    for (const id of this.activePlayerIds) {
      const inMatch = this.activeMatches.some(m =>
        m.playerAId === id || m.playerBId === id
      );

      if (!inMatch) survivors.push(id);
    }

    this.clearRoundTimers();

    this.broadcast("roundEnded", {
      survivors
    });

    setTimeout(() => {
      this.startNextRound(survivors);
    }, 2500);
  }

  private finishRoundByHealth() {
    if (this.state.status !== "in_match") return;

    this.clearRoundTimers();

    const survivors: string[] = [];

    for (const match of this.activeMatches) {
      const a = this.state.players.get(match.playerAId);
      const b = this.state.players.get(match.playerBId);

      if (!a || !b) continue;

      if (a.health >= b.health) survivors.push(a.id);
      else survivors.push(b.id);
    }

    for (const id of this.activePlayerIds) {
      const inMatch = this.activeMatches.some(m =>
        m.playerAId === id || m.playerBId === id
      );

      if (!inMatch) survivors.push(id);
    }

    this.broadcast("roundEnded", {
      survivors
    });

    setTimeout(() => {
      this.startNextRound(survivors);
    }, 2500);
  }

  private endTournament(winnerId?: string) {
    this.clearRoundTimers();

    const winner = winnerId ? this.state.players.get(winnerId) : null;

    this.state.status = "ended";

    this.broadcast("tournamentEnded", {
      winnerId: winner?.id || "",
      winnerName: winner?.name || "Winner",
      winnerNumber: winnerId ? this.getPlayerNumber(winnerId) : 1
    });
  }

  private clearRoundTimers() {
    if (this.roundTimer) {
      clearTimeout(this.roundTimer);
      this.roundTimer = null;
    }

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private clearTimerIntervalOnly() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
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
    for (const client of this.clients) {
      const me = this.state.players.get(client.sessionId);
      if (!me || me.role !== "player") continue;

      const opponent = this.getOpponent(me.id);

      client.send("gameState", {
        startingHealth: this.state.startingHealth,
        healingEnabled: this.state.healingEnabled,
        timerEnabled: this.state.timerEnabled,
        timeRemainingMs: this.state.timerEnabled
          ? Math.max(0, this.roundEndsAt - Date.now())
          : -1,
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
    const difficulty = this.state.difficulty || "easy";

    if (difficulty === "easy") {
      return this.generateEasyQuestion();
    }

    if (difficulty === "medium") {
      return this.generateMediumQuestion();
    }

    return this.generateHardQuestion();
  }

  private generateEasyQuestion(): Question {
    const types = ["add", "subtract"];
    const type = types[Math.floor(Math.random() * types.length)];

    let a = this.rand(1, 20);
    let b = this.rand(1, 20);

    if (type === "add") {
      return {
        prompt: `${a} + ${b}`,
        answer: a + b
      };
    }

    if (b > a) [a, b] = [b, a];

    return {
      prompt: `${a} - ${b}`,
      answer: a - b
    };
  }

  private generateMediumQuestion(): Question {
    const types = ["add", "subtract", "multiply", "divide"];
    const type = types[Math.floor(Math.random() * types.length)];

    let a = this.rand(2, 12);
    let b = this.rand(2, 12);

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

    const answer = this.rand(2, 12);
    const divisor = this.rand(2, 12);

    return {
      prompt: `${answer * divisor} ÷ ${divisor}`,
      answer
    };
  }

  private generateHardQuestion(): Question {
    const types = ["bedmas1", "bedmas2", "bedmas3"];
    const type = types[Math.floor(Math.random() * types.length)];

    const a = this.rand(2, 12);
    const b = this.rand(2, 12);
    const c = this.rand(2, 8);

    if (type === "bedmas1") {
      return {
        prompt: `${a} + ${b} × ${c}`,
        answer: a + b * c
      };
    }

    if (type === "bedmas2") {
      return {
        prompt: `(${a} + ${b}) × ${c}`,
        answer: (a + b) * c
      };
    }

    return {
      prompt: `${a} × ${b} - ${c}`,
      answer: a * b - c
    };
  }

  private getPlayerNumber(playerId: string) {
    const players = this.getPlayers();
    const index = players.findIndex(p => p.id === playerId);

    return index >= 0 ? index + 1 : 1;
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

  private beginRoundGameplay() {
    if (this.state.status !== "in_match") return;

    this.clearRoundTimers();

    this.roundEndsAt = this.state.timerEnabled
      ? Date.now() + this.state.timerMinutes * 60 * 1000
      : 0;

    if (this.state.timerEnabled && this.state.timerMinutes > 0) {
      this.roundTimer = setTimeout(() => {
        this.finishRoundByHealth();
      }, this.state.timerMinutes * 60 * 1000);

      this.timerInterval = setInterval(() => {
        if (this.state.status !== "in_match") return;
        this.broadcastGameState();
      }, 1000);
    }

    this.sendQuestionsToAllActivePlayers();
    this.broadcastGameState();
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