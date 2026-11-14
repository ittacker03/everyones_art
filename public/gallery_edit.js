const params = new URLSearchParams(window.location.search);
const galleryId = params.get("galleryId");
const canvas = document.querySelector("#isometric-canvas");
const context = canvas.getContext("2d");
const modeLabels = {
  "block-install": "블록 설치",
  "block-remove": "블록 제거",
  "frame-install": "액자 설치",
  "frame-remove": "액자 제거",
};
const center = { x: 480, y: 120 };
const tileWidth = 22;
const tileHeight = 11;
const blockHeight = 34;
let gallery;
let artworks = [];
let mode = "block-install";
let layer = 0;
let selected = { x: 9, y: 10 };
let selectedDesignId = null;
let selectedArtworkId = null;
let dirty = false;
let saving = false;
let overview = false;

function point(x, y, z = 0) {
  return {
    x: center.x + (x - y) * tileWidth,
    y: center.y + (x + y) * tileHeight - z * blockHeight,
  };
}

function blockAt(x, y, z) {
  return gallery.blocks.find((block) => block.x === x && block.y === y && block.z === z);
}

function setStatus(message = "", isError = false) {
  const status = document.querySelector("#save-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function render() {
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!overview) drawGrid();
  [...gallery.blocks]
    .sort((left, right) => left.z - right.z || left.x + left.y - right.x - right.y)
    .forEach(drawBlock);
  if (!overview) drawSelection();
  document.querySelector("#mode-status").textContent = modeLabels[mode];
  document.querySelector("#position-status").textContent =
    `(${selected.x}, ${selected.y}, ${layer + 1}층)`;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  document.querySelectorAll("[data-layer]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.layer) === layer);
  });
  const overviewButton = document.querySelector("#overview-button");
  overviewButton.classList.toggle("active", overview);
  overviewButton.setAttribute("aria-pressed", String(overview));
  overviewButton.textContent = overview ? "편집 보기" : "전체 보기";
}

function diamond(x, y, z, fill, stroke = "#cfc8d6") {
  const top = [
    point(x, y, z + 1),
    point(x + 1, y, z + 1),
    point(x + 1, y + 1, z + 1),
    point(x, y + 1, z + 1),
  ];
  context.beginPath();
  context.moveTo(top[0].x, top[0].y);
  top.slice(1).forEach((item) => context.lineTo(item.x, item.y));
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.stroke();
  return top;
}

function drawGrid() {
  context.lineWidth = 1;
  for (let x = 0; x <= 20; x += 1) {
    const from = point(x, 0, layer);
    const to = point(x, 20, layer);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.strokeStyle = "#ddd6df";
    context.stroke();
  }
  for (let y = 0; y <= 20; y += 1) {
    const from = point(0, y, layer);
    const to = point(20, y, layer);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.strokeStyle = "#ddd6df";
    context.stroke();
  }
}

function drawBlock(block) {
  context.globalAlpha = overview || block.z === layer ? 1 : 0.35;
  const top = diamond(block.x, block.y, block.z + 0.01, "#aaa5ae");
  const bottom = top.map((item) => ({ x: item.x, y: item.y + blockHeight }));
  context.beginPath();
  context.moveTo(top[3].x, top[3].y);
  context.lineTo(top[2].x, top[2].y);
  context.lineTo(bottom[2].x, bottom[2].y);
  context.lineTo(bottom[3].x, bottom[3].y);
  context.closePath();
  context.fillStyle = "#8d8992";
  context.fill();
  context.stroke();

  context.beginPath();
  context.moveTo(top[1].x, top[1].y);
  context.lineTo(top[2].x, top[2].y);
  context.lineTo(bottom[2].x, bottom[2].y);
  context.lineTo(bottom[1].x, bottom[1].y);
  context.closePath();
  context.fillStyle = "#77737c";
  context.fill();
  context.stroke();
  if (block.frame) drawFrame(block);
  context.globalAlpha = 1;
}

function drawFrame(block) {
  const top = point(block.x, block.y, block.z + 1);
  const bottom = point(block.x, block.y + 0.8, block.z + 0.8);
  context.strokeStyle = "#f2c14e";
  context.lineWidth = 3;
  context.strokeRect(
    Math.min(top.x, bottom.x),
    Math.min(top.y, bottom.y),
    Math.abs(bottom.x - top.x),
    Math.abs(bottom.y - top.y),
  );
  context.lineWidth = 1;
}

function drawSelection() {
  const selectedTop = [
    point(selected.x, selected.y, layer + 1.03),
    point(selected.x + 1, selected.y, layer + 1.03),
    point(selected.x + 1, selected.y + 1, layer + 1.03),
    point(selected.x, selected.y + 1, layer + 1.03),
  ];
  const selectedBottom = selectedTop.map((item) => ({
    x: item.x,
    y: item.y + blockHeight,
  }));
  const selectionColor =
    mode === "block-install"
      ? "#2e9d55"
      : mode === "block-remove" || mode === "frame-remove"
        ? "#c33b4b"
        : "#8d5cf6";

  context.globalAlpha = 1;
  context.strokeStyle = selectionColor;
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";

  context.beginPath();
  context.moveTo(selectedTop[0].x, selectedTop[0].y);
  selectedTop.slice(1).forEach((item) => context.lineTo(item.x, item.y));
  context.closePath();
  context.stroke();

  [
    [3, 2],
    [1, 2],
  ].forEach(([topStart, topEnd]) => {
    context.beginPath();
    context.moveTo(selectedTop[topStart].x, selectedTop[topStart].y);
    context.lineTo(selectedTop[topEnd].x, selectedTop[topEnd].y);
    context.lineTo(selectedBottom[topEnd].x, selectedBottom[topEnd].y);
    context.lineTo(selectedBottom[topStart].x, selectedBottom[topStart].y);
    context.closePath();
    context.stroke();
  });

  context.lineWidth = 1;
  context.lineJoin = "miter";
  context.lineCap = "butt";
}

function setDirty() {
  dirty = true;
  setStatus("");
}

function moveSelection(direction) {
  const next = { ...selected };
  if (direction === "up") next.x -= 1;
  if (direction === "right") next.y -= 1;
  if (direction === "down") next.x += 1;
  if (direction === "left") next.y += 1;
  if (next.x < 0 || next.x >= 20 || next.y < 0 || next.y >= 20) return;
  selected = next;
  setStatus("");
  render();
}

function selectMode(nextMode) {
  mode = nextMode;
  render();
  canvas.focus();
}

function applyAction() {
  const block = blockAt(selected.x, selected.y, layer);
  if (mode === "block-install") {
    if (block) return;
    gallery.blocks.push({
      id: `b_local_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      x: selected.x,
      y: selected.y,
      z: layer,
      designId: selectedDesignId,
      frame: null,
    });
    setDirty();
  } else if (mode === "block-remove") {
    if (!block) return;
    gallery.blocks = gallery.blocks.filter((item) => item !== block);
    setDirty();
  } else if (mode === "frame-install") {
    if (!block || block.frame || !selectedArtworkId) return;
    block.frame = { artworkId: selectedArtworkId };
    selectedArtworkId = null;
    document.querySelectorAll("[data-artwork-id]").forEach((item) => {
      item.classList.remove("active");
    });
    mode = "block-install";
    setDirty();
  } else if (mode === "frame-remove") {
    if (!block?.frame) {
      setStatus("제거할 액자가 없습니다.", true);
      return;
    }
    block.frame = null;
    setDirty();
  }
  render();
}

async function save() {
  if (saving || !dirty) return true;
  saving = true;
  const button = document.querySelector("#save-button");
  button.disabled = true;
  document.querySelector("#retry-button").hidden = true;
  setStatus("저장 중...");
  try {
    const response = await fetch(`/api/me/galleries/${galleryId}/editor`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: gallery.blocks }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "저장하지 못했습니다.");
    gallery = result.gallery;
    dirty = false;
    setStatus("저장 완료");
    window.setTimeout(() => {
      if (!dirty) setStatus("");
    }, 3000);
    return true;
  } catch (error) {
    setStatus(error.message, true);
    document.querySelector("#retry-button").hidden = false;
    return false;
  } finally {
    saving = false;
    button.disabled = false;
  }
}

function leave() {
  if (!dirty) {
    window.location.href = "/";
    return;
  }
  const dialog = document.querySelector("#leave-dialog");
  dialog.showModal();
}

async function handleLeaveChoice(event) {
  const choice = event.target.returnValue;
  if (choice === "save") {
    event.preventDefault();
    if (await save()) window.location.href = "/";
  } else if (choice === "discard") {
    window.location.href = "/";
  }
}

function renderArtworkList() {
  const list = document.querySelector("#editor-artwork-list");
  list.replaceChildren();
  artworks.forEach((artwork) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "artwork-selection";
    item.dataset.artworkId = artwork.id;
    item.innerHTML = `<img src="${artwork.imageUrl}" alt=""><span></span>`;
    item.querySelector("span").textContent = artwork.title;
    item.addEventListener("click", () => {
      selectedArtworkId = selectedArtworkId === artwork.id ? null : artwork.id;
      list.querySelectorAll("button").forEach((button) => button.classList.remove("active"));
      if (selectedArtworkId) item.classList.add("active");
      canvas.focus();
    });
    list.appendChild(item);
  });
}

function renderDesignList() {
  const list = document.querySelector("#design-list");
  list.replaceChildren();
  document.querySelector("[data-design-id]").addEventListener("click", () => {
    selectedDesignId = null;
    list.querySelectorAll("button").forEach((button) => button.classList.remove("active"));
    document.querySelector("[data-design-id]").classList.add("active");
    canvas.focus();
  });
}

async function initialize() {
  if (!galleryId) throw new Error("전시 공간을 찾을 수 없습니다.");
  const response = await fetch(`/api/me/galleries/${galleryId}/editor`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "편집기를 불러오지 못했습니다.");
  gallery = result.gallery;
  gallery.blocks = Array.isArray(gallery.blocks) ? gallery.blocks : [];
  artworks = result.artworks;
  document.querySelector("#gallery-title").textContent = `${gallery.name} 꾸미기`;
  renderArtworkList();
  renderDesignList();
  render();
  canvas.focus();
}

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => selectMode(button.dataset.mode));
});
document.querySelectorAll("[data-layer]").forEach((button) => {
  button.addEventListener("click", () => {
    layer = Number(button.dataset.layer);
    render();
    canvas.focus();
  });
});
document.querySelector("#overview-button").addEventListener("click", () => {
  overview = !overview;
  render();
});
document.querySelector("#isometric-canvas").addEventListener("keydown", (event) => {
  const directions = { ArrowUp: "up", ArrowRight: "right", ArrowDown: "down", ArrowLeft: "left" };
  if (directions[event.key]) {
    event.preventDefault();
    moveSelection(directions[event.key]);
  } else if (event.key === "Enter") {
    event.preventDefault();
    applyAction();
  }
});
document.querySelector("#save-button").addEventListener("click", save);
document.querySelector("#retry-button").addEventListener("click", save);
document.querySelector("#leave-button").addEventListener("click", leave);
document.querySelector("#back-link").addEventListener("click", (event) => {
  if (!dirty) return;
  event.preventDefault();
  leave();
});
document.querySelector("#leave-dialog").addEventListener("close", handleLeaveChoice);
window.addEventListener("beforeunload", (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

initialize().catch((error) => {
  document.querySelector("#page-error").textContent = error.message;
});
