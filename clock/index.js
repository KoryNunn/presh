module.exports = function createClock(){
    var work = require('webworkify');
    var w = work(require('./work.js'));

    var MINUTE_IN_MS = 60000;
    var currentBPM = {bpm: 120, ms: 500 / 4};

    var listeners = [];

    w.addEventListener('message', function(ev) {
        if (ev.data === 'tick') {
            for (var i = 0; i < listeners.length; i++) {
                listeners[i](listeners[i]._callCount);
                listeners[i]._callCount++;
            }
        }
    })

    function onTick(cb) {
        if(listeners.indexOf(cb) < 0){
          cb._callCount = 0;
          listeners.push(cb);
        }
    }

    function offTick(cb) {
        listeners.splice(listeners.indexOf(cb),1);
    }

    function setMS(ms) {
      setCurrent(null, ms);
      w.postMessage({interval: currentBPM.ms});
    }

    function setCurrent(bpm, ms) {
      if (bpm) {
        currentBPM = {
          bpm: bpm,
          ms: (MINUTE_IN_MS/bpm) / 4
        };
      } else {
        currentBPM = {
          bpm: MINUTE_IN_MS/ms,
          ms: ms / 4
        };
      }
    }

    function start() {
      w.postMessage('start');
    }

    function stop() {
      w.postMessage('stop');
    }

    function setBPM(BPM) {
      setCurrent(BPM);
      w.postMessage({interval: currentBPM.ms});
    }

    function getBPM() {
      return currentBPM;
    }

    return {
      onTick: onTick,
      offTick: offTick,
      setMS: setMS,
      start: start,
      stop: stop,
      setBPM: setBPM,
      getBPM: getBPM
    };
};