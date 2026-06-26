/*
 * Stockfish 18 client for the NGNL SillyTavern extension.
 *
 * Loading order:
 * 1. Local vendored files in ./stockfish/
 * 2. npm CDN fallback (UNPKG)
 *
 * Stockfish.js is GPL-3.0 licensed:
 * https://github.com/nmrugg/stockfish.js
 */

const STOCKFISH_VERSION = '18.0.8';
const ENGINE_FILE = 'stockfish-18-lite-single.js';
const WASM_FILE = 'stockfish-18-lite-single.wasm';

const CDN_BASE = `https://unpkg.com/stockfish@${STOCKFISH_VERSION}/bin`;
const CDN_ENGINE_URL = `${CDN_BASE}/${ENGINE_FILE}`;
const CDN_WASM_URL = `${CDN_BASE}/${WASM_FILE}`;

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
    return Promise.race([
        promise,
        delay(timeoutMs).then(() => {
            throw new Error(message);
        }),
    ]);
}

async function isUsableLocalFile(url, minimumBytes = 100) {
    try {
        const response = await fetch(url, {
            method: 'GET',
            cache: 'no-store',
        });

        if (!response.ok) {
            return false;
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
            return false;
        }

        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength && contentLength < minimumBytes) {
            return false;
        }

        return true;
    } catch {
        return false;
    }
}

export class StockfishClient {
    constructor(options = {}) {
        this.worker = null;
        this.ready = false;
        this.loading = false;
        this.source = '未加载';
        this.onStatus = typeof options.onStatus === 'function'
            ? options.onStatus
            : () => {};

        this.waiters = [];
        this.currentSearch = null;
        this.workerObjectUrl = null;
    }

    setStatus(text) {
        this.onStatus(text);
    }

    async init() {
        if (this.ready && this.worker) {
            return;
        }

        if (this.loading) {
            await this.waitForLine(line => line === 'readyok', 30000);
            return;
        }

        this.loading = true;
        this.setStatus('正在加载 Stockfish 18……');

        try {
            const localEngineUrl = new URL(
                `./stockfish/${ENGINE_FILE}`,
                import.meta.url,
            ).href;

            const localWasmUrl = new URL(
                `./stockfish/${WASM_FILE}`,
                import.meta.url,
            ).href;

            const hasLocalEngine = await isUsableLocalFile(localEngineUrl, 10000);
            const hasLocalWasm = await isUsableLocalFile(localWasmUrl, 1000000);

            if (hasLocalEngine && hasLocalWasm) {
                this.source = '本地 Stockfish 18';
                this.worker = new Worker(localEngineUrl);
            } else {
                this.source = '在线加载 Stockfish 18';
                this.worker = await this.createCdnWorker();
            }

            this.bindWorker();

            this.send('uci');
            await this.waitForLine(line => line === 'uciok', 30000);

            this.send('setoption name Threads value 1');
            this.send('setoption name Hash value 64');
            this.send('setoption name Skill Level value 20');
            this.send('setoption name UCI_LimitStrength value false');
            this.send('setoption name Ponder value false');
            this.send('isready');

            await this.waitForLine(line => line === 'readyok', 30000);

            this.ready = true;
            this.loading = false;
            this.setStatus(`${this.source} 已就绪`);
        } catch (error) {
            this.loading = false;
            this.ready = false;
            this.dispose();
            this.setStatus(`Stockfish 加载失败：${error.message}`);
            throw error;
        }
    }

    async createCdnWorker() {
        const response = await fetch(CDN_ENGINE_URL, {
            cache: 'force-cache',
        });

        if (!response.ok) {
            throw new Error(`无法下载 Stockfish 脚本（HTTP ${response.status}）`);
        }

        let source = await response.text();

        if (!source.includes(WASM_FILE)) {
            throw new Error('Stockfish 脚本格式不符合预期');
        }

        source = source.replaceAll(WASM_FILE, CDN_WASM_URL);

        const blob = new Blob([source], {
            type: 'text/javascript;charset=utf-8',
        });

        this.workerObjectUrl = URL.createObjectURL(blob);
        return new Worker(this.workerObjectUrl);
    }

    bindWorker() {
        if (!this.worker) {
            return;
        }

        this.worker.addEventListener('message', event => {
            const line = String(event.data || '').trim();
            if (!line) {
                return;
            }

            for (const waiter of [...this.waiters]) {
                if (!waiter.predicate(line)) {
                    continue;
                }

                this.waiters.splice(this.waiters.indexOf(waiter), 1);
                clearTimeout(waiter.timeout);
                waiter.resolve(line);
            }

            if (line.startsWith('bestmove ') && this.currentSearch) {
                const match = line.match(/^bestmove\s+(\S+)/);
                const move = match?.[1] || null;
                const search = this.currentSearch;
                this.currentSearch = null;
                clearTimeout(search.timeout);

                if (!move || move === '(none)' || move === '0000') {
                    search.resolve(null);
                } else {
                    search.resolve(move);
                }
            }
        });

        this.worker.addEventListener('error', event => {
            const message = event.message || 'Stockfish Worker 运行失败';
            this.rejectAll(new Error(message));
            this.ready = false;
            this.setStatus(message);
        });

        this.worker.addEventListener('messageerror', () => {
            const error = new Error('Stockfish 返回了无法读取的数据');
            this.rejectAll(error);
            this.ready = false;
            this.setStatus(error.message);
        });
    }

    waitForLine(predicate, timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            const waiter = {
                predicate,
                resolve,
                reject,
                timeout: null,
            };

            waiter.timeout = setTimeout(() => {
                const index = this.waiters.indexOf(waiter);
                if (index >= 0) {
                    this.waiters.splice(index, 1);
                }
                reject(new Error('等待 Stockfish 响应超时'));
            }, timeoutMs);

            this.waiters.push(waiter);
        });
    }

    send(command) {
        if (!this.worker) {
            throw new Error('Stockfish 尚未启动');
        }

        this.worker.postMessage(command);
    }

    async bestMove(fen, options = {}) {
        await this.init();

        if (this.currentSearch) {
            this.stop();
            await delay(30);
        }

        const moveTime = Math.max(
            500,
            Math.min(30000, Number(options.moveTime) || 3000),
        );

        this.send('ucinewgame');
        this.send(`position fen ${fen}`);
        this.send(`go movetime ${moveTime}`);

        return withTimeout(
            new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.currentSearch = null;
                    try {
                        this.send('stop');
                    } catch {
                        // Worker may already be unavailable.
                    }
                    reject(new Error('Stockfish 思考超时'));
                }, moveTime + 12000);

                this.currentSearch = {
                    resolve,
                    reject,
                    timeout,
                };
            }),
            moveTime + 15000,
            'Stockfish 思考超时',
        );
    }

    stop() {
        if (!this.worker) {
            return;
        }

        try {
            this.send('stop');
        } catch {
            // Ignore shutdown races.
        }
    }

    rejectAll(error) {
        for (const waiter of this.waiters) {
            clearTimeout(waiter.timeout);
            waiter.reject(error);
        }
        this.waiters = [];

        if (this.currentSearch) {
            clearTimeout(this.currentSearch.timeout);
            this.currentSearch.reject(error);
            this.currentSearch = null;
        }
    }

    dispose() {
        this.rejectAll(new Error('Stockfish 已关闭'));

        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }

        if (this.workerObjectUrl) {
            URL.revokeObjectURL(this.workerObjectUrl);
            this.workerObjectUrl = null;
        }

        this.ready = false;
        this.loading = false;
        this.source = '未加载';
    }
}
