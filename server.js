// Alle erforderlichen Module importieren
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// Express-App initialisieren
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// CORS aktivieren
const cors = require('cors');
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  credentials: true
}));

// Statische Dateien aus dem 'public'-Verzeichnis bereitstellen
app.use(express.static(path.join(__dirname, 'public')));

// Route für die Hauptseite
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Spielkonstanten
const GAME_WIDTH = 4000;
const GAME_HEIGHT = 4000;
const PLAYER_BASE_SIZE = 25; // Spieler etwas kleiner machen
const BLOCK_COUNT = 250; // Mehr Blöcke für mehr Action
const BLOCK_SIZE = 30;
const BULLET_BASE_SIZE = 15; // Noch größere Kugeln wie in Diep.io
const BULLET_LIFETIME = 5000; // 5 Sekunden Lebensdauer für Kugeln
const BASE_STATS = {
    healthRegen: 1,
    maxHealth: 100,
    bodyDamage: 10,
    bulletSpeed: 5,
    bulletPenetration: 1, // Durchdringungskraft der Kugeln
    bulletDamage: 10,
    reload: 800, // ms zwischen Schüssen - erhöht auf 800ms für langsameres Schießen
    movementSpeed: 3
};

// NEUE VERBESSERTE UPGRADE-EFFEKTE
const UPGRADE_EFFECTS = {
    healthRegen: {
        baseValue: 1,
        upgradeMultiplier: 0.2  // +20% pro Level (war ~10%)
    },
    maxHealth: {
        baseValue: 100,
        upgradeMultiplier: 0.15 // +15% pro Level (war 10%)
    },
    bodyDamage: {
        baseValue: 10,
        upgradeMultiplier: 0.25 // +25% pro Level (war ~10%)
    },
    bulletSpeed: {
        baseValue: 5,
        upgradeMultiplier: 0.15 // +15% pro Level (war 10%)
    },
    bulletPenetration: {
        baseValue: 1,
        upgradeMultiplier: 0.25 // +25% pro Level (war 10%)
    },
    bulletDamage: {
        baseValue: 10,
        upgradeMultiplier: 0.2  // +20% pro Level (war 10%)
    },
    reload: {
        baseValue: 800,
        reductionFactor: 0.1    // 10% Reduktion pro Level (war 7%)
    },
    movementSpeed: {
        baseValue: 3,
        upgradeMultiplier: 0.12 // +12% pro Level (war 10%)
    }
};

// Block-Typen und deren Werte
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

// XP für Level-Aufstiege
const BASE_XP_FOR_LEVEL = 30; // 3 gelbe Blöcke für Level 2

// Upgrade-Kosten-Multiplikator (15% teurer pro Level)
const UPGRADE_COST_MULTIPLIER = 1.15;

// Spielzustand
const players = {};
const bullets = [];
const blocks = [];
const inactivePlayers = new Set();

// Importiere das Bot-System
const botSystem = require('./bot.js');

// Zufällige Blöcke verschiedener Typen generieren
for (let i = 0; i < BLOCK_COUNT; i++) {
    let blockType;
    const rand = Math.random();

    // Verteilung: 70% Quadrate, 20% Dreiecke, 10% Pentagone
    if (rand < 0.7) {
        blockType = BLOCK_TYPES.SQUARE;
    } else if (rand < 0.9) {
        blockType = BLOCK_TYPES.TRIANGLE;
    } else {
        blockType = BLOCK_TYPES.PENTAGON;
    }

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

// Socket.io Event-Handling
io.on('connection', (socket) => {
    console.log(`Spieler verbunden: ${socket.id}`);

    // Spieler beitritt verarbeiten
    socket.on('join', (data) => {
        console.log("Spieler verbindet sich:", data);
        
        // Falls kein Data-Objekt übergeben wird, erstellen wir eines
        if (!data) data = {};
    
        // Spielername aus den Daten oder der URL-Query
        const query = socket.handshake.query;
        const playerName = data.name || query.name || 'Unbenannt';
        
        // Upgrade-Informationen extrahieren
        let upgradeCode = null;
        if (data && data.upgrade) {
            upgradeCode = data.upgrade;
            console.log(`Spieler ${playerName} möchte Upgrade verwenden: ${upgradeCode}`);
        }
    
        // Standardwerte für Upgrade-Eigenschaften festlegen
        const playerSettings = {
            doubleCannon: false,
            xpMultiplier: 1,
            godMode: false,
            level: 1,
            availableUpgrades: 0
        };
        
        // Upgrade-Einstellungen vorverarbeiten
        if (upgradeCode) {
            console.log(`Verarbeite Upgrade: ${upgradeCode}`);
            switch(upgradeCode) {
                case 'start_level_5':
                    playerSettings.level = 5;
                    playerSettings.availableUpgrades = 4;
                    break;
                case 'god_mode_30':
                    playerSettings.godMode = true;
                    break;
                case 'double_xp':
                    playerSettings.xpMultiplier = 2;
                    break;
                case 'double_cannon':
                    playerSettings.doubleCannon = true;
                    break;
                default:
                    console.log(`Unbekanntes Upgrade: ${upgradeCode}`);
            }
        }
    
        // Neuen Spieler erstellen - jetzt mit den Upgrade-Eigenschaften
        const player = {
            id: socket.id,
            name: playerName,
            x: Math.random() * (GAME_WIDTH - 200) + 100,
            y: Math.random() * (GAME_HEIGHT - 200) + 100,
            angle: 0,
            health: BASE_STATS.maxHealth,
            maxHealth: BASE_STATS.maxHealth,
            score: 0,
            level: playerSettings.level,
            xp: 0,
            xpToNextLevel: BASE_XP_FOR_LEVEL * Math.pow(1.2, playerSettings.level - 1),
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
            availableUpgrades: playerSettings.availableUpgrades,
            isLeader: false,
            lastShootTime: 0,
            lastActiveTime: Date.now(),
            // Die vorverarbeiteten Upgrade-Eigenschaften
            godMode: playerSettings.godMode,
            doubleCannon: playerSettings.doubleCannon,
            xpMultiplier: playerSettings.xpMultiplier
        };
    
        // Spieler zum Spiel hinzufügen
        players[socket.id] = player;
    
        // Nachträgliche Verarbeitung des God-Mode-Timers
        if (playerSettings.godMode) {
            console.log(`God Mode Timer für ${playerName} gestartet (30s)`);
            setTimeout(() => {
                if (players[socket.id]) {
                    players[socket.id].godMode = false;
                    io.to(socket.id).emit('godModeEnded');
                    console.log(`God Mode für ${playerName} beendet`);
                }
            }, 30000);
        }
    
        // Initialen Spielzustand an Spieler senden
        socket.emit('init', {
            player,
            players,
            blocks
        });
    
        // Neuen Spieler an alle anderen Spieler senden
        socket.broadcast.emit('playerJoined', player);
    
        // Bestenliste aktualisieren
        updateLeaderboard();
    });

    // Verbesserte Admin-Befehle mit Token-Authentifizierung
    socket.on('admin_toggle_god_mode', (data) => {
        // Prüfen, ob Token und Admin-Status vorhanden sind
        if (!data || !data.token) {
            console.log("God-Mode-Anfrage ohne Token abgelehnt");
            return;
        }
        
        // Admin-Authentifizierung durchführen
        verifyAdminToken(data.token, (isAdmin) => {
            if (!isAdmin) {
                console.log(`God-Mode-Anfrage mit ungültigem Admin-Token abgelehnt: ${data.token}`);
                return;
            }

            // Spieler aus Socket.ID ermitteln
            const player = players[socket.id];
            if (!player) return;

            // God-Mode umschalten
            player.godMode = !!data.enabled;
            console.log(`God-Mode ${player.godMode ? 'aktiviert' : 'deaktiviert'} für Spieler ${player.name} (Admin-Aktion)`);
        });
    });

    socket.on('admin_give_levels', (data) => {
        // Admin-Rechte prüfen
        if (!data || !data.token) return;
        
        verifyAdminToken(data.token, (isAdmin) => {
            if (!isAdmin) return;
            
            const playerId = data.playerId;
            const levels = data.levels;

            if (!playerId || !players[playerId]) return;

            const targetPlayer = players[playerId];

            // Level hinzufügen
            for (let i = 0; i < levels; i++) {
                targetPlayer.level += 1;
                targetPlayer.availableUpgrades += 1;

                // Nächstes Level braucht mehr XP (20% mehr pro Level)
                targetPlayer.xpToNextLevel = Math.floor(BASE_XP_FOR_LEVEL * Math.pow(1.2, targetPlayer.level - 1));
            }

            // Spieler über Level-Up informieren
            io.to(playerId).emit('levelUp', {
                level: targetPlayer.level,
                xpToNextLevel: targetPlayer.xpToNextLevel,
                availableUpgrades: targetPlayer.availableUpgrades
            });

            // Bestenliste aktualisieren
            updateLeaderboard();
        });
    });

    socket.on('admin_kill_player', (data) => {
        // Admin-Rechte prüfen
        if (!data || !data.token) return;
        
        verifyAdminToken(data.token, (isAdmin) => {
            if (!isAdmin) return;
            
            const playerId = data.playerId;

            if (!playerId || !players[playerId]) return;

            const targetPlayer = players[playerId];

            // Spieler über Tod benachrichtigen
            io.to(playerId).emit('died', {
                score: targetPlayer.score,
                level: targetPlayer.level,
                killerName: "Admin",
                killerId: null
            });

            // Spieler entfernen
            delete players[playerId];
            io.emit('playerLeft', playerId);

            // Bestenliste aktualisieren
            updateLeaderboard();
        });
    });

    socket.on('admin_spawn_bot', (data) => {
        // Admin-Rechte prüfen
        if (!data || !data.token) return;
        
        verifyAdminToken(data.token, (isAdmin) => {
            if (!isAdmin) return;
            
            // Bot-System aufrufen um einen Bot zu spawnen
            if (typeof botManager === 'object' && botManager.createBot) {
                botManager.createBot();
            }
        });
    });

    // Funktion zur Überprüfung eines Admin-Tokens
    function verifyAdminToken(token, callback) {
        // Hier müsstest du einen HTTP-Request an deinen Auth-Server senden
        // Für dieses Beispiel verwenden wir eine vereinfachte Version
        const https = require('https');
        
        const options = {
            hostname: 'nm-web.de',
            path: `/check_admin_status.php?token=${encodeURIComponent(token)}`,
            method: 'GET'
        };

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    callback(response.success && response.is_admin);
                } catch (e) {
                    console.error("Fehler beim Parsen der Admin-Überprüfungsantwort:", e);
                    callback(false);
                }
            });
        });
        
        req.on('error', (e) => {
            console.error(`Problem mit der Admin-Verifizierung: ${e.message}`);
            callback(false);
        });
        
        req.end();
    }

    // NEU: God-Mode umschalten
    socket.on('toggle_god_mode', (enabled) => {
        const player = players[socket.id];
        if (player) {
            player.godMode = enabled;
            console.log(`God-Mode ${enabled ? 'aktiviert' : 'deaktiviert'} für Spieler ${player.name}`);
        }
    });

    // Spielerbewegung verarbeiten
    socket.on('move', (data) => {
        const player = players[socket.id];
        if (!player) return;

        // VERBESSERT: Bewegungsgeschwindigkeit mit verbesserten Upgrade-Effekten
        const speed = BASE_STATS.movementSpeed * (1 + (player.upgrades.movementSpeed.level - 1) * UPGRADE_EFFECTS.movementSpeed.upgradeMultiplier);

        // Position aktualisieren
        player.x += data.dx * speed;
        player.y += data.dy * speed;

        // Spieler innerhalb der Spielgrenzen halten
        player.x = Math.max(0, Math.min(GAME_WIDTH, player.x));
        player.y = Math.max(0, Math.min(GAME_HEIGHT, player.y));

        // Aktivitätszeit aktualisieren
        player.lastActiveTime = Date.now();
    });

    // Spielerrotation verarbeiten
    socket.on('rotate', (angle) => {
        const player = players[socket.id];
        if (player) {
            player.angle = angle;
            player.lastActiveTime = Date.now();
        }
    });

    // Spieler schießt
    socket.on('shoot', () => {
        const player = players[socket.id];
        if (!player) return;

        // VERBESSERT: Nachladezeit mit verbesserten Upgrade-Effekten
        const now = Date.now();
        const reloadTime = BASE_STATS.reload * Math.pow(1 - UPGRADE_EFFECTS.reload.reductionFactor, player.upgrades.reload.level - 1);

        if (now - player.lastShootTime < reloadTime) {
            return; // Noch am Nachladen
        }

        player.lastShootTime = now;
        player.lastActiveTime = now;

        // VERBESSERT: Geschossgeschwindigkeit mit verbesserten Upgrade-Effekten
        const bulletSpeed = BASE_STATS.bulletSpeed * (1 + (player.upgrades.bulletSpeed.level - 1) * UPGRADE_EFFECTS.bulletSpeed.upgradeMultiplier);

        // VERBESSERT: Geschossgröße mit verbesserten Upgrade-Effekten
        const bulletSize = BULLET_BASE_SIZE * (1 + (player.upgrades.bulletDamage.level - 1) * 0.08);

        // Neues Geschoss erstellen
        const bullet = {
            id: `bullet-${socket.id}-${now}`,
            ownerId: socket.id,
            x: player.x + Math.cos(player.angle) * PLAYER_BASE_SIZE * 1.5,
            y: player.y + Math.sin(player.angle) * PLAYER_BASE_SIZE * 1.5,
            speedX: Math.cos(player.angle) * bulletSpeed,
            speedY: Math.sin(player.angle) * bulletSpeed,
            // VERBESSERT: Geschossschaden mit verbesserten Upgrade-Effekten
            damage: BASE_STATS.bulletDamage * (1 + (player.upgrades.bulletDamage.level - 1) * UPGRADE_EFFECTS.bulletDamage.upgradeMultiplier),
            size: bulletSize,
            // VERBESSERT: Geschosspenetration mit verbesserten Upgrade-Effekten
            health: BASE_STATS.bulletPenetration * (1 + (player.upgrades.bulletPenetration.level - 1) * UPGRADE_EFFECTS.bulletPenetration.upgradeMultiplier),
            penetration: BASE_STATS.bulletPenetration * (1 + (player.upgrades.bulletPenetration.level - 1) * UPGRADE_EFFECTS.bulletPenetration.upgradeMultiplier),
            createdAt: now
        };

        bullets.push(bullet);

        // Wenn Spieler Doppelkanone hat, zweites Geschoss hinzufügen
        if (player.doubleCannon) {
            // Zweites Geschoss mit leicht geändertem Winkel
            const offset = Math.PI / 18; // 10 Grad Offset
            const secondBullet = {
                id: `bullet-${socket.id}-${now}-2`,
                ownerId: socket.id,
                x: player.x + Math.cos(player.angle + offset) * PLAYER_BASE_SIZE * 1.5,
                y: player.y + Math.sin(player.angle + offset) * PLAYER_BASE_SIZE * 1.5,
                speedX: Math.cos(player.angle + offset) * bulletSpeed,
                speedY: Math.sin(player.angle + offset) * bulletSpeed,
                damage: bullet.damage,
                size: bullet.size,
                health: bullet.health,
                penetration: bullet.penetration,
                createdAt: now
            };
            bullets.push(secondBullet);
        }
    });

    // NEU: Handler für Schadensereignisse
    socket.on('takeDamage', (data) => {
        const player = players[socket.id];
        if (!player) return;

        // VERBESSERT: Wenn Spieler im God-Mode, keinen Schaden nehmen
        if (player.godMode) return;

        // Schaden anwenden
        player.health = Math.max(0, player.health - data.damage);

        // Anderen Spielern mitteilen
        io.emit('playerDamaged', {
            id: socket.id,
            health: player.health
        });

        // Wenn Schaden durch Block verursacht wurde
        if (data.type === 'block') {
            const block = blocks.find(b => b.id === data.id);
            if (block) {
                block.health = Math.max(0, block.health - data.damage);

                // Block-Zustand an alle senden
                io.emit('blockDamaged', {
                    id: block.id,
                    health: block.health
                });

                // Block respawnen, wenn zerstört
                if (block.health <= 0) {
                    // Punkte an Spieler vergeben
                    player.score += block.points * 10;

                    const gainedXp = block.points * 10;
                    checkLevelUp(player, gainedXp);

                    // Block an neuer Position respawnen
                    block.x = Math.random() * GAME_WIDTH;
                    block.y = Math.random() * GAME_HEIGHT;
                    block.health = block.maxHealth;

                    // Zufällige Geschwindigkeit und Rotationsgeschwindigkeit
                    const blockType = getBlockTypeByShape(block.shape);
                    if (blockType) {
                        block.speedX = (Math.random() - 0.5) * blockType.speed;
                        block.speedY = (Math.random() - 0.5) * blockType.speed;
                        block.rotationSpeed = (Math.random() - 0.5) * 0.02;
                    }
                }
            }
        }

        // Spieler ist gestorben
        if (player.health <= 0) {
            // VERBESSERT: Killer ID für Death Screen
            socket.emit('died', {
                score: player.score,
                level: player.level,
                killerName: "unknown", // In diesem Fall ist der Killer normalerweise ein Block
                killerId: null
            });
            delete players[socket.id];
            io.emit('playerLeft', socket.id);

            // Bestenliste aktualisieren
            updateLeaderboard();
        }
    });

    // Upgrade-Anfragen verarbeiten (nur mit Level-Punkten)
    socket.on('upgrade', (skill) => {
        const player = players[socket.id];
        if (!player) return;

        const upgrade = player.upgrades[skill];

        // Prüfen, ob Upgrade gültig ist
        if (
            upgrade && 
            player.availableUpgrades > 0 && 
            upgrade.level < upgrade.max &&
            player.totalUpgrades < player.maxTotalUpgrades // Gesamtlimit prüfen
        ) {
            // Upgrade anwenden
            player.availableUpgrades -= 1;
            upgrade.level += 1;
            player.totalUpgrades += 1;

            // Spielerstats basierend auf Upgrades aktualisieren
            updatePlayerStats(player);

            // Aktivitätszeit aktualisieren
            player.lastActiveTime = Date.now();

            // Upgrade-Status an Spieler senden
            socket.emit('upgradeApplied', {
                skill,
                level: upgrade.level,
                totalUpgrades: player.totalUpgrades,
                maxTotalUpgrades: player.maxTotalUpgrades,
                availableUpgrades: player.availableUpgrades
            });
        }
    });

    // Spielerinaktivität verarbeiten
    socket.on('inactive', () => {
        inactivePlayers.add(socket.id);
    });

    socket.on('active', () => {
        inactivePlayers.delete(socket.id);
        if (players[socket.id]) {
            players[socket.id].lastActiveTime = Date.now();
        }
    });

    // Spieler-Disconnect verarbeiten
    socket.on('disconnect', () => {
        console.log(`Spieler getrennt: ${socket.id}`);

        // Wenn der Spieler authentifiziert war, sende Spielstatistiken an den Server
        if (players[socket.id] && players[socket.id].token) {
            const player = players[socket.id];

            // Fetch-Request an den Server senden
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    token: player.token,
                    playtime: (Date.now() - player.joinTime) / 1000, // Spielzeit in Sekunden
                    kills: player.kills || 0,
                    max_level: player.level || 1,
                    score: player.score || 0
                })
            };
        }
            
        // Spieler entfernen
        if (players[socket.id]) {
            delete players[socket.id];
            io.emit('playerLeft', socket.id);
        }

        // Aus inaktiver Liste entfernen
        inactivePlayers.delete(socket.id);

        // VERBESSERT: Alle Geschosse dieses Spielers entfernen, um "Ghost Bullets" zu vermeiden
        for (let i = bullets.length - 1; i >= 0; i--) {
            if (bullets[i].ownerId === socket.id) {
                bullets.splice(i, 1);
            }
        }

        // Bestenliste aktualisieren
        updateLeaderboard();
    });
});

//Login,Player System :3


// Level-Up Funktion
function checkLevelUp(player, gainedXp = 0) {
    // Falls XP-Multiplikator existiert, anwenden
    if (player.xpMultiplier && gainedXp > 0) {
        gainedXp *= player.xpMultiplier;
    }
    
    // XP zum Spieler hinzufügen
    if (gainedXp > 0) {
        player.xp += gainedXp;
        player.totalXp += gainedXp;
    }
    
    if (player.xp >= player.xpToNextLevel) {
        // Level erhöhen
        player.level += 1;
        player.xp -= player.xpToNextLevel;

        // Einen Skill-Punkt hinzufügen
        player.availableUpgrades += 1;

        // Nächstes Level braucht mehr XP (20% mehr pro Level)
        player.xpToNextLevel = Math.floor(BASE_XP_FOR_LEVEL * Math.pow(1.2, player.level - 1));

        // Spieler über Level-Up informieren
        io.to(player.id).emit('levelUp', {
            level: player.level,
            xpToNextLevel: player.xpToNextLevel,
            availableUpgrades: player.availableUpgrades
        });

        // Bestenliste aktualisieren
        updateLeaderboard();

        // Rekursiv prüfen, ob mehrere Level auf einmal aufgestiegen
        if (player.xp >= player.xpToNextLevel) {
            checkLevelUp(player, gainedXp);
        }
    }
}

// Block-Typ anhand der Form ermitteln
function getBlockTypeByShape(shape) {
    if (shape === 'square') return BLOCK_TYPES.SQUARE;
    if (shape === 'triangle') return BLOCK_TYPES.TRIANGLE;
    if (shape === 'pentagon') return BLOCK_TYPES.PENTAGON;
    return null;
}

// Bestenliste aktualisieren
function updateLeaderboard() {
    // Top 5 Spieler nach Level sortieren
    const leaderboardPlayers = Object.values(players)
        .sort((a, b) => {
            if (b.level !== a.level) return b.level - a.level;
            return b.xp - a.xp; // Bei gleichem Level nach XP sortieren
        })
        .slice(0, 5);

    // Führenden Spieler markieren
    let hadLeader = false;
    if (leaderboardPlayers.length > 0) {
        const leaderId = leaderboardPlayers[0].id;

        // Alle Spieler auf nicht-Führend setzen
        for (const id in players) {
            if (players[id].isLeader && id !== leaderId) {
                players[id].isLeader = false;
            }
        }

        // Neuen Führenden setzen
        if (players[leaderId]) {
            players[leaderId].isLeader = true;
            hadLeader = true;
        }
    }

    // Wenn kein Führender mehr existiert, alle auf false setzen
    if (!hadLeader) {
        for (const id in players) {
            players[id].isLeader = false;
        }
    }

    // Bestenliste an alle Spieler senden
    const leaderboard = leaderboardPlayers.map(p => ({
        id: p.id,
        name: p.name,
        level: p.level,
        score: p.score,
        isLeader: p.isLeader
    }));

    io.emit('leaderboardUpdate', leaderboard);
}

// VERBESSERT: Spielerstats basierend auf Upgrades aktualisieren
function updatePlayerStats(player) {
    // Max Health aktualisieren mit verbesserten Upgrade-Effekten
    const healthMultiplier = 1 + (player.upgrades.maxHealth.level - 1) * UPGRADE_EFFECTS.maxHealth.upgradeMultiplier;
    player.maxHealth = UPGRADE_EFFECTS.maxHealth.baseValue * healthMultiplier;

    // Bei einem Level-Up auch direkt die Gesundheit auffüllen
    if (player.upgrades.maxHealth.level > 1) {
        player.health = player.maxHealth;
    }
}

// Spieler aktualisieren (Gesundheitsregeneration, Inaktivitätsprüfung)
function updatePlayers() {
    const now = Date.now();

    for (const id in players) {
        const player = players[id];

        // VERBESSERT: Gesundheitsregeneration mit verbesserten Upgrade-Effekten
        const regenRate = BASE_STATS.healthRegen * (1 + (player.upgrades.healthRegen.level - 1) * UPGRADE_EFFECTS.healthRegen.upgradeMultiplier);
        const maxHealth = player.maxHealth;

        if (player.health < maxHealth) {
            player.health = Math.min(maxHealth, player.health + regenRate / 30); // Dividieren durch 30, da Spielschleife ~30 mal/Sek läuft
        }

        // Inaktive Spieler prüfen (5 Minuten Timeout)
        if (inactivePlayers.has(id) && player.lastActiveTime && now - player.lastActiveTime > 5 * 60 * 1000) {
            io.to(id).emit('inactive_timeout');
            delete players[id];
            io.emit('playerLeft', id);
        }
    }
}

// Blöcke aktualisieren (Bewegung, Kollision)
function updateBlocks() {
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];

        // Position aktualisieren
        block.x += block.speedX;
        block.y += block.speedY;

        // Rotation aktualisieren
        block.rotation += block.rotationSpeed;

        // Am Spielfeldrand abprallen
        if (block.x < 0 || block.x > GAME_WIDTH) {
            block.speedX = -block.speedX;
        }
        if (block.y < 0 || block.y > GAME_HEIGHT) {
            block.speedY = -block.speedY;
        }

        // Spielfeldgrenzen einhalten
        block.x = Math.max(0, Math.min(GAME_WIDTH, block.x));
        block.y = Math.max(0, Math.min(GAME_HEIGHT, block.y));

        // Kollisionen mit anderen Blöcken prüfen
        for (let j = i + 1; j < blocks.length; j++) {
            const otherBlock = blocks[j];
            const dx = block.x - otherBlock.x;
            const dy = block.y - otherBlock.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const minDistance = (block.size + otherBlock.size) / 2;

            if (distance < minDistance) {
                // Kollisionsabstoßung berechnen
                const angle = Math.atan2(dy, dx);
                const overlap = minDistance - distance;

                // Blöcke auseinander schieben
                const pushX = Math.cos(angle) * overlap * 0.5;
                const pushY = Math.sin(angle) * overlap * 0.5;

                block.x += pushX;
                block.y += pushY;
                otherBlock.x -= pushX;
                otherBlock.y -= pushY;

                // Geschwindigkeiten tauschen (einfache Elastizität)
                const tempSpeedX = block.speedX;
                const tempSpeedY = block.speedY;

                block.speedX = otherBlock.speedX;
                block.speedY = otherBlock.speedY;
                otherBlock.speedX = tempSpeedX;
                otherBlock.speedY = tempSpeedY;
            }
        }
    }
}

// NEU: Kollisionen zwischen Spielern und Bots prüfen (für Body Damage)
function checkPlayerBotCollisions() {
    for (const playerId in players) {
        const player = players[playerId];
        if (player.isBot) continue; // Überspringe Bot-gegen-Bot-Kollisionen

        // Ignorieren, wenn Spieler im God-Mode ist
        if (player.godMode) continue;

        // Für jede Bot
        for (const botId in players) {
            const bot = players[botId];
            if (!bot.isBot) continue; // Nur Bots

            const dx = player.x - bot.x;
            const dy = player.y - bot.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const minDistance = PLAYER_BASE_SIZE * 2; // Beide Spieler haben Radius

            if (distance < minDistance) {
                // Kollision! Beide erhalten Schaden basierend auf Body Damage

                // Bot erhält Schaden basierend auf Spieler-Körperschaden
                const playerBodyDamage = BASE_STATS.bodyDamage * 
                    (1 + (player.upgrades.bodyDamage.level - 1) * 
                    UPGRADE_EFFECTS.bodyDamage.upgradeMultiplier);

                // Spieler erhält Schaden basierend auf Bot-Körperschaden
                const botBodyDamage = BASE_STATS.bodyDamage * 
                    (1 + (bot.upgrades.bodyDamage.level - 1) * 
                    UPGRADE_EFFECTS.bodyDamage.upgradeMultiplier);

                // Schaden anwenden
                bot.health = Math.max(0, bot.health - playerBodyDamage * 0.5);
                player.health = Math.max(0, player.health - botBodyDamage * 0.5);

                // Kollisionseffekt an alle senden
                io.emit('playerDamaged', {
                    id: botId,
                    health: bot.health
                });

                io.emit('playerDamaged', {
                    id: playerId,
                    health: player.health
                });

                // Wegdrücken
                const angle = Math.atan2(dy, dx);
                const pushX = Math.cos(angle) * (minDistance - distance + 5) * 0.5;
                const pushY = Math.sin(angle) * (minDistance - distance + 5) * 0.5;

                // Bot wegbewegen
                bot.x -= pushX;
                bot.y -= pushY;

                // Spieler wegbewegen
                player.x += pushX;
                player.y += pushY;

                // Spielfeldgrenzen einhalten
                bot.x = Math.max(0, Math.min(GAME_WIDTH, bot.x));
                bot.y = Math.max(0, Math.min(GAME_HEIGHT, bot.y));
                player.x = Math.max(0, Math.min(GAME_WIDTH, player.x));
                player.y = Math.max(0, Math.min(GAME_HEIGHT, player.y));

                // Bot-Tod prüfen
                if (bot.health <= 0) {
                    // XP und Punkte an Spieler
                    player.score += 100;
                    const xpGain = Math.floor(bot.totalXp * 0.33);
                    player.xp += xpGain;
                    player.totalXp += xpGain;

                    // Levelaufstieg prüfen
                    checkLevelUp(player, gainedXp);

                    // Spieler über XP-Gewinn informieren
                    io.to(playerId).emit('xpGained', {
                        amount: xpGain,
                        fromKill: true,
                        victimName: bot.name
                    });

                    // Bot entfernen
                    if (typeof botManager.removeBot === 'function') {
                        botManager.removeBot(botId);
                    } else {
                        delete players[botId];
                        io.emit('playerLeft', botId);
                    }
                }

                // Spieler-Tod prüfen
                if (player.health <= 0) {
                    io.to(playerId).emit('died', {
                        score: player.score,
                        level: player.level,
                        killerName: bot.name,
                        killerId: botId
                    });

                    // Spieler entfernen
                    delete players[playerId];
                    io.emit('playerLeft', playerId);
                }
            }
        }
    }
}

// VERBESSERT: Geschosspositionen aktualisieren und Kollisionen prüfen
function updateBullets() {
    const now = Date.now();

    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];

        // Position aktualisieren
        bullet.x += bullet.speedX;
        bullet.y += bullet.speedY;

        // Prüfen, ob Geschoss außerhalb der Grenzen ist
        if (
            bullet.x < 0 || 
            bullet.x > GAME_WIDTH || 
            bullet.y < 0 || 
            bullet.y > GAME_HEIGHT ||
            now - bullet.createdAt > BULLET_LIFETIME // Maximale Lebensdauer von Kugeln
        ) {
            bullets.splice(i, 1);
            continue;
        }

        // VERBESSERT: Kollisionen mit anderen Geschossen prüfen
        for (let j = bullets.length - 1; j >= 0; j--) {
            if (i === j) continue; // Sich selbst überspringen

            const otherBullet = bullets[j];

            // Kollisionen nur zwischen Geschossen verschiedener Spieler prüfen
            if (bullet.ownerId !== otherBullet.ownerId) {
                if (checkBulletCollision(bullet, otherBullet)) {
                    // VERBESSERT: Schaden an beiden Geschossen basierend auf Stärke anrichten
                    const bulletPower1 = bullet.damage * bullet.penetration;
                    const bulletPower2 = otherBullet.damage * otherBullet.penetration;

                    // Schadensverhältnis basierend auf relativer Stärke
                    const damageRatio1 = bulletPower1 / (bulletPower1 + bulletPower2);
                    const damageRatio2 = bulletPower2 / (bulletPower1 + bulletPower2);

                    // Skalierten Schaden auf beide Geschosse anwenden
                    bullet.health -= otherBullet.damage * damageRatio2 * 1.5;
                    otherBullet.health -= bullet.damage * damageRatio1 * 1.5;

                    // Kollisionseffekt an alle Spieler senden
                    io.emit('bulletCollision', {
                        x: (bullet.x + otherBullet.x) / 2,
                        y: (bullet.y + otherBullet.y) / 2,
                        size: (bullet.size + otherBullet.size) / 3 // Größe basierend auf Geschossgrößen
                    });

                    // Geschosse mit 0 oder weniger Leben entfernen
                    if (bullet.health <= 0) {
                        bullets.splice(i, 1);
                        break;
                    }

                    if (otherBullet.health <= 0) {
                        bullets.splice(j, 1);
                        if (j < i) i--; // Index i anpassen, falls j vor i war
                    }
                }
            }
        }

        // Wenn Geschoss entfernt wurde, Blockprüfungen überspringen
        if (i >= bullets.length) continue;

        // Kollisionen mit Blöcken prüfen
        for (let j = blocks.length - 1; j >= 0; j--) {
            const block = blocks[j];

            if (checkCollision(bullet, block)) {
                // Schaden am Block und am Geschoss
                block.health -= bullet.damage;
                bullet.health -= 1; // Block reduziert immer Kugelgesundheit um 1

                // Block-Zustand an alle senden
                io.emit('blockDamaged', {
                    id: block.id,
                    health: block.health
                });

                // Prüfen, ob Block zerstört wurde
                if (block.health <= 0) {
                    // Punkte an Schützen vergeben
                    const player = players[bullet.ownerId];
                    if (player) {
                        // XP vergeben und Level prüfen
                        const gainedXp = block.xp;


                        // Benachrichtigung über XP-Gewinn an Schützen senden
                        io.to(bullet.ownerId).emit('xpGained', {
                            amount: gainedXp,
                            fromKill: false
                        });

                        // Prüfen, ob Level-Aufstieg
                        checkLevelUp(player, gainedXp);
                    }

                    // Block an zufälliger Position respawnen
                    block.x = Math.random() * GAME_WIDTH;
                    block.y = Math.random() * GAME_HEIGHT;
                    block.health = block.maxHealth;
                }

                // Prüfen, ob Geschoss entfernt werden sollte
                if (bullet.health <= 0) {
                    bullets.splice(i, 1);
                    break;
                }
            }
        }

        // Wenn Geschoss entfernt wurde, Spielerkollisionsprüfungen überspringen
        if (i >= bullets.length) continue;

        // Kollisionen mit Spielern prüfen
        for (const id in players) {
            const player = players[id];

            // Eigene Geschosse überspringen
            if (id === bullet.ownerId) continue;

            // NEU: God-Mode-Spieler überspringen
            if (player.godMode === true) continue;

            if (checkCollision(bullet, player)) {
                // Spieler Schaden zufügen
                player.health -= bullet.damage;
                // VERBESSERT: Körperschaden mit verbessertem Upgrade-Effekt
                const bodyDamage = BASE_STATS.bodyDamage * (1 + (player.upgrades.bodyDamage.level - 1) * UPGRADE_EFFECTS.bodyDamage.upgradeMultiplier);
                bullet.health -= bodyDamage * 0.2; // Körperschaden reduziert Kugelgesundheit

                // Spieler-Schaden an alle senden
                io.emit('playerDamaged', {
                    id: id,
                    health: player.health
                });

                // Prüfen, ob Spieler getötet wurde
                if (player.health <= 0) {
                    // Punkte an Schützen vergeben
                    const shooter = players[bullet.ownerId];
                    if (shooter) {
                        shooter.score += 100;
    
                        // FIXED: 33% of the killed player's XP to the shooter
                        // This is the critical fix - correctly calculate 33% of totalXp
                        const xpGain = Math.floor(player.totalXp * 0.33);
                        shooter.xp += xpGain;
                        shooter.totalXp += xpGain;
                        
                        // Apply the XP to check for level up
                        checkLevelUp(shooter, xpGain);
    
                        // Notify shooter about XP gain
                        io.to(bullet.ownerId).emit('xpGained', {
                            amount: xpGain,
                            fromKill: true,
                            victimName: player.name
                        });
                    }

                    // VERBESSERT: Killer-ID für Death Screen
                    io.to(id).emit('died', {
                        score: player.score,
                        level: player.level,
                        killerName: shooter ? shooter.name : "unknown",
                        killerId: shooter ? shooter.id : null
                    });

                    // Spieler entfernen
                    delete players[id];
                    io.emit('playerLeft', id);

                    // Bestenliste aktualisieren
                    updateLeaderboard();
                }

                // Prüfen, ob Geschoss entfernt werden sollte
                if (bullet.health <= 0) {
                    bullets.splice(i, 1);
                    break;
                }
            }
        }
    }
}

// NEUE FUNKTION: Verwaiste Kugeln entfernen
function cleanupOrphanedBullets() {
    const validPlayerIds = new Set(Object.keys(players));
    let removedCount = 0;

    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        if (!validPlayerIds.has(bullet.ownerId)) {
            // Besitzer existiert nicht mehr, Kugel entfernen
            bullets.splice(i, 1);
            removedCount++;
        }
    }

    if (removedCount > 0) {
        console.log(`${removedCount} verwaiste Kugeln entfernt`);
    }
}

// VERBESSERT: Spezielle Funktion für Geschoss-gegen-Geschoss-Kollisionen
function checkBulletCollision(bullet1, bullet2) {
    const dx = bullet1.x - bullet2.x;
    const dy = bullet1.y - bullet2.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Kollisionsabstand basierend auf beiden Geschossgrößen
    return distance < (bullet1.size + bullet2.size) / 2;
}

// Kollision zwischen zwei Objekten prüfen (Kreis-Kreis oder Kreis-Rechteck)
function checkCollision(obj1, obj2) {
    // Für Geschosse und Spieler (Kreis-Kreis)
    if (obj1.speedX !== undefined && !obj2.size) {
        const dx = obj1.x - obj2.x;
        const dy = obj1.y - obj2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        return distance < PLAYER_BASE_SIZE + obj1.size/2; // Kugeldurchmesser verwenden
    }

    // Für Geschosse und Blöcke (Kreis-Rechteck)
    if (obj1.speedX !== undefined && obj2.size) {
        const halfSize = obj2.size / 2;

        // Nächsten Punkt auf dem Rechteck zum Kreis finden
        const closestX = Math.max(obj2.x - halfSize, Math.min(obj1.x, obj2.x + halfSize));
        const closestY = Math.max(obj2.y - halfSize, Math.min(obj1.y, obj2.y + halfSize));

        // Abstand zwischen nächstem Punkt und Kreismittelpunkt berechnen
        const dx = closestX - obj1.x;
        const dy = closestY - obj1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        return distance < obj1.size/2; // Geschossgröße verwenden
    }

    return false;
}

// Bot-Manager initialisieren
const botManager = botSystem(io, players, bullets, blocks, BASE_STATS, PLAYER_BASE_SIZE, 
                            BULLET_BASE_SIZE, GAME_WIDTH, GAME_HEIGHT, 
                            checkLevelUp, updatePlayerStats, getBlockTypeByShape, updateLeaderboard);

// Spielschleife
setInterval(() => {
    // Geschosse aktualisieren
    updateBullets();

    // NEU: Verwaiste Kugeln aufräumen
    cleanupOrphanedBullets();

    // NEU: Spieler-Bot-Kollisionen prüfen
    checkPlayerBotCollisions();

    // Spieler aktualisieren
    updatePlayers();

    // Blöcke aktualisieren
    updateBlocks();

    // Bots aktualisieren
    botManager.updateBots();

    // Bestenliste aktualisieren (alle 5 Sekunden)
    if (Date.now() % 5000 < 33) {
        updateLeaderboard();
    }

    // Spielzustand an alle Spieler senden
    io.emit('gameState', {
        players,
        bullets,
        blocks
    });
}, 33); // ~30 mal pro Sekunde

// Server starten
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`WebSocket-Server läuft auf Port ${PORT}`);
    // Bot-System starten, nachdem der Server gestartet ist
    botManager.start();
});

// Server für index.js exportieren
module.exports = server;
