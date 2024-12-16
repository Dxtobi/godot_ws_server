import mongoose from 'mongoose';

const playerSchema = new mongoose.Schema({
    name: String,
    phone: String,
    uniqueId:String,
    kills: { type: Number, default: 0 },
    deaths: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },
    rank: { type: Number, default: 0 }, // Rank based on kills/deaths ratio
});

playerSchema.methods.updateRank = function () {
    this.rank = this.deaths === 0 ? this.kills : (this.kills / this.deaths).toFixed(2);
};

export const Player = mongoose.model('Player', playerSchema);
