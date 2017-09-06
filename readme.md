# Hangman

A small implementation of the game hangman.

## Howto

Start the hangman API and build the static client JS bundle:

```
$ make
```

Run the tests

```
$ make test
```

To use the UI, a web server like nginx must be used to serve
the static contents from webroot and forward other requests
to the node.js server. See nginx.conf.sample for how to achieve
this.

## API

The API exclusively employs JSON for both requests and responses.

```
GET api/highscore
RETURNS: [
  {
    "score": Integer, # The numeric high score
    "nick": String # The nick of whoever achieved this
  },
  ...
]
```

Retrieve the current list of high scores. Ordered by decreasing score.

```
PUT api/game
PARAMETERS: {} # Empty json object
RETURNS: {
  game: String, # A token used by the server to identify the game. Up to 10kb in size.
  word: String, # The obfuscated word (letters and digits replaced with underscore)
  won: Boolean, # Whether the game is won
  score: Integer, # The current score of the player
  tuns: Integer # How many turns have passed in this game
}
```

Start a new game.

```
POST api/game
PARAMETERS: {
  game: String, # The game token as returned by the MOST RECENT PUT or POST request to api/game
  guess: String # The character that the player guessed (must be a single letter or digit)
}
RETURNS: {
  game: String, # A token used by the server to identify the game. Up to 10kb in size.
  word: String, # The obfuscated word (letters and digits replaced with underscore)
  won: Boolean, # Whether the game is won
  score: Integer, # The current score of the player
  tuns: Integer # How many turns have passed in this game
}
```

Send a guessed character to the server.
This may not be called if a game is already won.

```
POST api/highscore
PARAMETERS: {
  game: String, # The game token as returned by POST request to api/game
  nick: String # The nick of the player to store in the list of high scores. Must be between 3 and 16 chars and contain no special characters.
}
RETUNRS {} # Empty JSON
```

After the game is won (POST api/game returned a document with won=true),
store the high score achieved in the list of high scores.

## TODO

* Add a mechanism to sync high scores across instances (
  Let each instance connect to at least three other instances
  in the network and accept up to 30 connections itself. Whenever
  a new high score is added, a message shall be sent to all 33
  peers informing them about the new highscore; this way we can
  achieve a small and easy P2P network. Might need optimization
  to make sure there are no overly long paths between nodes).
* Test for the right errors to be thrown
* Replace jquery with a smaller library (it blows up our client script size):
* Make sure the game tokens can not be reused; this would be cheating
* Make the client UI nice (add 'you guessed correct/wrong' messages,
  wait a short while before showing the high scores; access high scores
  without playing)
* Improve the scoring (scores are too large right now)
* Make the UI look nicer on mobile devices

## Copyright

Copyright 2017 by Karolin Varner

License: CC0/Public Domain (as applicable)
