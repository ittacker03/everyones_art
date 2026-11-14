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

function normalizeText(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
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
    return response.json({
      user: publicUser(user),
      galleryCount: 0,
      artworkCount: artworks.length,
    });
  } catch (error) {
    return next(error);
  }
});

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
      await saveArtworks(request.session.userId, artworks);
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
