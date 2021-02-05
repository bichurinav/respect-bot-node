const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const roomSchema = new Schema({
    room: Number,
    list: [
        {
            user: String,
            firstName: String,
            lastName: String,
            status: String,
            respect: Number,
            report: Number,
            merit: Array,
            fail: Array
        }
    ],
    roulette: {
        gameStarted: Boolean,
        bullet: Number,
        players: [
            {
                user: String,
                bullet: Number,
                shot: Boolean
            }
        ]
    },
});

const room = mongoose.model('Room', roomSchema);
module.exports = room;
