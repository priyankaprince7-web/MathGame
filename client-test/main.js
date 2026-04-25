const client = new Colyseus.Client("ws://localhost:2567");

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
const statusText = document.getElementById("statusText");

function showScreen(screenId) {
  joinScreen.hidden = true;
  lobbyScreen.hidden = true;
  gameScreen.hidden = true;

  document.getElementById(screenId).hidden = false;
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

    room.send("joinLobby", { name });

    setupRoomListeners();

    showScreen("lobbyScreen");
    lobbyStatus.textContent = "Connected. Waiting for the host to start.";
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
  });

  room.onMessage("question", (data) => {
    showScreen("gameScreen");

    questionNumberText.textContent = "Question " + data.questionNumber;
    questionText.textContent = data.prompt;

    answerInput.value = "";
    answerInput.focus();

    statusText.textContent = "Solve it!";
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
      damageBox.textContent = "Stored Damage: " + me.storedDamage;
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

    questionNumberText.textContent = "Match Over";
    questionText.textContent = data.winnerName ? `${data.winnerName} wins!` : "Match Over";
    statusText.textContent = data.reason || "The match has ended.";

    submitAnswerBtn.disabled = true;
    attackBtn.disabled = true;
    answerInput.disabled = true;
  });

  room.onLeave(() => {
    setStatus("Disconnected from room.");
  });
}

submitAnswerBtn.onclick = () => {
  if (!room) return;

  const answer = answerInput.value.trim();

  if (!answer) {
    statusText.textContent = "Enter an answer first.";
    return;
  }

  room.send("submitAnswer", { answer });
};

answerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    submitAnswerBtn.click();
  }
});

attackBtn.onclick = () => {
  if (!room) return;

  room.send("attack");
  statusText.textContent = "Attack sent!";
};