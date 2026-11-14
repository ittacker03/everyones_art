const list = document.querySelector("#design-list");

function showError(message) {
  document.querySelector("#page-error").textContent = message;
}

function renderDesigns(designs) {
  list.replaceChildren();
  if (!designs.length) {
    list.innerHTML = "<p>아직 만든 블록 디자인이 없습니다.</p>";
    return;
  }
  designs.forEach((design) => {
    const item = document.createElement("article");
    item.className = "design-card";
    item.innerHTML = `
      <canvas class="design-preview-image" width="120" height="115"></canvas>
      <div class="design-card-content">
        <h2></h2>
        <p>앞면·옆면·윗면 32×32 도트 디자인</p>
        <a class="button" href="/design_edit?designId=${encodeURIComponent(design.id)}">수정</a>
        <button type="button" class="danger-button">삭제</button>
      </div>`;
    item.querySelector("h2").textContent = design.name;
    renderThumbnail(design, item.querySelector("canvas")).catch(() => {
      showError("디자인 썸네일을 불러오지 못했습니다.");
    });
    item.querySelector(".danger-button").addEventListener("click", async () => {
      if (!window.confirm("이 디자인을 삭제할까요? 사용 중인 블록은 기본 회색으로 바뀝니다.")) {
        return;
      }
      const response = await fetch(`/api/me/designs/${design.id}`, { method: "DELETE" });
      if (!response.ok) {
        showError("디자인을 삭제하지 못했습니다.");
        return;
      }
      await loadDesigns();
    });
    list.appendChild(item);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", reject);
    image.src = url;
  });
}

function drawFace(context, image, points, flipX = false) {
  const base = flipX ? points[1] : points[0];
  const horizontalEnd = flipX ? points[0] : points[1];
  const verticalEnd = flipX ? points[2] : points[3];
  const scale = 32;
  const u = {
    x: (horizontalEnd.x - base.x) / scale,
    y: (horizontalEnd.y - base.y) / scale,
  };
  const v = {
    x: (verticalEnd.x - base.x) / scale,
    y: (verticalEnd.y - base.y) / scale,
  };
  context.save();
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath();
  context.clip();
  context.setTransform(u.x, u.y, v.x, v.y, base.x, base.y);
  context.drawImage(image, 0, 0, scale, scale);
  context.restore();
}

async function renderThumbnail(design, canvas) {
  const context = canvas.getContext("2d");
  const images = await Promise.all(
    ["front", "side", "top"].map((face) => loadImage(design.imageUrls[face])),
  );
  const [front, side, topImage] = images;
  const center = { x: 60, y: 12 };
  const top = [
    { x: center.x, y: center.y },
    { x: center.x + 42, y: center.y + 21 },
    { x: center.x, y: center.y + 42 },
    { x: center.x - 42, y: center.y + 21 },
  ];
  const bottom = top.map((point) => ({ x: point.x, y: point.y + 65 }));
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#aaa5ae";
  context.beginPath();
  context.moveTo(top[0].x, top[0].y);
  top.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath();
  context.fill();
  context.fillStyle = "#8d8992";
  context.beginPath();
  [top[3], top[2], bottom[2], bottom[3]].forEach((point, index) =>
    index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y),
  );
  context.closePath();
  context.fill();
  context.fillStyle = "#77737c";
  context.beginPath();
  [top[1], top[2], bottom[2], bottom[1]].forEach((point, index) =>
    index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y),
  );
  context.closePath();
  context.fill();
  drawFace(context, topImage, top);
  drawFace(context, front, [top[3], top[2], bottom[2], bottom[3]]);
  drawFace(context, side, [top[1], top[2], bottom[2], bottom[1]], true);
  context.strokeStyle = "#77737c";
  context.lineWidth = 1.5;
  [top, [top[3], top[2], bottom[2], bottom[3]], [top[1], top[2], bottom[2], bottom[1]]]
    .forEach((face) => {
      context.beginPath();
      context.moveTo(face[0].x, face[0].y);
      face.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.closePath();
      context.stroke();
    });
}

async function loadDesigns() {
  const response = await fetch("/api/me/designs");
  if (!response.ok) {
    if (response.status === 401) window.location.href = "/sign-in";
    throw new Error("designs request failed");
  }
  const result = await response.json();
  renderDesigns(result.designs);
}

loadDesigns().catch(() => showError("디자인 목록을 불러오지 못했습니다."));
