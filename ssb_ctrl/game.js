const filter = require('pull-stream/throughs/filter')
const pull = require("pull-stream");
const map = require("pull-stream/throughs/map");
const collect = require("pull-stream/sinks/collect");

module.exports = (sbot) => {

  function getEndedGames(playerId) {
    //TODO
  }

  function getPlayers(gameRootMessage) {
    return new Promise((resolve, reject) => {
      sbot.get(gameRootMessage, function(error, result) {
        if (error) {
          reject(error)
        } else {
          const authorId = result.author;
          const invited = result.content.inviting;

          const authorColour = result.content.myColor === "white" ? result.content.myColor : "black";
          const players = {};

          players[authorId] = authorColour;
          players[invited] = authorColour === "white" ? "black" : "white";

          resolve(players);
        }
      });

    })
  }

  /*
   * Return just the FEN, players, and who's move it is.
   * This might be used for a miniboard view of a game, for example.
  */
  function getSmallGameSummary(gameRootMessage) {
    // For now this just calls through to 'getSituation' - but we could maybe do something
    // more efficient in the future.by just looking at the ply of the last move and the
    // players from the original message, etc.

    return getSituation(gameRootMessage).then(gameSituation => {
      const summary = {
        gameId: gameSituation.gameId,
        fen: gameSituation.fen,
        players: gameSituation.players,
        toMove: gameSituation.toMove
      }

      return summary;
    });
  }

  function getSituation(gameRootMessage) {
    //TODO: worra mess, tidy this function up

    return new Promise((resolve, reject) => {

      const source = sbot.links({
        dest: gameRootMessage,
        values: true,
        keys: false
      });

      const filterByPlayerMoves = players =>
        filter(msg => msg.value.content.type === "ssb_chess_move" && players.hasOwnProperty(msg.value.author));

      const getPlayerToMove = (players, numMoves) => {
        const colourToMove = numMoves % 2 === 0 ? "white" : "black";

        const playerIds = Object.keys(players);

        for (var i = 0; i < playerIds.length; i++) {
          if (players[playerIds[i]] === colourToMove) {
            return playerIds[i];
          }
        }

      };

      getPlayers(gameRootMessage).then(players => {

        pull(source,
          filterByPlayerMoves(players),
          collect((err, msgs) => {
            if (!msgs) msgs = [];

            // Sort in ascending ply so that we get a list of moves linearly
            msgs = msgs.sort((a,b) => a.value.content.ply - b.value.content.ply);

            var pgnMoves = msgs.map(msg => msg.value.content.pgnMove);

            resolve({
              gameId: gameRootMessage,
              pgnMoves: pgnMoves,
              origDests: msgs.map(msg => ({
                'orig': msg.value.content.orig,
                'dest': msg.value.content.dest
              })),
              fen: msgs.length > 0 ? msgs[msgs.length - 1].value.content.fen : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
              players: players,
              toMove: getPlayerToMove(players, pgnMoves.length)
            })
          }));
      });
    });
  }

  function makeMove(gameRootMessage, ply, originSquare, destinationSquare, pgnMove, fen) {
    const post = {
      type: 'ssb_chess_move',
      ply: ply,
      root: gameRootMessage,
      orig: originSquare,
      dest: destinationSquare,
      pgnMove: pgnMove,
      fen: fen
    }

    sbot.publish(post, function(err, msg) {
      console.log("Posting move: " + console.dir(msg));
    });
  }

  return {
    getPlayers: getPlayers,
    getSituation: getSituation,
    getSmallGameSummary: getSmallGameSummary,
    makeMove: makeMove
  }

}
