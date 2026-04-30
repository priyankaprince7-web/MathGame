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
const shieldBtn = document.getElementById("shieldBtn");
const attackFill = document.getElementById("attackFill");
const shieldFill = document.getElementById("shieldFill");
const statusText = document.getElementById("statusText");
const customKeypad = document.getElementById("customKeypad");
const endButtons = document.getElementById("endButtons");
const playAgainBtn = document.getElementById("playAgainBtn");
const backToLobbyBtn = document.getElementById("backToLobbyBtn");

const keypadButtons = document.querySelectorAll(".keypadBtn");

shieldBtn.classList.add("notReady");

document.addEventListener("wheel", (e) => {
  e.preventDefault();
}, { passive: false });

document.querySelectorAll("button").forEach(btn => {
  btn.addEventListener("pointerdown", () => {
    btn.classList.add("pressed");
  });

  btn.addEventListener("pointerup", () => {
    btn.classList.remove("pressed");
  });

  btn.addEventListener("pointerleave", () => {
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

    customKeypad.hidden = false;
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

    customKeypad.hidden = false;
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

  if (me) {
    // ATTACK: 10-point bar
    const attackPercent = Math.min(me.storedDamage, 20) * 5;
    attackFill.style.clipPath = `inset(0 ${100 - attackPercent}% 0 0)`;

    // SHIELD:
    // inactive = charges in 5ths based on storedDamage
    // active = drains over 5 seconds
    let shieldPercent = 0;

    if (me.shieldActive) {
      shieldPercent = Math.max(0, Math.min(me.shieldTimeLeft / 5000, 1)) * 100;
    } else {
      shieldPercent = Math.min(me.shieldCharge, 5) * 20;
    }

    shieldFill.style.clipPath = `inset(0 ${100 - shieldPercent}% 0 0)`;

    if (!me.shieldActive && me.storedDamage >= 5) {
      shieldBtn.classList.add("ready");
    } else {
      shieldBtn.classList.remove("ready");
    }

    if (!me.shieldActive && me.shieldCharge >= 5) {
      shieldBtn.classList.remove("notReady");
    } else if (!me.shieldActive) {
      shieldBtn.classList.add("notReady");
    }
  }
  });

  room.onMessage("attackResult", (data) => {
    if (data.attackerId === room.sessionId) {
      statusText.textContent = data.blocked
        ? `You attacked for ${data.damage} damage, but shield reduced it!`
        : `You attacked for ${data.damage} damage!`;
    } else if (data.defenderId === room.sessionId) {
      statusText.textContent = data.blocked
        ? `${data.attackerName} attacked, but your shield reduced it to ${data.damage}!`
        : `${data.attackerName} attacked you for ${data.damage} damage!`;
    }
  });

  room.onMessage("matchEnded", (data) => {
    showScreen("gameScreen");

    gameScreen.classList.add("ended");

    questionNumberText.textContent = "Match Over";
    questionText.textContent = data.winnerName ? `${data.winnerName} wins!` : "Match Over";

    customKeypad.hidden = true;
    endButtons.hidden = false;
    answerInput.hidden = true;

    submitAnswerBtn.disabled = true;
    attackBtn.disabled = true;
    shieldBtn.disabled = true;
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

shieldBtn.addEventListener("pointerdown", (event) => {
  event.preventDefault();

  if (!room) return;

  if (shieldBtn.classList.contains("notReady")) {
    return;
  }

  room.send("shield");

  playAgainBtn.addEventListener("pointerdown", (event) => {
    event.preventDefault();

    if (!room) return;

    room.send("playAgain");
  });

  backToLobbyBtn.addEventListener("pointerdown", (event) => {
    event.preventDefault();

    showScreen("joinScreen");

    joinBtn.disabled = false;
    joinStatus.textContent = "";
    roomInput.value = "";
  });

});