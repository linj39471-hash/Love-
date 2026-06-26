import assert from 'node:assert/strict';

import {
    ChessGame,
    chooseAIMove,
    COLORS,
} from '../engine.js';

function findMove(game, uci) {
    return game.legalMoves(game.turn).find(move => {
        const files = 'abcdefgh';
        const name = square => {
            const row = Math.floor(square / 8);
            const col = square % 8;
            return `${files[col]}${8 - row}`;
        };

        return `${name(move.from)}${name(move.to)}${(move.promotion || '').toLowerCase()}` === uci;
    });
}

function play(game, uci) {
    const move = findMove(game, uci);
    assert.ok(move, `Expected legal move: ${uci}`);
    return game.makeMove(move);
}

const opening = new ChessGame();
assert.equal(opening.legalMoves().length, 20);
assert.equal(opening.turn, COLORS.WHITE);
assert.equal(
    opening.fen(),
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
);

play(opening, 'e2e4');
play(opening, 'e7e5');
play(opening, 'g1f3');
assert.equal(opening.turn, COLORS.BLACK);
assert.ok(opening.pgn().includes('Nf3'));

const mate = new ChessGame();
play(mate, 'f2f3');
play(mate, 'e7e5');
play(mate, 'g2g4');
play(mate, 'd8h4');
assert.equal(mate.status().type, 'checkmate');
assert.equal(mate.status().winner, COLORS.BLACK);

const castle = new ChessGame();
play(castle, 'e2e4');
play(castle, 'e7e5');
play(castle, 'g1f3');
play(castle, 'b8c6');
play(castle, 'f1e2');
play(castle, 'g8f6');
assert.ok(findMove(castle, 'e1g1'));

const enPassant = new ChessGame();
play(enPassant, 'e2e4');
play(enPassant, 'a7a6');
play(enPassant, 'e4e5');
play(enPassant, 'd7d5');
assert.ok(findMove(enPassant, 'e5d6'));

const aiGame = new ChessGame();
const aiMove = await chooseAIMove(aiGame, {
    depth: 2,
    timeMs: 150,
    personality: 'tet',
});
assert.ok(aiMove);
assert.ok(
    aiGame.legalMoves().some(move => {
        return move.from === aiMove.from && move.to === aiMove.to;
    }),
);

console.log('All chess engine tests passed.');
