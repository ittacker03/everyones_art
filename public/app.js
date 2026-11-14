const form = document.querySelector("#auth-form");
const authCard = document.querySelector("#auth-card");
const welcomeCard = document.querySelector("#welcome-card");
const confirmLabel = document.querySelector("#confirm-label");
const confirmError = document.querySelector("#confirm-error");
const submitButton = form.querySelector('button[type="submit"]');
const canvas = document.querySelector("#artwork-canvas");
const context = canvas.getContext("2d", { willReadFrequently: true });
let mode = "login";
let drawing = false;
let tool = "pen";
let editingArtworkId = null;

function setMessage(message = "") {
  document.querySelector("#form-message").textContent = message;
}

function clearErrors() {
  document.querySelectorAll(".error").forEach((element) => {
    element.textContent = "";
  });
  setMessage();
}

function setLoggedIn(user) {
  authCard.hidden = true;
  welcomeCard.hidden = false;
  document.querySelector("#welcome-name").textContent = user.username;
  document.querySelector("#signin-link").hidden = true;
  document.querySelector("#mypage-link").hidden = false;
  document.querySelector("#logout-button").hidden = false;
  loadArtworks().catch(() => showArtworkError("작품 목록을 불러오지 못했습니다."));
}

function setLoggedOut() {
  authCard.hidden = false;
  welcomeCard.hidden = true;
  document.querySelector("#signin-link").hidden = false;
  document.querySelector("#mypage-link").hidden = true;
  document.querySelector("#logout-button").hidden = true;
}

async function loadSession() {
  const response = await fetch("/api/auth/me");
  const result = await response.json();
  if (result.user) setLoggedIn(result.user);
}

document.querySelectorAll("[data-tab]").forEach((tab) =>
  tab.addEventListener("click", () => {
    mode = tab.dataset.tab;
    document
      .querySelectorAll("[data-tab]")
      .forEach((item) => item.classList.toggle("active", item === tab));
    confirmLabel.hidden = mode !== "signup";
    confirmError.hidden = mode !== "signup";
    form.querySelector('input[name="passwordConfirm"]').required =
      mode === "signup";
    submitButton.textContent = mode === "signup" ? "회원가입" : "로그인";
    clearErrors();
  }),
);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearErrors();
  const response = await fetch(`/api/auth/${mode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(new FormData(form))),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = result.error;
    if (error.field) {
      document.querySelector(
        `#${error.field === "passwordConfirm" ? "confirm" : error.field}-error`,
      ).textContent = error.message;
    } else {
      setMessage(error.message);
    }
    return;
  }
  if (mode === "signup") {
    setMessage("가입이 완료되었습니다. 로그인해 주세요.");
    document.querySelector('[data-tab="login"]').click();
    form.reset();
  } else {
    setLoggedIn(result.user);
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  setLoggedOut();
});

function resetCanvas() {
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((event.clientX - bounds.left) / bounds.width) * canvas.width),
    y: Math.floor(((event.clientY - bounds.top) / bounds.height) * canvas.height),
  };
}

function draw(event) {
  const point = canvasPoint(event);
  context.lineWidth = Number(document.querySelector("#pen-size").value);
  context.lineCap = "round";
  context.strokeStyle =
    tool === "eraser" ? "rgba(0,0,0,1)" : document.querySelector("#pen-color").value;
  if (tool === "eraser") context.globalCompositeOperation = "destination-out";
  else context.globalCompositeOperation = "source-over";
  context.lineTo(point.x, point.y);
  context.stroke();
  context.beginPath();
  context.moveTo(point.x, point.y);
}

canvas.addEventListener("pointerdown", (event) => {
  const point = canvasPoint(event);
  if (tool === "eyedropper") {
    pickColor(point.x, point.y);
    setTool("pen");
    return;
  }
  if (tool === "fill") {
    floodFill(point.x, point.y);
    return;
  }
  drawing = true;
  canvas.setPointerCapture(event.pointerId);
  context.beginPath();
  context.moveTo(point.x, point.y);
  draw(event);
});
canvas.addEventListener("pointermove", (event) => {
  if (drawing) draw(event);
});
canvas.addEventListener("pointerup", () => {
  drawing = false;
  context.beginPath();
});
canvas.addEventListener("pointercancel", () => {
  drawing = false;
  context.beginPath();
});

function floodFill(startX, startY) {
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const targetIndex = (startY * canvas.width + startX) * 4;
  const target = image.data.slice(targetIndex, targetIndex + 4);
  const color = hexToRgba(document.querySelector("#pen-color").value);
  if (target.every((value, index) => value === color[index])) return;
  const stack = [[startX, startY]];
  const matches = (x, y) => {
    const index = (y * canvas.width + x) * 4;
    return target.every((value, offset) => image.data[index + offset] === value);
  };
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height || !matches(x, y)) continue;
    const index = (y * canvas.width + x) * 4;
    image.data.set(color, index);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  context.putImageData(image, 0, 0);
}

function hexToRgba(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

function pickColor(x, y) {
  const [red, green, blue, alpha] = context.getImageData(x, y, 1, 1).data;
  const color = alpha === 0
    ? "#ffffff"
    : `#${[red, green, blue]
        .map((channel) => channel.toString(16).padStart(2, "0"))
        .join("")}`;
  document.querySelector("#pen-color").value = color;
}

function setTool(nextTool) {
  tool = nextTool;
  document
    .querySelectorAll("[data-tool]")
    .forEach((item) => item.classList.toggle("active", item.dataset.tool === nextTool));
}

document.querySelectorAll("[data-tool]").forEach((button) =>
  button.addEventListener("click", () => {
    setTool(button.dataset.tool);
  }),
);
document.querySelector("#clear-canvas").addEventListener("click", resetCanvas);
document.querySelector("#artwork-description").addEventListener("input", (event) => {
  document.querySelector("#artwork-description-count").textContent =
    `${event.target.value.length} / 100자`;
});

function showArtworkError(message) {
  document.querySelector("#artwork-image-error").textContent = message;
}

function openArtworkEditor(artwork = null) {
  editingArtworkId = artwork?.id || null;
  document.querySelector("#editor-title").textContent = artwork
    ? "작품 수정"
    : "새 작품 만들기";
  document.querySelector("#artwork-title").value = artwork?.title || "";
  document.querySelector("#artwork-description").value = artwork?.description || "";
  document.querySelector("#artwork-description-count").textContent =
    `${(artwork?.description || "").length} / 100자`;
  resetCanvas();
  if (artwork) {
    const image = new Image();
    image.onload = () => {
      context.globalCompositeOperation = "source-over";
      context.drawImage(image, 0, 0);
    };
    image.src = artwork.imageUrl;
  }
  document.querySelector("#artwork-editor").hidden = false;
  showArtworkError("");
}

document.querySelector("#new-artwork-button").addEventListener("click", () => {
  openArtworkEditor();
});
document.querySelector("#cancel-artwork-button").addEventListener("click", () => {
  document.querySelector("#artwork-editor").hidden = true;
  editingArtworkId = null;
});

async function saveArtwork() {
  const title = document.querySelector("#artwork-title").value;
  const description = document.querySelector("#artwork-description").value;
  const imageData = canvas.toDataURL("image/png");
  const endpoint = editingArtworkId
    ? `/api/me/artworks/${editingArtworkId}`
    : "/api/me/artworks";
  const response = await fetch(endpoint, {
    method: editingArtworkId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description, imageData }),
  });
  const result = await response.json();
  if (!response.ok) {
    if (result.error.field === "title" || result.error.field === "description") {
      document.querySelector(`#artwork-${result.error.field}-error`).textContent =
        result.error.message;
    } else {
      showArtworkError(result.error.message);
    }
    return;
  }
  document.querySelector("#artwork-editor").hidden = true;
  editingArtworkId = null;
  await loadArtworks();
}

document.querySelector("#save-artwork-button").addEventListener("click", () => {
  saveArtwork().catch(() => showArtworkError("작품을 저장하지 못했습니다."));
});

async function loadArtworks() {
  const response = await fetch("/api/me/artworks");
  if (!response.ok) throw new Error("artworks request failed");
  const { artworks } = await response.json();
  const list = document.querySelector("#artwork-list");
  list.replaceChildren();
  artworks.forEach((artwork) => {
    const item = document.createElement("article");
    item.className = "artwork-item";
    item.innerHTML = `<img src="${artwork.imageUrl}" alt=""><div><strong></strong><p></p><button type="button">수정</button><button type="button">삭제</button></div>`;
    item.querySelector("strong").textContent = artwork.title;
    item.querySelector("p").textContent = artwork.description;
    item.querySelector("img").alt = artwork.title;
    item.querySelector("button").addEventListener("click", () => openArtworkEditor(artwork));
    item.querySelectorAll("button")[1].addEventListener("click", async () => {
      if (!window.confirm("이 작품을 삭제할까요?")) return;
      const deleteResponse = await fetch(`/api/me/artworks/${artwork.id}`, {
        method: "DELETE",
      });
      if (deleteResponse.ok) await loadArtworks();
    });
    list.appendChild(item);
  });
}

loadSession().catch(() => setMessage("서버에 연결할 수 없습니다."));
