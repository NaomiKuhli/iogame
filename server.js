/***********************************************
 * server.js - Gesicherte Version mit Admin-Check
 ***********************************************/

// 1) Node-Module laden
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fetch = require('node-fetch');  // Wichtig für isUserAdmin()

// 2) Express aufsetzen
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 3) CORS aktivieren (ggf. einschränken)
const cors = require('cors');
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  credentials: true
}));

// 4) JSON-Parsing
app.use(express.json());

// 5) Statische Dateien (wenn du ein public-Verzeichnis hast)
app.use(express.static(path.join(__dirname, 'public')));

// 6) Standardroute
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

/***********************************************
 * Hilfsfunktion: isUserAdmin(token)
 * Ruft auth_check.php auf und prüft is_admin
 ***********************************************/
async function isUserAdmin(token) {
    if (!token) return false;

    try {
        // Deine URL zu auth_check.php (anpassen!)
        const url = 'https://nm-web.de/game/public/auth_check.php';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const data = await response.json();

        // Bei Erfolg => data.success = true, data.user.is_admin = true => Admin
        if (data.success && data.user && data.user.is_admin === true) {
            return true;
        }
    } catch (error) {
        console.error('Fehler bei isUserAdmin:', error);
    }
    return false;
}

/***********************************************
 * Spielkonstanten & Variablen
 ***********************************************/
const GAME_WIDTH = 4000;
const GAME_HEIGHT = 4000;
const PLAYER_BASE_SIZE = 25;
const BLOCK_COUNT = 250;
const BLOCK_SIZE = 30;
const BULLET_BASE_SIZE = 15;
const BULLET_LIFETIME = 5000;

const BASE_STATS = {
    healthRegen: 1,
    maxHealth: 100,
    bodyDamage: 10,
    bulletSpeed: 5,
    bulletPenetration: 1,
    bulletDamage: 10,
    reload: 800,
    movementSpeed: 3
};

// Upgrade-Effekte - Deine Werte
const UPGRADE_EFFECTS = {
    healthRegen: { baseValue: 1, upgradeMultiplier: 0.2 },
    maxHealth: { baseValue: 100, upgradeMultiplier: 0.15 },
    bodyDamage: { baseValue: 10, upgradeMultiplier: 0.25 },
    bulletSpeed: { baseValue: 5, upgradeMultiplier: 0.15 },
    bulletPenetration: { baseValue: 1, upgradeMultiplier: 0.25 },
    bulletDamage: { baseValue: 10, upgradeMultiplier: 0.2 },
    reload: { baseValue: 800, reductionFactor: 0.1 },
    movementSpeed: { baseValue: 3, upgradeMultiplier: 0.12 }
};

const BLOCK_TYPES = {
    SQUARE: {
        shape: 'square',
        size: 30,
        health: 50,
        xp: 10,
        points: 1,
        color: '#f1c40f',
        speed: 0.1
    },
    TRIANGLE: {
        shape: 'triangle',
        size: 30,
        health: 100,
        xp: 25,
        points: 2,
        color: '#e74c3c',
        speed: 0.2
    },
    PENTAGON: {
        shape: 'pentagon',
        size: 40,
        health: 200,
        xp: 100,
        points: 5,
        color: '#9b59b6',
        speed: 0.05
    }
};

const BASE_XP_FOR_LEVEL = 30;
const UPGRADE_COST_MULTIPLIER = 1.15;

// Spielzustand
const players = {};
const bullets = [];
const blocks = [];
const inactivePlayers = new Set();

// Blöcke initial anlegen
for (let i = 0; i < BLOCK_COUNT; i++) {
    let blockType;
    const rand = Math.random();
    if (rand < 0.7) blockType = BLOCK_TYPES.SQUARE;
    else if (rand < 0.9) blockType = BLOCK_TYPES.TRIANGLE;
    else blockType = BLOCK_TYPES.PENTAGON;

    blocks.push({
        id: `block-${i}`,
        x: Math.random() * GAME_WIDTH,
        y: Math.random() * GAME_HEIGHT,
        size: blockType.size,
        health: blockType.health,
        maxHealth: blockType.health,
        shape: blockType.shape,
        color: blockType.color,
        xp: blockType.xp,
        points: blockType.points,
        speedX: (Math.random() - 0.5) * blockType.speed,
        speedY: (Math.random() - 0.5) * blockType.speed,
        rotation: 0,
        rotationSpeed: (Math.random() - 0.5) * 0.02
    });
}

// Optional: Bot-System
// const botSystem = require('./bot.js')(io, players, bullets, blocks, BASE_STATS, ...);

/***********************************************
 * Socket.io
 ***********************************************/
io.on('connection', (socket) => {
    console.log(`Spieler verbunden: ${socket.id}`);

    // join-Event
    socket.on('join', (data) => {
        if (!data) data = {};

        const playerName = data.name || 'Unbenannt';
        const userToken = data.token || null;

        // Spielerobjekt
        const newPlayer = {
            id: socket.id,
            name: playerName,
            x: Math.random() * (GAME_WIDTH - 200) + 100,
            y: Math.random() * (GAME_HEIGHT - 200) + 100,
            angle: 0,
            health: BASE_STATS.maxHealth,
            maxHealth: BASE_STATS.maxHealth,
            score: 0,
            level: 1,
            xp: 0,
            xpToNextLevel: BASE_XP_FOR_LEVEL,
            totalXp: 0,
            upgrades: {
                healthRegen: { level: 1, max: 10 },
                maxHealth: { level: 1, max: 10 },
                bodyDamage: { level: 1, max: 10 },
                bulletSpeed: { level: 1, max: 10 },
                bulletPenetration: { level: 1, max: 10 },
                bulletDamage: { level: 1, max: 10 },
                reload: { level: 1, max: 10 },
                movementSpeed: { level: 1, max: 10 }
            },
            totalUpgrades: 0,
            maxTotalUpgrades: 45,
            availableUpgrades: 0,
            isLeader: false,
            lastShootTime: 0,
            lastActiveTime: Date.now(),
            godMode: false,
            xpMultiplier: 1,
            doubleCannon: false,
            token: userToken // Merken, falls wir es später brauchen
        };

        // Upgrade-Code abfangen
        if (data.upgrade) {
            switch (data.upgrade) {
                case 'start_level_5':
                    newPlayer.level = 5;
                    newPlayer.availableUpgrades = 4;
                    newPlayer.xpToNextLevel = Math.floor(
                        BASE_XP_FOR_LEVEL * Math.pow(1.2, newPlayer.level - 1)
                    );
                    break;
                case 'god_mode_30':
                    // Wenn du das jedem erlauben willst, OK
                    // Sonst nur Admin: => if (await isUserAdmin(userToken)) { ... }
                    newPlayer.godMode = true;
                    setTimeout(() => {
                        if (players[socket.id]) {
                            players[socket.id].godMode = false;
                            io.to(socket.id).emit('godModeEnded');
                        }
                    }, 30000);
                    break;
                case 'double_xp':
                    newPlayer.xpMultiplier = 2;
                    break;
                case 'double_cannon':
                    newPlayer.doubleCannon = true;
                    break;
            }
        }

        players[socket.id] = newPlayer;

        // Init an den Client
        socket.emit('init', {
            player: newPlayer,
            players,
            blocks
        });

        // Allen anderen mitteilen
        socket.broadcast.emit('playerJoined', newPlayer);
        updateLeaderboard();
    });

    /***********************************************
     * Admin-Events
     ***********************************************/

    // God-Mode toggeln
    socket.on('toggle_god_mode', async (payload) => {
        const player = players[socket.id];
        if (!player) return;

        const token = payload.token; // Vom Client
        const isAdmin = await isUserAdmin(token);
        if (!isAdmin) {
            console.warn(`Nicht-Admin versucht God-Mode zu togglen: ${socket.id}`);
            return;
        }

        player.godMode = !!payload.enabled;
        console.log(`God-Mode bei ${player.name} = ${player.godMode}`);
    });

    // admin_give_levels
    socket.on('admin_give_levels', async (data) => {
        const token = data.token;
        const isAdmin = await isUserAdmin(token);
        if (!isAdmin) {
            console.warn(`Nicht-Admin versucht admin_give_levels`);
            return;
        }

        const playerId = data.playerId;
        const levels = data.levels || 1;
        if (!playerId || !players[playerId]) return;

        const targetPlayer = players[playerId];
        for (let i = 0; i < levels; i++) {
            targetPlayer.level += 1;
            targetPlayer.availableUpgrades += 1;
            targetPlayer.xpToNextLevel = Math.floor(
                BASE_XP_FOR_LEVEL * Math.pow(1.2, targetPlayer.level - 1)
            );
        }

        io.to(playerId).emit('levelUp', {
            level: targetPlayer.level,
            xpToNextLevel: targetPlayer.xpToNextLevel,
            availableUpgrades: targetPlayer.availableUpgrades
        });

        updateLeaderboard();
    });

    // admin_kill_player
    socket.on('admin_kill_player', async (data) => {
        const token = data.token;
        const isAdmin = await isUserAdmin(token);
        if (!isAdmin) {
            console.warn(`Nicht-Admin versucht admin_kill_player`);
            return;
        }

        const playerId = data.playerId;
        if (!playerId || !players[playerId]) return;

        const targetPlayer = players[playerId];
        io.to(playerId).emit('died', {
            score: targetPlayer.score,
            level: targetPlayer.level,
            killerName: "Admin",
            killerId: null
        });
        delete players[playerId];
        io.emit('playerLeft', playerId);
        updateLeaderboard();
    });

    // admin_spawn_bot
    socket.on('admin_spawn_bot', async () => {
        // Falls du Bot-System nutzt
        const player = players[socket.id];
        if (!player) return;

        const isAdmin = await isUserAdmin(player.token);
        if (!isAdmin) {
            console.warn(`Nicht-Admin versucht admin_spawn_bot`);
            return;
        }
        // botSystem.createBot();
    });

    /***********************************************
     * Normale Spieler-Events
     ***********************************************/

    // Move
    socket.on('move', (data) => {
        const player = players[socket.id];
        if (!player) return;

        const speed = BASE_STATS.movementSpeed * (
            1 + (player.upgrades.movementSpeed.level - 1) * UPGRADE_EFFECTS.movementSpeed.upgradeMultiplier
        );

        player.x += data.dx * speed;
        player.y += data.dy * speed;
        player.x = Math.max(0, Math.min(GAME_WIDTH, player.x));
        player.y = Math.max(0, Math.min(GAME_HEIGHT, player.y));
        player.lastActiveTime = Date.now();
    });

    // Rotate
    socket.on('rotate', (angle) => {
        const player = players[socket.id];
        if (!player) return;
        player.angle = angle;
        player.lastActiveTime = Date.now();
    });

    // Shoot
    socket.on('shoot', () => {
        const player = players[socket.id];
        if (!player) return;

        const now = Date.now();
        const reloadTime = BASE_STATS.reload *
          Math.pow(1 - UPGRADE_EFFECTS.reload.reductionFactor, player.upgrades.reload.level - 1);

        if (now - player.lastShootTime < reloadTime) return;
        player.lastShootTime = now;
        player.lastActiveTime = now;

        const bulletSpeed = BASE_STATS.bulletSpeed * (
            1 + (player.upgrades.bulletSpeed.level - 1) * UPGRADE_EFFECTS.bulletSpeed.upgradeMultiplier
        );
        const bulletSize = BULLET_BASE_SIZE * (1 + (player.upgrades.bulletDamage.level - 1) * 0.08);

        const bullet = {
            id: `bullet-${socket.id}-${now}`,
            ownerId: socket.id,
            x: player.x + Math.cos(player.angle) * PLAYER_BASE_SIZE * 1.5,
            y: player.y + Math.sin(player.angle) * PLAYER_BASE_SIZE * 1.5,
            speedX: Math.cos(player.angle) * bulletSpeed,
            speedY: Math.sin(player.angle) * bulletSpeed,
            damage: BASE_STATS.bulletDamage * (
              1 + (player.upgrades.bulletDamage.level - 1) * UPGRADE_EFFECTS.bulletDamage.upgradeMultiplier
            ),
            size: bulletSize,
            health: BASE_STATS.bulletPenetration * (
              1 + (player.upgrades.bulletPenetration.level - 1) * UPGRADE_EFFECTS.bulletPenetration.upgradeMultiplier
            ),
            penetration: BASE_STATS.bulletPenetration * (
              1 + (player.upgrades.bulletPenetration.level - 1) * UPGRADE_EFFECTS.bulletPenetration.upgradeMultiplier
            ),
            createdAt: now
        };
        bullets.push(bullet);

        if (player.doubleCannon) {
            const offset = Math.PI / 18;
            const secondBullet = { ...bullet };
            secondBullet.id += '-2';
            secondBullet.x = player.x + Math.cos(player.angle + offset) * PLAYER_BASE_SIZE * 1.5;
            secondBullet.y = player.y + Math.sin(player.angle + offset) * PLAYER_BASE_SIZE * 1.5;
            secondBullet.speedX = Math.cos(player.angle + offset) * bulletSpeed;
            secondBullet.speedY = Math.sin(player.angle + offset) * bulletSpeed;
            bullets.push(secondBullet);
        }
    });

    // takeDamage (z.B. durch Blöcke)
    socket.on('takeDamage', (data) => {
        const player = players[socket.id];
        if (!player) return;

        if (player.godMode) return; // kein Schaden im Godmode

        player.health = Math.max(0, player.health - data.damage);
        io.emit('playerDamaged', {
            id: socket.id,
            health: player.health
        });

        // Schaden durch Block
        if (data.type === 'block') {
            const block = blocks.find(b => b.id === data.id);
            if (block) {
                block.health = Math.max(0, block.health - data.damage);
                io.emit('blockDamaged', { id: block.id, health: block.health });

                if (block.health <= 0) {
                    // Punkte & XP
                    player.score += block.points * 10;
                    const gainedXp = block.xp * (player.xpMultiplier || 1);
                    player.xp += gainedXp;
                    player.totalXp += gainedXp;
                    checkLevelUp(player);

                    // Respawn Block
                    block.x = Math.random() * GAME_WIDTH;
                    block.y = Math.random() * GAME_HEIGHT;
                    block.health = block.maxHealth;
                    const blockType = getBlockTypeByShape(block.shape);
                    if (blockType) {
                        block.speedX = (Math.random() - 0.5) * blockType.speed;
                        block.speedY = (Math.random() - 0.5) * blockType.speed;
                        block.rotationSpeed = (Math.random() - 0.5) * 0.02;
                    }
                }
            }
        }

        // Spieler gestorben
        if (player.health <= 0) {
            socket.emit('died', {
                score: player.score,
                level: player.level,
                killerName: data.killerName || "Unbekannt",
                killerId: data.killerId || null
            });
            delete players[socket.id];
            io.emit('playerLeft', socket.id);
            updateLeaderboard();
        }
    });

    // Upgrade
    socket.on('upgrade', (skill) => {
        const player = players[socket.id];
        if (!player) return;

        const upgrade = player.upgrades[skill];
        if (
            upgrade && 
            player.availableUpgrades > 0 &&
            upgrade.level < upgrade.max &&
            player.totalUpgrades < player.maxTotalUpgrades
        ) {
            player.availableUpgrades--;
            upgrade.level++;
            player.totalUpgrades++;
            updatePlayerStats(player);

            socket.emit('upgradeApplied', {
                skill,
                level: upgrade.level,
                totalUpgrades: player.totalUpgrades,
                maxTotalUpgrades: player.maxTotalUpgrades,
                availableUpgrades: player.availableUpgrades
            });
        }
    });

    // Spieler inaktiv / aktiv
    socket.on('inactive', () => {
        inactivePlayers.add(socket.id);
    });
    socket.on('active', () => {
        inactivePlayers.delete(socket.id);
        if (players[socket.id]) {
            players[socket.id].lastActiveTime = Date.now();
        }
    });

    // disconnect
    socket.on('disconnect', () => {
        if (players[socket.id]) {
            delete players[socket.id];
            io.emit('playerLeft', socket.id);
            updateLeaderboard();
        }
        inactivePlayers.delete(socket.id);
        console.log(`Spieler getrennt: ${socket.id}`);
    });
});

/***********************************************
 * Hilfsfunktionen
 ***********************************************/
function checkLevelUp(player) {
    while (player.xp >= player.xpToNextLevel) {
        player.xp -= player.xpToNextLevel;
        player.level++;
        player.availableUpgrades++;
        player.xpToNextLevel = Math.floor(
            BASE_XP_FOR_LEVEL * Math.pow(1.2, player.level - 1)
        );
        io.to(player.id).emit('levelUp', {
            level: player.level,
            xpToNextLevel: player.xpToNextLevel,
            availableUpgrades: player.availableUpgrades
        });
        updateLeaderboard();
    }
}

function updatePlayerStats(player) {
    // Beispiel: maxHealth
    player.maxHealth = BASE_STATS.maxHealth *
      (1 + (player.upgrades.maxHealth.level - 1) * UPGRADE_EFFECTS.maxHealth.upgradeMultiplier);
    // usw.
}

function getBlockTypeByShape(shape) {
    switch (shape) {
        case 'square': return BLOCK_TYPES.SQUARE;
        case 'triangle': return BLOCK_TYPES.TRIANGLE;
        case 'pentagon': return BLOCK_TYPES.PENTAGON;
        default: return null;
    }
}

function updateLeaderboard() {
    const sortedPlayers = Object.values(players).sort((a, b) => b.score - a.score);
    if (sortedPlayers[0]) sortedPlayers[0].isLeader = true;
    const top = sortedPlayers.slice(0, 5).map(p => ({
        id: p.id, name: p.name, level: p.level, score: p.score
    }));
    io.emit('leaderboard', {
        players: top,
        totalPlayers: Object.keys(players).length
    });
}

/***********************************************
 * Server starten
 ***********************************************/
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});
