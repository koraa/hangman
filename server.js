'use strict';

const {random, floor, pow, min, max, round} = Math;
const readline = require('readline');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');

/// LOOKUP TABLES ///

// The probability of choosing the right characters in the minimum
// number of steps is given by the following formular:
//
// P(charnum) = product((charnum-i) / (26-i) for i in [0; charnum])
//
// This lookup table is stores the multiplicative inverse of each of those
// probabilities. This is used as a coefficient on the score so guessing
// fast for a word with 13 characters gives much more points than guessing
// some three char word.
//
// (Note that games with 13 chars to guess are the hardest, after thirteen
// it becomes simpler again, because the probability of choosing a char
// *not* to guess is the same as choosing one to guess.
// E.g. for a char the probability of choosing the right one to guess is 1/26,
// for 25 chars the probability to choose the right one to *exclude* from
// guesses also is 1/26).
const charnum_difficulty = [
  1, 26, 325, 2600, 14950, 65780, 230230, 657800, 1562275, 3124550, 5311735, 7726160, 9657700,
  10400600, // 13 words, most difficult
  9657700, 7726160, 5311735, 3124550, 1562275, 657800, 230230, 65780, 14950, 2600, 325, 26, 1]

// Letter frequency
//
// In english e is the most commonly used word.
// This table contains the multiplicative inverse for each relative letter frequence,
// so guessing words with z gives much more points than guessing words with e.
//
// Rewarding rare letters discourages algorithms based on the letter frequency.
const letter_difficulty = {
  'a': 12.2444,
  'b': 67.0241,
  'c': 35.9454,
  'd': 23.5128,
  'e': 7.87278,
  'f': 44.8833,
  'g': 49.6278,
  'h': 16.4096,
  'i': 14.3554,
  'j': 653.595,
  'k': 129.534,
  'l': 24.8447,
  'm': 41.5628,
  'n': 14.817,
  'o': 13.3209,
  'p': 51.8403,
  'q': 1052.63,
  'r': 16.7029,
  's': 15.8053,
  't': 11.0424,
  'u': 36.2582,
  'v': 102.249,
  'w': 42.3729,
  'x': 666.667,
  'y': 50.6586,
  'z': 1351.35
};

//// GENERIC UTILS ////

/// Safe version of instanceof (can deal with null, undefined and primitive types)
const isInstance = (x, t) => {
  if (x === null || x === undefined || t === null || t === undefined) {
    return false;
  } else {
    return x instanceof t || x.constructor === t;
  }
};

/// Higher order function that turns a function that takes a
/// callback into one that returns a promise
const promisify = (f) => (...args) => new Promise((resolve, reject) => {
  f(...args, (err, val) => {
    if (err) reject(err);
    else     resolve(val);
  });
});

/// Read a file. Takes the path to the file and returns a
/// promise that resolves with the file contents.
const readFile = promisify(fs.readFile);

/// Write a file. Takes the path and the data to write and
/// returns a promise
const writeFile = promisify(fs.writeFile);

/// Read the lines from a node stream. Returns a promise
/// resolving to an array with the lines.
const readLines = (input) => new Promise((resolve, reject) => {
  const buf = [];
  const str = readline.createInterface({input});
  str.on('line', (line) => buf.push(line));
  str.on('close', () => resolve(buf));
});


//// MODELS ////

/// Represents the state of an ongoing hangman game
class HangmanGame {

  /// ARGS:
  ///   * word – The word we are playing hangman with
  ///   * guessed – How many words the player has already guessed
  ///               (used if the game has started a while ago)
  ///   * turns – How many turns have happened until now
  constructor(word, guessed = [], turns = 0) {
    this.word = word;
    this.turns = turns;
    this.charsNeeded = new Set(word.toLowerCase().replace(/[^a-z0-9]/gi, ''));
    this.charsGuessed = new Set(guessed);
  }

  /// Construct a HangmangGame from the game property produced
  /// serializeState.
  /// A privateKey must be supplied for decrypting the protected data.
  static decrypt(game, privateKey) {
    const dat = JSON.parse(
        crypto.privateDecrypt(privateKey, new Buffer(game, 'base64'))); return new HangmanGame(dat.word, dat.charsGuessed, dat.turns);
  }

  /// Serialize the HangmanGame to json-like data suitable for
  /// transmitting to a player
  ///
  /// The data returned will have the following properties:
  ///   * game – The game state, encrypted with privateKey, so
  ///            the player can not cheat
  ///   * word – The result of hiddenWord()
  ///   * won – Whether the player has won the game
  ///   * score – The current score of the player
  ///   * turn – Number of the current turn
  serializeState(privateKey) {
    const game = crypto.publicEncrypt(privateKey, new Buffer(JSON.stringify({
      word: this.word,
      charsGuessed: Array.from(this.charsGuessed),
      turns: this.turns
    }))).toString('base64');
    return {
      game,
      word: this.hiddenWord(),
      won: this.won(),
      score: this.score(),
      turns: this.turns
    }
  }

  // Checks whether the player has won (guessed all letters)
  won() {
    return this.charsGuessed.size === this.charsNeeded.size;
  }

  /// Representation of the word with all letters hidden
  /// (replaced with _), except the ones that have already
  /// been guessed
  hiddenWord(word) {
    let res = '';
    for (const c of this.word.toLowerCase()) {
      const hide = c.match(/[a-z0-9]/i) && !this.charsGuessed.has(c);
      res += hide ? '_' : c;
    }
    return res;
  };

  /// Score the player receives for this game.
  /// (Note: This score is transmitted to the client during the
  /// game; after the first correct guess it *is* possible to
  /// infer some properties of the word; the second and third
  /// coefficient is known to the client and so the wordDifficulty
  /// can be found which contains info about the word.
  /// Could be mitigated by only transmitting the score to the
  /// client after game end...)
  score() {
    // Multiplicative inverse of the probability of brute
    // forcing the word in the minimum number of turns
    const bruteforceDifficulty = charnum_difficulty[this.charsNeeded.size];

    // Different letters occur with different probabilities
    // in words. E.g. e appears most often in while z appears
    // very seldomly.
    // This increases the score for words with infrequent letters
    // in order to discourage just guessing by letter frequency
    // (Clients may get lower average turn numbers, but they
    // will not be able to get the best high scores, for that
    // you need to guess well for words with infrequent letters).
    let avrageLetterDifficulty = 1;
    for (const c of this.charsNeeded)
      avrageLetterDifficulty *= letter_difficulty[c] || 1;

    // We need to take the avrage because otherwise we
    // reward longer words, counteracting the bruteforceDifficulty
    avrageLetterDifficulty /= this.charsNeeded.size;

    // Makes sure the score rises linearly each turn
    // TODO: Use some exponential scale?
    const turnCoefficient = (this.charsGuessed.size / min(1, this.charsNeeded.size));

    // This punishes guessing wrong harshly. For each wrong guess
    // the score is halved!
    const badGuessPenalty = pow(0.5, this.turns - this.charsGuessed.size);

    const score = round(bruteforceDifficulty * avrageLetterDifficulty
         * turnCoefficient * badGuessPenalty * 0.0001);
    return score === NaN ? 0 : score;
  }
};

/// Stores the highscores and takes care of loading and syncing
/// them to disk.
///
/// Note that the disk-saving mechanism is also usually used to provide
/// the GET /api/highscores endpoint. Real web servers are better at
/// serving an infrequently-updated file than us.
class Highscores {

  /// Args:
  ///   * The file highscores are persisted in
  ///   * max_highscores – How many of the best highscores should be saved
  constructor(file, max_highscores = 5) {
    this._max = max_highscores;
    this._file = file;
    this.value = [];

    // Load the old highscores from disk
    this._readyPromise = readFile(this._file).then((txt) => {
      this.value = JSON.parse(txt);
    }).catch((err) => {
      // ENOENT No such file or directory.
      // Ignored because then we just start with an empty high score
      if (err.errno === -2) return;
      throw err;
    });

    // Listen for requests to sync the highscores to disk
    this._startHighscoreSync();
  }

  /// Coroutiune/Thread/Fiber/Actor writing the high score to it's file.
  /// Only actually starts writing when there where any changes
  /// (implemented using syncHighscoreSignal) and at most every
  /// ten seconds.
  async _startHighscoreSync() {
    // NOTE: Using the actor model of concurrency here (basically
    // treating the highscore sync like a coroutine/thread/fiber/actor that
    // receives the message to now sync the highscores), because
    // that makes sure we only run *one* highscore sync at a time
    // which is important because we do not want to dos us and
    // the result of multiple writeFile calls to the same file is undefined.
    // It als is slighly simpler than handling the delay in multiple
    // if statements.
    // TODO: We need a proper message queue between fibers/actors

    let syncSlot = new Promise((resolve) => { this._syncSignal = resolve; });
    while (true) {
      // Wait until we are told to sync the highscores to disk
      // Then set up the new signal IMMEDIATELY, so we don't miss
      // any changes that happen while writeFile is running
      // (asynchronously)
      await syncSlot;
      syncSlot = new Promise((resolve) => { this._syncSignal = resolve; });

      writeFile(this._file, JSON.stringify(this.value));
    }
  }

  /// Add a highscore
  async add({nick, score}) {
    // Make sure we only start adding values to the high
    // scores once they have been red from disk
    await this._readyPromise;

    // Find the highscore index to insert into
    // (this is basically an insertation sort)
    let idx = this.value.length;
    for (; idx > 0 && this.value[idx-1].score < score; idx--);


    // Update the highscores
    if (idx < this._max) {
      this.value.splice(idx, 0, {score, nick})
      // Limit the highscore table to maxHighscoreNo
      this.value.splice(this._max, this.value.length - this._max);
      this._syncSignal();
    }
  }
};

//// GLOBAL STATE ////////////////////////////////

let context = {
  /// The list of playable words we may play hangman with
  words: undefined,

  /// The list of high scores [['name', score]] with the lowest
  /// score last
  highscore: undefined,

  // Our key used for encrypting client tokens and messages
  // between peers
  privateKey: undefined
};

const server = express();

//// ENDPOINTS ///////////////////////////////////

/// These specifically are exceptions that should
/// be send to the client via HTTP
class HttpException {
  constructor(code, message) {
    this.code = code;
    this.message = message;
  }

  payload() {
    return {'error': this.message}
  }
};

/// Make express deal with promises
/// Overwrite the default error handler (we do not want to expose
/// sensitive info from errors)
const asyncExpressHandler = (fn) => (req, res, next) =>
  Promise.resolve(null)
    .then(() => fn(req, res)) // Convert any exceptions to promise errors
    .catch((err) => {
      if (isInstance(err, HttpException)) {
        res.status(err.code).send(err.payload())
      } else {
        console.log("Exception while processing request: ", err);
        res.status(500).send({'error': 'Internal Server Error'})
      }
    });

/// Like HangmanGame.decrypt, but throws appropriate HTTPExceptions
const decryptGame = ((gameData) => {
  try {
    return HangmanGame.decrypt(gameData, context.privateKey);
  } catch (err) {
    throw new HttpException(400, 'Invalid Game!');
  }
});

server.use(bodyParser.json());

/// Start a game
server.put('/api/game', asyncExpressHandler((req, res) => {
  // NOTE: This is a bad PRNG. V8 uses XORSHIFT128 which is fast
  // but predictable. We should consider using a seedable PRNG with
  // PCG or some other less predictable PRNG and seeding it every
  // couple of requests from /dev/urandom
  const word = context.words[floor(random() * context.words.length)];
  const game = new HangmanGame(word);
  res.status(200).send(game.serializeState(context.privateKey));
}));

/// Make a guess
server.post('/api/game', asyncExpressHandler((req, res) => {
  const {guess, game: gameData} = req.body;
  const game = decryptGame(gameData);

  if (game.won())
    throw new HttpException(410, 'The game is already won!');

  if (!guess.match(/^[a-z0-9]$/i))
    throw new HttpException(400, 'Your guess must be a single letter or digit!');

  if (game.charsNeeded.has(guess)) // Guessed right
    game.charsGuessed.add(guess);
  
  game.turns++;

  res.status(200).send(game.serializeState(context.privateKey));
}));

server.get('/api/highscore', asyncExpressHandler((req, res) => {
  res.status(200).send(context.highscore.value);
}));

/// Add the nick to the high scores after finishing the game
server.post('/api/highscore', asyncExpressHandler(async (req, res) => {
  const {nick, game: gameData} = req.body;
  const game = decryptGame(gameData);
  const score = game.score();

  if (!game.won())
    throw new HttpException(400, 'The game is not yet won!');

  const badNick = !isInstance(nick, String)
               || !nick.match(/^\w/)
               || nick.length < 1 || nick.length > 16;
  if (badNick)
    throw new HttpException(400,
      'Nick must be a string between 1 and 16 chars and contain no special chars.');

  await context.highscore.add({score, nick});
  res.status(200).send({});
}));

process.on('unhandledRejection', (error, promise) => {
  console.log('unhandledRejection', error, 'in', promise);
  process.exit(1);
});

const main = async (keyFile, highscoreFile) => {
  if (keyFile === undefined || highscoreFile === undefined) {
    console.log("USAGE server.js KeyFile highscoreFile < wordsFile")
    process.exit(1);
  }

  context.highscore = new Highscores(highscoreFile);

  await Promise.all([
    readFile(keyFile).then((key) => { context.privateKey = key; }),
    readLines(process.stdin).then((lines) => { context.words = lines; })]);

};

module.exports = {
  charnum_difficulty, letter_difficulty,
  promisify, readFile, writeFile, readLines, isInstance,
  HangmanGame, Highscores, server, main,

  get context() { return context; },
  set context(val) { context = val; }
};

if (require.main === module) {
  main(...process.argv.slice(2));
  server.listen(8000);
}
