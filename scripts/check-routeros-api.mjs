import net from "node:net";
import process from "node:process";

const options = parseArguments(process.argv.slice(2));
const password = options.password ?? process.env.TICKETPRO_ROUTER_PASSWORD ?? "";

const socket = net.createConnection({ host: options.host, port: options.port });
const reader = new RouterOsReader(socket);

try {
  await waitForConnection(socket, options.timeoutMs);
  socket.setNoDelay(true);

  socket.write(encodeSentence([
    "/login",
    `=name=${options.username}`,
    `=password=${password}`
  ]));
  await readResponse(reader, options.timeoutMs, "authentification");
  console.log(`Authentification RouterOS : OK (${options.username}@${options.host}:${options.port})`);

  socket.write(encodeSentence(["/system/resource/print"]));
  const rows = await readResponse(reader, options.timeoutMs, "lecture /system/resource/print");

  if (rows.length === 0) {
    throw new Error("RouterOS a répondu sans retourner les informations système.");
  }

  console.log("Commande /system/resource/print : OK");
  console.log(JSON.stringify(rows[0], null, 2));
} catch (error) {
  console.error(`ÉCHEC API RouterOS : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  socket.destroy();
}

function parseArguments(args) {
  const result = {
    host: "192.168.88.1",
    password: undefined,
    port: 8728,
    timeoutMs: 5000,
    username: "admin"
  };

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];

    if (["--host", "--password", "--port", "--timeout", "--username"].includes(key) && value === undefined) {
      throw new Error(`Valeur manquante pour ${key}.`);
    }

    if (key === "--host") result.host = value;
    else if (key === "--password") result.password = value;
    else if (key === "--port") result.port = parsePositiveInteger(value, "port");
    else if (key === "--timeout") result.timeoutMs = parsePositiveInteger(value, "timeout");
    else if (key === "--username") result.username = value;
    else throw new Error(`Argument inconnu : ${key}`);

    index += 1;
  }

  return result;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} invalide : ${value}`);
  }
  return parsed;
}

function waitForConnection(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`connexion TCP expirée après ${timeoutMs} ms`));
    }, timeoutMs);

    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };

    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

async function readResponse(reader, timeoutMs, stage) {
  const rows = [];

  while (true) {
    const words = await reader.readSentence(timeoutMs, stage);
    if (words.length === 0) continue;

    const reply = words[0];
    const attributes = wordsToObject(words.slice(1));

    if (reply === "!re") rows.push(attributes);
    else if (reply === "!done") return rows;
    else if (reply === "!empty") continue;
    else if (reply === "!trap") {
      throw new Error(`RouterOS !trap : ${attributes.message ?? JSON.stringify(attributes)}`);
    } else if (reply === "!fatal") {
      throw new Error(`RouterOS !fatal : ${attributes.message ?? JSON.stringify(attributes)}`);
    }
  }
}

function wordsToObject(words) {
  const result = {};
  for (const word of words) {
    if (!word.startsWith("=")) continue;
    const separator = word.indexOf("=", 1);
    if (separator < 0) continue;
    result[word.slice(1, separator)] = word.slice(separator + 1);
  }
  return result;
}

function encodeSentence(words) {
  return Buffer.concat([...words.map(encodeWord), Buffer.from([0])]);
}

function encodeWord(value) {
  const data = Buffer.from(value, "utf8");
  return Buffer.concat([encodeLength(data.length), data]);
}

function encodeLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x4000) return Buffer.from([(length >> 8) | 0x80, length & 0xff]);
  if (length < 0x20_0000) {
    return Buffer.from([(length >> 16) | 0xc0, (length >> 8) & 0xff, length & 0xff]);
  }
  if (length < 0x1000_0000) {
    return Buffer.from([
      (length >> 24) | 0xe0,
      (length >> 16) & 0xff,
      (length >> 8) & 0xff,
      length & 0xff
    ]);
  }
  return Buffer.from([
    0xf0,
    (length >> 24) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff
  ]);
}

class RouterOsReader {
  constructor(socket) {
    this.buffer = Buffer.alloc(0);
    this.closedError = null;
    this.waiters = [];

    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    socket.on("error", (error) => {
      this.closedError = error;
      this.rejectAll(error);
    });
    socket.on("close", () => {
      const error = this.closedError ?? new Error("connexion fermée par RouterOS");
      this.closedError = error;
      this.rejectAll(error);
    });
  }

  readSentence(timeoutMs, stage) {
    const parsed = this.tryParseSentence();
    if (parsed) return Promise.resolve(parsed);
    if (this.closedError) return Promise.reject(this.closedError);

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: undefined };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new Error(`${stage} expirée après ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  drain() {
    while (this.waiters.length > 0) {
      const sentence = this.tryParseSentence();
      if (!sentence) return;
      const waiter = this.waiters.shift();
      clearTimeout(waiter.timer);
      waiter.resolve(sentence);
    }
  }

  rejectAll(error) {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  tryParseSentence() {
    const words = [];
    let offset = 0;

    while (true) {
      const lengthInfo = decodeLength(this.buffer, offset);
      if (!lengthInfo) return null;
      offset += lengthInfo.bytesRead;

      if (this.buffer.length < offset + lengthInfo.length) return null;
      if (lengthInfo.length === 0) {
        this.buffer = this.buffer.subarray(offset);
        return words;
      }

      words.push(this.buffer.subarray(offset, offset + lengthInfo.length).toString("utf8"));
      offset += lengthInfo.length;
    }
  }
}

function decodeLength(buffer, offset) {
  if (buffer.length <= offset) return null;
  const first = buffer[offset];

  if ((first & 0x80) === 0) return { bytesRead: 1, length: first };
  if ((first & 0xc0) === 0x80) {
    if (buffer.length < offset + 2) return null;
    return { bytesRead: 2, length: ((first & 0x3f) << 8) + buffer[offset + 1] };
  }
  if ((first & 0xe0) === 0xc0) {
    if (buffer.length < offset + 3) return null;
    return {
      bytesRead: 3,
      length: ((first & 0x1f) << 16) + (buffer[offset + 1] << 8) + buffer[offset + 2]
    };
  }
  if ((first & 0xf0) === 0xe0) {
    if (buffer.length < offset + 4) return null;
    return {
      bytesRead: 4,
      length:
        ((first & 0x0f) * 0x1000000) +
        (buffer[offset + 1] << 16) +
        (buffer[offset + 2] << 8) +
        buffer[offset + 3]
    };
  }
  if (buffer.length < offset + 5) return null;
  return {
    bytesRead: 5,
    length:
      (buffer[offset + 1] * 0x1000000) +
      (buffer[offset + 2] << 16) +
      (buffer[offset + 3] << 8) +
      buffer[offset + 4]
  };
}
