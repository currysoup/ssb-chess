var sqlite3 = require('sqlite3').verbose();
var pull = require("pull-stream");

var DbPromiseUtils = require("./db_promise_utils");

var PubSub = require("pubsub-js");

//TODO: Get rid of some of the boiler plate in this file.

module.exports = (sbot, db) => {

  var allStmtAsPromise = DbPromiseUtils(db).allStmtAsPromise;
  var getStmtAsPromise = DbPromiseUtils(db).getStmtAsPromise;
  var runStmtAsPromise = DbPromiseUtils(db).runStmtAsPromise;

  var ssb_chess_type_messages = [
    "ssb_chess_invite",
    "ssb_chess_invite_accept",
    "ssb_chess_game_end"
  ];

  function myLiveFeedSince(since) {

    var opts = {
      live: true
    }

    if (since) {
      opts['gte'] = since;
    }

    const myFeedSource = sbot.createFeedStream(opts);

    return myFeedSource;
  }

  function getInvitationSummary(row) {

    const invitation = {
      gameId: row.gameId,
      sentBy: row.inviter,
      inviting: row.invitee,
      inviterPlayingAs: row.inviterColor,
      timeStamp: row.updated
    }

    return invitation;
  }

  function pendingChallengesSent(playerId) {
    var query = ` select * from ssb_chess_games WHERE inviter="${playerId}" and status="invited" `;
    console.log(query);

    return allStmtAsPromise(query).then(rows => rows.map(getInvitationSummary));
  }

  function pendingChallengesReceived(playerId) {
    var query = ` select * from ssb_chess_games WHERE invitee="${playerId}" and status="invited" `;

    return allStmtAsPromise(query).then(rows => rows.map(getInvitationSummary));
  }

  function getGamesAgreedToPlayIds(playerId) {
    var query = `select * from ssb_chess_games
    WHERE invitee="${playerId}"
      or inviter="${playerId}" and (status <> "invited");`;

    return allStmtAsPromise(query).then(rows => rows.map(row => row.gameId));
  }

  function getRelatedMessages(gameInvite, cb) {
    sbot.relatedMessages({
      id: gameInvite.key
    }, function(err, msg) {

      var relatedMessages = msg.related ? msg.related : [];

      var result = {
        invite: gameInvite,
        gameMessages: relatedMessages
      }

      cb(null, result);
    });
  }

  function getGameStatus(maybeAcceptMsg, maybeGameEndMsg) {
    if (maybeGameEndMsg) {
      return maybeGameEndMsg.value.content.status;
    } else if (maybeAcceptMsg) {
      return "started";
    } else {
      return "invited";
    }
  }

  function getUpdatedTime(maybeAcceptMsg, maybeGameEndMsg, orDefault) {
    if (maybeGameEndMsg) {
      return maybeGameEndMsg.value.timestamp;
    } else if (maybeAcceptMsg) {
      return maybeAcceptMsg.value.timestamp;
    } else {
      return orDefault;
    }
  }

  function storeGameHistoryIntoView(gameHistory, optionalSyncCallback) {
    var invite = gameHistory.invite;
    var inviter = invite.value.author;

    var acceptInviteMsg = gameHistory.gameMessages.find(msg =>
      msg.value.content &&
      msg.value.content.type === "ssb_chess_invite_accept" &&
      msg.value.author === invite.value.content.inviting);

    var gameEndMsg = gameHistory.gameMessages.find(msg =>
      msg.value.content && msg.value.content.type === "ssb_chess_game_end");

    var status = getGameStatus(acceptInviteMsg, gameEndMsg);
    var updateTime = getUpdatedTime(acceptInviteMsg, gameEndMsg, invite.value.timestamp);

    var winner = gameEndMsg ? gameEndMsg.value.content.winner : null;

    var insertStmt = `INSERT OR REPLACE INTO ssb_chess_games (gameId, inviter, invitee, inviterColor, status, winner, updated)
      VALUES ( '${invite.key}',
       '${inviter}', '${invite.value.content.inviting}',
       '${invite.value.content.myColor}', '${status}', '${winner}', ${Date.now() / 1000} )`;

    db.run(insertStmt, function(err) {

      if (err) {
        console.dir(err);
        console.log("Error inserting game status view");
      }

      if (optionalSyncCallback) {
        // This can be used to run insert statements 1 after another if
        // ordering is important (as it is for as we want to refresh the
        //  page only when we're completely caught up)
        optionalSyncCallback(null, "db insert finished");
      }

    });

  }

  function getGameInvite(id, cb) {
    sbot.get(id, function(err, inviteMsg) {
      // happy0? h4cky0 moar like
      inviteMsg.value = inviteMsg;

      inviteMsg.key = id;
      //console.dir(id);
      //console.dir(inviteMsg);
      cb(null, inviteMsg);
    });
  }

  function keepUpToDateWithGames() {
    var isChessMsgFilter = (msg) => !msg.sync === true && ssb_chess_type_messages.indexOf(msg.value.content.type) !== -1;
    var fiveMinutes = 300 * 1000;

    var gameIdUpdateThrough = pull(pull.filter(isChessMsgFilter),
      pull.map(msg => msg.value.content.root ? msg.value.content.root : msg.key));

    var originalGameInvites = pull(gameIdUpdateThrough, pull.asyncMap(getGameInvite));

    var storeGamesSync = pull(originalGameInvites, pull(pull.asyncMap(getRelatedMessages), pull.asyncMap(storeGameHistoryIntoView)));

    pull(myLiveFeedSince(Date.now() - fiveMinutes), storeGamesSync, pull.drain(e => {
      console.log("Game update");
      PubSub.publish("catch_up_with_games");
    }));
  }

  function signalAppReady() {
    PubSub.publish("catch_up_with_games", Date.now());
  }

  function loadGameSummariesIntoDatabase() {
    var inviteMsgs = sbot.messagesByType({
      "type": "ssb_chess_invite"
    });

    var insertGamesThrough = pull(
      pull.asyncMap(getRelatedMessages),
      pull.asyncMap(storeGameHistoryIntoView)
    );

    pull(inviteMsgs,
      insertGamesThrough,
      pull.onEnd(() => {
        console.log("Caught up with game statuses so far. Watching for new updates.");
        signalAppReady();
        keepUpToDateWithGames();
      }));
  }

  return {
    loadGameSummariesIntoDatabase: loadGameSummariesIntoDatabase,
    pendingChallengesSent: pendingChallengesSent,
    pendingChallengesReceived: pendingChallengesReceived,
    getGamesAgreedToPlayIds: getGamesAgreedToPlayIds
  }
}
