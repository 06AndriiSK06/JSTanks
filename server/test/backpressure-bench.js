import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

const tmpDir = path.resolve(import.meta.dirname, "../logs/bench-tmp");
await mkdir(tmpDir, { recursive: true });
const bigLogPath = path.join(tmpDir, "synthetic-200mb.ndjson");

// 1. Генеруємо ~200 МБ синтетичного NDJSON-файлу через pipeline
const targetBytes = 200 * 1024 * 1024;
const sampleLine = `${JSON.stringify({
	t: Date.now(),
	roomId: "iron-fortress",
	type: "chat",
	playerId: "p-1024",
	name: "Andrii",
	text: "Telemetry payload check for stream backpressure verification across slow TCP consumer",
})}\n`;
const lineBuf = Buffer.from(sampleLine, "utf8");
const totalLines = Math.ceil(targetBytes / lineBuf.length);

async function* generateLines() {
	for (let i = 0; i < totalLines; i += 1) {
		yield lineBuf;
	}
}

console.log("Generating ~200 MB synthetic NDJSON replay log...");
await pipeline(generateLines(), createWriteStream(bigLogPath));
const fileStat = await stat(bigLogPath);
console.log(
	`Generated file size: ${(fileStat.size / (1024 * 1024)).toFixed(1)} MB`,
);

// 2. Піднімаємо HTTP-сервер, що віддає файл через pipeline(createReadStream, res)
const server = http.createServer(async (_req, res) => {
	res.writeHead(200, { "Content-Type": "application/x-ndjson" });
	await pipeline(createReadStream(bigLogPath), res);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

// 3. Повільний споживач (throttle ~40 MB/s), який заміряє RSS сервера кожні 400 мс
const rssSamples = [];
const sampler = setInterval(() => {
	const rssMb = process.memoryUsage().rss / (1024 * 1024);
	rssSamples.push({
		sec: (rssSamples.length * 0.4).toFixed(1),
		rssMb: Number(rssMb.toFixed(1)),
	});
}, 400);

await new Promise((resolve, reject) => {
	http
		.get(`http://127.0.0.1:${port}/replay`, async (res) => {
			const slowSink = new Writable({
				write(chunk, _enc, cb) {
					// Імітація повільного каналу: 1 мс затримки на кожен чанк 64 КБ (~64 МБ/с)
					setTimeout(cb, 1);
				},
			});
			try {
				await pipeline(res, slowSink);
				resolve();
			} catch (err) {
				reject(err);
			}
		})
		.on("error", reject);
});

clearInterval(sampler);
await new Promise((resolve) => server.close(resolve));
await rm(tmpDir, { recursive: true, force: true });

console.log(
	"\n=== RSS Memory Samples (200 MB stream over throttled consumer) ===",
);
console.table(rssSamples);
const minRss = Math.min(...rssSamples.map((s) => s.rssMb));
const maxRss = Math.max(...rssSamples.map((s) => s.rssMb));
console.log(
	`Min RSS: ${minRss} MB | Max RSS: ${maxRss} MB | Delta: ${(maxRss - minRss).toFixed(1)} MB`,
);
