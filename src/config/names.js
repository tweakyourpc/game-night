/**
 * Display names, in one place. Internal ids (game ids, storage keys) never change when
 * a display name does, so renaming a game here is safe for existing installations.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.NAMES = {
  platform: 'Game Night',
  games: {
    wordwright: 'Wordwright',
    fourinarow: 'Four in a Row',
    dots: 'Dots and Boxes',
    checkers: 'Checkers',
    fivefold: 'Fivefold',          // the five-dice scorecard game; rename freely
    tictactoe: 'Tic-tac-toe',
  },
};
