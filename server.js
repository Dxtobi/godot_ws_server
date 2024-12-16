import express from 'express';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { connectDB } from './config/db.js';
import { Player } from './models/player.js';
import { findLobby, createLobby, broadcastToLobby } from './services/lobbyService.js';
import { endGame } from './services/gameService.js';

connectDB();

const app = express();
const PORT = 8080;
const MAX_PLAYERS_PER_LOBBY = 2;
const GAME_DURATION = 6 * 60 * 1000; // 6 minutes

const onlinePlayers = new Map();
const lobbies = { team_match: [], free_for_all: [] };

// Attach WebSocketServer to the Express server
const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server });
var id_count = 0
// WebSocket logic
wss.on('connection', (ws) => {
    id_count+=1
    const player = { id: uuidv4(), socket: ws, name: '', phone: '', state: {}, kills: 0, deaths: 0, points: 0, rank: 0, };
    onlinePlayers.set(ws, player);

    console.log('New client connected');

    // Listen for messages from the client
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'register': {
                    const { name, phone, uniqueId } = data;

                    
                    // Find or create the player in the database
                    const dbPlayer = await Player.findOneAndUpdate(
                        { uniqueId },
                        { name, phone, uniqueId },
                        { upsert: true, new: true }
                    );
                    // Update the player object with database values
                    player.name = dbPlayer.name+`${id_count}`;
                    player.phone = dbPlayer.phone;
                    player.kills = dbPlayer.kills;
                    player.deaths = dbPlayer.deaths;
                    player.points = dbPlayer.totalPoints;
                    player.rank = dbPlayer.kills / Math.max(1, dbPlayer.deaths);

                    ws.send(JSON.stringify({ type: 'registered', id: player.id }));
                    break;
                }

                case 'join_match': {
                    const { matchType } = data;
                    const lobby = findLobby(matchType) || createLobby(matchType, lobbies, MAX_PLAYERS_PER_LOBBY);
                    player.lobbyId = lobby.id;

                    //Assign player to a team if it's a team match
                    
                    if (matchType === 'team_match') {
                        const teamACount = lobby.players.filter(p => p.team === 'Team-A').length;
                        const teamBCount = lobby.players.filter(p => p.team === 'Team-B').length;
                        player.team = teamACount <= teamBCount ? 'Team-A' : 'Team-B';
                    }

                   
                    lobby.players.push(player);

                    // Notify all players in the lobby of the new player list
                    const playerList = lobby.players.map(p => ({ id: p.id, name: p.name, rank:p.rank, team: p.team || null }));
                    broadcastToLobby(lobby, { type: 'lobby_update', players: playerList });
                    
                    ws.send(JSON.stringify({ type: 'joined_lobby', lobbyId: lobby.id }));

                    //Start game if lobby is full
                    if (lobby.players.length === MAX_PLAYERS_PER_LOBBY && !lobby.isGameActive) {
                        lobby.isGameActive = true;
                        lobby.gameStartTime = Date.now();

                        broadcastToLobby(lobby, { type: 'game_start', lobbyId: lobby.id });

                        // End the game after GAME_DURATION
                        setTimeout(async () => {
                            await endGame(lobby, lobbies);
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
        console.log('Client disconnected');
        id_count-=1
        // Remove player from their lobby
        const lobby = lobbies.team_match.concat(lobbies.free_for_all).find(l => l.id === player.lobbyId);

        if (lobby) {
            const playerList = lobby.players.map(p => ({ id: p.id, name: p.name, rank:p.rank }));
            broadcastToLobby(lobby, { type: 'lobby_update', players: playerList });
            lobby.players = lobby.players.filter(p => p.id !== player.id);
           
        }
    });
});

console.log('WebSocket server integrated with Express is running.');
