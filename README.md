# JSTanks — Lab 04: Node.js: `EventEmitter`, Streams, and a WebSocket Server

Аркадна мультиплеєрна 2D-гра про керування танком на полігоні (`npm workspaces`: `client/` + `server/`). На стороні Node.js реалізовано HTTP-сервер (`node:http`) із роздачею статичних файлів та API кімнат, WebSocket-сервер (`ws`) з валідацією версіонованого протоколу, кімнати на базі `EventEmitter`, потокове NDJSON-логування матчів через `Transform` + `stream.pipeline` та клієнтську обгортку сокета з чергою повідомлень і перепідключенням.

## Структура монорепозиторію (`npm workspaces`)

- `package.json` — кореневий маніфест (`"workspaces": ["client", "server"]`) та спільні скрипти (`dev:server`, `dev:client`, `build`, `start`, `format`, `lint`).
- `client/` — фронтенд на Vite + Canvas 2D API:
  - `client/vite.config.js` — проксі `/api`, `/health` та `/ws` на `http://localhost:3000` у режимі розробки.
  - `client/src/net/connection.js` — `class GameConnection extends EventTarget` із чергою повідомлень (`sendQueue`) до відкриття сокета та автоперепідключенням з exponential backoff.
  - `client/src/lobby/lobby.js`, `lobbyView.js`, `chatView.js` — реальне лобі (`GET /api/rooms`, `POST /api/rooms`) та живий чат/список гравців у кімнаті (`ROOM ROSTER & CHAT`).
- `server/` — бекенд на Node.js (`"type": "module"`, префікс `node:` для вбудованих модулів):
  - `server/src/config.js` — читання та сувора валідація змінних середовища (`PORT`, `HOST`, `LOG_DIR`, `MAX_ROOMS`, `MAX_PLAYERS_PER_ROOM`) із підтримкою `--env-file=.env`.
  - `server/src/index.js` — `node:http` сервер: безпечна статика з `client/dist` (MIME-типи, захист від Path Traversal `..`), `GET /health`, `GET/POST /api/rooms`, потокові повтори `GET /api/replays/:id`, діагностичний ендпоінт `GET /api/slow` та **Graceful Shutdown** (`SIGINT` / `SIGTERM`).
  - `server/src/rooms.js` — `class Room extends EventEmitter` (`join`, `leave`, `chat`, `event`, `empty`) та `RoomManager` з автоматичним видаленням порожніх кімнат.
  - `server/src/protocol.js` — версіонований JSON-протокол (`v: 1`), сувора перевірка типів, розміру та полів кожного вхідного повідомлення.
  - `server/src/ws.js` — життєвий цикл WebSocket-підключення: таймаут `5 с` на `join`, heartbeat (`ping` кожні `15 с`, розрив після 2 пропущених `pong`), token-bucket rate limit, політика повільного клієнта (`socket.bufferedAmount`) та слухачі `"error"`.
  - `server/src/log/matchlog.js` та `replay.js` — потоковий запис подій матчу (`NdjsonTransform` в object mode + `pipeline`) у `LOG_DIR/<room>-<timestamp>.ndjson` і потокове читання повторів без завантаження файлу в пам'ять.

## Запуск проєкту

```bash
npm install
npm run build

# Запуск у режимі розробки (два термінали):
npm run dev:server
npm run dev:client

# Запуск продакшн-сервера (роздає зібраний client/dist):
npm start
```

---

## Доказ Backpressure: графік пам'яті (`RSS`) при потоковому завантаженні 200 МБ логу

Для перевірки роботи механізму **backpressure** (`server/test/backpressure-bench.js`) згенеровано синтетичний лог матчу розміром **200.0 МБ** (`synthetic-200mb.ndjson`), який віддається через `pipeline(createReadStream(filePath), res)` клієнту з навмисним тротлінгом швидкості споживання (`1 ms` затримки на кожен чанк).

### Результати вимірювань (`process.memoryUsage().rss`)

- **Розмір файлу:** `200.0 MB`
- **Мінімальний RSS:** `56.9 MB`
- **Стабільний робочий коридор під час стрімінгу (5–53 с):** `56.9 MB – 77.5 MB` (піковий сплеск під час початкової генерації файлу — `117.1 MB`, після чого V8 GC повертає пам'ять до ~60 МБ).
- **Висновок:** замість зростання споживання пам'яті на `+200 MB` (як при `fs.readFile` або ігноруванні `res.write() === false`), `stream.pipeline` автоматично ставить `Readable`-потік файлу на паузу (`pause()`), щойно внутрішній буфер сокета досягає `highWaterMark`, і відновлює читання (`resume()`) після події `"drain"`.

```text
RSS (MB)
120 |      *
100 |    *   *
 80 |  *       *   *   *   *   *   *   *   *   *   *   *   *   *
 60 |*           *   *   *   *   *   *   *   *   *   *   *   *   *
 40 |_____________________________________________________________
     0s   4s   8s  12s  16s  20s  24s  28s  32s  36s  40s  44s  52s
```

---

## Цикл подій Node.js (`libuv`), блокування потоку та обробка `"error"` в `EventEmitter`

### 1. Фази циклу подій `libuv` та наслідки блокування на 300 мс

На відміну від багатопотокових серверів (Java/C#), ваш JavaScript-код у Node.js виконується в **одному головному потоці** поверх циклу подій `libuv`, який проходить 5 послідовних фаз:

1. **`timers`** — колбеки `setTimeout` та `setInterval`, час яких настав.
2. **`pending callbacks`** — системні I/O-колбеки, відкладені з попередньої ітерації.
3. **`poll`** — очікування нових I/O-подій (вхідні HTTP-запити, WebSocket-фрейми, завершення читання файлів).
4. **`check`** — виконання колбеків `setImmediate()`.
5. **`close callbacks`** — закриття дескрипторів (`socket.on("close")`).

_(Між кожною фазою повністю спорожнюються черги `process.nextTick()` та мікрозадач `Promise`.)_

**Що відбувається при синхронному блокуванні (`GET /api/slow` на 300 мс):**
Коли один клієнт викликає `/api/slow`, синхронний цикл `while (performance.now() - start < 300)` утримує головний потік у фазі `poll`. Протягом усіх **300 мс** `libuv` фізично не може перейти до читання нових фреймів із сокетів або запуску таймерів: повідомлення чату від інших гравців у кімнаті, HTTP-запити `/api/rooms` та heartbeat-пінги зупиняються для **всіх** підключених користувачів одночасно. Саме тому важкі обчислення не можна виконувати в обробниках запитів (для цього існують `worker_threads`).

### 2. Чому необроблена подія `"error"` в `EventEmitter` валить увесь процес

`EventEmitter` у Node.js має спеціальне правило: якщо викликати `emitter.emit("error", err)`, а на подію `"error"` не зареєстровано жодного слухача, Node.js трактує це як **неперехоплений виняток (`Uncaught Exception`)** і негайно аварійно завершує весь процес із кодом `1`, обриваючи з'єднання всіх активних гравців:

```text
node:events:497
      throw er; // Unhandled 'error' event
      ^
Error: read ECONNRESET
    at TCP.onStreamRead (node:internal/stream_base_commons:217:20)
Emitted 'error' event on WebSocket instance
```

**Виправлення у нашому сервері:**
Кожен потенційно вразливий `EventEmitter` (кожен клієнтський `socket`, `WebSocketServer`, `Room`, а також усі потоки `source`, `transform`, `sink` у `createMatchLogger`) має обов'язковий слухач `.on("error", err => console.error(...))`, а на рівні процесу зареєстровані `SIGINT`/`SIGTERM` для коректного закриття ресурсів без втрати даних.
