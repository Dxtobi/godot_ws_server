import { v4 as uuidv4 } from 'uuid';

const lobbies = { team_match: [], free_for_all: [] };

export const createLobby = (matchType) => {
    const lobby = {
        id: uuidv4(),
        matchType,
        players: [],
        isGameActive: false,
        points: matchType === 'team_match' ? { team1: 0, team2: 0 } : {},
    };
    lobbies[matchType].push(lobby);
    return lobby;
};

export const findLobby = (matchType) => {
    return lobbies[matchType].find(l => l.players.length < 2);
};

export const broadcastToLobby = (lobby, message) => {
    lobby.players.forEach(player => {
        player.socket.send(JSON.stringify(message));
    });
};

export const broadcastToLobbyExceptTheBroadcaster = (lobby, message, broadcasterSocket) => {
    lobby.players.forEach(player => {
        if (player.socket !== broadcasterSocket && player.socket.readyState === WebSocket.OPEN) {
            player.socket.send(JSON.stringify(message));
        }
    });
};
