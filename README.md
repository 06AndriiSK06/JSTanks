# JSTanks — Lab 06: TypeScript: Types for the Protocol, the Simulation, and Both Sides of the Wire

![JSTanks Two-Player Dogfight](docs/gameplay-lab05.gif)

Повністю типізована мультиплеєрна 2D-гра (`npm workspaces`: `shared/`, `server/`, `client/`) під суворим режимом компілятора TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`). Єдине джерело істини для мережевого протоколу на базі **Zod** (`z.infer`), бінарний протокол `DataView` (little-endian), брендовані ідентифікатори (`EntityId`, `Tick`, `Seq`, `OwnerSlot`), імутабельний `Vector2` (`readonly`) та 100% збережений детермінізм симуляції з Lab 05.

## Перевірка типів, тести та запуск

```bash
npm install
npm run typecheck   # tsc --noEmit у shared, server та client (0 помилок, 0 any)
npm test            # тести детермінізму, Zod-валідації та бінарного DataView
npm run build       # продакшн-збірка клієнта

# Режим розробки (два термінали):
npm run dev:server  # node --import tsx --env-file=.env --watch src/index.ts
npm run dev:client  # vite
```

CI перевірка типів налаштована у `.github/workflows/typecheck.yml` (`npm ci && npm run typecheck`).

---

## Що знайшов TypeScript під час міграції («What TypeScript found»)

1. **Неперевірений доступ за індексом масиву (`noUncheckedIndexedAccess`):** у `predictor.ts` звернення до буфера знімків `this.snapshotBuffer[0]` та `this.snapshotBuffer[i + 1]` мало потенційний тип `BufferedSnapshot | undefined`. Без явної перевірки `if (!firstSnap || !lastSnap)` доступ до `.receivedAt` міг спричинити `TypeError` при порожньому буфері на старті сесії.
2. **Небезпечна мутація полів `Vector2`:** у старому JS-коді `breakDeterminism` змінював координати напряму (`this.localShip.pos.x += ...`). Після додавання модифікатора `readonly x: number; readonly y: number` у `Vector2` компілятор заборонив приховану мутацію і змусив створювати новий екземпляр `new Vector2(...)`.
3. **Неперевірений результат `document.querySelector` / `getElementById`:** при роботі з DOM (`#game`, `#lobby-player-name`) суворий `strictNullChecks` виявив, що елемент може бути `null` або базовим `HTMLElement` без властивості `.value`, тому додано безпечні перевірки `instanceof HTMLCanvasElement` та дженерики `querySelector<HTMLInputElement>(...)`.
4. **Типізація помилок у блоках `catch (err: unknown)`:** замість неявного `any` у `catch` довелося явно звужувати тип через `err instanceof Error` та `err instanceof DOMException` перед читанням `.name` та `.message` у `loader.ts`, `lobby.ts` і `ws.ts`.
5. **Вичерпна перевірка всіх варіантів сутностей та повідомлень (`never`):** при розборі `SnapshotEntity` та `ClientMessage` додавання `const _exhaustive: never = msg` у `default`-гілку `switch` гарантує на етапі компіляції, що жоден новий тип повідомлення чи сутності не залишиться без обробника.

---

## Три найцікавіші типи в проєкті (простими словами)

### 1. Branded-типи для ідентифікаторів (`EntityId`, `Tick`, `Seq`, `OwnerSlot`)

```ts
export type EntityId = number & { readonly __brand: "EntityId" };
export type Tick = number & { readonly __brand: "Tick" };
export type Seq = number & { readonly __brand: "Seq" };
```

**Простими словами:** У звичайному JS і номер тіку сервера (`Tick`), і номер команди гравця (`Seq`), і ID танка (`EntityId`) — це просто числа (`number`). Можна випадково передати `tick` замість `seq` у `toSnapshot(tick)` — і програма мовчки зламає звірку координат. Branded-тип додає до числа віртуальну «бірку» (`__brand`), яка існує лише під час перевірки компілятором (у рантаймі це звичайне число без жодних накладних витрат), тому переплутати їх тепер неможливо.

### 2. Дискриміновані об'єднання з вичерпним `switch` (`ClientMessage` та `SnapshotEntity`)

```ts
export type SnapshotEntity =
  | ShipSnapshotEntity // { kind: "ship"; ... }
  | BulletSnapshotEntity // { kind: "bullet"; ... }
  | AsteroidSnapshotEntity // { kind: "asteroid"; ... }
  | PickupSnapshotEntity; // { kind: "pickup"; ... }
```

**Простими словами:** Усі варіанти сутностей мають спільне поле-мітку `kind` з точним літеральним значенням. Коли ми пишемо `switch (entity.kind)`, TypeScript автоматично розуміє, які саме поля доступні в кожній гілці `case`, а рядок `const _exhaustive: never = entity;` у `default` змусить компілятор видати помилку, якщо ми колись додамо новий вид сутності (наприклад, `"mine"`), але забудемо додати її рендер.

### 3. Узагальнена типізована шина подій (`Bus<E extends Record<string, unknown>>`)

```ts
export class Bus<E extends Record<string, unknown>> {
  on<K extends keyof E>(name: K, fn: (payload: E[K]) => void): () => void { ... }
  emit<K extends keyof E>(name: K, payload: E[K]): void { ... }
}
```

**Простими словами:** `E` — це словник усіх подій модуля (наприклад, `{ chat: { name: string; text: string }; roster: { players: ... } }`). Конструкція `K extends keyof E` обмежує назву події лише існуючими ключами словника, а `E[K]` автоматично підставляє точний тип даних для цієї події. Якщо спробувати відправити подію `"chat"` із полем `count: 5` замість `text: "..."`, компілятор одразу зупинить збірку.

---

## Архітектурне рішення щодо UI-фреймворку (Lobby, Roster/Chat та HUD)

Для лобі, чату кімнати та діагностичного `Netgraph` ми свідомо залишили **чистий типізований TypeScript без важких UI-фреймворків (React / Vue / Svelte)**, побудувавши реактивні оновлення поверх нашої типізованої шини `Bus<LobbyEvents>` та `Bus<ConnectionEvents>`:

- **Чому не брали фреймворк:** основне навантаження інтерфейсу відбувається на `Canvas 2D` зі швидкістю 60–144 кадрів/с, а поверх нього рендеряться лише 3 компактні панелі (лобі, чат кімнати та Netgraph).
- **Що виграли:** продакшн-бандл клієнта важить лише **~96 KB (~26 KB gzip)** без додаткового runtime-шару Virtual DOM чи реактивних сигналів, час збірки Vite становить **~100 мс**, а підписки через `Bus<E>` дають повну типобезпеку подій без зайвих залежностей.
