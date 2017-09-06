const fs = require('fs');
const assert = require('assert');
const crypto = require('crypto');
const hangman = require('./server.js');
const supertest = require('supertest');
const {step} = require('mocha-steps')

const {promisify, readFile, writeFile, readLines,
       isInstance, server, Highscores} = hangman;

const unlink = promisify(fs.unlink);

const compareSets = (a, b) => {
    if (a.size !== b.size) return false;
    for (const elem of as)
      if (!b.has(elem))
        return false;
    return true;
};

const get = (route) =>  supertest(server).get(route);
const post = (route, data, code) =>
  supertest(server).post(route).type('json').send(data);
const put = (route, data, code) =>
  supertest(server).put(route).type('json').send(data);

class GameTester {
  // There are no async constructores
  static async create(words = ['Hello 3 World', 'Sunshine'],
                      highscore = hangman.context.highscore.value || []) {
    const me = new GameTester();

    if (GameTester._current !== undefined)
      GameTester._current.destroy();
    GameTester._current = me;

    me.highscorefile = `/tmp/${randomToken()}`;
    await writeFile(me.highscorefile, JSON.stringify(highscore));
    
    hangman.context = {
      words,
      highscore: new Highscores(me.highscorefile),
      privateKey: await readFile('test_key_donotuseinproduction.pem')
    }

    return me;
  }

  static async playGame(word, nick, highscore = hangman.context.highscore.value || []) {
    const game = await GameTester.create([word], highscore);
    await game.start().expect(200);

    await game.guessAll(word);
    assert(game.state.won === true);

    await game.addHighscore(nick);

    return game;
  }

  start() {
    const req = put('/api/game', {});
    req.then((res) => { this.state = res.body });
    return req;
  }

  guess(guess) {
    const req = post('/api/game', {
      game: this.state.game,
      guess});
    req.then((res) => { this.state = res.body });
    return req;
  }

  async guessAll(guesses) {
    const requests = [];
    for (const guess of new Set(guesses.toLowerCase())) {
      const req = this.guess(guess).expect(200);
      requests.push(req);
      await req;
    }
    return requests;
  }

  addHighscore(nick) {
    const game = this.state.game;
    return post('/api/highscore', {game, nick});
  }

  async highscore() {
    const res = await get('/api/highscore').expect(200);
    return res.body;
  }

  async highscoreOf(nick) {
    const scores = await this.highscore();
    for (let idx = 0; idx < scores.length; idx++) {
      let hs = scores[idx];
      if (hs.nick === nick)
        return {idx, score: hs.score};
    }
    return undefined;
  }

  // There are no destructors in JS
  async destroy() {
    await unlink(this.highscorefile);
  }
};

// Poor man's UUID
const randomToken = () =>
  crypto.randomBytes(16).toString('hex');

it('promisify', async () => {
  const fun = promisify((err, val, cb) => cb(err, val));

  const val = await fun(null, 42);
  assert(val === 42);

  let err;
  try {
    await fun(23);
  } catch (er) {
    err = er;
  }
  assert(err = 23);
});

it('writeFile, readFile, readLines', async () => {
  // In one test because we must test writeFile by reading
  // from the file and we would have to use writeFile
  // again for testing readLines

  const testfile = `/tmp/${randomToken()}`;
  const tokens = [randomToken(), randomToken(), randomToken()];
  const text = tokens.join('\n');

  await writeFile(testfile, text);

  const textRed = (await readFile(testfile)).toString();
  assert(textRed === text);

  const linesRed = await readLines(fs.createReadStream(testfile));

  await unlink(testfile);
});

describe('isInstance', () => {
  it('deal with null/undefined', () => {
    assert(!isInstance(null, String)); // should not throw
    assert(!isInstance(undefined, String));
  });

  it('deal with objects', () => {
    assert(isInstance(new String(), Object));
    assert(isInstance(new String(), String));
    assert(isInstance({}, Object));
    assert(isInstance(new Number(), Number));
  });

  it('deal with primitives', () => {
    assert(isInstance(2, Number));
    assert(isInstance("foo", String));
    assert(isInstance(false, Boolean));
  });
});

describe('hangmanGame', () => {
  let game, oldScore = 0;

  step('loads highscores from disk', async () => {
    game = await GameTester.create(
      ['23 foo!'], [{nick: 'Herbert', score: 42}]);
    await game.start().expect(200);

    const highscore = await game.highscore();
    assert.deepEqual(highscore, [{nick: 'Herbert', score: 42}]);
  });

  step('new-game', async () => {
    assert(game.state.won === false);
    assert(game.state.score === 0);
    assert(game.state.turns === 0);
  });

  step('word is obfuscated', () => {
    assert(game.state.word === '__ ___!');
  });

  step('guessing right deobfuscates', async () => {
    oldScore = game.state.score;

    await game.guess('2').expect(200);
    assert(game.state.word == '2_ ___!')
    assert(game.state.turns === 1);
    assert(game.state.won === false);

    await game.guess('o').expect(200);
    assert(game.state.word == '2_ _oo!')

    assert(game.state.turns === 2);
    assert(game.state.won === false);
  });

  step('guessing right increases the score', () => {
    assert(game.state.score > oldScore);
    oldScore = game.state.score;
  });

  step('guessing wrong does not deobfuscate', async () => {
    await game.guess('x').expect(200);
    assert(game.state.word == '2_ _oo!');
    assert(game.state.turns === 3);
    assert(game.state.won === false);
  });

  step('guessing wrong does not increase the score', () => {
    assert(game.state.score <= oldScore);
    oldScore = game.state.score;
  });

  step('can win', async () => {
    await game.guessAll('3f');
    assert(game.state.won === true);
    assert(game.state.word == '23 foo!')
  });

  step('can add highscore', async () => {
    await game.addHighscore('fnord').expect(200);
    const highscore = await game.highscore();
    assert(new Set(highscore.map((o) => o.nick)).has('fnord'));
  });

  step('can not add highscore unless won', async () => {
    game = await GameTester.create(['bar']);
    await game.start().expect(200);

    await game.addHighscore('brigitte').expect(400);

    const highscore = await game.highscore();
    assert(!new Set(highscore.map((o) => o.nick)).has('brigitte'));
  });

  step('more chars give higher score', async () => {
    game = await GameTester.playGame('a', 'naga', []);
    game = await GameTester.playGame('ab', 'pamela');

    const nagaHS = await game.highscoreOf('naga');
    const pamelaHS = await game.highscoreOf('pamela');

    assert(nagaHS.idx > pamelaHS.idx);
    assert(nagaHS.score < pamelaHS.score);
  });

  step('rare chars give higher score', async () => {
    game = await GameTester.playGame('ax', 'gorge');

    const gorgeHS = await game.highscoreOf('gorge');
    const pamelaHS = await game.highscoreOf('pamela');

    assert(pamelaHS.idx > gorgeHS.idx);
    assert(pamelaHS.score < gorgeHS.score);
  });

  step('guessing wrong gives lower score', async () => {
    game = await GameTester.create(['ax']);
    await game.start().expect(200);

    await game.guess('n').expect(200);
    await game.guessAll('ax');
    assert(game.state.won === true);

    await game.addHighscore('jutta');

    const gorgeHS = await game.highscoreOf('gorge');
    const juttaHS = await game.highscoreOf('jutta');

    assert(juttaHS.idx > gorgeHS.idx);
    assert(juttaHS.score < gorgeHS.score);
  });

  step('highscores is limited to five players', async () => {
    game = await GameTester.playGame('xyz', 'adam');
    game = await GameTester.playGame('wefa', 'tom');

    const highscore = game.highscore();
    const highscoreNicks = new Set(
      (await game.highscore()).map((o) => o.nick));

    const expectedNicks = new Set(['adam', 'tom', 'pamela',
                                  'gorge', 'jutta']);

    // Naga should have been thrown out
    assert.deepEqual(highscoreNicks, expectedNicks);
  });

  step('selects words randomly', async () => {
    const words = new Set(['foo', 'fnord', 'herbert']);
    let found = new Set();

    game = await GameTester.create(Array.from(words));

    while (found.length != words.length) {
      await game.start().expect(200);

      let word;
      if (game.state.word.length == 3) {
        word = 'foo';
      } else if (game.state.word.length == 5) {
        word = 'fnord';
      } else if (game.state.word.length == 7) {
        word = 'herbert';
      }

      await game.guessAll(word);

      assert(game.state.won === true);
      found.add(word);
      console.log(found);
    }
  });

});
