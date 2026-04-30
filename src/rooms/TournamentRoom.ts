import { Room, Client } from "colyseus";
import { TournamentState, PlayerState } from "./schema/TournamentState.js";

type Role = "host" | "player";

type Question = {
  prompt: string;
  answer: number;
};

function makeRoomCode(length = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
}

export class TournamentRoom extends Room {
  maxClients = 3;
  state = new TournamentState();

  gameStarted = false;
  questionDeck: Question[] = [];
  matchDurationMs = 5 * 60 * 1000;
  matchEndsAt = 0;

  timerInterval: NodeJS.Timeout | null = null;
  matchTimeout: NodeJS.Timeout | null = null;

  onCreate() {
    this.roomId = makeRoomCode();
    this.state.roomCode = this.roomId;
    this.state.status = "lobby";
    this.state.timeRemainingMs = 0;

    console.log("Tournament room created:", this.roomId);

    this.onMessage("joinLobby", (client, message: { name?: string }) => {
      const participant = this.state.players.get(client.sessionId);
      if (!participant) return;

      participant.name = message?.name?.trim() || participant.name || "Player";
      participant.connected = true;

      this.broadcastPlayers();
      this.broadcastGameState();
      this.broadcastStatus(`${participant.name} joined the lobby`);
    });

    this.onMessage("startGame", () => {
      this.startMatch();
    });

    this.onMessage("playAgain", () => {
      this.startMatch();
    });

    this.onMessage("submitAnswer", (client, message: { answer: string | number }) => {
      if (!this.gameStarted) return;

      const player = this.state.players.get(client.sessionId);
      if (!player || player.role !== "player") return;

      const currentQuestion = this.getQuestionForPlayer(player);
      if (!currentQuestion) return;

      const submitted = Number(message.answer);

      if (submitted === currentQuestion.answer) {
        player.storedDamage = Math.min(player.storedDamage + 2, 20);
        player.shieldCharge = Math.min(player.shieldCharge + 1, 5);
        player.questionIndex += 1;

        client.send("answerFeedback", {
          correct: true,
          message: "Correct!"
        });

        this.sendQuestionToPlayer(client, player);
        this.broadcastGameState();
      } else {
        client.send("answerFeedback", {
          correct: false,
          message: "Wrong answer. Try again."
        });
      }
    });

    this.onMessage("shield", (client) => {
      if (!this.gameStarted) return;

      const player = this.state.players.get(client.sessionId);
      if (!player || player.role !== "player") return;

      const cost = 5;

      if (player.shieldCharge < cost) {
        client.send("statusMessage", "Need full shield charge");
        return;
      }

      player.shieldCharge = 0;
      player.storedDamage = Math.max(0, player.storedDamage - 5);
      player.shieldUntil = Date.now() + 5000;

      client.send("statusMessage", "Shield active for 5 seconds!");
      this.broadcastGameState();
    });

    this.onMessage("attack", (client) => {
      if (!this.gameStarted) return;

      const attacker = this.state.players.get(client.sessionId);
      if (!attacker || attacker.role !== "player") return;

      if (attacker.storedDamage <= 0) {
        client.send("statusMessage", "No stored damage to use");
        return;
      }

      const defender = this.getOpponent(attacker.id);
      if (!defender) return;

      let damage = attacker.storedDamage;
      attacker.storedDamage = 0;

      const now = Date.now();
      let blocked = false;

      if (defender.shieldUntil > now) {
        damage = Math.ceil(damage / 2);
        blocked = true;
      }

      defender.health = Math.max(0, defender.health - damage);

      this.broadcast("attackResult", {
        attackerId: attacker.id,
        attackerName: attacker.name,
        defenderId: defender.id,
        defenderName: defender.name,
        damage,
        blocked
      });

      this.broadcastGameState();

      if (defender.health <= 0) {
        this.endMatch(attacker, defender, `${attacker.name} wins by knockout`);
      }
    });
  }

  startMatch() {
    const players = this.getPlayers();

    if (players.length !== 2) {
      this.broadcastStatus("Need exactly 2 players to start");
      return;
    }

    this.gameStarted = true;
    this.state.status = "in_match";
    this.questionDeck = this.generateQuestionDeck(100);
    this.matchEndsAt = Date.now() + this.matchDurationMs;
    this.state.timeRemainingMs = this.matchDurationMs;

    for (const player of players) {
      player.health = 20;
      player.storedDamage = 0;
      player.shieldUntil = 0;
      player.questionIndex = 0;
      player.shieldCharge = 0;
    }

    this.clearTimers();

    this.timerInterval = setInterval(() => {
      this.state.timeRemainingMs = Math.max(0, this.matchEndsAt - Date.now());
      this.broadcastGameState();
    }, 1000);

    this.matchTimeout = setTimeout(() => {
      this.endMatchByTime();
    }, this.matchDurationMs);

    this.broadcast("gameStarted");
    this.broadcastPlayers();
    this.broadcastGameState();
    this.sendQuestionsToPlayers();
    this.broadcastStatus("Match started");

    console.log("Game started");
  }

  onJoin(client: Client, options: { role?: Role }) {
    const role: Role = options?.role === "host" ? "host" : "player";

    console.log(client.sessionId, "joined!", options);

    if (!this.state.players.has(client.sessionId)) {
      const player = new PlayerState();
      player.id = client.sessionId;
      player.name = role === "host" ? "Host" : "Joining...";
      player.role = role;
      player.connected = true;
      player.health = 20;
      player.storedDamage = 0;
      player.shieldUntil = 0;
      player.questionIndex = 0;
      player.shieldCharge = 0;

      this.state.players.set(client.sessionId, player);
    }

    this.broadcastPlayers();
    this.broadcastGameState();
  }

  onLeave(client: Client) {
    const participant = this.state.players.get(client.sessionId);

    if (participant) {
      const wasPlayer = participant.role === "player";
      const name = participant.name;

      this.state.players.delete(client.sessionId);
      this.broadcastPlayers();
      this.broadcastGameState();

      console.log(client.sessionId, "left!");

      if (this.gameStarted && wasPlayer) {
        const remainingPlayer = this.getPlayers()[0];
        if (remainingPlayer) {
          this.endMatch(
            remainingPlayer,
            participant,
            `${name} disconnected. ${remainingPlayer.name} wins`
          );
        }
      }
    }
  }

  onDispose() {
    this.clearTimers();
  }

  broadcastPlayers() {
    const playersOnly = this.getPlayers().map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected
    }));

    this.broadcast("updatePlayers", playersOnly);
  }

  broadcastGameState() {
    this.state.timeRemainingMs = this.gameStarted
      ? Math.max(0, this.matchEndsAt - Date.now())
      : 0;

    const now = Date.now();

    const playersOnly = this.getPlayers().map((p) => ({
      id: p.id,
      name: p.name,
      health: p.health,
      storedDamage: p.storedDamage,
      shieldActive: p.shieldUntil > now,
      shieldTimeLeft: Math.max(0, p.shieldUntil - now),
      questionIndex: p.questionIndex,
      shieldCharge: p.shieldCharge
    }));

    this.broadcast("gameState", {
      players: playersOnly,
      gameStarted: this.gameStarted,
      timeRemainingMs: this.state.timeRemainingMs
    });
  }

  broadcastStatus(message: string) {
    this.broadcast("statusMessage", message);
  }

  sendQuestionsToPlayers() {
    for (const client of this.clients) {
      const participant = this.state.players.get(client.sessionId);
      if (!participant || participant.role !== "player") continue;

      this.sendQuestionToPlayer(client, participant);
    }
  }

  sendQuestionToPlayer(client: Client, player: PlayerState) {
    const question = this.getQuestionForPlayer(player);
    if (!question) return;

    client.send("question", {
      prompt: question.prompt,
      questionNumber: player.questionIndex + 1
    });
  }

  getQuestionForPlayer(player: PlayerState) {
    if (player.questionIndex >= this.questionDeck.length) {
      this.questionDeck.push(...this.generateQuestionDeck(50));
    }

    return this.questionDeck[player.questionIndex];
  }

  getPlayers() {
    return Array.from(this.state.players.values()).filter((p) => p.role === "player");
  }

  getOpponent(playerId: string) {
    return this.getPlayers().find((p) => p.id !== playerId) || null;
  }

  generateQuestionDeck(count: number): Question[] {
    const deck: Question[] = [];

    for (let i = 0; i < count; i++) {
      const a = Math.floor(Math.random() * 11);
      const b = Math.floor(Math.random() * 11);

      deck.push({
        prompt: `${a} + ${b} = ?`,
        answer: a + b
      });
    }

    return deck;
  }

  endMatchByTime() {
    if (!this.gameStarted) return;

    const players = this.getPlayers();
    if (players.length < 2) return;

    const [p1, p2] = players;

    if (p1.health < p2.health) {
      this.endMatch(p2, p1, `${p2.name} wins on time`);
    } else if (p2.health < p1.health) {
      this.endMatch(p1, p2, `${p1.name} wins on time`);
    } else if (p1.storedDamage > p2.storedDamage) {
      this.endMatch(p1, p2, `${p1.name} wins on time by higher stored damage`);
    } else if (p2.storedDamage > p1.storedDamage) {
      this.endMatch(p2, p1, `${p2.name} wins on time by higher stored damage`);
    } else {
      this.gameStarted = false;
      this.state.status = "finished";
      this.clearTimers();
      this.broadcastGameState();

      this.broadcast("matchEnded", {
        winnerId: null,
        winnerName: "Draw",
        loserId: null,
        loserName: "Draw",
        reason: "Time expired with equal health and equal stored damage"
      });

      this.broadcastStatus("Match ended in a draw");
    }
  }

  endMatch(winner: PlayerState, loser: PlayerState, reason: string) {
    this.gameStarted = false;
    this.state.status = "finished";
    this.clearTimers();
    this.broadcastGameState();

    this.broadcast("matchEnded", {
      winnerId: winner.id,
      winnerName: winner.name,
      loserId: loser.id,
      loserName: loser.name,
      reason
    });

    this.broadcastStatus(reason);
  }

  clearTimers() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    if (this.matchTimeout) {
      clearTimeout(this.matchTimeout);
      this.matchTimeout = null;
    }
  }
}