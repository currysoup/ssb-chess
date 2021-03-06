var m = require("mithril");
var Chessground = require('chessground').Chessground;
var PlayerModelUtils = require('../../ctrl/player_model_utils')();

module.exports = (summary, identPerspective) => {

  function renderSummary() {

    // An observer might not be in the 'players' list so we need a default
    // perspective of white for them.
    const playerColour = (summary.players[identPerspective] &&
       summary.players[identPerspective].colour) ? summary.players[identPerspective].colour: "white";

    var vDom = m('a', {class: 'cg-board-wrap', title: summary.gameId,
      href: '#!/games/' + btoa(summary.gameId)},
      m("div", {
        id: summary.gameId
      }))

    var config = {
      fen: summary.fen,
      viewOnly: true,
      orientation: playerColour
    };

    if (summary.lastMove) {
      config.lastMove = [summary.lastMove.orig, summary.lastMove.dest];
    }

    // The dom element isn't available yet
    setTimeout(() => {
      var element = vDom.dom;
      Chessground(element, config);
    });

    var coloursNames = PlayerModelUtils.coloursToNames(summary.players);
    var otherPlayerColour = playerColour == "white" ? "black" : "white";

    return m('div', {
        class: "ssb-chess-miniboard blue merida"
      }, [m('center', {class: "ssb-chess-miniboard-name"}, coloursNames[otherPlayerColour].substring(0, 10)),
      vDom,
      m('center', {class: "ssb-chess-miniboard-name"}, coloursNames[playerColour].substring(0, 10))]);
  }

  return {
    view: function() {
      return renderSummary();
    }
  }

}
