const express = require("express");
const session = require("express-session");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { sessionSecret, uploadsDirectory } = require("./config");
const {
  readUsers,
  saveUsers,
  readArtworks,
  saveArtworks,
  readGalleries,
  saveGalleries,
  readDesigns,
  saveDesigns,
} = require("./storage");

const app = express();
const publicDirectory = path.join(__dirname, "..", "public");

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  }),
);
app.get(
  "/gallery_edit.html",
  requireLogin,
  (request, response) =>
    response.sendFile(path.join(publicDirectory, "gallery_edit.html")),
);
app.get("/design-manage", requireLogin, (request, response) =>
  response.sendFile(path.join(publicDirectory, "design_manage.html")),
);
app.get("/design_manage.html", requireLogin, (request, response) =>
  response.sendFile(path.join(publicDirectory, "design_manage.html")),
);
app.get("/design_edit", requireLogin, (request, response) =>
  response.sendFile(path.join(publicDirectory, "design_edit.html")),
);
app.get("/design-edit", requireLogin, (request, response) =>
  response.sendFile(path.join(publicDirectory, "design_edit.html")),
);
app.get("/design_edit.html", requireLogin, (request, response) =>
  response.sendFile(path.join(publicDirectory, "design_edit.html")),
);
app.get("/item_manage", requireLogin, (request, response) =>
  response.sendFile(path.join(publicDirectory, "item_manage.html")),
);
app.get("/item-manage", requireLogin, (request, response) =>
  response.sendFile(path.join(publicDirectory, "item_manage.html")),
);
app.get("/item_manage.html", requireLogin, (request, response) =>
  response.sendFile(path.join(publicDirectory, "item_manage.html")),
);
app.use(express.static(publicDirectory));
app.use("/uploads", express.static(uploadsDirectory));

function normalizeUsername(username) {
  return username.normalize("NFC").toLocaleLowerCase("ko-KR");
}

function fieldError(field, message) {
  return { error: { code: "INVALID_INPUT", field, message } };
}

function sendFieldError(response, field, message) {
  return response.status(400).json(fieldError(field, message));
}

function artworkResponse(artwork, userId) {
  return {
    ...artwork,
    imageUrl: `/uploads/artworks/${userId}/${artwork.id}.png?v=${artwork.rev}`,
  };
}

function designResponse(design, userId) {
  const faces = ["front", "side", "top"];
  return {
    ...design,
    imageUrls: Object.fromEntries(
      faces.map((face) => [
        face,
        `/uploads/designs/${userId}/${design.id}/${face}.png?v=${design.rev}`,
      ]),
    ),
  };
}

function galleryResponse(gallery, userId) {
  return {
    ...gallery,
    blocks: Array.isArray(gallery.blocks) ? gallery.blocks : [],
    coverUrl: gallery.coverExtension
      ? `/uploads/galleries/${userId}/${gallery.id}.${gallery.coverExtension}?v=${gallery.coverRev}`
      : null,
  };
}

function normalizeText(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function parseCover(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(
    dataUrl,
  );
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 5 * 1024 * 1024) return null;
  const isPng =
    match[1] === "png" &&
    buffer.length >= 8 &&
    buffer.readUInt32BE(0) === 0x89504e47;
  const isJpeg =
    match[1] === "jpeg" &&
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;
  if (!isPng && !isJpeg) return null;
  return { buffer, extension: isPng ? "png" : "jpg" };
}

function parsePng(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const buffer = Buffer.from(match[1], "base64");
  if (buffer.length < 33 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return buffer.readUInt32BE(16) === 512 && buffer.readUInt32BE(20) === 512
    ? buffer
    : null;
}

function parseDesignPng(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const buffer = Buffer.from(match[1], "base64");
  if (
    buffer.length < 33 ||
    buffer.readUInt32BE(0) !== 0x89504e47 ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }
  return buffer.readUInt32BE(16) === 32 && buffer.readUInt32BE(20) === 32
    ? buffer
    : null;
}

async function saveArtworkImage(userId, artworkId, image) {
  const directory = path.join(uploadsDirectory, "artworks", userId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${artworkId}.png`), image);
}

async function deleteArtworkImage(userId, artworkId) {
  try {
    await fs.unlink(
      path.join(uploadsDirectory, "artworks", userId, `${artworkId}.png`),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function saveDesignImages(userId, designId, faces) {
  const directory = path.join(uploadsDirectory, "designs", userId, designId);
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(
    Object.entries(faces).map(([face, image]) =>
      fs.writeFile(path.join(directory, `${face}.png`), image),
    ),
  );
}

async function deleteDesignImages(userId, designId) {
  await fs.rm(path.join(uploadsDirectory, "designs", userId, designId), {
    recursive: true,
    force: true,
  });
}

async function saveGalleryCover(userId, galleryId, cover) {
  const directory = path.join(uploadsDirectory, "galleries", userId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, `${galleryId}.${cover.extension}`),
    cover.buffer,
  );
}

async function deleteGalleryCover(userId, gallery) {
  if (!gallery.coverExtension) return;
  try {
    await fs.unlink(
      path.join(
        uploadsDirectory,
        "galleries",
        userId,
        `${gallery.id}.${gallery.coverExtension}`,
      ),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) return reject(error);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(password, storedHash) {
  const [salt, storedKey] = String(storedHash).split(":");
  if (!salt || !storedKey) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) return reject(error);
      const expected = Buffer.from(storedKey, "hex");
      const actual = derivedKey;
      resolve(
        expected.length === actual.length &&
          crypto.timingSafeEqual(expected, actual),
      );
    });
  });
}

async function requireLogin(request, response, next) {
  if (request.session.userId) return next();
  if (request.path.startsWith("/api/")) {
    return response.status(401).json({
      error: { code: "LOGIN_REQUIRED", message: "로그인이 필요합니다." },
    });
  }
  return response.redirect("/sign-in");
}

app.get("/sign-in", (request, response) => {
  if (request.session.userId) return response.redirect("/");
  return response.sendFile(path.join(publicDirectory, "index.html"));
});

app.get("/api/auth/me", async (request, response, next) => {
  try {
    if (!request.session.userId) return response.json({ user: null });
    const user = (await readUsers()).find(
      (item) => item.id === request.session.userId,
    );
    if (!user) {
      request.session.destroy(() => {});
      return response.json({ user: null });
    }
    return response.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/auth/signup", async (request, response, next) => {
  try {
    const { username, password, passwordConfirm } = request.body;
    const name = typeof username === "string" ? username.normalize("NFC") : "";
    if (!/^[가-힣A-Za-z0-9_]{2,20}$/.test(name)) {
      return sendFieldError(
        response,
        "username",
        "아이디는 2~20자의 한글, 영문, 숫자, 밑줄만 사용할 수 있습니다.",
      );
    }
    if (typeof password !== "string" || password.length < 4) {
      return sendFieldError(
        response,
        "password",
        "비밀번호는 4자 이상이어야 합니다.",
      );
    }
    if (password !== passwordConfirm) {
      return sendFieldError(
        response,
        "passwordConfirm",
        "비밀번호가 일치하지 않습니다.",
      );
    }
    const users = await readUsers();
    if (users.some((user) => user.usernameKey === normalizeUsername(name))) {
      return sendFieldError(
        response,
        "username",
        "이미 사용 중인 아이디입니다.",
      );
    }
    const user = {
      id: `u_${crypto.randomUUID()}`,
      username: name,
      usernameKey: normalizeUsername(name),
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    await saveUsers(users);
    return response.status(201).json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/auth/login", async (request, response, next) => {
  try {
    const username =
      typeof request.body.username === "string" ? request.body.username : "";
    const password =
      typeof request.body.password === "string" ? request.body.password : "";
    const user = (await readUsers()).find(
      (item) => item.usernameKey === normalizeUsername(username),
    );
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return response.status(401).json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "아이디 또는 비밀번호가 올바르지 않습니다.",
        },
      });
    }
    await new Promise((resolve, reject) =>
      request.session.regenerate((error) =>
        error ? reject(error) : resolve(),
      ),
    );
    request.session.userId = user.id;
    return response.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/auth/logout", (request, response, next) => {
  request.session.destroy((error) => {
    if (error) return next(error);
    response.clearCookie("connect.sid");
    return response.json({ ok: true });
  });
});

app.get("/api/me", requireLogin, async (request, response, next) => {
  try {
    const user = (await readUsers()).find(
      (item) => item.id === request.session.userId,
    );
    if (!user)
      return response.status(401).json({
        error: { code: "LOGIN_REQUIRED", message: "로그인이 필요합니다." },
      });
    const artworks = await readArtworks(user.id);
    const galleries = await readGalleries(user.id);
    const designs = await readDesigns(user.id);
    return response.json({
      user: publicUser(user),
      galleryCount: galleries.length,
      artworkCount: artworks.length,
      designCount: designs.length,
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/me/galleries", requireLogin, async (request, response, next) => {
  try {
    const galleries = await readGalleries(request.session.userId);
    return response.json({
      galleries: galleries.map((gallery) =>
        galleryResponse(gallery, request.session.userId),
      ),
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/me/galleries", requireLogin, async (request, response, next) => {
  try {
    const name = normalizeText(request.body.name);
    const description = normalizeText(request.body.description);
    const cover = request.body.coverData ? parseCover(request.body.coverData) : null;
    if (!name || name.length > 20) {
      return sendFieldError(
        response,
        "name",
        "전시 공간 이름은 1~20자로 입력해 주세요.",
      );
    }
    if (description.length > 100) {
      return sendFieldError(
        response,
        "description",
        "전시 공간 소개는 100자 이하로 입력해 주세요.",
      );
    }
    if (request.body.coverData && !cover) {
      return sendFieldError(
        response,
        "coverData",
        "대표 이미지는 5MB 이하의 PNG 또는 JPG 파일이어야 합니다.",
      );
    }
    const galleries = await readGalleries(request.session.userId);
    if (galleries.length >= 5) {
      return response.status(400).json({
        error: {
          code: "GALLERY_LIMIT_REACHED",
          message: "전시 공간은 최대 5개까지 만들 수 있습니다.",
        },
      });
    }
    const gallery = {
      id: `g_${crypto.randomUUID()}`,
      name,
      description,
      blocks: [],
      coverExtension: cover?.extension || null,
      coverRev: cover ? 1 : 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (cover) await saveGalleryCover(request.session.userId, gallery.id, cover);
    galleries.push(gallery);
    await saveGalleries(request.session.userId, galleries);
    return response.status(201).json({
      gallery: galleryResponse(gallery, request.session.userId),
    });
  } catch (error) {
    return next(error);
  }
});

app.patch(
  "/api/me/galleries/:galleryId",
  requireLogin,
  async (request, response, next) => {
    try {
      const name = normalizeText(request.body.name);
      const description = normalizeText(request.body.description);
      const hasCover = Object.prototype.hasOwnProperty.call(
        request.body,
        "coverData",
      );
      const cover = hasCover && request.body.coverData
        ? parseCover(request.body.coverData)
        : null;
      if (!name || name.length > 20) {
        return sendFieldError(
          response,
          "name",
          "전시 공간 이름은 1~20자로 입력해 주세요.",
        );
      }
      if (description.length > 100) {
        return sendFieldError(
          response,
          "description",
          "전시 공간 소개는 100자 이하로 입력해 주세요.",
        );
      }
      if (hasCover && request.body.coverData && !cover) {
        return sendFieldError(
          response,
          "coverData",
          "대표 이미지는 5MB 이하의 PNG 또는 JPG 파일이어야 합니다.",
        );
      }
      const galleries = await readGalleries(request.session.userId);
      const gallery = galleries.find(
        (item) => item.id === request.params.galleryId,
      );
      if (!gallery) {
        return response.status(404).json({
          error: { code: "NOT_FOUND", message: "전시 공간을 찾을 수 없습니다." },
        });
      }
      if (hasCover && !request.body.coverData) {
        await deleteGalleryCover(request.session.userId, gallery);
        gallery.coverExtension = null;
        gallery.coverRev = 0;
      } else if (cover) {
        await deleteGalleryCover(request.session.userId, gallery);
        await saveGalleryCover(request.session.userId, gallery.id, cover);
        gallery.coverExtension = cover.extension;
        gallery.coverRev += 1;
      }
      gallery.name = name;
      gallery.description = description;
      gallery.updatedAt = new Date().toISOString();
      await saveGalleries(request.session.userId, galleries);
      return response.json({
        gallery: galleryResponse(gallery, request.session.userId),
      });
    } catch (error) {
      return next(error);
    }
  },
);

app.get("/api/me/designs", requireLogin, async (request, response, next) => {
  try {
    const designs = await readDesigns(request.session.userId);
    return response.json({
      designs: designs.map((design) =>
        designResponse(design, request.session.userId),
      ),
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/me/designs", requireLogin, async (request, response, next) => {
  try {
    const name = normalizeText(request.body.name);
    const faceData = request.body.faces;
    if (!name || name.length > 20) {
      return sendFieldError(
        response,
        "name",
        "블록 디자인 이름은 1~20자로 입력해 주세요.",
      );
    }
    if (
      !faceData ||
      ["front", "side", "top"].some((face) => !parseDesignPng(faceData[face]))
    ) {
      return sendFieldError(
        response,
        "faces",
        "앞면, 옆면, 윗면의 32×32 PNG를 모두 저장해 주세요.",
      );
    }
    const designs = await readDesigns(request.session.userId);
    const nameKey = name.toLocaleLowerCase("ko-KR");
    if (designs.some((design) => design.nameKey === nameKey)) {
      return sendFieldError(response, "name", "이미 사용 중인 디자인 이름입니다.");
    }
    const design = {
      id: `d_${crypto.randomUUID()}`,
      name,
      nameKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rev: 1,
    };
    await saveDesignImages(
      request.session.userId,
      design.id,
      Object.fromEntries(
        ["front", "side", "top"].map((face) => [
          face,
          parseDesignPng(faceData[face]),
        ]),
      ),
    );
    designs.push(design);
    await saveDesigns(request.session.userId, designs);
    return response.status(201).json({
      design: designResponse(design, request.session.userId),
    });
  } catch (error) {
    return next(error);
  }
});

app.patch(
  "/api/me/designs/:designId",
  requireLogin,
  async (request, response, next) => {
    try {
      const name = normalizeText(request.body.name);
      const designs = await readDesigns(request.session.userId);
      const design = designs.find((item) => item.id === request.params.designId);
      if (!design) {
        return response.status(404).json({
          error: { code: "NOT_FOUND", message: "블록 디자인을 찾을 수 없습니다." },
        });
      }
      if (!name || name.length > 20) {
        return sendFieldError(
          response,
          "name",
          "블록 디자인 이름은 1~20자로 입력해 주세요.",
        );
      }
      const nameKey = name.toLocaleLowerCase("ko-KR");
      if (
        designs.some(
          (item) => item.id !== design.id && item.nameKey === nameKey,
        )
      ) {
        return sendFieldError(response, "name", "이미 사용 중인 디자인 이름입니다.");
      }
      const faceData = request.body.faces;
      if (
        !faceData ||
        ["front", "side", "top"].some((face) => !parseDesignPng(faceData[face]))
      ) {
        return sendFieldError(
          response,
          "faces",
          "앞면, 옆면, 윗면의 32×32 PNG를 모두 저장해 주세요.",
        );
      }
      design.name = name;
      design.nameKey = nameKey;
      design.updatedAt = new Date().toISOString();
      design.rev += 1;
      await saveDesignImages(
        request.session.userId,
        design.id,
        Object.fromEntries(
          ["front", "side", "top"].map((face) => [
            face,
            parseDesignPng(faceData[face]),
          ]),
        ),
      );
      await saveDesigns(request.session.userId, designs);
      return response.json({
        design: designResponse(design, request.session.userId),
      });
    } catch (error) {
      return next(error);
    }
  },
);

app.delete(
  "/api/me/designs/:designId",
  requireLogin,
  async (request, response, next) => {
    try {
      const designs = await readDesigns(request.session.userId);
      const index = designs.findIndex(
        (design) => design.id === request.params.designId,
      );
      if (index === -1) {
        return response.status(404).json({
          error: { code: "NOT_FOUND", message: "블록 디자인을 찾을 수 없습니다." },
        });
      }
      const [design] = designs.splice(index, 1);
      const galleries = await readGalleries(request.session.userId);
      galleries.forEach((gallery) => {
        if (!Array.isArray(gallery.blocks)) return;
        gallery.blocks.forEach((block) => {
          if (block.designId === design.id) block.designId = null;
        });
      });
      await saveDesigns(request.session.userId, designs);
      await saveGalleries(request.session.userId, galleries);
      await deleteDesignImages(request.session.userId, design.id);
      return response.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  },
);

app.get(
  "/gallery-edit",
  requireLogin,
  (request, response) =>
    response.sendFile(path.join(publicDirectory, "gallery_edit.html")),
);

app.get(
  "/api/me/galleries/:galleryId/editor",
  requireLogin,
  async (request, response, next) => {
    try {
      const galleries = await readGalleries(request.session.userId);
      const gallery = galleries.find(
        (item) => item.id === request.params.galleryId,
      );
      if (!gallery) {
        return response.status(404).json({
          error: { code: "NOT_FOUND", message: "전시 공간을 찾을 수 없습니다." },
        });
      }
      const artworks = await readArtworks(request.session.userId);
      const designs = await readDesigns(request.session.userId);
      return response.json({
        gallery: galleryResponse(gallery, request.session.userId),
        artworks: artworks.map((artwork) =>
          artworkResponse(artwork, request.session.userId),
        ),
        designs: designs.map((design) =>
          designResponse(design, request.session.userId),
        ),
      });
    } catch (error) {
      return next(error);
    }
  },
);

function normalizedEditorBlocks(blocks, artworkIds, designIds) {
  if (!Array.isArray(blocks) || blocks.length > 1200) return null;
  const positions = new Set();
  const normalized = [];
  for (const block of blocks) {
    const x = Number(block?.x);
    const y = Number(block?.y);
    const z = Number(block?.z);
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      !Number.isInteger(z) ||
      x < 0 ||
      x >= 20 ||
      y < 0 ||
      y >= 20 ||
      z < 0 ||
      z >= 3
    ) {
      return null;
    }
    const position = `${x},${y},${z}`;
    if (positions.has(position)) return null;
    positions.add(position);
    const artworkId =
      block.frame && block.frame.artworkId ? block.frame.artworkId : null;
    if (artworkId !== null && !artworkIds.has(artworkId)) return null;
    const designId =
      typeof block.designId === "string" && block.designId ? block.designId : null;
    if (designId !== null && !designIds.has(designId)) return null;
    normalized.push({
      id: typeof block.id === "string" ? block.id : `b_${crypto.randomUUID()}`,
      x,
      y,
      z,
      designId,
      frame: artworkId ? { artworkId } : null,
    });
  }
  return normalized;
}

app.patch(
  "/api/me/galleries/:galleryId/editor",
  requireLogin,
  async (request, response, next) => {
    try {
      const galleries = await readGalleries(request.session.userId);
      const gallery = galleries.find(
        (item) => item.id === request.params.galleryId,
      );
      if (!gallery) {
        return response.status(404).json({
          error: { code: "NOT_FOUND", message: "전시 공간을 찾을 수 없습니다." },
        });
      }
      const artworks = await readArtworks(request.session.userId);
      const designs = await readDesigns(request.session.userId);
      const blocks = normalizedEditorBlocks(
        request.body.blocks,
        new Set(artworks.map((artwork) => artwork.id)),
        new Set(designs.map((design) => design.id)),
      );
      if (!blocks) {
        return sendFieldError(
          response,
          "blocks",
          "블록 위치, 디자인 또는 액자 작품 정보가 올바르지 않습니다.",
        );
      }
      gallery.blocks = blocks;
      gallery.updatedAt = new Date().toISOString();
      await saveGalleries(request.session.userId, galleries);
      return response.json({
        gallery: galleryResponse(gallery, request.session.userId),
      });
    } catch (error) {
      return next(error);
    }
  },
);

app.delete(
  "/api/me/galleries/:galleryId",
  requireLogin,
  async (request, response, next) => {
    try {
      const galleries = await readGalleries(request.session.userId);
      const index = galleries.findIndex(
        (gallery) => gallery.id === request.params.galleryId,
      );
      if (index === -1) {
        return response.status(404).json({
          error: { code: "NOT_FOUND", message: "전시 공간을 찾을 수 없습니다." },
        });
      }
      const [gallery] = galleries.splice(index, 1);
      await saveGalleries(request.session.userId, galleries);
      await deleteGalleryCover(request.session.userId, gallery);
      return response.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  },
);

app.get("/api/me/artworks", requireLogin, async (request, response, next) => {
  try {
    const artworks = await readArtworks(request.session.userId);
    return response.json({
      artworks: artworks.map((artwork) =>
        artworkResponse(artwork, request.session.userId),
      ),
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/me/artworks", requireLogin, async (request, response, next) => {
  try {
    const title = normalizeText(request.body.title);
    const description = normalizeText(request.body.description);
    const image = parsePng(request.body.imageData);
    if (!title || title.length > 100) {
      return sendFieldError(
        response,
        "title",
        "작품 제목은 1~100자로 입력해 주세요.",
      );
    }
    if (description.length > 100) {
      return sendFieldError(
        response,
        "description",
        "작품 설명은 100자 이하로 입력해 주세요.",
      );
    }
    if (!image) {
      return sendFieldError(
        response,
        "imageData",
        "512×512 PNG 그림을 저장해 주세요.",
      );
    }
    const artworks = await readArtworks(request.session.userId);
    const titleKey = title.toLocaleLowerCase("ko-KR");
    if (artworks.some((artwork) => artwork.titleKey === titleKey)) {
      return sendFieldError(response, "title", "이미 사용 중인 작품 제목입니다.");
    }
    const artwork = {
      id: `a_${crypto.randomUUID()}`,
      title,
      titleKey,
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rev: 1,
    };
    artworks.push(artwork);
    await saveArtworkImage(request.session.userId, artwork.id, image);
    await saveArtworks(request.session.userId, artworks);
    return response.status(201).json({
      artwork: artworkResponse(artwork, request.session.userId),
    });
  } catch (error) {
    return next(error);
  }
});

app.patch(
  "/api/me/artworks/:artworkId",
  requireLogin,
  async (request, response, next) => {
    try {
      const title = normalizeText(request.body.title);
      const description = normalizeText(request.body.description);
      const image = request.body.imageData
        ? parsePng(request.body.imageData)
        : null;
      if (!title || title.length > 100) {
        return sendFieldError(
          response,
          "title",
          "작품 제목은 1~100자로 입력해 주세요.",
        );
      }
      if (description.length > 100) {
        return sendFieldError(
          response,
          "description",
          "작품 설명은 100자 이하로 입력해 주세요.",
        );
      }
      if (request.body.imageData && !image) {
        return sendFieldError(
          response,
          "imageData",
          "512×512 PNG 그림을 저장해 주세요.",
        );
      }
      const artworks = await readArtworks(request.session.userId);
      const artwork = artworks.find(
        (item) => item.id === request.params.artworkId,
      );
      if (!artwork) {
        return response.status(404).json({
          error: { code: "NOT_FOUND", message: "작품을 찾을 수 없습니다." },
        });
      }
      const titleKey = title.toLocaleLowerCase("ko-KR");
      if (
        artworks.some(
          (item) => item.id !== artwork.id && item.titleKey === titleKey,
        )
      ) {
        return sendFieldError(response, "title", "이미 사용 중인 작품 제목입니다.");
      }
      artwork.title = title;
      artwork.titleKey = titleKey;
      artwork.description = description;
      artwork.updatedAt = new Date().toISOString();
      if (image) {
        artwork.rev += 1;
        await saveArtworkImage(request.session.userId, artwork.id, image);
      }
      await saveArtworks(request.session.userId, artworks);
      return response.json({
        artwork: artworkResponse(artwork, request.session.userId),
      });
    } catch (error) {
      return next(error);
    }
  },
);

app.delete(
  "/api/me/artworks/:artworkId",
  requireLogin,
  async (request, response, next) => {
    try {
      const artworks = await readArtworks(request.session.userId);
      const index = artworks.findIndex(
        (item) => item.id === request.params.artworkId,
      );
      if (index === -1) {
        return response.status(404).json({
          error: { code: "NOT_FOUND", message: "작품을 찾을 수 없습니다." },
        });
      }
      const [artwork] = artworks.splice(index, 1);
      const galleries = await readGalleries(request.session.userId);
      galleries.forEach((gallery) => {
        if (!Array.isArray(gallery.blocks)) return;
        gallery.blocks.forEach((block) => {
          if (block.frame?.artworkId === artwork.id) block.frame = null;
        });
      });
      await saveArtworks(request.session.userId, artworks);
      await saveGalleries(request.session.userId, galleries);
      await deleteArtworkImage(request.session.userId, artwork.id);
      return response.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  },
);

app.use((error, request, response, next) => {
  console.error(error);
  if (response.headersSent) return next(error);
  return response.status(500).json({
    error: { code: "SERVER_ERROR", message: "서버 오류가 발생했습니다." },
  });
});

module.exports = app;
