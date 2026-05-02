const client = new Colyseus.Client("wss://mathgame-production-5026.up.railway.app");

let room = null;

const joinScreen = document.getElementById("joinScreen");
const lobbyScreen = document.getElementById("lobbyScreen");
const gameScreen = document.getElementById("gameScreen");

const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");

const joinStatus = document.getElementById("joinStatus");
const lobbyStatus = document.getElementById("lobbyStatus");

const questionNumberText = document.getElementById("questionNumberText");
const questionText = document.getElementById("questionText");
const answerInput = document.getElementById("answerInput");
const submitAnswerBtn = document.getElementById("submitAnswerBtn");
const damageBox = document.getElementById("damageBox");
const attackBtn = document.getElementById("attackBtn");
const healBtn = document.getElementById("healBtn");
const healFill = document.getElementById("healFill");
const attackFill = document.getElementById("attackFill");
const statusText = document.getElementById("statusText");
const customKeypad = document.getElementById("customKeypad");
const endButtons = document.getElementById("endButtons");
const playAgainBtn = document.getElementById("playAgainBtn");
const backToLobbyBtn = document.getElementById("backToLobbyBtn");

const myHealthLabel = document.getElementById("myHealthLabel");
const opponentHealthLabel = document.getElementById("opponentHealthLabel");
const myHealthFill = document.getElementById("myHealthFill");
const opponentHealthFill = document.getElementById("opponentHealthFill");

const keypadButtons = document.querySelectorAll(".keypadBtn");

const customKeypadHeal = document.getElementById("customKeypadHeal");
const customKeypadAttackOnly = document.getElementById("customKeypadAttackOnly");
const attackOnlyBtn = document.getElementById("attackOnlyBtn");
const attackOnlyFill = document.getElementById("attackOnlyFill");

document.addEventListener("wheel", (e) => {
  e.preventDefault();
}, { passive: false });

document.querySelectorAll("button").forEach((btn) => {
  btn.addEventListener("pointerdown", () => {
    btn.classList.add("pressed");

    setTimeout(() => {
      btn.classList.remove("pressed");
    }, 100);
  });

  btn.addEventListener("pointerup", () => {
    btn.classList.remove("pressed");
  });

  btn.addEventListener("pointercancel", () => {
    btn.classList.remove("pressed");
  });
});

function showScreen(screenId) {
  joinScreen.hidden = true;
  lobbyScreen.hidden = true;
  gameScreen.hidden = true;

  document.getElementById(screenId).hidden = false;

  if (screenId === "joinScreen") {
    document.body.classList.remove("lockScroll");
  } else {
    document.body.classList.add("lockScroll");
  }
}

function setStatus(message) {
  if (statusText) statusText.textContent = message;
  if (lobbyStatus && !lobbyScreen.hidden) lobbyStatus.textContent = message;
  if (joinStatus && !joinScreen.hidden) joinStatus.textContent = message;
}

joinBtn.onclick = async () => {
  const name = nameInput.value.trim() || "Player";
  const roomId = roomInput.value.trim();

  if (!roomId) {
    joinStatus.textContent = "Enter the room code first.";
    return;
  }

  try {
    joinBtn.disabled = true;
    joinStatus.textContent = "Joining...";

    room = await client.joinById(roomId, {
      role: "player"
    });

    setupRoomListeners();

    showScreen("lobbyScreen");
    lobbyStatus.textContent = "Connected. Waiting for the host to start.";

    room.send("joinLobby", { name });
  } catch (error) {
    console.error(error);
    joinStatus.textContent = "Join failed: " + error.message;
    joinBtn.disabled = false;
  }
};

function setupRoomListeners() {
  room.onMessage("updatePlayers", (players) => {
    const names = players.map((p) => p.name).join(", ");
    lobbyStatus.textContent = "Players: " + names;
  });

  room.onMessage("gameStarted", () => {
    showScreen("gameScreen");
    statusText.textContent = "Game started!";
    gameScreen.classList.remove("ended");

    customKeypadHeal.hidden = false;
    customKeypadAttackOnly.hidden = true;
    endButtons.hidden = true;
    answerInput.hidden = false;
    answerInput.disabled = false;
  });

  room.onMessage("question", (data) => {
    showScreen("gameScreen");

    questionNumberText.textContent = "Question " + data.questionNumber;
    questionText.textContent = data.prompt;

    answerInput.value = "";
    statusText.textContent = "Solve it!";

    gameScreen.classList.remove("ended");

    customKeypadHeal.hidden = false;
  customKeypadAttackOnly.hidden = true;
    endButtons.hidden = true;
    answerInput.hidden = false;
    answerInput.disabled = false;
  });

  room.onMessage("answerFeedback", (data) => {
    statusText.textContent = data.message;
  });

  room.onMessage("statusMessage", (message) => {
    setStatus(message);
  });

  room.onMessage("gameState", (state) => {
    if (!state || !state.players || !room) return;

    const me = state.players.find((p) => p.id === room.sessionId);
    const opponent = state.players.find((p) => p.id !== room.sessionId);

    if (!me) return;

    const maxHealth = state.startingHealth || 20;
    const healingEnabled = state.healingEnabled === true;

    // Choose keypad
    customKeypadHeal.hidden = !healingEnabled;
    customKeypadAttackOnly.hidden = healingEnabled;

    const attackPoints = Math.min(me.storedDamage, maxHealth);
    const healPoints = Math.min(me.healCharge, 10);

    // Attack fill for both keypad versions
    attackFill.style.clipPath = `inset(0 ${100 - (attackPoints / maxHealth) * 100}% 0 0)`;
    attackOnlyFill.style.clipPath = `inset(0 ${100 - (attackPoints / maxHealth) * 100}% 0 0)`;

    attackBtn.querySelector(".actionText").textContent = `Attack: ${attackPoints}`;
    attackOnlyBtn.querySelector(".actionText").textContent = `Attack: ${attackPoints}`;

    // Heal fill only when healing is on
    if (healingEnabled) {
      healFill.style.clipPath = `inset(0 ${100 - healPoints * 10}% 0 0)`;
      healBtn.querySelector(".actionText").textContent = `Heal: ${healPoints}`;
    }

    myHealthLabel.textContent = "Your Health";

    const myHealthPercent = (Math.min(me.health, maxHealth) / maxHealth) * 100;
    myHealthFill.style.clipPath = `inset(0 ${100 - myHealthPercent}% 0 0)`;

    if (opponent) {
      opponentHealthLabel.textContent = opponent.name + " Health";

      const opponentHealthPercent = (Math.min(opponent.health, maxHealth) / maxHealth) * 100;
      opponentHealthFill.style.clipPath = `inset(0 ${100 - opponentHealthPercent}% 0 0)`;
    } else {
      opponentHealthLabel.textContent = "Waiting for opponent...";
      opponentHealthFill.style.clipPath = "inset(0 100% 0 0)";
    }
  });

  room.onMessage("attackResult", (data) => {
    if (data.attackerId === room.sessionId) {
      statusText.textContent = `You attacked for ${data.damage} damage!`;
    } else if (data.defenderId === room.sessionId) {
      statusText.textContent = `${data.attackerName} attacked you for ${data.damage} damage!`;
    }
  });

  room.onMessage("matchEnded", (data) => {
    showScreen("gameScreen");

    gameScreen.classList.add("ended");

    questionNumberText.textContent = "Match Over";
    questionText.textContent =
      `${data.winnerName || "Someone"} wins!\n\nIf you want to play again, press the Play Again button on the main game screen.`;

    customKeypadHeal.hidden = true;
    customKeypadAttackOnly.hidden = true;
    endButtons.hidden = true;
    answerInput.hidden = true;

    submitAnswerBtn.disabled = true;
    attackBtn.disabled = true;
    healBtn.disabled = true;
    answerInput.disabled = true;
  });

  room.onLeave(() => {
    setStatus("Disconnected from room.");
  });
}

function submitAnswer() {
  if (!room) return;

  const answer = answerInput.value.trim();

  if (!answer) {
    statusText.textContent = "Enter an answer first.";
    return;
  }

  room.send("submitAnswer", { answer });
}

submitAnswerBtn.onclick = submitAnswer;

document.addEventListener("keydown", (event) => {
  if (gameScreen.hidden) return;

  if (event.key >= "0" && event.key <= "9") {
    answerInput.value += event.key;
  }

  if (event.key === "Backspace") {
    answerInput.value = answerInput.value.slice(0, -1);
  }

  if (event.key === "Enter") {
    submitAnswer();
  }
});

keypadButtons.forEach((btn) => {
  btn.addEventListener("pointerdown", (event) => {
    event.preventDefault();

    const key = btn.dataset.key;

    if (key === "back") {
      answerInput.value = answerInput.value.slice(0, -1);
      return;
    }

    if (key === "submit") {
      submitAnswer();
      return;
    }

    answerInput.value += key;
  });
});

attackBtn.addEventListener("pointerdown", (event) => {
  event.preventDefault();

  if (!room) return;

  room.send("attack");
  statusText.textContent = "Attack sent!";
});

healBtn.addEventListener("pointerdown", (event) => {
  event.preventDefault();

  if (!room) return;

  // 🚫 block if healing is turned OFF
  if (healBtn.hidden) return;

  // 🚫 block if no charge
  if (healBtn.classList.contains("notReady")) {
    return;
  }

  room.send("heal");
});

playAgainBtn.addEventListener("click", () => {
  if (!room) return;

  gameScreen.classList.remove("ended");

  customKeypadHeal.hidden = false;
  customKeypadAttackOnly.hidden = true;
  endButtons.hidden = true;
  answerInput.hidden = false;
  answerInput.disabled = false;

  room.send("playAgain");
});

backToLobbyBtn.addEventListener("click", () => {
  showScreen("joinScreen");

  gameScreen.classList.remove("ended");

  joinBtn.disabled = false;
  joinStatus.textContent = "";
  lobbyStatus.textContent = "Connected. Waiting for the host to start.";
  roomInput.value = "";
});