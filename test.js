// Import required modules
import WebSocket from 'ws';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/game_db', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const playerSchema = new mongoose.Schema({
    name: String,
    phone: String,
    kills: { type: Number, default: 0 },
    deaths: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 }
});

const Player = mongoose.model('Player', playerSchema);

// WebSocket server setup
const wss = new WebSocket.Server({ port: 8080 });

const onlinePlayers = new Map(); // Store connected players { socket: { id, name, phone, state, ... } }
const lobbies = { team_match: [], free_for_all: [] }; // Lobbies for match types
const MAX_PLAYERS_PER_LOBBY = 20;
const GAME_DURATION = 6 * 60 * 1000; // 6 minutes

// Helper functions
function createLobby(matchType) {
    return {
        id: uuidv4(),
        matchType,
        players: [],
        isGameActive: false,
        gameStartTime: null,
        points: matchType === 'team_match' ? { team1: 0, team2: 0 } : {},
        killLog: [] // Stores who killed whom
    };
}

function broadcastToLobby(lobby, message) {
    lobby.players.forEach(player => {
        if (onlinePlayers.has(player.socket)) {
            player.socket.send(JSON.stringify(message));
        }
    });
}

function calculateTeamPoints(teamPlayers) {
    const totalKills = teamPlayers.reduce((sum, p) => sum + p.kills, 0);
    const pointsPerPlayer = Math.ceil(totalKills / teamPlayers.length);
    return teamPlayers.map(player => ({ ...player, points: pointsPerPlayer }));
}

function findLobby(matchType) {
    let lobby = lobbies[matchType].find(l => l.players.length < MAX_PLAYERS_PER_LOBBY);
    if (!lobby) {
        lobby = createLobby(matchType);
        lobbies[matchType].push(lobby);
    }
    return lobby;
}

wss.on('connection', (ws) => {
    const player = { id: uuidv4(), socket: ws, name: '', phone: '', state: {}, kills: 0, deaths: 0, points: 0 };
    onlinePlayers.set(ws, player);

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'register': {
                    const { name, phone } = data;
                    player.name = name;
                    player.phone = phone;

                    await Player.findOneAndUpdate({ phone }, { name, phone }, { upsert: true });
                    ws.send(JSON.stringify({ type: 'registered', id: player.id }));
                    break;
                }

                case 'join_match': {
                    const { matchType } = data;
                    const lobby = findLobby(matchType);

                    player.lobbyId = lobby.id;
                    lobby.players.push(player);

                    ws.send(JSON.stringify({ type: 'joined_lobby', lobbyId: lobby.id }));

                    // Check if lobby is ready to start
                    if (lobby.players.length === MAX_PLAYERS_PER_LOBBY && !lobby.isGameActive) {
                        lobby.isGameActive = true;
                        lobby.gameStartTime = Date.now();

                        broadcastToLobby(lobby, { type: 'game_start', lobbyId: lobby.id });

                        // End the game after GAME_DURATION
                        setTimeout(() => {
                            const mvp = lobby.players.reduce((top, p) => (p.kills > top.kills ? p : top), { kills: 0 });
                            broadcastToLobby(lobby, { type: 'game_end', mvp: { name: mvp.name, kills: mvp.kills } });

                            // Update player records
                            await Promise.all(lobby.players.map(async p => {
                                await Player.findOneAndUpdate(
                                    { phone: p.phone },
                                    { $inc: { kills: p.kills, deaths: p.deaths, totalPoints: p.points } }
                                );
                            }));

                            // Reset lobby
                            lobby.players = [];
                            lobby.isGameActive = false;
                        }, GAME_DURATION);
                    }
                    break;
                }

                case 'update_state': {
                    const { state } = data;
                    player.state = state;

                    const lobby = lobbies.team_match.concat(lobbies.free_for_all).find(l => l.id === player.lobbyId);
                    if (lobby) {
                        broadcastToLobby(lobby, { type: 'update_state', playerId: player.id, state });
                    }
                    break;
                }

                case 'player_kill': {
                    const { killerId, victimId } = data;

                    const lobby = lobbies.team_match.concat(lobbies.free_for_all).find(l => l.id === player.lobbyId);
                    if (lobby) {
                        const killer = lobby.players.find(p => p.id === killerId);
                        const victim = lobby.players.find(p => p.id === victimId);

                        if (killer && victim) {
                            killer.kills += 1;
                            victim.deaths += 1;

                            if (lobby.matchType === 'team_match') {
                                const team = killer.team;
                                lobby.points[team] += 1;
                            }

                            broadcastToLobby(lobby, { type: 'player_kill', killerId, victimId });
                        }
                    }
                    break;
                }

                case 'ready': {
                    player.ready = true;
                    const lobby = lobbies.team_match.concat(lobbies.free_for_all).find(l => l.id === player.lobbyId);
                    if (lobby && lobby.players.every(p => p.ready)) {
                        broadcastToLobby(lobby, { type: 'all_ready' });
                    }
                    break;
                }
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });

    ws.on('close', () => {
        onlinePlayers.delete(ws);

        // Remove player from lobby
        const lobby = lobbies.team_match.concat(lobbies.free_for_all).find(l => l.id === player.lobbyId);
        if (lobby) {
            lobby.players = lobby.players.filter(p => p.id !== player.id);
        }
    });
});

console.log('WebSocket server is running on ws://localhost:8080');
