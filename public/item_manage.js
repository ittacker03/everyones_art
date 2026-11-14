const canvas = document.querySelector("#artwork-canvas");
const context = canvas.getContext("2d", { willReadFrequently: true });
let tool = "pen";
let drawing = false;
let editingArtworkId = null;
let dirty = false;

function showError(message) {
  document.querySelector("#page-error").textContent = message;
}

function clearErrors() {
  document.querySelectorAll(".artwork-editor .error").forEach((item) => {
    item.textContent = "";
  });
  showError("");
}

function resetCanvas() {
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function markDirty() {
  dirty = true;
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((event.clientX - bounds.left) / bounds.width) * canvas.width),
    y: Math.floor(((event.clientY - bounds.top) / bounds.height) * canvas.height),
  };
}

function hexToRgba(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

function floodFill(startX, startY) {
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const targetIndex = (startY * canvas.width + startX) * 4;
  const target = Array.from(image.data.slice(targetIndex, targetIndex + 4));
  const color = hexToRgba(document.querySelector("#pen-color").value);
  if (target.every((value, index) => value === color[index])) return;
  const stack = [[startX, startY]];
  const matches = (x, y) => {
    const index = (y * canvas.width + x) * 4;
    return target.every((value, offset) => image.data[index + offset] === value);
  };
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height || !matches(x, y)) {
      continue;
    }
    image.data.set(color, (y * canvas.width + x) * 4);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  context.putImageData(image, 0, 0);
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

function draw(event) {
  const point = canvasPoint(event);
  if (tool === "eyedropper") {
    pickColor(point.x, point.y);
    setTool("pen");
    return;
  }
  if (tool === "fill") {
    floodFill(point.x, point.y);
    markDirty();
    return;
  }
  context.lineWidth = Number(document.querySelector("#pen-size").value);
  context.lineCap = "round";
  context.strokeStyle = tool === "eraser"
    ? "rgba(0,0,0,1)"
    : document.querySelector("#pen-color").value;
  context.globalCompositeOperation =
    tool === "eraser" ? "destination-out" : "source-over";
  context.lineTo(point.x, point.y);
  context.stroke();
  context.beginPath();
  context.moveTo(point.x, point.y);
  markDirty();
}

function setTool(nextTool) {
  tool = nextTool;
  document.querySelectorAll("[data-tool]").forEach((item) => {
    item.classList.toggle("active", item.dataset.tool === nextTool);
  });
}

function openArtworkEditor(artwork = null) {
  editingArtworkId = artwork?.id || null;
  dirty = false;
  clearErrors();
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
    image.addEventListener("load", () => {
      context.globalCompositeOperation = "source-over";
      context.drawImage(image, 0, 0);
    });
    image.src = artwork.imageUrl;
  }
  document.querySelector("#artwork-editor").hidden = false;
  document.querySelector("#artwork-title").focus();
}

async function saveArtwork() {
  clearErrors();
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
    if (result.error?.field === "title" || result.error?.field === "description") {
      document.querySelector(`#artwork-${result.error.field}-error`).textContent =
        result.error.message;
    } else {
      document.querySelector("#artwork-image-error").textContent =
        result.error?.message || "작품을 저장하지 못했습니다.";
    }
    return;
  }
  dirty = false;
  document.querySelector("#artwork-editor").hidden = true;
  editingArtworkId = null;
  await loadArtworks();
}

async function loadArtworks() {
  const response = await fetch("/api/me/artworks");
  if (!response.ok) {
    if (response.status === 401) window.location.href = "/sign-in";
    throw new Error("artworks request failed");
  }
  const { artworks } = await response.json();
  const list = document.querySelector("#artwork-list");
  list.replaceChildren();
  if (!artworks.length) {
    list.innerHTML = "<p>아직 만든 작품이 없습니다.</p>";
    return;
  }
  artworks.forEach((artwork) => {
    const item = document.createElement("article");
    item.className = "artwork-item";
    item.innerHTML = `
      <img src="${artwork.imageUrl}" alt="">
      <div>
        <strong></strong><p></p>
        <button type="button">수정</button>
        <button type="button">삭제</button>
      </div>`;
    item.querySelector("strong").textContent = artwork.title;
    item.querySelector("p").textContent = artwork.description;
    item.querySelector("img").alt = artwork.title;
    item.querySelector("button").addEventListener("click", () => openArtworkEditor(artwork));
    item.querySelectorAll("button")[1].addEventListener("click", async () => {
      if (!window.confirm("이 작품을 삭제할까요?")) return;
      const response = await fetch(`/api/me/artworks/${artwork.id}`, { method: "DELETE" });
      if (!response.ok) {
        showError("작품을 삭제하지 못했습니다.");
        return;
      }
      await loadArtworks();
    });
    list.appendChild(item);
  });
}

document.querySelectorAll("[data-tool]").forEach((button) => {
  button.addEventListener("click", () => setTool(button.dataset.tool));
});
document.querySelector("#clear-canvas").addEventListener("click", () => {
  resetCanvas();
  markDirty();
});
document.querySelector("#artwork-description").addEventListener("input", (event) => {
  document.querySelector("#artwork-description-count").textContent =
    `${event.target.value.length} / 100자`;
  markDirty();
});
document.querySelector("#artwork-title").addEventListener("input", markDirty);
canvas.addEventListener("pointerdown", (event) => {
  if (tool === "fill" || tool === "eyedropper") {
    draw(event);
    return;
  }
  drawing = true;
  canvas.setPointerCapture(event.pointerId);
  const point = canvasPoint(event);
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
document.querySelector("#new-artwork-button").addEventListener("click", () => {
  openArtworkEditor();
});
document.querySelector("#cancel-artwork-button").addEventListener("click", () => {
  if (dirty && !window.confirm("저장하지 않은 변경 내용을 버리고 닫을까요?")) return;
  dirty = false;
  editingArtworkId = null;
  document.querySelector("#artwork-editor").hidden = true;
});
document.querySelector("#save-artwork-button").addEventListener("click", () => {
  saveArtwork().catch(() => {
    document.querySelector("#artwork-image-error").textContent =
      "작품을 저장하지 못했습니다.";
  });
});
window.addEventListener("beforeunload", (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

loadArtworks().catch(() => showError("작품 목록을 불러오지 못했습니다."));
