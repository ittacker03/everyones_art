const fs = require("node:fs/promises");
const path = require("node:path");
const { dataDirectory, usersFile } = require("./config");

let writeQueue = Promise.resolve();

async function ensureStorage() {
  await fs.mkdir(dataDirectory, { recursive: true });
  try {
    await fs.access(usersFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeJson(usersFile, { schemaVersion: 1, users: [] });
  }
}

async function readUsers() {
  await ensureStorage();
  const contents = await fs.readFile(usersFile, "utf8");
  const parsed = JSON.parse(contents.replace(/^\uFEFF/, ""));
  if (!parsed || !Array.isArray(parsed.users)) {
    throw new Error("사용자 저장 파일 형식이 올바르지 않습니다.");
  }
  return parsed.users;
}

function writeJson(file, value) {
  const temporaryFile = `${file}.${process.pid}.tmp`;
  writeQueue = writeQueue.then(async () => {
    await fs.writeFile(
      temporaryFile,
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
    await fs.rename(temporaryFile, file);
  });
  return writeQueue;
}

async function saveUsers(users) {
  await writeJson(usersFile, { schemaVersion: 1, users });
}

function userArtworksFile(userId) {
  return path.join(dataDirectory, "users", userId, "artworks.json");
}

async function readArtworks(userId) {
  const file = userArtworksFile(userId);
  try {
    const contents = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(contents.replace(/^\uFEFF/, ""));
    if (!parsed || !Array.isArray(parsed.artworks)) {
      throw new Error("작품 저장 파일 형식이 올바르지 않습니다.");
    }
    return parsed.artworks;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}

async function saveArtworks(userId, artworks) {
  const file = userArtworksFile(userId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeJson(file, { schemaVersion: 1, artworks });
}

module.exports = {
  ensureStorage,
  readUsers,
  saveUsers,
  readArtworks,
  saveArtworks,
  userArtworksFile,
};
