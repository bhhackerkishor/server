<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>TalkPair</title>
  <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Poppins', sans-serif;
      background: radial-gradient(circle at top, #14171a, #0f1113);
      color: #fff;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
    }

    .card {
      background: #1e2227;
      border-radius: 20px;
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
      padding: 30px;
      width: 400px;
      max-width: 95%;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 15px;
    }

    input {
      padding: 10px 15px;
      border-radius: 8px;
      border: none;
      width: 80%;
      text-align: center;
      outline: none;
    }

    button {
      background: #4CAF50;
      border: none;
      color: white;
      padding: 10px 20px;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.2s;
    }

    button:hover {
      background: #43a047;
    }

    button:disabled {
      background: #555;
      cursor: not-allowed;
    }

    .controls {
      display: flex;
      gap: 15px;
      justify-content: center;
    }

    .icon-btn {
      width: 50px;
      height: 50px;
      border-radius: 50%;
      border: none;
      font-size: 22px;
      background: #333;
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.3s;
    }

    .icon-btn.active {
      background: #e53935;
    }

    #videos {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      width: 100%;
      margin-top: 15px;
    }

    video {
      width: 48%;
      border-radius: 10px;
      background: black;
    }

    #log {
      font-size: 14px;
      background: #121417;
      padding: 10px;
      border-radius: 10px;
      height: 100px;
      overflow-y: auto;
      width: 100%;
    }

  </style>
</head>
<body>
  <div class="card">
    <h2>🎙️ TalkPair</h2>
    <input id="name" placeholder="Enter your name..." />
    <div class="controls">
      <button id="registerBtn">Register</button>
      <button id="findBtn" disabled>Find Partner</button>
      <button id="endBtn" disabled>End</button>
    </div>
    <div class="controls">
      <button id="micBtn" class="icon-btn">🎤</button>
      <button id="speakerBtn" class="icon-btn">🔈</button>
    </div>
    <div id="videos">
      <video id="localVideo" autoplay muted playsinline></video>
      <video id="remoteVideo" autoplay playsinline></video>
    </div>
    <div id="log"></div>
  </div>

  <script>
    const socket = io("https://server-09p9.onrender.com");
    const nameInput = document.getElementById("name");
    const registerBtn = document.getElementById("registerBtn");
    const findBtn = document.getElementById("findBtn");
    const endBtn = document.getElementById("endBtn");
    const micBtn = document.getElementById("micBtn");
    const speakerBtn = document.getElementById("speakerBtn");
    const logDiv = document.getElementById("log");

    let peerConnection;
    let localStream;
    let partnerId;
    let micOn = true;
    let speakerOn = true;

    const log = (msg) => {
      const el = document.createElement("div");
      el.textContent = msg;
      logDiv.appendChild(el);
      logDiv.scrollTop = logDiv.scrollHeight;
    };

    registerBtn.onclick = () => {
      const name = nameInput.value.trim();
      if (name) {
        socket.emit("register", name);
        findBtn.disabled = false;
      }
    };

    findBtn.onclick = () => {
      socket.emit("find-partner");
      findBtn.disabled = true;
    };

    endBtn.onclick = () => {
      socket.emit("end-call");
      endBtn.disabled = true;
      findBtn.disabled = false;
    };

    micBtn.onclick = () => {
      micOn = !micOn;
      localStream.getAudioTracks().forEach(track => track.enabled = micOn);
      micBtn.classList.toggle("active", !micOn);
      micBtn.textContent = micOn ? "🎤" : "🔇";
    };

    speakerBtn.onclick = () => {
      speakerOn = !speakerOn;
      document.getElementById("remoteVideo").muted = !speakerOn;
      speakerBtn.classList.toggle("active", !speakerOn);
      speakerBtn.textContent = speakerOn ? "🔈" : "🔇";
    };

    async function createPeerConnection() {
      peerConnection = new RTCPeerConnection();
      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

      peerConnection.ontrack = (event) => {
        document.getElementById("remoteVideo").srcObject = event.streams[0];
      };

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("signal", { candidate: event.candidate });
        }
      };
    }

    socket.on("status", log);
    socket.on("waiting", log);
    socket.on("partner-left", () => log("⚠️ Partner left"));
    socket.on("call-ended", () => log("📞 Call ended"));

    socket.on("partner-found", async ({ partnerId: pId, partnerName }) => {
      log("🎉 Partner found: " + partnerName);
      endBtn.disabled = false;
      partnerId = pId;

      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      document.getElementById("localVideo").srcObject = localStream;
      await createPeerConnection();

      // Only one user creates the offer
      if (socket.id < partnerId) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit("signal", { offer });
      }
    });

    let pendingCandidates = [];

    socket.on("signal", async (data) => {
      if (data.offer) {
        if (!peerConnection) {
          await createPeerConnection();
        }
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit("signal", { answer });

        pendingCandidates.forEach(c => peerConnection.addIceCandidate(c));
        pendingCandidates = [];

      } else if (data.answer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      } else if (data.candidate) {
        const candidate = new RTCIceCandidate(data.candidate);
        if (peerConnection) {
          await peerConnection.addIceCandidate(candidate);
        } else {
          pendingCandidates.push(candidate);
        }
      }
    });
  </script>
</body>
</html>
