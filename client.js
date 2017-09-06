'use strict';

const $ = require('jquery');

let gameState;
let highscoreTemplate;


const sendJson = (url, data, method) => $.ajax({
  'type': method,
  'url': url,
  'contentType': 'application/json',
  'data': JSON.stringify(data),
  'dataType': 'json'});

const get = $.get;
const post = (url, data) => sendJson(url, data, 'POST');
const put  = (url, data) => sendJson(url, data, 'PUT');

const loadHighscore = async () => {
  const scores = await get('api/highscore');

  if (scores.length == 0) {
    $('#highscore-table').text('No high scores yet!');
    return;
  }

  $('#highscore-table').text('');
  for (let idx = 0; idx < scores.length; idx++) {
    const {score, nick} = scores[idx];
    const elem = $(highscoreTemplate);
    elem.find('.idxfield').text((idx+1).toString() + '.');
    elem.find('.nickfield').text(nick);
    elem.find('.scorefield').text(score);
    $('#highscore-table').append(elem);
  }
};

const displayGameState = async (state) => {
  console.log("displayGameState")
  gameState = state;

  $('#current-turn').text(gameState.turns);
  $('#current-score').text(gameState.score);

  if (gameState.won) {
    await loadHighscore();
    $('#game').addClass('hidden');
    $('#highscore').removeClass('hidden');
    $('#name-input').focus();
  } else {
    $('#the-word').text(gameState.word);
  }
};

$('body').keypress(async (ev) => {
  const c = ev.key.toLowerCase();
  if (!c.match(/[a-z0-9]/) || gameState.won) return;
  const state = await post('api/game', {
    game: gameState.game,
    guess: c
  });
  displayGameState(state);
});

$('#nick-input').keypress(async (ev) => {
  // Only react to Enter
  if (ev.keyCode != 13) return;
  ev.preventDefault();
  await post('api/highscore', {
    game: gameState.game,
    nick: $('#nick-input').val()
  });
  $('#nick-input-container').addClass('hidden');
  loadHighscore();
});

highscoreTemplate = $('#highscore-table').html();
$('#highscore-table').html('');

put('api/game', {}).then((res) => displayGameState(res));
