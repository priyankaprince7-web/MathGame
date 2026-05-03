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

    this.onMessage("startGame", (client, settings?: {
      difficulty?: string;
      timerEnabled?: boolean;
      timerMinutes?: number;
      healingEnabled?: boolean;
      startingHealth?: number;
    }) => {
      this.applySettings(settings);
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
      player.storedDamage = Math.min(player.storedDamage + 2, this.state.startingHealth);

      if (this.state.healingEnabled) {
        player.healCharge = Math.min(player.healCharge + 1, 10);
      } else {
        player.healCharge = 0;
      }

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

    this.onMessage("heal", (client) => {
      if (!this.gameStarted) return;

      const player = this.state.players.get(client.sessionId);
      if (!player || player.role !== "player") return;

      if (!this.state.healingEnabled) {
        client.send("statusMessage", "Healing is off");
        return;
      }

      if (player.healCharge <= 0) {
        client.send("statusMessage", "No health charge to use");
        return;
      }

      const amount = player.healCharge;

      player.health = Math.min(this.state.startingHealth, player.health + amount);

      player.healCharge = 0;
      player.storedDamage = Math.max(0, player.storedDamage - amount);

      // ⭐ ADD THIS
      this.broadcast("healUsed", player.id);

      client.send("statusMessage", "Health increased!");
      this.broadcastGameState();
    });

    this.onMessage("attack", (client) => {
      if (!this.gameStarted) return;

      const attacker = this.state.players.get(client.sessionId);
      if (!attacker || attacker.role !== "player") return;

      if (attacker.storedDamage <= 0) {
        client.send("statusMessage", "No attack charge to use");
        return;
      }

      const defender = this.getOpponent(attacker.id);
      if (!defender) return;

      const damage = attacker.storedDamage;

      attacker.storedDamage = 0;
      attacker.healCharge = Math.max(0, attacker.healCharge - damage);

      defender.health = Math.max(0, defender.health - damage);

      this.broadcast("attackResult", {
        attackerId: attacker.id,
        attackerName: attacker.name,
        defenderId: defender.id,
        defenderName: defender.name,
        damage
      });

      this.broadcastGameState();

      if (defender.health <= 0) {
        this.endMatch(attacker, defender, `${attacker.name} wins by knockout`);
      }
    });
  }

  applySettings(settings?: {
    difficulty?: string;
    timerEnabled?: boolean;
    timerMinutes?: number;
    healingEnabled?: boolean;
    startingHealth?: number;
  }) {
    const difficulty = settings?.difficulty || "easy";
    this.state.difficulty = ["easy", "medium", "hard"].includes(difficulty)
      ? difficulty
      : "easy";

    this.state.timerEnabled = settings?.timerEnabled ?? true;
    this.state.timerMinutes = Math.max(3, Math.min(10, Number(settings?.timerMinutes ?? 3)));

    this.state.healingEnabled = settings?.healingEnabled ?? true;
    this.state.startingHealth = Math.max(10, Math.min(50, Number(settings?.startingHealth ?? 20)));

    this.matchDurationMs = this.state.timerMinutes * 60 * 1000;
  }

  startMatch() {
    const players = this.getPlayers();

    if (players.length !== 2) {
      this.broadcastStatus("Need exactly 2 players to start");
      return;
    }

    this.gameStarted = true;
    this.state.status = "in_match";
    this.questionDeck = this.generateQuestionDeck(100, this.state.difficulty);

    if (this.state.timerEnabled) {
      this.matchEndsAt = Date.now() + this.matchDurationMs;
      this.state.timeRemainingMs = this.matchDurationMs;

      this.timerInterval = setInterval(() => {
        this.state.timeRemainingMs = Math.max(0, this.matchEndsAt - Date.now());
        this.broadcastGameState();
      }, 1000);

      this.matchTimeout = setTimeout(() => {
        this.endMatchByTime();
      }, this.matchDurationMs);
    } else {
      this.matchEndsAt = 0;
      this.state.timeRemainingMs = -1;
    }

    for (const player of players) {
      player.health = this.state.startingHealth;
      player.storedDamage = 0;
      player.healCharge = 0;
      player.questionIndex = 0;
    }

    this.clearTimers();

    if (this.state.timerEnabled) {
      this.timerInterval = setInterval(() => {
        this.state.timeRemainingMs = Math.max(0, this.matchEndsAt - Date.now());
        this.broadcastGameState();
      }, 1000);

      this.matchTimeout = setTimeout(() => {
        this.endMatchByTime();
      }, this.matchDurationMs);
    }

    this.broadcast("gameStarted");
    this.broadcastPlayers();
    this.broadcastGameState();
    this.sendQuestionsToPlayers();
    this.broadcastStatus("Match started");
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
      player.healCharge = 0;
      player.questionIndex = 0;

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
    this.state.timeRemainingMs =
      this.gameStarted && this.state.timerEnabled
        ? Math.max(0, this.matchEndsAt - Date.now())
        : -1;

    const playersOnly = this.getPlayers().map((p) => ({
      id: p.id,
      name: p.name,
      health: p.health,
      storedDamage: p.storedDamage,
      healCharge: p.healCharge,
      questionIndex: p.questionIndex
    }));

    this.broadcast("gameState", {
      players: playersOnly,
      gameStarted: this.gameStarted,
      timeRemainingMs: this.state.timerEnabled ? this.state.timeRemainingMs : -1,
      difficulty: this.state.difficulty,
      timerEnabled: this.state.timerEnabled,
      timerMinutes: this.state.timerMinutes,
      healingEnabled: this.state.healingEnabled,
      startingHealth: this.state.startingHealth
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

  generateQuestionDeck(count: number, difficulty = "easy"): Question[] {
    const deck: Question[] = [];

    for (let i = 0; i < count; i++) {
      deck.push(this.generateBedmasQuestion(difficulty));
    }

    return deck;
  }

  generateBedmasQuestion(difficulty: string): Question {
    const r = (min: number, max: number) =>
      Math.floor(Math.random() * (max - min + 1)) + min;

    let a = 0;
    let b = 0;
    let c = 0;
    let d = 0;
    let prompt = "";
    let answer = 0;

    if (difficulty === "easy") {
      const operations = ["+", "-", "×", "÷"];
      const op = operations[r(0, operations.length - 1)];

      if (op === "+") {
        a = r(1, 20);
        b = r(1, 20);
        prompt = `${a} + ${b}`;
        answer = a + b;
      } 
      else if (op === "-") {
        a = r(1, 20);
        b = r(1, a); // keeps answer whole and not negative
        prompt = `${a} - ${b}`;
        answer = a - b;
      } 
      else if (op === "×") {
        a = r(1, 12);
        b = r(1, 12);
        prompt = `${a} × ${b}`;
        answer = a * b;
      } 
      else if (op === "÷") {
        b = r(1, 12);
        answer = r(1, 12);
        a = b * answer; // guarantees no remainder
        prompt = `${a} ÷ ${b}`;
      }
    } 
    else if (difficulty === "medium") {
      // This is your old easy format
      a = r(1, 10);
      b = r(1, 10);
      c = r(1, 10);

      if (Math.random() < 0.5) {
        prompt = `${a} + ${b} × ${c}`;
        answer = a + b * c;
      } else {
        prompt = `(${a} + ${b}) × ${c}`;
        answer = (a + b) * c;
      }
    } 
    else {
      // This is your old medium format
      a = r(2, 12);
      b = r(2, 12);
      c = r(2, 12);
      d = r(1, 10);

      prompt = `${a} × (${b} + ${c}) - ${d}`;
      answer = a * (b + c) - d;
    }

    return {
      prompt: `${prompt} = ?`,
      answer
    };
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
      this.endMatch(p1, p2, `${p1.name} wins on time by higher attack charge`);
    } else if (p2.storedDamage > p1.storedDamage) {
      this.endMatch(p2, p1, `${p2.name} wins on time by higher attack charge`);
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
        reason: "Time expired with equal health and equal attack charge"
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