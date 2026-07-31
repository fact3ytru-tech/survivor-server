const http = require('http');
const WebSocket = require('ws');

// 🔥 HTTP-сервер для проверки здоровья Render (и чтобы "будить" сервер)
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('🎮 Survivor Arena server is running');
});

// 🔥 WebSocket работает на том же порту
const wss = new WebSocket.Server({ server });

const rooms = new Map();
const PLAYER_COLORS = ['#6c5ce7', '#00cec9', '#fd79a8', '#fdcb6e', '#55efc4', '#ff7675'];

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

wss.on('connection', (ws) => {
    ws.id = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    ws.roomId = null;

    ws.on('message', (msg) => {
        let data;
        try { data = JSON.parse(msg); } catch (e) { return; }

        switch (data.type) {
            case 'init': {
                let room = null;
                for (const [id, r] of rooms) {
                    if (Object.keys(r.players).length < 6) { room = r; room.id = id; break; }
                }
                if (!room) {
                    const code = generateRoomCode();
                    room = { id: code, players: {}, hostId: null };
                    rooms.set(code, room);
                }

                const playerIndex = Object.keys(room.players).length;
                room.players[ws.id] = {
                    id: ws.id,
                    name: data.name || 'Игрок',
                    color: PLAYER_COLORS[playerIndex % PLAYER_COLORS.length],
                    ready: false,
                    isHost: data.isHost && !room.hostId,
                    x: 400, y: 300
                };
                if (data.isHost && !room.hostId) room.hostId = ws.id;
                ws.roomId = room.id;

                ws.send(JSON.stringify({
                    type: 'init_ok',
                    id: ws.id,
                    roomCode: room.id,
                    players: room.players
                }));
                broadcastLobby(room);
                break;
            }

            case 'ready': {
                const room = rooms.get(ws.roomId);
                if (room && room.players[ws.id]) {
                    room.players[ws.id].ready = !!data.ready;
                    broadcastLobby(room);
                }
                break;
            }

            case 'start_game': {
                const room = rooms.get(ws.roomId);
                if (room && room.hostId === ws.id) {
                    const allReady = Object.values(room.players).every(p => p.ready);
                    if (allReady) {
                        broadcastToRoom(room, { type: 'game_start' });
                    }
                }
                break;
            }

            case 'player_action': {
                const room = rooms.get(ws.roomId);
                if (room) {
                    if (room.players[ws.id]) {
                        Object.assign(room.players[ws.id], data);
                    }
                    broadcastToRoom(room, data, ws.id);
                }
                break;
            }

            case 'game_state': {
                const room = rooms.get(ws.roomId);
                if (room) broadcastToRoom(room, data, ws.id);
                break;
            }

            case 'leave': {
                handleDisconnect(ws);
                break;
            }
        }
    });

    ws.on('close', () => handleDisconnect(ws));
    ws.on('error', () => handleDisconnect(ws));
});

function handleDisconnect(ws) {
    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (!room) return;

    delete room.players[ws.id];

    if (room.hostId === ws.id) {
        const remaining = Object.keys(room.players);
        if (remaining.length > 0) {
            room.hostId = remaining[0];
            room.players[room.hostId].isHost = true;
        } else {
            rooms.delete(ws.roomId);
            return;
        }
    }

    broadcastToRoom(room, { type: 'player_left', playerId: ws.id });
    broadcastLobby(room);
    ws.roomId = null;
}

function broadcastLobby(room) {
    broadcastToRoom(room, { type: 'lobby_update', players: room.players });
}

function broadcastToRoom(room, data, exceptId = null) {
    wss.clients.forEach(c => {
        if (c.roomId === room.id && c.readyState === WebSocket.OPEN && c.id !== exceptId) {
            c.send(JSON.stringify(data));
        }
    });
}

// 🔥 Порт из окружения Render, локально — 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎮 Сервер запущен на порту ${PORT}`);
    console.log('📝 Ожидание подключений...');
});