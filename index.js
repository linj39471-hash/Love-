import {
    ChessGame,
    chooseAIMove,
    squareToName,
    COLORS,
} from './engine.js';

import {
    StockfishClient,
} from './stockfish-client.js';

const MODULE_NAME = 'ngnl_stockfish_chess';
const META_KEY = 'ngnl_stockfish_chess_game';
const SAVE_VERSION = 1;

const PIECE_GLYPHS = Object.freeze({
    wK: '♔',
    wQ: '♕',
    wR: '♖',
    wB: '♗',
    wN: '♘',
    wP: '♙',
    bK: '♚',
    bQ: '♛',
    bR: '♜',
    bB: '♝',
    bN: '♞',
    bP: '♟',
});

const THINKING_LEVELS = Object.freeze({
    strong: {
        label: '高强度',
        moveTime: 2000,
    },
    demon: {
        label: '魔王强度',
        moveTime: 5000,
    },
    god: {
        label: '游戏之神',
        moveTime: 10000,
    },
});

const TET_LINES = Object.freeze({
    start: [
        '“没有魔法，没有隐藏规则。来下一盘最普通的国际象棋吧，空白。”',
        '“这次只比棋力。Aschente。”',
    ],
    normal: [
        '“嗯，这一步很像你们会选的答案。”',
        '“继续吧。棋盘还没有失去乐趣。”',
        '“只要规则公平，输赢就会变得格外漂亮。”',
        '“你们看到的是现在，而我正在等后面的局面。”',
    ],
    check: [
        '“将军。现在轮到你们证明‘空白’不会输啦。”',
        '“王已经被盯上了哦。”',
    ],
    capture: [
        '“这枚棋子，我就收下了。”',
        '“交换成立。问题是——你真的赚到了吗？”',
    ],
    win: [
        '“将死。游戏结束，这一局是我的胜利。”',
    ],
    lose: [
        '“我输了。真好——这才叫游戏嘛！”',
    ],
    draw: [
        '“和棋吗？看来下一局还得继续。”',
    ],
});

let game = new ChessGame();
let stateStack = [game.serialize()];
let selectedSquare = null;
let legalTargets = [];
let lastMove = null;
let thinking = false;
let initialized = false;
let saveTimer = null;
let aiTimer = null;
let ui = {};

const stockfish = new StockfishClient({
    onStatus: text => {
        if (ui.engineStatus) {
            ui.engineStatus.textContent = text;
        }
    },
});

function context() {
    return globalThis.SillyTavern?.getContext?.();
}

function defaultSettings() {
    return {
        panelOpen: false,
        minimized: false,
        flipped: false,
        thinkingLevel: 'demon',
        sound: false,
        panelLeft: null,
        panelTop: null,
        panelWidth: 760,
        panelHeight: 720,
    };
}

function getSettings() {
    const ctx = context();

    if (!ctx) {
        return defaultSettings();
    }

    const {
        extensionSettings,
    } = ctx;

    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = defaultSettings();
    }

    const settings = extensionSettings[MODULE_NAME];

    for (const [key, value] of Object.entries(defaultSettings())) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = value;
        }
    }

    return settings;
}

function saveSettings() {
    try {
        context()?.saveSettingsDebounced?.();
    } catch (error) {
        console.warn('[NGNL Stockfish Chess] 设置保存失败：', error);
    }
}

function hasActiveChat() {
    const ctx = context();

    return Boolean(
        ctx
        && (
            Number.isInteger(ctx.characterId)
            || Boolean(ctx.groupId)
        )
    );
}

function currentMetadata() {
    return context()?.chatMetadata || null;
}

function buildSavePayload() {
    return {
        version: SAVE_VERSION,
        game: game.serialize(),
        stateStack,
        lastMove,
    };
}

function scheduleSave() {
    clearTimeout(saveTimer);

    saveTimer = setTimeout(async () => {
        const metadata = currentMetadata();

        if (!metadata) {
            return;
        }

        metadata[META_KEY] = buildSavePayload();

        try {
            await context()?.saveMetadata?.();
        } catch (error) {
            console.warn('[NGNL Stockfish Chess] 棋局保存失败：', error);
        }
    }, 180);
}

function loadCurrentChatGame() {
    cancelPendingAI();

    const payload = currentMetadata()?.[META_KEY];

    try {
        game = payload?.game
            ? new ChessGame(payload.game)
            : new ChessGame();

        stateStack = Array.isArray(payload?.stateStack)
            && payload.stateStack.length
            ? payload.stateStack
            : [game.serialize()];

        lastMove = payload?.lastMove || null;
    } catch (error) {
        console.warn('[NGNL Stockfish Chess] 存档无效，已重置：', error);
        game = new ChessGame();
        stateStack = [game.serialize()];
        lastMove = null;
    }

    selectedSquare = null;
    legalTargets = [];
    thinking = false;

    renderAll();

    if (game.turn === COLORS.BLACK && !game.status().over) {
        queueTetMove(450);
    }
}

function pushState() {
    stateStack.push(game.serialize());

    if (stateStack.length > 500) {
        stateStack = stateStack.slice(-500);
    }
}

function createUI() {
    if (document.getElementById('ngnl-stockfish-launcher')) {
        return;
    }

    const launcher = document.createElement('button');
    launcher.id = 'ngnl-stockfish-launcher';
    launcher.type = 'button';
    launcher.title = '打开：空白 VS 特图国际象棋';
    launcher.setAttribute('aria-label', '打开游戏人生国际象棋');
    launcher.innerHTML = `
        <span class="ngnl-launcher-piece" aria-hidden="true">♟</span>
        <span class="ngnl-launcher-ring" aria-hidden="true"></span>
    `;

    const panel = document.createElement('section');
    panel.id = 'ngnl-stockfish-panel';
    panel.setAttribute('aria-label', '空白对战特图国际象棋');

    panel.innerHTML = `
        <header id="ngnl-stockfish-dragbar" class="ngnl-chess-header">
            <div class="ngnl-title-group">
                <div class="ngnl-title-emblem">♛</div>

                <div>
                    <div class="ngnl-main-title">
                        『　』空白
                        <span>VS</span>
                        特图
                    </div>

                    <div class="ngnl-sub-title">
                        STANDARD CHESS · STOCKFISH 18
                    </div>
                </div>
            </div>

            <div class="ngnl-window-buttons">
                <button id="ngnl-stockfish-minimize" type="button" title="缩小">
                    —
                </button>

                <button id="ngnl-stockfish-close" type="button" title="关闭">
                    ×
                </button>
            </div>
        </header>

        <div class="ngnl-chess-body">
            <main class="ngnl-board-area">
                <div id="ngnl-black-player" class="ngnl-player-card ngnl-black-player">
                    <div class="ngnl-player-avatar ngnl-tet-avatar">
                        T
                    </div>

                    <div class="ngnl-player-info">
                        <strong>特图</strong>
                        <span>黑方 · Stockfish AI</span>
                    </div>

                    <div class="ngnl-turn-light"></div>
                </div>

                <div class="ngnl-board-frame">
                    <div
                        id="ngnl-stockfish-board"
                        class="ngnl-chess-board"
                        role="grid"
                        aria-label="国际象棋棋盘"
                    ></div>

                    <div id="ngnl-thinking-mask" class="ngnl-thinking-mask">
                        <div class="ngnl-thinking-orbit"></div>
                        <strong>特图正在思考</strong>
                        <span>Stockfish 正在计算最佳棋步……</span>
                    </div>
                </div>

                <div id="ngnl-white-player" class="ngnl-player-card ngnl-white-player">
                    <div class="ngnl-player-avatar ngnl-blank-avatar">
                        『 』
                    </div>

                    <div class="ngnl-player-info">
                        <strong>你（空白）</strong>
                        <span>白方 · 点击棋子进行操作</span>
                    </div>

                    <div class="ngnl-turn-light"></div>
                </div>
            </main>

            <aside class="ngnl-side-area">
                <section class="ngnl-status-card">
                    <div class="ngnl-section-kicker">
                        CURRENT MATCH
                    </div>

                    <div id="ngnl-game-status" class="ngnl-game-status">
                        空白行动
                    </div>

                    <div class="ngnl-status-grid">
                        <span>回合</span>
                        <b id="ngnl-fullmove">1</b>

                        <span>行动方</span>
                        <b id="ngnl-turn-text">空白</b>

                        <span>局面</span>
                        <b id="ngnl-check-text">正常</b>
                    </div>
                </section>

                <section class="ngnl-engine-card">
                    <div class="ngnl-card-title">
                        特图的棋力核心
                    </div>

                    <div id="ngnl-engine-status" class="ngnl-engine-status">
                        尚未加载 Stockfish
                    </div>

                    <label class="ngnl-field-row" for="ngnl-thinking-level">
                        <span>思考强度</span>

                        <select id="ngnl-thinking-level">
                            <option value="strong">高强度 · 2秒</option>
                            <option value="demon">魔王强度 · 5秒</option>
                            <option value="god">游戏之神 · 10秒</option>
                        </select>
                    </label>

                    <button id="ngnl-test-engine" type="button" class="ngnl-secondary-button">
                        测试 Stockfish
                    </button>
                </section>

                <section class="ngnl-control-card">
                    <div class="ngnl-control-grid">
                        <button id="ngnl-new-game" type="button" class="ngnl-primary-button">
                            新棋局
                        </button>

                        <button id="ngnl-undo" type="button">
                            悔棋
                        </button>

                        <button id="ngnl-flip-board" type="button">
                            翻转
                        </button>

                        <button id="ngnl-copy-position" type="button">
                            复制局面
                        </button>

                        <button id="ngnl-export-pgn" type="button">
                            导出棋谱
                        </button>
                    </div>
                </section>

                <section class="ngnl-dialogue-card">
                    <div class="ngnl-card-title">
                        特图
                    </div>

                    <div id="ngnl-tet-dialogue" class="ngnl-tet-dialogue">
                        “没有魔法，没有隐藏规则。来下一盘最普通的国际象棋吧，空白。”
                    </div>
                </section>

                <section class="ngnl-history-card">
                    <div class="ngnl-card-title">
                        棋谱
                    </div>

                    <div id="ngnl-move-history" class="ngnl-move-history"></div>
                </section>
            </aside>
        </div>

        <div id="ngnl-promotion-dialog" class="ngnl-promotion-dialog" hidden>
            <div class="ngnl-promotion-box">
                <strong>兵升变</strong>
                <span>请选择升变棋子</span>

                <div class="ngnl-promotion-options">
                    <button type="button" data-promotion="Q">♕</button>
                    <button type="button" data-promotion="R">♖</button>
                    <button type="button" data-promotion="B">♗</button>
                    <button type="button" data-promotion="N">♘</button>
                </div>
            </div>
        </div>
    `;

    document.body.append(launcher, panel);

    ui = {
        launcher,
        panel,
        dragbar: panel.querySelector('#ngnl-stockfish-dragbar'),
        minimize: panel.querySelector('#ngnl-stockfish-minimize'),
        close: panel.querySelector('#ngnl-stockfish-close'),
        board: panel.querySelector('#ngnl-stockfish-board'),
        thinkingMask: panel.querySelector('#ngnl-thinking-mask'),
        blackPlayer: panel.querySelector('#ngnl-black-player'),
        whitePlayer: panel.querySelector('#ngnl-white-player'),
        gameStatus: panel.querySelector('#ngnl-game-status'),
        fullmove: panel.querySelector('#ngnl-fullmove'),
        turnText: panel.querySelector('#ngnl-turn-text'),
        checkText: panel.querySelector('#ngnl-check-text'),
        engineStatus: panel.querySelector('#ngnl-engine-status'),
        thinkingLevel: panel.querySelector('#ngnl-thinking-level'),
        testEngine: panel.querySelector('#ngnl-test-engine'),
        newGame: panel.querySelector('#ngnl-new-game'),
        undo: panel.querySelector('#ngnl-undo'),
        flipBoard: panel.querySelector('#ngnl-flip-board'),
        copyPosition: panel.querySelector('#ngnl-copy-position'),
        exportPgn: panel.querySelector('#ngnl-export-pgn'),
        tetDialogue: panel.querySelector('#ngnl-tet-dialogue'),
        moveHistory: panel.querySelector('#ngnl-move-history'),
        promotionDialog: panel.querySelector('#ngnl-promotion-dialog'),
    };

    bindUIEvents();
    applyStoredSettings();
    renderAll();
}

function bindUIEvents() {
    ui.launcher.addEventListener('click', () => {
        setPanelOpen(true);
    });

    ui.close.addEventListener('click', () => {
        setPanelOpen(false);
    });

    ui.minimize.addEventListener('click', toggleMinimized);
    ui.board.addEventListener('click', handleBoardClick);
    ui.newGame.addEventListener('click', resetGame);
    ui.undo.addEventListener('click', undoTurn);
    ui.flipBoard.addEventListener('click', flipBoard);
    ui.copyPosition.addEventListener('click', copyPosition);
    ui.exportPgn.addEventListener('click', exportPgn);
    ui.testEngine.addEventListener('click', testEngine);

    ui.thinkingLevel.addEventListener('change', () => {
        const settings = getSettings();
        settings.thinkingLevel = ui.thinkingLevel.value;
        saveSettings();
    });

    ui.promotionDialog.addEventListener('click', event => {
        if (event.target === ui.promotionDialog) {
            closePromotionDialog();
        }
    });

    bindDragging();
    bindResizeSaving();
}

function applyStoredSettings() {
    const settings = getSettings();

    ui.thinkingLevel.value = THINKING_LEVELS[settings.thinkingLevel]
        ? settings.thinkingLevel
        : 'demon';

    ui.panel.classList.toggle(
        'ngnl-minimized',
        Boolean(settings.minimized),
    );

    ui.minimize.textContent = settings.minimized ? '□' : '—';

    if (Number.isFinite(settings.panelWidth)) {
        ui.panel.style.width = `${settings.panelWidth}px`;
    }

    if (Number.isFinite(settings.panelHeight)) {
        ui.panel.style.height = `${settings.panelHeight}px`;
    }

    if (
        Number.isFinite(settings.panelLeft)
        && Number.isFinite(settings.panelTop)
    ) {
        ui.panel.style.left = `${settings.panelLeft}px`;
        ui.panel.style.top = `${settings.panelTop}px`;
        ui.panel.style.right = 'auto';
        ui.panel.style.bottom = 'auto';
    }

    setPanelOpen(Boolean(settings.panelOpen), false);
}

function setPanelOpen(open, persist = true) {
    const settings = getSettings();
    settings.panelOpen = Boolean(open);

    ui.panel.classList.toggle('ngnl-open', Boolean(open));
    ui.launcher.classList.toggle('ngnl-hidden', Boolean(open));

    if (persist) {
        saveSettings();
    }

    if (open && !stockfish.ready && !stockfish.loading) {
        stockfish.init().catch(error => {
            console.warn('[NGNL Stockfish Chess] Stockfish 预加载失败：', error);
        });
    }
}

function toggleMinimized() {
    const settings = getSettings();
    settings.minimized = !settings.minimized;

    ui.panel.classList.toggle('ngnl-minimized', settings.minimized);
    ui.minimize.textContent = settings.minimized ? '□' : '—';

    saveSettings();
}

function bindDragging() {
    let dragState = null;

    ui.dragbar.addEventListener('pointerdown', event => {
        if (event.target.closest('button')) {
            return;
        }

        const rect = ui.panel.getBoundingClientRect();

        dragState = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            left: rect.left,
            top: rect.top,
        };

        ui.dragbar.setPointerCapture(event.pointerId);
        ui.panel.classList.add('ngnl-dragging');
    });

    ui.dragbar.addEventListener('pointermove', event => {
        if (!dragState) {
            return;
        }

        const maxLeft = Math.max(
            0,
            window.innerWidth - Math.min(ui.panel.offsetWidth, window.innerWidth),
        );

        const maxTop = Math.max(
            0,
            window.innerHeight - 54,
        );

        const left = Math.max(
            0,
            Math.min(
                maxLeft,
                dragState.left + event.clientX - dragState.pointerX,
            ),
        );

        const top = Math.max(
            0,
            Math.min(
                maxTop,
                dragState.top + event.clientY - dragState.pointerY,
            ),
        );

        ui.panel.style.left = `${left}px`;
        ui.panel.style.top = `${top}px`;
        ui.panel.style.right = 'auto';
        ui.panel.style.bottom = 'auto';
    });

    const finishDrag = event => {
        if (!dragState) {
            return;
        }

        dragState = null;
        ui.panel.classList.remove('ngnl-dragging');

        if (ui.dragbar.hasPointerCapture(event.pointerId)) {
            ui.dragbar.releasePointerCapture(event.pointerId);
        }

        persistPanelGeometry();
    };

    ui.dragbar.addEventListener('pointerup', finishDrag);
    ui.dragbar.addEventListener('pointercancel', finishDrag);
}

function bindResizeSaving() {
    if (typeof ResizeObserver !== 'function') {
        return;
    }

    const observer = new ResizeObserver(() => {
        clearTimeout(ui.resizeTimer);
        ui.resizeTimer = setTimeout(persistPanelGeometry, 180);
    });

    observer.observe(ui.panel);
}

function persistPanelGeometry() {
    if (window.innerWidth <= 760) {
        return;
    }

    const rect = ui.panel.getBoundingClientRect();
    const settings = getSettings();

    settings.panelLeft = Math.round(rect.left);
    settings.panelTop = Math.round(rect.top);
    settings.panelWidth = Math.round(rect.width);
    settings.panelHeight = Math.round(rect.height);

    saveSettings();
}

function boardOrder() {
    const squares = Array.from(
        {
            length: 64,
        },
        (_, index) => index,
    );

    return getSettings().flipped
        ? squares.reverse()
        : squares;
}

function legalMovesFrom(square) {
    if (game.turn !== COLORS.WHITE) {
        return [];
    }

    return game.legalMoves(COLORS.WHITE).filter(move => move.from === square);
}

function renderBoard() {
    if (!ui.board) {
        return;
    }

    ui.board.textContent = '';

    const order = boardOrder();
    const checkedKing = game.inCheck(game.turn)
        ? game.kingSquare(game.turn)
        : -1;

    const targetMap = new Map();

    for (const move of legalTargets) {
        if (!targetMap.has(move.to)) {
            targetMap.set(move.to, []);
        }

        targetMap.get(move.to).push(move);
    }

    for (let visualIndex = 0; visualIndex < order.length; visualIndex += 1) {
        const square = order[visualIndex];
        const row = Math.floor(square / 8);
        const col = square % 8;
        const piece = game.pieceAt(square);
        const targetMoves = targetMap.get(square) || [];

        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `ngnl-square ${(row + col) % 2 ? 'ngnl-dark' : 'ngnl-light'}`;
        cell.dataset.square = String(square);
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute(
            'aria-label',
            `${squareToName(square)}${piece ? ` ${piece}` : ''}`,
        );

        if (
            lastMove
            && (
                square === lastMove.from
                || square === lastMove.to
            )
        ) {
            cell.classList.add('ngnl-last-move');
        }

        if (square === checkedKing) {
            cell.classList.add('ngnl-check-square');
        }

        if (square === selectedSquare) {
            cell.classList.add('ngnl-selected-square');
        }

        if (targetMoves.length) {
            const capture = targetMoves.some(move => {
                return Boolean(move.captured || move.enPassant);
            });

            cell.classList.add(
                capture
                    ? 'ngnl-capture-target'
                    : 'ngnl-move-target',
            );
        }

        if (piece) {
            const pieceElement = document.createElement('span');
            pieceElement.className = [
                'ngnl-piece',
                piece[0] === COLORS.WHITE
                    ? 'ngnl-white-piece'
                    : 'ngnl-black-piece',
            ].join(' ');

            pieceElement.textContent = PIECE_GLYPHS[piece];
            cell.append(pieceElement);
        }

        const visualRow = Math.floor(visualIndex / 8);
        const visualCol = visualIndex % 8;

        if (visualCol === 0) {
            const rank = document.createElement('small');
            rank.className = 'ngnl-rank-label';
            rank.textContent = squareToName(square)[1];
            cell.append(rank);
        }

        if (visualRow === 7) {
            const file = document.createElement('small');
            file.className = 'ngnl-file-label';
            file.textContent = squareToName(square)[0];
            cell.append(file);
        }

        ui.board.append(cell);
    }
}

function renderStatus() {
    if (!ui.gameStatus) {
        return;
    }

    const status = game.status();
    const whiteTurn = game.turn === COLORS.WHITE;

    ui.fullmove.textContent = String(game.fullmove);
    ui.turnText.textContent = whiteTurn ? '空白' : '特图';
    ui.checkText.textContent = status.over
        ? status.text
        : status.type === 'check'
            ? '将军'
            : '正常';

    if (thinking) {
        ui.gameStatus.textContent = '特图正在思考……';
    } else {
        ui.gameStatus.textContent = status.text;
    }

    ui.gameStatus.classList.toggle('ngnl-game-over', status.over);
    ui.whitePlayer.classList.toggle(
        'ngnl-active-player',
        !status.over && whiteTurn && !thinking,
    );

    ui.blackPlayer.classList.toggle(
        'ngnl-active-player',
        !status.over && !whiteTurn,
    );

    ui.thinkingMask.classList.toggle('ngnl-visible', thinking);

    ui.undo.disabled = thinking || stateStack.length <= 1;
    ui.newGame.disabled = thinking;
    ui.thinkingLevel.disabled = thinking;
}

function renderHistory() {
    if (!ui.moveHistory) {
        return;
    }

    ui.moveHistory.textContent = '';

    if (!game.moveLog.length) {
        const empty = document.createElement('div');
        empty.className = 'ngnl-history-empty';
        empty.textContent = '棋局尚未开始';
        ui.moveHistory.append(empty);
        return;
    }

    for (let index = 0; index < game.moveLog.length; index += 2) {
        const row = document.createElement('div');
        row.className = 'ngnl-history-row';

        const number = document.createElement('span');
        number.className = 'ngnl-history-number';
        number.textContent = `${Math.floor(index / 2) + 1}.`;

        const whiteMove = document.createElement('span');
        whiteMove.textContent = game.moveLog[index]?.san || '';

        const blackMove = document.createElement('span');
        blackMove.textContent = game.moveLog[index + 1]?.san || '';

        row.append(number, whiteMove, blackMove);
        ui.moveHistory.append(row);
    }

    ui.moveHistory.scrollTop = ui.moveHistory.scrollHeight;
}

function renderAll() {
    renderBoard();
    renderStatus();
    renderHistory();
}

function handleBoardClick(event) {
    const cell = event.target.closest('.ngnl-square');

    if (!cell || thinking || game.status().over) {
        return;
    }

    if (game.turn !== COLORS.WHITE) {
        toast('现在是特图的回合。', 'info');
        return;
    }

    const square = Number(cell.dataset.square);
    const piece = game.pieceAt(square);

    if (selectedSquare === null) {
        if (!piece || piece[0] !== COLORS.WHITE) {
            return;
        }

        selectedSquare = square;
        legalTargets = legalMovesFrom(square);
        renderBoard();
        return;
    }

    if (piece?.[0] === COLORS.WHITE) {
        selectedSquare = square;
        legalTargets = legalMovesFrom(square);
        renderBoard();
        return;
    }

    const matchingMoves = legalTargets.filter(move => move.to === square);

    if (!matchingMoves.length) {
        selectedSquare = null;
        legalTargets = [];
        renderBoard();
        return;
    }

    const promotionMoves = matchingMoves.filter(move => move.promotion);

    if (promotionMoves.length) {
        openPromotionDialog(promotionMoves);
        return;
    }

    makePlayerMove(matchingMoves[0]);
}

function openPromotionDialog(moves) {
    ui.promotionDialog.hidden = false;
    ui.promotionDialog.classList.add('ngnl-visible');

    const buttons = ui.promotionDialog.querySelectorAll('[data-promotion]');

    const cleanup = () => {
        for (const button of buttons) {
            button.replaceWith(button.cloneNode(true));
        }
    };

    for (const button of buttons) {
        button.onclick = () => {
            const promotion = button.dataset.promotion;
            const move = moves.find(candidate => candidate.promotion === promotion);
            closePromotionDialog();
            cleanup();

            if (move) {
                makePlayerMove(move);
            }
        };
    }
}

function closePromotionDialog() {
    ui.promotionDialog.classList.remove('ngnl-visible');
    ui.promotionDialog.hidden = true;
}

function makePlayerMove(move) {
    try {
        const result = game.makeMove(move);

        lastMove = {
            from: result.from,
            to: result.to,
            san: result.san,
            uci: result.uci,
        };

        selectedSquare = null;
        legalTargets = [];

        pushState();
        scheduleSave();
        renderAll();

        if (game.status().over) {
            finishGameDialogue();
            return;
        }

        setTetDialogue(randomLine(TET_LINES.normal));
        queueTetMove(420);
    } catch (error) {
        console.error('[NGNL Stockfish Chess] 玩家走棋失败：', error);
        toast(`无法走这一步：${error.message}`, 'error');
    }
}

function queueTetMove(delay = 350) {
    clearTimeout(aiTimer);

    aiTimer = setTimeout(() => {
        makeTetMove();
    }, delay);
}

async function makeTetMove() {
    if (
        thinking
        || game.turn !== COLORS.BLACK
        || game.status().over
    ) {
        return;
    }

    thinking = true;
    renderStatus();

    try {
        const level = THINKING_LEVELS[getSettings().thinkingLevel]
            || THINKING_LEVELS.demon;

        let uciMove = null;
        let usedFallback = false;

        try {
            uciMove = await stockfish.bestMove(
                game.fen(),
                {
                    moveTime: level.moveTime,
                },
            );
        } catch (error) {
            usedFallback = true;
            console.warn(
                '[NGNL Stockfish Chess] Stockfish 不可用，启用备用 AI：',
                error,
            );

            ui.engineStatus.textContent = 'Stockfish 不可用，正在使用备用本地 AI';
        }

        let move = uciMove
            ? findLegalMoveFromUci(uciMove)
            : null;

        if (!move) {
            usedFallback = true;
            move = await chooseAIMove(game, {
                depth: 5,
                timeMs: 2400,
                personality: 'tet',
            });
        }

        if (!move) {
            throw new Error('AI 没有返回合法棋步');
        }

        const result = game.makeMove(move);

        lastMove = {
            from: result.from,
            to: result.to,
            san: result.san,
            uci: result.uci,
        };

        pushState();
        scheduleSave();
        updateTetDialogueForMove(result, usedFallback);
    } catch (error) {
        console.error('[NGNL Stockfish Chess] 特图走棋失败：', error);
        toast(`特图走棋失败：${error.message}`, 'error');
        ui.engineStatus.textContent = `错误：${error.message}`;
    } finally {
        thinking = false;
        renderAll();
    }

    if (game.status().over) {
        finishGameDialogue();
    }
}

function findLegalMoveFromUci(uci) {
    const normalized = String(uci || '').trim().toLowerCase();

    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(normalized)) {
        return null;
    }

    return game.legalMoves(game.turn).find(move => {
        const moveUci = [
            squareToName(move.from),
            squareToName(move.to),
            (move.promotion || '').toLowerCase(),
        ].join('');

        return moveUci === normalized;
    }) || null;
}

function updateTetDialogueForMove(move, usedFallback) {
    if (usedFallback) {
        setTetDialogue('“引擎暂时没有回应？没关系，游戏之神自己也会下棋。”');
        return;
    }

    if (game.status().over) {
        finishGameDialogue();
        return;
    }

    if (game.inCheck(COLORS.WHITE)) {
        setTetDialogue(randomLine(TET_LINES.check));
        return;
    }

    if (move.captured || move.enPassant) {
        setTetDialogue(randomLine(TET_LINES.capture));
        return;
    }

    setTetDialogue(randomLine(TET_LINES.normal));
}

function finishGameDialogue() {
    const status = game.status();

    if (!status.over) {
        return;
    }

    if (status.winner === COLORS.BLACK) {
        setTetDialogue(randomLine(TET_LINES.win));
    } else if (status.winner === COLORS.WHITE) {
        setTetDialogue(randomLine(TET_LINES.lose));
    } else {
        setTetDialogue(randomLine(TET_LINES.draw));
    }
}

function randomLine(lines) {
    return lines[Math.floor(Math.random() * lines.length)];
}

function setTetDialogue(text) {
    if (ui.tetDialogue) {
        ui.tetDialogue.textContent = text;
    }
}

function cancelPendingAI() {
    clearTimeout(aiTimer);
    aiTimer = null;
    stockfish.stop();
    thinking = false;
}

function resetGame() {
    cancelPendingAI();

    game = new ChessGame();
    stateStack = [game.serialize()];
    selectedSquare = null;
    legalTargets = [];
    lastMove = null;

    setTetDialogue(randomLine(TET_LINES.start));
    scheduleSave();
    renderAll();
}

function undoTurn() {
    if (thinking || stateStack.length <= 1) {
        return;
    }

    cancelPendingAI();

    do {
        stateStack.pop();

        if (!stateStack.length) {
            stateStack = [new ChessGame().serialize()];
            break;
        }

        game = new ChessGame(stateStack[stateStack.length - 1]);
    } while (
        game.turn !== COLORS.WHITE
        && stateStack.length > 1
    );

    game = new ChessGame(stateStack[stateStack.length - 1]);
    selectedSquare = null;
    legalTargets = [];

    const lastLog = game.moveLog.at(-1);
    lastMove = lastLog
        ? uciLogToLastMove(lastLog.uci)
        : null;

    setTetDialogue('“悔棋吗？可以呀。游戏的目标本来就是继续玩下去。”');
    scheduleSave();
    renderAll();
}

function uciLogToLastMove(uci) {
    const normalized = String(uci || '').toLowerCase();

    if (!/^[a-h][1-8][a-h][1-8]/.test(normalized)) {
        return null;
    }

    return {
        from: squareNameToIndex(normalized.slice(0, 2)),
        to: squareNameToIndex(normalized.slice(2, 4)),
        uci: normalized,
        san: '',
    };
}

function squareNameToIndex(name) {
    const file = name.charCodeAt(0) - 97;
    const rank = Number(name[1]);
    const row = 8 - rank;
    return row * 8 + file;
}

function flipBoard() {
    const settings = getSettings();
    settings.flipped = !settings.flipped;
    saveSettings();
    renderBoard();
}

async function testEngine() {
    ui.testEngine.disabled = true;
    ui.engineStatus.textContent = '正在测试 Stockfish……';

    try {
        await stockfish.init();
        const move = await stockfish.bestMove(
            new ChessGame().fen(),
            {
                moveTime: 500,
            },
        );

        if (!move) {
            throw new Error('引擎没有返回棋步');
        }

        ui.engineStatus.textContent = `${stockfish.source} 测试成功：${move}`;
        toast('Stockfish 测试成功。', 'success');
    } catch (error) {
        ui.engineStatus.textContent = `测试失败：${error.message}`;
        toast(`Stockfish 测试失败：${error.message}`, 'error');
    } finally {
        ui.testEngine.disabled = false;
    }
}

function positionText() {
    return [
        '【游戏人生｜你（空白）VS 特图】',
        '规则：现实标准国际象棋',
        '白方：你（空白）',
        '黑方：特图（Stockfish 18）',
        `状态：${game.status().text}`,
        `FEN：${game.fen()}`,
        `PGN：${game.pgn() || '尚未走棋'}`,
    ].join('\n');
}

async function copyPosition() {
    const text = positionText();

    try {
        await navigator.clipboard.writeText(text);
    } catch {
        fallbackCopy(text);
    }

    toast('当前棋局已复制。', 'success');
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';

    document.body.append(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}

function exportPgn() {
    const status = game.status();

    const result = status.winner === COLORS.WHITE
        ? '1-0'
        : status.winner === COLORS.BLACK
            ? '0-1'
            : status.over
                ? '1/2-1/2'
                : '*';

    const date = new Date()
        .toISOString()
        .slice(0, 10)
        .replaceAll('-', '.');

    const pgn = [
        '[Event "Blank vs Tet"]',
        '[Site "SillyTavern"]',
        `[Date "${date}"]`,
        '[White "Blank / User"]',
        '[Black "Tet / Stockfish 18"]',
        `[Result "${result}"]`,
        '',
        `${game.pgn()} ${result}`.trim(),
        '',
    ].join('\n');

    const blob = new Blob(
        [pgn],
        {
            type: 'application/x-chess-pgn;charset=utf-8',
        },
    );

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Blank-vs-Tet-${Date.now()}.pgn`;

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => {
        URL.revokeObjectURL(link.href);
    }, 1000);
}

function toast(message, type = 'info') {
    if (globalThis.toastr?.[type]) {
        globalThis.toastr[type](message);
        return;
    }

    console[type === 'error' ? 'error' : 'log'](
        `[NGNL Stockfish Chess] ${message}`,
    );
}

function registerMacro() {
    try {
        const macros = context()?.macros;

        if (!macros?.register) {
            return;
        }

        macros.register('ngnl_chess_state', {
            description: '返回空白与特图当前国际象棋局面。',
            category: macros.category?.UTILITY,
            handler: () => positionText(),
        });
    } catch (error) {
        console.warn('[NGNL Stockfish Chess] 宏注册失败：', error);
    }
}

function bindSillyTavernEvents() {
    const ctx = context();

    if (!ctx?.eventSource || !ctx?.event_types) {
        return;
    }

    ctx.eventSource.on(
        ctx.event_types.CHAT_CHANGED,
        loadCurrentChatGame,
    );
}

function init() {
    if (initialized) {
        return;
    }

    initialized = true;

    createUI();
    registerMacro();
    bindSillyTavernEvents();
    loadCurrentChatGame();

    console.info(
        '[NGNL Stockfish Chess] 空白 VS 特图扩展已加载。',
    );
}

function boot() {
    const ctx = context();

    if (ctx?.eventSource && ctx?.event_types?.APP_READY) {
        ctx.eventSource.on(
            ctx.event_types.APP_READY,
            () => setTimeout(init, 0),
        );
        return;
    }

    if (document.readyState === 'loading') {
        document.addEventListener(
            'DOMContentLoaded',
            init,
            {
                once: true,
            },
        );
        return;
    }

    init();
}

boot();
