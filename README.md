# JSTanks — Lab 03: Asynchronous JavaScript: Promises, `async/await`, and the Loading Screen

Аркадна 2D-гра про керування танком на полігоні (ES Modules, Vite, Canvas 2D API) із фіксованим кроком симуляції (`60 Hz`), асинхронним пайплайном завантаження ресурсів, екраном завантаження з реальним прогрес-баром, рендерингом зі спрайтшитів, звуковим рушієм на Web Audio API, шиною подій `EventTarget` та мережевим лобі перед стартом бою.

## Запуск проєкту

```bash
npm install
npm run dev
```

Перевірка форматування та лінтера (Biome):

```bash
npm run format
npm run lint
```

### Керування та діагностичні параметри URL

- `W` / `S` або `↑` / `↓` — рух уперед / задній хід
- `A` / `D` або `←` / `→` — поворот корпусу танка
- `Space` або `F` — постріл зі ствола бронебійним снарядом
- `E` або `Left Shift` — запуск самонавідної ракети (`homing`)
- `M` — увімкнути / вимкнути звук (Web Audio)
- `?mode=seq` — запуск завантаження ресурсів у послідовному режимі (`sequential await`) для порівняння часу
- `?fail=404` | `?fail=timeout` | `?fail=abort` | `?fail=json` — симуляція збоїв мережі та парсингу

---

## Архітектура асинхронних модулів (Milestones M1–M3)

- `public/assets/manifest.json` та `src/assets/loader.js` — асинхронний завантажувач ресурсів (`loadImage`, `loadAudio`, `loadJson` через спільний `fetchJson`, який перевіряє `response.ok`). Усі функції приймають `AbortSignal` та обгорнуті у `withRetry` з **exponential backoff + jitter** і негайним відхиленням без ретраїв на помилки клієнта `4xx`.
- `loadAll` — запускає завантаження всіх ресурсів паралельно через `Promise.all` із відстеженням прогресу по кожному файлу (`done / total`) для прогрес-бару на Canvas.
- `src/audio/audio.js` — звуковий рушій на **Web Audio API**. `AudioContext` розблоковується на першому жесті користувача (`pointerdown` / `keydown`), а `.wav`-файли декодуються в `AudioBuffer` ще під час екрана завантаження для відтворення без затримок.
- `src/sim/world.js` (`class World extends EventTarget`) — симуляція **не імпортує** модулі аудіо чи HUD. Замість цього `World` генерує `CustomEvent` (`"fired"`, `"hit"`, `"exploded"`, `"pickup"`, `"scoreChanged"`), на які підписуються `createAudioEngine` та `createHudRenderer`.
- `src/lobby/lobby.js` (`class Lobby extends EventTarget`) та `src/lobby/lobbyView.js` — відокремлені шар даних лобі та DOM-інтерфейс. Лобі опитує `/api/rooms.json` за інтервалом із таймаутом `AbortSignal.timeout(3000)` на кожен запит і миттєво викликає `controller.abort()` при натисканні гравцем **JOIN BATTLE**.

---

## Порівняння продуктивності: Sequential `await` vs Concurrent `Promise.all`

Завантаження 6 ресурсів маніфесту (1 спрайтшит `sprites.svg`, 1 конфіг `arena.json` та 4 аудіобуфери `.wav` із декодуванням через `decodeAudioData`) виміряно через `performance.now()` у `loadAll`:

| Режим завантаження                | Механізм виконання                                     | Час завантаження (локальний Vite dev-server) |       Поведінка при затримці мережі (`+200 ms` на ресурс)       |
| :-------------------------------- | :----------------------------------------------------- | :------------------------------------------: | :-------------------------------------------------------------: |
| **Sequential (`?mode=seq`)**      | Послідовний цикл `for...of` з `await` на кожен файл    |                  `~28.4 ms`                  |   Сума всіх затримок: `6 × 200 ms ≈ 1200+ ms` ($O(\sum t_i)$)   |
| **Concurrent (за замовчуванням)** | Паралельний запуск через `Promise.all(tasks.map(...))` |                  `~9.2 ms`                   | Час найповільнішого запиту: `max(t_i) ≈ 215 ms` ($O(\max t_i)$) |

**Висновок:** при послідовному `await` кожен наступний `fetch` та `decodeAudioData` чекає завершення попереднього, простоюючи в очікуванні I/O. Паралельний запуск через `Promise.all` усуває каскадне очікування і прискорює старт гри навіть на локальному сервері у ~3 рази, а в реальній мережі — пропорційно кількості ассетів.

---

## П'ять головоломок порядку виконання (Microtasks vs Tasks)

### Головоломка 1 — `async/await` та синхронний код до першого `await`

```js
async function loadTank() {
	console.log("1: start");
	await Promise.resolve();
	console.log("2: after await");
}
console.log("0: sync");
loadTank();
console.log("3: end");
```

- **Вивід:** `0: sync` → `1: start` → `3: end` → `2: after await`
- **Пояснення:** Тіло `async`-функції виконується синхронно до першого `await`, після чого функція повертає керування в Event Loop, а її продовження планується як мікрозадача.

### Головоломка 2 — `setTimeout` всередині `.then()`

```js
Promise.resolve()
	.then(() => {
		console.log("1: microtask 1");
		setTimeout(() => console.log("4: macrotask from then"), 0);
	})
	.then(() => console.log("2: microtask 2"));

setTimeout(() => console.log("3: outer macrotask"), 0);
```

- **Вивід:** `1: microtask 1` → `2: microtask 2` → `3: outer macrotask` → `4: macrotask from then`
- **Пояснення:** Черга мікрозадач повністю спорожнюється (`1`, `2`) перед переходом до черги макрозадач, де таймери виконуються у порядку їх реєстрації (`3`, потім `4`).

### Головоломка 3 — Взаємодія `requestAnimationFrame`, мікрозадач і `setTimeout`

```js
setTimeout(() => console.log("3: timeout"), 0);
requestAnimationFrame(() => {
	console.log("2: rAF");
	Promise.resolve().then(() => console.log("2.5: microtask inside rAF"));
});
Promise.resolve().then(() => console.log("1: initial microtask"));
```

- **Вивід:** `1: initial microtask` → `2: rAF` → `2.5: microtask inside rAF` → `3: timeout`
- **Пояснення:** Перед фазою рендерингу виконуються початкові мікрозадачі (`1`), далі перед відмальовкою кадру спрацьовує `requestAnimationFrame` (`2`) і одразу після нього чиститься його черга мікрозадач (`2.5`), і лише на наступному тіку циклу виконується `setTimeout` (`3`).

### Головоломка 4 — Асиміляція промісів (повернення проміса з `.then`)

```js
Promise.resolve("A")
	.then((v) => {
		console.log(v);
		return new Promise((r) => setTimeout(() => r("B"), 0));
	})
	.then((v) => console.log(v));
Promise.resolve("C").then((v) => console.log(v));
```

- **Вивід:** `A` → `C` → `B`
- **Пояснення:** Перший `.then` виводить `A` і повертає проміс із таймером, тому другий `.then` чекає його вирішення у наступній макрозадачі, тоді як уже вирішений проміс `C` встигає виконатися в поточній черзі мікрозадач.

### Головоломка 5 — Прокидання помилки крізь `.then` та відновлення після `.catch`

```js
Promise.reject(new Error("404"))
	.then(() => console.log("skipped"))
	.catch((err) => {
		console.log("caught:", err.message);
		return "fallback";
	})
	.then((val) => console.log("recovered:", val));
```

- **Вивід:** `caught: 404` → `recovered: fallback`
- **Пояснення:** Відхилений проміс пропускає всі обробники `onFulfilled` до найближчого `.catch`, який перехоплює помилку й повертає нормальне значення, переводячи ланцюжок назад у стан `fulfilled`.

---

## Галерея збоїв та відновлення (Milestone M4)

Усі сценарії збоїв перевірені через діагностичні параметри запуску без падіння застосунку:

| Сценарій збою                     | Спосіб відтворення                                                                   | Реакція системи та відновлення                                                                                                                                                                                                                                                                 |
| :-------------------------------- | :----------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. `404` спрайтшита**           | `?fail=404` (`nonexistent-tank-sheet-404.png`)                                       | `loadImage` фіксує помилку завантаження (`status = 404`), `withRetry` **не робить зайвих ретраїв на `4xx`**, прогрес-бар стає червоним, виводиться повідомлення про помилку та інструкція натиснути **Retry (`R` / клік)** або **`Enter`**, щоб продовжити гру з резервною векторною графікою. |
| **2. Таймаут мережі**             | `?fail=timeout` (`AbortSignal.timeout(1)`)                                           | Браузер генерує `TimeoutError: The operation was aborted due to timeout`. `withRetry` коректно розпізнає сигнал скасування, зупиняє очікування без зависання інтерфейсу й пропонує повторну спробу.                                                                                            |
| **3. Abort посеред завантаження** | `?fail=abort` (`controller.abort()` через `30 ms`)                                   | Усі активні запити `fetch` і `decodeAudioData` отримують `AbortError: User cancelled asset loading`, миттєво звільняють ресурси і переводять екран завантаження у безпечний стан очікування дій гравця.                                                                                        |
| **4. Битий JSON (`SyntaxError`)** | `?fail=json` (завантаження HTML замість `manifest.json` та SVG замість `rooms.json`) | `response.json()` кидає `SyntaxError: Unexpected token '<'`. На екрані завантаження з'являється кнопка Retry, а в лобі статус показує попередження (`Warning: ...`), дозволяючи гравцю натиснути **JOIN BATTLE** в офлайн-режимі арени.                                                        |
