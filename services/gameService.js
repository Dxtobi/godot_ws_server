import { Player } from '../models/player.js';
import { broadcastToLobby } from './lobbyService.js';

export const endGame = async (lobby) => {
    const mvp = lobby.players.reduce((top, p) => (p.kills > top.kills ? p : top), { kills: 0 });
    broadcastToLobby(lobby, { type: 'game_end', mvp: { name: mvp.name, kills: mvp.kills } });

    await Promise.all(
        lobby.players.map(async (player) => {
            player.points += player.kills; // Example logic for points
            const dbPlayer = await Player.findOne({ phone: player.phone });
            if (dbPlayer) {
                dbPlayer.kills += player.kills;
                dbPlayer.deaths += player.deaths;
                dbPlayer.totalPoints += player.points;
                dbPlayer.updateRank();
                await dbPlayer.save();
            }
        })
    );

    lobby.players = [];
    lobby.isGameActive = false;
};
