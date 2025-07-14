import dotenv from 'dotenv';
dotenv.config();

import { Game } from "@gathertown/gather-game-client";
import mysql from "mysql2/promise";
import WebSocket from 'ws';

(globalThis as any).WebSocket = WebSocket;

const game = new Game(process.env.GATHER_SPACE_ID!, () =>
    Promise.resolve({ apiKey: process.env.GATHER_API_KEY! })
);

let db: mysql.Pool;
db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

const userHeartbeats: Record<string, Set<number>> = {};

game.connect();
game.subscribeToConnection((connected: boolean) => {
    if (!connected) return;
    console.log('Connected to Gather');
    setInterval(executeHeartbeats, 60000); // 1 minute interval
});

async function executeHeartbeats() {
    const players = game.players;
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000) * 60;

    for (const player of Object.values(players)) {
        if (!player?.id || !player.name || !player.status || player.name === 'Recording') continue;
        if (!['Available', 'Busy'].includes(player.status)) continue;

        const playerName = player.name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, "")
            .split(' ')
            .join('');
        const displayEmail = player.displayEmail || 'Unknown';

        const [rows] = await db.query(
            'SELECT api_key FROM users WHERE id = ? OR email = ?',
            [playerName, displayEmail]
        );
        const user = (rows as any[])[0];

        if (!user?.api_key) continue;

        if (!userHeartbeats[playerName]) {
            userHeartbeats[playerName] = new Set();
        }

        userHeartbeats[playerName].add(currentMinute);
    }

    for (const [userName, minutes] of Object.entries(userHeartbeats)) {
        const [rows] = await db.query(
            'SELECT api_key FROM users WHERE id = ?',
            [userName]
        );
        const user = (rows as any[])[0];
        if (!user?.api_key) continue;

        const heartbeats = Array.from(minutes).map(min => ({
            time: min,
            entity: 'Gather',
            type: 'app',
            project: 'Gather Client',
            plugin: 'gather-heartbeat/1.0.0',
            category: 'meeting',
            branch: 'main',
        }));

        if (heartbeats.length === 0) continue;

        await fetch(`${process.env.WAKAPI_API_URL}/users/current/heartbeats.bulk?api_key=${user.api_key}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Machine-Name': 'Gather',
                'User-Agent': 'gather-client/1.0.0 (Macintosh; Intel Mac OS X 10_15_7)',
            },
            body: JSON.stringify(heartbeats),
        });

        userHeartbeats[userName].clear();
    }
}
