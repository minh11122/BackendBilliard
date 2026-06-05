const mongoose = require('mongoose');
const TournamentRound = require("../models/tournament_round.model");

const connectDB = async () => {
    try {
        //await mongoose.connect(`${process.env.MONGODB_ALATAS_URL}`);
        await mongoose.connect(`${process.env.MONGODB_URL}`);
        await TournamentRound.ensureTournamentRoundIndexes();
        console.log('MongoDB connected successfully');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        throw error;
    }
};

module.exports = connectDB;
