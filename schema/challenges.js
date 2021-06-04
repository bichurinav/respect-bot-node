const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const challengesSchema = new Schema({
    text: String,
});

const challenges = mongoose.model('challenges', challengesSchema);
const challengesMultiple = mongoose.model(
    'challengesmultiples',
    challengesSchema
);
module.exports = { challenges, challengesMultiple };
