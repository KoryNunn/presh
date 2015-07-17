function sound(path, bpm){

    //precache
    this.audio = new Audio(path);

    return function(){
        var audio = new Audio(path);
        audio.loop = false;
        audio.play();
        console.log(path);
    };
};


module.exports = sound;