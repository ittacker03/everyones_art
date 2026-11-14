const designId = new URLSearchParams(window.location.search).get("designId");
const faceNames = ["front", "side", "top"];
const canvases = {};
const contexts = {};
let activeFace = "front";
let tool = "pen";
let drawing = false;
let dirty = false;
let savedDesign = null;
const preview = document.querySelector("#design-preview");
const previewContext = preview.getContext("2d");

function canvasPoint(canvas, event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(31, Math.floor(((event.clientX - bounds.left) / bounds.width) * 32))),
    y: Math.max(0, Math.min(31, Math.floor(((event.clientY - bounds.top) / bounds.height) * 32))),
  };
}

function markDirty() {
  dirty = true;
  document.querySelector("#save-status").textContent = "";
  updatePreview();
}

function createCanvases() {
  const wrapper = document.querySelector("#face-canvases");
  faceNames.forEach((face) => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    canvas.className = "face-canvas";
    canvas.dataset.face = face;
    canvas.hidden = face !== activeFace;
    canvas.addEventListener("pointerdown", (event) => {
      if (tool === "fill") {
        paint(canvas, event);
        return;
      }
      drawing = true;
      canvas.setPointerCapture(event.pointerId);
      const point = canvasPoint(canvas, event);
      contexts[face].beginPath();
      contexts[face].moveTo(point.x + 0.5, point.y + 0.5);
      paint(canvas, event);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (drawing) paint(canvas, event);
    });
    canvas.addEventListener("pointerup", () => {
      drawing = false;
      contexts[face].beginPath();
    });
    canvas.addEventListener("pointercancel", () => {
      drawing = false;
      contexts[face].beginPath();
    });
    wrapper.appendChild(canvas);
    canvases[face] = canvas;
    contexts[face] = canvas.getContext("2d", { willReadFrequently: true });
    contexts[face].imageSmoothingEnabled = false;
  });
}

function paint(canvas, event) {
  const context = contexts[canvas.dataset.face];
  const point = canvasPoint(canvas, event);
  if (tool === "fill") {
    floodFill(context, point.x, point.y);
    markDirty();
    return;
  }
  context.lineWidth = Number(document.querySelector("#design-size").value);
  context.lineCap = "square";
  context.strokeStyle = document.querySelector("#design-color").value;
  context.globalCompositeOperation =
    tool === "eraser" ? "destination-out" : "source-over";
  context.lineTo(point.x + 0.5, point.y + 0.5);
  context.stroke();
  context.beginPath();
  context.moveTo(point.x + 0.5, point.y + 0.5);
  markDirty();
}

function floodFill(context, startX, startY) {
  const image = context.getImageData(0, 0, 32, 32);
  const targetIndex = (startY * 32 + startX) * 4;
  const target = Array.from(image.data.slice(targetIndex, targetIndex + 4));
  const colorHex = document.querySelector("#design-color").value;
  const color = [
    parseInt(colorHex.slice(1, 3), 16),
    parseInt(colorHex.slice(3, 5), 16),
    parseInt(colorHex.slice(5, 7), 16),
    255,
  ];
  if (target.every((value, index) => value === color[index])) return;
  const stack = [[startX, startY]];
  const matches = (x, y) => {
    const index = (y * 32 + x) * 4;
    return target.every((value, offset) => image.data[index + offset] === value);
  };
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= 32 || y >= 32 || !matches(x, y)) continue;
    image.data.set(color, (y * 32 + x) * 4);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  context.putImageData(image, 0, 0);
}

function dataUrl(canvas) {
  return canvas.toDataURL("image/png");
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", reject);
    image.src = url;
  });
}

function drawPreview(images = {}) {
  previewContext.clearRect(0, 0, preview.width, preview.height);
  previewContext.fillStyle = "#fff";
  previewContext.fillRect(0, 0, preview.width, preview.height);
  const center = { x: 150, y: 42 };
  const top = [
    { x: center.x, y: center.y },
    { x: center.x + 70, y: center.y + 35 },
    { x: center.x, y: center.y + 70 },
    { x: center.x - 70, y: center.y + 35 },
  ];
  const bottom = top.map((point) => ({ x: point.x, y: point.y + 108 }));
  fillPreviewFace(top, "#aaa5ae");
  fillPreviewFace([top[3], top[2], bottom[2], bottom[3]], "#8d8992");
  fillPreviewFace([top[1], top[2], bottom[2], bottom[1]], "#77737c");
  drawFaceImage(images.top, top);
  drawFaceImage(images.front, [top[3], top[2], bottom[2], bottom[3]]);
  drawFaceImage(images.side, [top[1], top[2], bottom[2], bottom[1]], true);
  previewContext.strokeStyle = "#77737c";
  previewContext.lineWidth = 2;
  [top, [top[3], top[2], bottom[2], bottom[3]], [top[1], top[2], bottom[2], bottom[1]]]
    .forEach((face) => {
      previewContext.beginPath();
      previewContext.moveTo(face[0].x, face[0].y);
      face.slice(1).forEach((point) => previewContext.lineTo(point.x, point.y));
      previewContext.closePath();
      previewContext.stroke();
    });
}

function fillPreviewFace(points, color) {
  previewContext.fillStyle = color;
  previewContext.beginPath();
  previewContext.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => previewContext.lineTo(point.x, point.y));
  previewContext.closePath();
  previewContext.fill();
}

function updatePreview() {
  drawPreview(Object.fromEntries(faceNames.map((face) => [face, canvases[face]])));
}

function drawFaceImage(image, points, flipX = false) {
  if (!image) return;
  const sourceSize = 32;
  const base = flipX ? points[1] : points[0];
  const horizontalEnd = flipX ? points[0] : points[1];
  const verticalEnd = flipX ? points[2] : points[3];
  const u = {
    x: (horizontalEnd.x - base.x) / sourceSize,
    y: (horizontalEnd.y - base.y) / sourceSize,
  };
  const v = {
    x: (verticalEnd.x - base.x) / sourceSize,
    y: (verticalEnd.y - base.y) / sourceSize,
  };
  previewContext.save();
  previewContext.beginPath();
  previewContext.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => previewContext.lineTo(point.x, point.y));
  previewContext.closePath();
  previewContext.clip();
  previewContext.setTransform(u.x, u.y, v.x, v.y, base.x, base.y);
  previewContext.drawImage(image, 0, 0, sourceSize, sourceSize);
  previewContext.restore();
}

async function loadSavedDesign() {
  if (!designId) {
    updatePreview();
    return;
  }
  const response = await fetch("/api/me/designs");
  if (!response.ok) throw new Error("디자인을 불러오지 못했습니다.");
  const result = await response.json();
  savedDesign = result.designs.find((design) => design.id === designId);
  if (!savedDesign) throw new Error("디자인을 찾을 수 없습니다.");
  document.querySelector("#page-title").textContent = "블록 디자인 수정";
  document.querySelector("#design-name").value = savedDesign.name;
  await Promise.all(faceNames.map(async (face) => {
    const image = await loadImage(savedDesign.imageUrls[face]);
    contexts[face].clearRect(0, 0, 32, 32);
    contexts[face].drawImage(image, 0, 0);
  }));
  updatePreview();
}

async function save() {
  const name = document.querySelector("#design-name").value.trim();
  document.querySelector("#name-error").textContent = "";
  if (!name) {
    document.querySelector("#name-error").textContent = "디자인 이름을 입력해 주세요.";
    return;
  }
  const body = {
    name,
    faces: Object.fromEntries(faceNames.map((face) => [face, dataUrl(canvases[face])])),
  };
  const response = await fetch(
    designId ? `/api/me/designs/${designId}` : "/api/me/designs",
    {
      method: designId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const result = await response.json();
  if (!response.ok) {
    if (result.error?.field === "name") {
      document.querySelector("#name-error").textContent = result.error.message;
    } else {
      document.querySelector("#page-error").textContent =
        result.error?.message || "디자인을 저장하지 못했습니다.";
    }
    return;
  }
  dirty = false;
  document.querySelector("#save-status").textContent = "저장 완료";
  window.location.href = "/design-manage";
}

document.querySelectorAll(".face-tabs [data-face]").forEach((button) => {
  button.addEventListener("click", () => {
    activeFace = button.dataset.face;
    document.querySelectorAll("[data-face]").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    Object.entries(canvases).forEach(([face, canvas]) => {
      canvas.hidden = face !== activeFace;
    });
  });
});
document.querySelectorAll("[data-tool]").forEach((button) => {
  button.addEventListener("click", () => {
    tool = button.dataset.tool;
    document.querySelectorAll("[data-tool]").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
  });
});
document.querySelector("#clear-face").addEventListener("click", () => {
  contexts[activeFace].clearRect(0, 0, 32, 32);
  markDirty();
});
document.querySelector("#save-design").addEventListener("click", () => {
  save().catch(() => {
    document.querySelector("#page-error").textContent = "디자인을 저장하지 못했습니다.";
  });
});
document.querySelectorAll('a[href="/design-manage"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    if (!dirty) return;
    event.preventDefault();
    document.querySelector("#leave-dialog").showModal();
  });
});
document.querySelector("#leave-dialog").addEventListener("close", (event) => {
  if (event.target.returnValue === "discard") window.location.href = "/design-manage";
});
window.addEventListener("beforeunload", (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

createCanvases();
loadSavedDesign().catch((error) => {
  document.querySelector("#page-error").textContent = error.message;
});
