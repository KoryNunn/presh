var createClock = require('./clock');

function schedule(bpm, bars){
    var clock = createClock();

    clock.setBPM(bpm);
    clock.start();

    return {
        add: clock.onTick,
        remove: clock.offTick,
        bpm: clock.setBPM,
        after: function(beats, callback){
            function countdown(){
                beats--;
                if(beats<=0){
                    callback();
                    clock.offTick(countdown);
                }
            }
            clock.onTick(countdown);
        }
    };
};


module.exports = schedule;