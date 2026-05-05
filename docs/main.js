const client = new Colyseus.Client("wss://www.scholarshowdown.com");

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

const myHealthLabel = document.getElementById("myHealthLabel");
const opponentHealthLabel = document.getElementById("opponentHealthLabel");
const myHealthFill = document.getElementById("myHealthFill");
const opponentHealthFill = document.getElementById("opponentHealthFill");

const keypadButtons = document.querySelectorAll(".keypadBtn");

const customKeypadHeal = document.getElementById("customKeypadHeal");
const customKeypadAttackOnly = document.getElementById("customKeypadAttackOnly");
const attackOnlyBtn = document.getElementById("attackOnlyBtn");
const attackOnlyFill = document.getElementById("attackOnlyFill");

const healthPanel = document.getElementById("healthPanel");

let currentHealingEnabled = true;
let phoneTimerEnabled = false;
let isPhonePaused = false;

function setKeypadMode(healingEnabled) {
  currentHealingEnabled = healingEnabled === true;

  customKeypadHeal.hidden = !currentHealingEnabled;
  customKeypadAttackOnly.hidden = currentHealingEnabled;
}

document.addEventListener("wheel", (e) => {
  if (!gameScreen.hidden && !gameScreen.classList.contains("ended")) {
    e.preventDefault();
  }
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

  if (screenId === "gameScreen" && !gameScreen.classList.contains("ended")) {
    document.body.classList.add("lockScroll");
  } else {
    document.body.classList.remove("lockScroll");
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

  room.onMessage("gamePaused", () => {
    isPhonePaused = true;

    showScreen("gameScreen");
    gameScreen.classList.remove("ended");

    questionNumberText.hidden = true;
    questionNumberText.textContent = "";

    questionText.textContent = "Game Paused";
    statusText.textContent = "";

    customKeypadHeal.hidden = true;
    customKeypadAttackOnly.hidden = true;
    answerInput.hidden = true;
    if (healthPanel) healthPanel.hidden = true;

    customKeypadHeal.style.display = "none";
    customKeypadAttackOnly.style.display = "none";

    submitAnswerBtn.disabled = true;
    attackBtn.disabled = true;
    healBtn.disabled = true;
    attackOnlyBtn.disabled = true;
    answerInput.disabled = true;
  });

  room.onMessage("gameResumed", () => {
    isPhonePaused = false;

    showScreen("gameScreen");

    questionText.textContent = "Resuming...";
    statusText.textContent = "";

    customKeypadHeal.hidden = true;
    customKeypadAttackOnly.hidden = true;
    answerInput.hidden = true;
    if (healthPanel) healthPanel.hidden = true;

    submitAnswerBtn.disabled = true;
    attackBtn.disabled = true;
    healBtn.disabled = true;
    attackOnlyBtn.disabled = true;
    answerInput.disabled = true;
  });

  room.onMessage("returnToLobby", () => {
    showScreen("lobbyScreen");

    gameScreen.classList.remove("ended");

    customKeypadHeal.hidden = true;
    customKeypadAttackOnly.hidden = true;
    answerInput.hidden = true;
    if (healthPanel) healthPanel.hidden = true;

    submitAnswerBtn.disabled = true;
    attackBtn.disabled = true;
    healBtn.disabled = true;
    attackOnlyBtn.disabled = true;
    answerInput.disabled = true;

    lobbyStatus.textContent = "Waiting for the host to start again.";
  });

  room.onMessage("countdown", (data) => {
    showScreen("gameScreen");

    questionNumberText.hidden = true;
    questionNumberText.textContent = "";

    statusText.textContent = "Get ready!";

    customKeypadHeal.hidden = true;
    customKeypadAttackOnly.hidden = true;
    answerInput.hidden = true;
    if (healthPanel) healthPanel.hidden = true;

    submitAnswerBtn.disabled = true;
    attackBtn.disabled = true;
    healBtn.disabled = true;
    attackOnlyBtn.disabled = true;
    answerInput.disabled = true;
  });

  room.onMessage("gameStarted", () => {
    showScreen("gameScreen");
    statusText.textContent = "Game started!";
    gameScreen.classList.remove("ended");

    setKeypadMode(currentHealingEnabled);

    answerInput.hidden = false;
    answerInput.disabled = false;

    submitAnswerBtn.disabled = false;
    attackBtn.disabled = false;
    healBtn.disabled = false;
    attackOnlyBtn.disabled = false;
  });

  room.onMessage("question", (data) => {
    if (isPhonePaused) return;
    showScreen("gameScreen");

    if (healthPanel) healthPanel.hidden = false;

    if (!phoneTimerEnabled) {
      questionNumberText.hidden = true;
      questionNumberText.textContent = "";
    }
    questionText.textContent = data.prompt;

    answerInput.value = "";
    statusText.textContent = "Solve it!";

    gameScreen.classList.remove("ended");

    customKeypadHeal.style.display = "";
    customKeypadAttackOnly.style.display = "";
    setKeypadMode(currentHealingEnabled);
    answerInput.hidden = false;
    answerInput.disabled = false;

    submitAnswerBtn.disabled = false;
    attackBtn.disabled = false;
    healBtn.disabled = false;
    attackOnlyBtn.disabled = false;
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
    if (isPhonePaused) return;

    const me = state.players.find((p) => p.id === room.sessionId);
    const opponent = state.players.find((p) => p.id !== room.sessionId);

    if (!me) return;

    const maxHealth = state.startingHealth || 20;
    const healingEnabled = state.healingEnabled === true;
    setKeypadMode(healingEnabled);

    phoneTimerEnabled = state.timerEnabled === true;

    if (phoneTimerEnabled && state.timeRemainingMs >= 0) {
      const totalSeconds = Math.max(0, Math.ceil(state.timeRemainingMs / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;

      questionNumberText.hidden = false;
      questionNumberText.textContent = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    } else {
      questionNumberText.hidden = true;
      questionNumberText.textContent = "";
    }

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
    document.body.classList.remove("lockScroll");

    const winnerName = data.winnerName || "Someone";

    questionNumberText.textContent = "Match Over";
    questionText.innerHTML = `
      <div id="winnerLine">${winnerName} Wins!</div>
      <div id="playAgainMessage">
        If you want to play again, press the Play Again button on the main game screen.
      </div>
    `;

    // fully hide gameplay UI
    customKeypadHeal.hidden = true;
    customKeypadAttackOnly.hidden = true;
    answerInput.hidden = true;

    customKeypadHeal.style.display = "none";
    customKeypadAttackOnly.style.display = "none";

    submitAnswerBtn.disabled = true;
    attackBtn.disabled = true;
    healBtn.disabled = true;
    attackOnlyBtn.disabled = true;
    answerInput.disabled = true;
  });

  room.onLeave(() => {
    room = null;

    joinBtn.disabled = false;
    joinStatus.textContent = "Room disconnected. Enter your name and room code to join again.";
    lobbyStatus.textContent = "";

    roomInput.value = "";
    answerInput.value = "";

    gameScreen.classList.remove("ended");

    customKeypadHeal.hidden = true;
    customKeypadAttackOnly.hidden = true;
    answerInput.hidden = true;

    submitAnswerBtn.disabled = true;
    attackBtn.disabled = true;
    healBtn.disabled = true;
    attackOnlyBtn.disabled = true;
    answerInput.disabled = true;

    showScreen("joinScreen");
  });

  room.onMessage("hostBackToTitle", () => {
    room = null;

    joinBtn.disabled = false;
    roomInput.value = "";
    answerInput.value = "";

    joinStatus.textContent = "Host returned to lobby. Enter a room code to join.";

    showScreen("joinScreen");
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

attackOnlyBtn.addEventListener("pointerdown", (event) => {
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
