/*
 * NGNL Stockfish Chess Rules Engine
 * Dependency-free standard chess rules plus an emergency fallback AI.
 * Board indices: 0 = a8, 63 = h1.
 */

const FILES = 'abcdefgh';
const WHITE = 'w';
const BLACK = 'b';
const MATE_SCORE = 100000;

const PIECE_VALUES = Object.freeze({ P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 });

const KNIGHT_STEPS = Object.freeze([
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
]);
const KING_STEPS = Object.freeze([
    [-1, -1], [-1, 0], [-1, 1], [0, -1],
    [0, 1], [1, -1], [1, 0], [1, 1],
]);
const BISHOP_DIRS = Object.freeze([[-1, -1], [-1, 1], [1, -1], [1, 1]]);
const ROOK_DIRS = Object.freeze([[-1, 0], [1, 0], [0, -1], [0, 1]]);

function opposite(color) {
    return color === WHITE ? BLACK : WHITE;
}

function rowOf(square) {
    return Math.floor(square / 8);
}

function colOf(square) {
    return square % 8;
}

function indexOf(row, col) {
    return row * 8 + col;
}

function inside(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
}

function squareName(square) {
    return `${FILES[colOf(square)]}${8 - rowOf(square)}`;
}

function cloneCastling(castling) {
    return {
        wK: Boolean(castling?.wK),
        wQ: Boolean(castling?.wQ),
        bK: Boolean(castling?.bK),
        bQ: Boolean(castling?.bQ),
    };
}

function initialBoard() {
    return [
        'bR', 'bN', 'bB', 'bQ', 'bK', 'bB', 'bN', 'bR',
        'bP', 'bP', 'bP', 'bP', 'bP', 'bP', 'bP', 'bP',
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null,
        'wP', 'wP', 'wP', 'wP', 'wP', 'wP', 'wP', 'wP',
        'wR', 'wN', 'wB', 'wQ', 'wK', 'wB', 'wN', 'wR',
    ];
}

function normalizeMove(move) {
    return {
        from: Number(move.from),
        to: Number(move.to),
        piece: String(move.piece),
        captured: move.captured ?? null,
        promotion: move.promotion ?? null,
        castle: move.castle ?? null,
        enPassant: Boolean(move.enPassant),
        doublePawn: Boolean(move.doublePawn),
    };
}

export class ChessGame {
    constructor(serialized = null) {
        this.reset();
        if (serialized) {
            this.load(serialized);
        }
    }

    reset() {
        this.board = initialBoard();
        this.turn = WHITE;
        this.castling = { wK: true, wQ: true, bK: true, bQ: true };
        this.epSquare = null;
        this.halfmove = 0;
        this.fullmove = 1;
        this.moveLog = [];
        this.positionHistory = [];
        this.positionHistory.push(this.positionKey());
    }

    load(data) {
        if (!data || !Array.isArray(data.board) || data.board.length !== 64) {
            throw new Error('无效的棋局存档。');
        }
        this.board = data.board.map(piece => piece || null);
        this.turn = data.turn === BLACK ? BLACK : WHITE;
        this.castling = cloneCastling(data.castling);
        this.epSquare = Number.isInteger(data.epSquare) ? data.epSquare : null;
        this.halfmove = Number.isFinite(data.halfmove) ? Math.max(0, data.halfmove) : 0;
        this.fullmove = Number.isFinite(data.fullmove) ? Math.max(1, data.fullmove) : 1;
        this.moveLog = Array.isArray(data.moveLog)
            ? data.moveLog.map(item => ({
                uci: String(item.uci || ''),
                san: String(item.san || item.uci || ''),
                color: item.color === BLACK ? BLACK : WHITE,
            }))
            : [];
        this.positionHistory = Array.isArray(data.positionHistory) && data.positionHistory.length
            ? data.positionHistory.map(String)
            : [this.positionKey()];
    }

    serialize() {
        return {
            board: [...this.board],
            turn: this.turn,
            castling: cloneCastling(this.castling),
            epSquare: this.epSquare,
            halfmove: this.halfmove,
            fullmove: this.fullmove,
            moveLog: this.moveLog.map(item => ({ ...item })),
            positionHistory: [...this.positionHistory],
        };
    }

    clone() {
        return new ChessGame(this.serialize());
    }

    pieceAt(square) {
        return this.board[square] || null;
    }

    kingSquare(color) {
        return this.board.indexOf(`${color}K`);
    }

    isSquareAttacked(square, byColor) {
        const targetRow = rowOf(square);
        const targetCol = colOf(square);

        // Pawns attack diagonally towards their movement direction.
        const pawnSourceRow = targetRow + (byColor === WHITE ? 1 : -1);
        for (const dc of [-1, 1]) {
            const sourceCol = targetCol + dc;
            if (inside(pawnSourceRow, sourceCol)
                && this.board[indexOf(pawnSourceRow, sourceCol)] === `${byColor}P`) {
                return true;
            }
        }

        for (const [dr, dc] of KNIGHT_STEPS) {
            const row = targetRow + dr;
            const col = targetCol + dc;
            if (inside(row, col) && this.board[indexOf(row, col)] === `${byColor}N`) {
                return true;
            }
        }

        for (const [dr, dc] of KING_STEPS) {
            const row = targetRow + dr;
            const col = targetCol + dc;
            if (inside(row, col) && this.board[indexOf(row, col)] === `${byColor}K`) {
                return true;
            }
        }

        const scan = (directions, allowedTypes) => {
            for (const [dr, dc] of directions) {
                let row = targetRow + dr;
                let col = targetCol + dc;
                while (inside(row, col)) {
                    const piece = this.board[indexOf(row, col)];
                    if (piece) {
                        if (piece[0] === byColor && allowedTypes.includes(piece[1])) {
                            return true;
                        }
                        break;
                    }
                    row += dr;
                    col += dc;
                }
            }
            return false;
        };

        return scan(BISHOP_DIRS, ['B', 'Q']) || scan(ROOK_DIRS, ['R', 'Q']);
    }

    inCheck(color = this.turn) {
        const king = this.kingSquare(color);
        return king >= 0 && this.isSquareAttacked(king, opposite(color));
    }

    pseudoMoves(color = this.turn) {
        const moves = [];
        for (let from = 0; from < 64; from += 1) {
            const piece = this.board[from];
            if (!piece || piece[0] !== color) continue;
            const type = piece[1];
            if (type === 'P') this.#pawnMoves(from, color, moves);
            else if (type === 'N') this.#jumpMoves(from, color, KNIGHT_STEPS, moves);
            else if (type === 'B') this.#slideMoves(from, color, BISHOP_DIRS, moves);
            else if (type === 'R') this.#slideMoves(from, color, ROOK_DIRS, moves);
            else if (type === 'Q') this.#slideMoves(from, color, [...BISHOP_DIRS, ...ROOK_DIRS], moves);
            else if (type === 'K') this.#kingMoves(from, color, moves);
        }
        return moves;
    }

    legalMoves(color = this.turn) {
        const moves = this.pseudoMoves(color);
        const legal = [];
        for (const move of moves) {
            const next = this.cloneForSearch();
            next.applyMoveUnchecked(move, false);
            if (!next.inCheck(color)) legal.push(move);
        }
        return legal;
    }

    cloneForSearch() {
        // Construct a real class instance so JavaScript private methods remain valid.
        const copy = new ChessGame();
        copy.board = [...this.board];
        copy.turn = this.turn;
        copy.castling = cloneCastling(this.castling);
        copy.epSquare = this.epSquare;
        copy.halfmove = this.halfmove;
        copy.fullmove = this.fullmove;
        copy.moveLog = [];
        copy.positionHistory = [];
        return copy;
    }

    #pawnMoves(from, color, moves) {
        const row = rowOf(from);
        const col = colOf(from);
        const direction = color === WHITE ? -1 : 1;
        const startRow = color === WHITE ? 6 : 1;
        const promotionRow = color === WHITE ? 0 : 7;
        const oneRow = row + direction;

        if (inside(oneRow, col)) {
            const one = indexOf(oneRow, col);
            if (!this.board[one]) {
                if (oneRow === promotionRow) {
                    for (const promotion of ['Q', 'R', 'B', 'N']) {
                        moves.push({ from, to: one, piece: `${color}P`, captured: null, promotion });
                    }
                } else {
                    moves.push({ from, to: one, piece: `${color}P`, captured: null });
                    const twoRow = row + direction * 2;
                    const two = indexOf(twoRow, col);
                    if (row === startRow && !this.board[two]) {
                        moves.push({ from, to: two, piece: `${color}P`, captured: null, doublePawn: true });
                    }
                }
            }
        }

        for (const dc of [-1, 1]) {
            const captureRow = row + direction;
            const captureCol = col + dc;
            if (!inside(captureRow, captureCol)) continue;
            const to = indexOf(captureRow, captureCol);
            const target = this.board[to];
            if (target && target[0] !== color) {
                if (captureRow === promotionRow) {
                    for (const promotion of ['Q', 'R', 'B', 'N']) {
                        moves.push({ from, to, piece: `${color}P`, captured: target, promotion });
                    }
                } else {
                    moves.push({ from, to, piece: `${color}P`, captured: target });
                }
            } else if (this.epSquare === to) {
                const capturedSquare = indexOf(row, captureCol);
                const captured = this.board[capturedSquare];
                if (captured === `${opposite(color)}P`) {
                    moves.push({
                        from,
                        to,
                        piece: `${color}P`,
                        captured,
                        enPassant: true,
                    });
                }
            }
        }
    }

    #jumpMoves(from, color, steps, moves) {
        const row = rowOf(from);
        const col = colOf(from);
        for (const [dr, dc] of steps) {
            const toRow = row + dr;
            const toCol = col + dc;
            if (!inside(toRow, toCol)) continue;
            const to = indexOf(toRow, toCol);
            const target = this.board[to];
            if (!target || target[0] !== color) {
                moves.push({ from, to, piece: this.board[from], captured: target || null });
            }
        }
    }

    #slideMoves(from, color, directions, moves) {
        const row = rowOf(from);
        const col = colOf(from);
        for (const [dr, dc] of directions) {
            let toRow = row + dr;
            let toCol = col + dc;
            while (inside(toRow, toCol)) {
                const to = indexOf(toRow, toCol);
                const target = this.board[to];
                if (!target) {
                    moves.push({ from, to, piece: this.board[from], captured: null });
                } else {
                    if (target[0] !== color) {
                        moves.push({ from, to, piece: this.board[from], captured: target });
                    }
                    break;
                }
                toRow += dr;
                toCol += dc;
            }
        }
    }

    #kingMoves(from, color, moves) {
        this.#jumpMoves(from, color, KING_STEPS, moves);
        const enemy = opposite(color);
        const homeKing = color === WHITE ? 60 : 4;
        if (from !== homeKing || this.inCheck(color)) return;

        const canCastle = (right, emptySquares, safeSquares, rookSquare, rookPiece, destination, castle) => {
            if (!this.castling[right]) return;
            if (this.board[rookSquare] !== rookPiece) return;
            if (emptySquares.some(square => this.board[square])) return;
            if (safeSquares.some(square => this.isSquareAttacked(square, enemy))) return;
            moves.push({ from, to: destination, piece: `${color}K`, captured: null, castle });
        };

        if (color === WHITE) {
            canCastle('wK', [61, 62], [61, 62], 63, 'wR', 62, 'K');
            canCastle('wQ', [59, 58, 57], [59, 58], 56, 'wR', 58, 'Q');
        } else {
            canCastle('bK', [5, 6], [5, 6], 7, 'bR', 6, 'K');
            canCastle('bQ', [3, 2, 1], [3, 2], 0, 'bR', 2, 'Q');
        }
    }

    makeMove(moveInput) {
        const desired = normalizeMove(moveInput);
        const legal = this.legalMoves(this.turn);
        const move = legal.find(candidate => (
            candidate.from === desired.from
            && candidate.to === desired.to
            && (candidate.promotion || null) === (desired.promotion || null)
        ));
        if (!move) {
            throw new Error(`非法棋步：${squareName(desired.from)}-${squareName(desired.to)}`);
        }

        const movingColor = this.turn;
        const sanBase = this.sanBase(move, legal);
        this.applyMoveUnchecked(move, true);
        const enemyInCheck = this.inCheck(this.turn);
        const enemyMoves = this.legalMoves(this.turn);
        const suffix = enemyInCheck ? (enemyMoves.length ? '+' : '#') : '';
        const san = `${sanBase}${suffix}`;
        const uci = `${squareName(move.from)}${squareName(move.to)}${(move.promotion || '').toLowerCase()}`;
        this.moveLog.push({ uci, san, color: movingColor });
        this.positionHistory.push(this.positionKey());
        return { ...move, san, uci, color: movingColor };
    }

    applyMoveUnchecked(move, updateCounters = true) {
        const color = move.piece[0];
        const enemy = opposite(color);
        const type = move.piece[1];
        const targetBefore = this.board[move.to];

        this.board[move.from] = null;

        if (move.enPassant) {
            const capturedSquare = move.to + (color === WHITE ? 8 : -8);
            this.board[capturedSquare] = null;
        }

        if (move.castle === 'K') {
            const rookFrom = color === WHITE ? 63 : 7;
            const rookTo = color === WHITE ? 61 : 5;
            this.board[rookTo] = this.board[rookFrom];
            this.board[rookFrom] = null;
        } else if (move.castle === 'Q') {
            const rookFrom = color === WHITE ? 56 : 0;
            const rookTo = color === WHITE ? 59 : 3;
            this.board[rookTo] = this.board[rookFrom];
            this.board[rookFrom] = null;
        }

        this.board[move.to] = move.promotion ? `${color}${move.promotion}` : move.piece;

        if (type === 'K') {
            this.castling[`${color}K`] = false;
            this.castling[`${color}Q`] = false;
        }
        if (type === 'R') this.#disableRookRight(move.from);
        if (targetBefore?.[1] === 'R') this.#disableRookRight(move.to);

        this.epSquare = move.doublePawn ? Math.floor((move.from + move.to) / 2) : null;

        if (updateCounters) {
            const wasCapture = Boolean(move.captured || targetBefore || move.enPassant);
            this.halfmove = type === 'P' || wasCapture ? 0 : this.halfmove + 1;
            if (color === BLACK) this.fullmove += 1;
        }
        this.turn = enemy;
    }

    #disableRookRight(square) {
        if (square === 63) this.castling.wK = false;
        else if (square === 56) this.castling.wQ = false;
        else if (square === 7) this.castling.bK = false;
        else if (square === 0) this.castling.bQ = false;
    }

    sanBase(move, legalMoves) {
        if (move.castle === 'K') return 'O-O';
        if (move.castle === 'Q') return 'O-O-O';

        const type = move.piece[1];
        const capture = Boolean(move.captured || move.enPassant);
        let text = type === 'P' ? '' : type;

        if (type === 'P' && capture) {
            text += FILES[colOf(move.from)];
        } else if (type !== 'P') {
            const ambiguous = legalMoves.filter(other => (
                other !== move
                && other.to === move.to
                && other.piece === move.piece
            ));
            if (ambiguous.length) {
                const sameFile = ambiguous.some(other => colOf(other.from) === colOf(move.from));
                const sameRank = ambiguous.some(other => rowOf(other.from) === rowOf(move.from));
                if (!sameFile) text += FILES[colOf(move.from)];
                else if (!sameRank) text += String(8 - rowOf(move.from));
                else text += squareName(move.from);
            }
        }

        if (capture) text += 'x';
        text += squareName(move.to);
        if (move.promotion) text += `=${move.promotion}`;
        return text;
    }

    positionKey() {
        const boardPart = this.board.map(piece => piece || '--').join('');
        const castling = [
            this.castling.wK ? 'K' : '',
            this.castling.wQ ? 'Q' : '',
            this.castling.bK ? 'k' : '',
            this.castling.bQ ? 'q' : '',
        ].join('') || '-';
        // En-passant only matters for repetition if a pawn can actually capture there.
        let ep = '-';
        if (Number.isInteger(this.epSquare)) {
            const row = rowOf(this.epSquare);
            const col = colOf(this.epSquare);
            const sourceRow = row + (this.turn === WHITE ? 1 : -1);
            const canCapture = [-1, 1].some(dc => (
                inside(sourceRow, col + dc)
                && this.board[indexOf(sourceRow, col + dc)] === `${this.turn}P`
            ));
            if (canCapture) ep = squareName(this.epSquare);
        }
        return `${boardPart}|${this.turn}|${castling}|${ep}`;
    }

    repetitionCount() {
        const key = this.positionKey();
        return this.positionHistory.reduce((count, item) => count + (item === key ? 1 : 0), 0);
    }

    insufficientMaterial() {
        const nonKings = [];
        for (let square = 0; square < 64; square += 1) {
            const piece = this.board[square];
            if (piece && piece[1] !== 'K') nonKings.push({ piece, square });
        }
        if (nonKings.length === 0) return true;
        if (nonKings.length === 1 && ['B', 'N'].includes(nonKings[0].piece[1])) return true;
        if (nonKings.every(item => item.piece[1] === 'B')) {
            const colors = nonKings.map(item => (rowOf(item.square) + colOf(item.square)) % 2);
            return colors.every(color => color === colors[0]);
        }
        return false;
    }

    status() {
        const legal = this.legalMoves(this.turn);
        if (legal.length === 0) {
            if (this.inCheck(this.turn)) {
                return {
                    over: true,
                    type: 'checkmate',
                    winner: opposite(this.turn),
                    text: `${opposite(this.turn) === WHITE ? '空白' : '特图'}将死获胜`,
                };
            }
            return { over: true, type: 'stalemate', winner: null, text: '逼和' };
        }
        if (this.halfmove >= 100) return { over: true, type: 'fifty', winner: null, text: '五十回合规则和棋' };
        if (this.repetitionCount() >= 3) return { over: true, type: 'repetition', winner: null, text: '三次重复和棋' };
        if (this.insufficientMaterial()) return { over: true, type: 'material', winner: null, text: '子力不足和棋' };
        return {
            over: false,
            type: this.inCheck(this.turn) ? 'check' : 'playing',
            winner: null,
            text: this.inCheck(this.turn)
                ? `${this.turn === WHITE ? '空白' : '特图'}被将军`
                : `${this.turn === WHITE ? '空白' : '特图'}行动`,
        };
    }

    fen() {
        const ranks = [];
        for (let row = 0; row < 8; row += 1) {
            let empty = 0;
            let rank = '';
            for (let col = 0; col < 8; col += 1) {
                const piece = this.board[indexOf(row, col)];
                if (!piece) {
                    empty += 1;
                    continue;
                }
                if (empty) {
                    rank += empty;
                    empty = 0;
                }
                const letter = piece[1];
                rank += piece[0] === WHITE ? letter : letter.toLowerCase();
            }
            if (empty) rank += empty;
            ranks.push(rank);
        }
        const castling = [
            this.castling.wK ? 'K' : '',
            this.castling.wQ ? 'Q' : '',
            this.castling.bK ? 'k' : '',
            this.castling.bQ ? 'q' : '',
        ].join('') || '-';
        const ep = Number.isInteger(this.epSquare) ? squareName(this.epSquare) : '-';
        return `${ranks.join('/')} ${this.turn} ${castling} ${ep} ${this.halfmove} ${this.fullmove}`;
    }

    pgn() {
        const result = [];
        for (let i = 0; i < this.moveLog.length; i += 2) {
            const number = Math.floor(i / 2) + 1;
            const white = this.moveLog[i]?.san || '';
            const black = this.moveLog[i + 1]?.san || '';
            result.push(`${number}. ${white}${black ? ` ${black}` : ''}`);
        }
        return result.join(' ');
    }
}

function centralBonus(square) {
    const row = rowOf(square);
    const col = colOf(square);
    const distance = Math.abs(row - 3.5) + Math.abs(col - 3.5);
    return Math.round((7 - distance) * 3);
}

function evaluate(game) {
    const status = game.status();
    if (status.over) {
        if (status.winner === WHITE) return MATE_SCORE;
        if (status.winner === BLACK) return -MATE_SCORE;
        return 0;
    }

    let score = 0;
    let whiteBishops = 0;
    let blackBishops = 0;
    for (let square = 0; square < 64; square += 1) {
        const piece = game.board[square];
        if (!piece) continue;
        const colorSign = piece[0] === WHITE ? 1 : -1;
        const type = piece[1];
        let value = PIECE_VALUES[type];
        if (['N', 'B', 'Q'].includes(type)) value += centralBonus(square);
        if (type === 'P') {
            const advance = piece[0] === WHITE ? 6 - rowOf(square) : rowOf(square) - 1;
            value += advance * 8;
        }
        if (type === 'B') {
            if (piece[0] === WHITE) whiteBishops += 1;
            else blackBishops += 1;
        }
        score += colorSign * value;
    }
    if (whiteBishops >= 2) score += 24;
    if (blackBishops >= 2) score -= 24;

    // Modest castling/king-safety preference.
    if (game.board[62] === 'wK' || game.board[58] === 'wK') score += 34;
    if (game.board[6] === 'bK' || game.board[2] === 'bK') score -= 34;
    return score;
}

function moveOrderingScore(move) {
    let score = 0;
    if (move.captured) score += 10 * PIECE_VALUES[move.captured[1]] - PIECE_VALUES[move.piece[1]];
    if (move.promotion) score += PIECE_VALUES[move.promotion] + 800;
    if (move.castle) score += 90;
    score += centralBonus(move.to);
    return score;
}

function orderedMoves(game) {
    return game.legalMoves(game.turn).sort((a, b) => moveOrderingScore(b) - moveOrderingScore(a));
}

class SearchTimeout extends Error {}

function negamax(game, depth, alpha, beta, colorSign, deadline, ply = 0) {
    if (performance.now() >= deadline) throw new SearchTimeout();
    const status = game.status();
    if (status.over) {
        if (!status.winner) return 0;
        const whiteScore = status.winner === WHITE ? MATE_SCORE - ply : -MATE_SCORE + ply;
        return colorSign * whiteScore;
    }
    if (depth <= 0) return colorSign * evaluate(game);

    let best = -Infinity;
    const moves = orderedMoves(game);
    for (const move of moves) {
        if (performance.now() >= deadline) throw new SearchTimeout();
        const next = game.cloneForSearch();
        next.applyMoveUnchecked(move, true);
        const score = -negamax(next, depth - 1, -beta, -alpha, -colorSign, deadline, ply + 1);
        if (score > best) best = score;
        if (score > alpha) alpha = score;
        if (alpha >= beta) break;
    }
    return best;
}

function personalityBonus(game, move, personality) {
    let bonus = 0;
    if (personality === 'blank') {
        if (move.captured) bonus += 8;
        if (move.promotion) bonus += 24;
        if (move.castle) bonus += 10;
    } else {
        // Tet is slightly more willing to choose active, surprising moves.
        bonus += centralBonus(move.to) * 0.35;
        if (move.piece[1] === 'N') bonus += 5;
        if (move.castle) bonus += 7;
    }
    return bonus;
}

export async function chooseAIMove(game, options = {}) {
    const legal = orderedMoves(game);
    if (!legal.length) return null;
    if (legal.length === 1) return legal[0];

    const depth = Math.max(1, Math.min(5, Number(options.depth) || 3));
    const timeMs = Math.max(50, Math.min(2500, Number(options.timeMs) || 350));
    const personality = options.personality === 'tet' ? 'tet' : 'blank';
    const deadline = performance.now() + timeMs;
    const rootColorSign = game.turn === WHITE ? 1 : -1;
    let completed = [];

    for (let currentDepth = 1; currentDepth <= depth; currentDepth += 1) {
        const scored = [];
        try {
            for (const move of legal) {
                const next = game.cloneForSearch();
                next.applyMoveUnchecked(move, true);
                let score = -negamax(
                    next,
                    currentDepth - 1,
                    -Infinity,
                    Infinity,
                    -rootColorSign,
                    deadline,
                    1,
                );
                score += personalityBonus(game, move, personality);
                scored.push({ move, score });
            }
            scored.sort((a, b) => b.score - a.score);
            completed = scored;
        } catch (error) {
            if (!(error instanceof SearchTimeout)) throw error;
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 0));
        if (performance.now() >= deadline) break;
    }

    if (!completed.length) return legal[0];

    const bestScore = completed[0].score;
    const tolerance = personality === 'tet' ? 26 : 12;
    const candidates = completed.filter(item => item.score >= bestScore - tolerance).slice(0, 4);
    const randomChance = personality === 'tet' ? 0.30 : 0.13;
    if (candidates.length > 1 && Math.random() < randomChance) {
        const weightedIndex = Math.floor(Math.pow(Math.random(), 1.7) * candidates.length);
        return candidates[weightedIndex].move;
    }
    return completed[0].move;
}

export function squareToName(square) {
    return squareName(square);
}

export const COLORS = Object.freeze({ WHITE, BLACK });
