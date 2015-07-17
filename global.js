var fs = require('fs');
var sound = require('./sound');
var createSchedule = require('./schedule');

module.exports = {
    map: function(items, fn){
        return items.map(fn);
    },
    sound: sound,
    schedule: createSchedule
};