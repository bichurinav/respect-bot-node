const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const roomSchema = new Schema({
    room: Number,
    list: [
        {
            user: String,
            status: String,
            respect: Number,
            report: Number,
            merit: Array,
            fail: Array
        }
    ]
});
const room = mongoose.model('Room', roomSchema);
module.exports = room;
