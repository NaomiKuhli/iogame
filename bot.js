// bot.js - Verbessertes Bot-System für Tank.io
module.exports = function(io, players, bullets, blocks, BASE_STATS, PLAYER_BASE_SIZE, 
                           BULLET_BASE_SIZE, GAME_WIDTH, GAME_HEIGHT, 
                           checkLevelUp, updatePlayerStats, getBlockTypeByShape, updateLeaderboard) {

    // Bot-Konfiguration
    const BOT_CONFIG = {
        SPAWN_INTERVAL: 15000, // Schneller prüfen: Alle 15 Sekunden 
        MAX_BOTS: 5,           // Basis-Maximale Anzahl von Bots
        SPAWN_CHANCE: 0.6,     // Erhöhte Grundchance auf 60%
        VIEW_RANGE: 800,       // Sichtweite der Bots (realistisch wie bei einem Spieler)
        BLOCK_PRIORITY: 0.5,   // 70% Priorität für Blöcke
        PLAYER_PRIORITY: 0.5,  // 30% Priorität für Spieler

        // Neuer Wert für bessere Blockerkennung - erhöht auf 150 für frühzeitige Erkennung
        BLOCK_AVOIDANCE_RANGE: 150,

        // Dynamische Bot-Einstellungen
        DYNAMIC_BOTS: true,    // Dynamische Bot-Anzahl aktivieren
        MIN_BOTS: 3,           // Mindestanzahl von Bots, wenn Spieler vorhanden sind
        MAX_BOTS_DYNAMIC: 12,  // Absolute Obergrenze für Bots
        BOTS_PER_MISSING_PLAYER: 2, // Zusätzliche Bots pro fehlendem Spieler
        MAX_REAL_PLAYERS: 6,   // Referenzwert für die volle Spielerzahl

        NAMES: [               // Mögliche Bot-Namen
            "Terminator", "Hunter", "Predator", "Destroyer", 
            "Guardian", "Sentinel", "Enforcer", "Executioner",
            "Reaper", "Shadow", "Ghost", "Phantom", "Spectre",
            "Ninja", "Samurai", "Warrior", "Knight", "Paladin"
        ],
        DIFFICULTY_LEVELS: {
            EASY: {
                REACTION_TIME: 800,      // Reaktionszeit in ms
                ACCURACY: 0.9,           // Genauigkeit des Zielens (0-1) - erhöht für weniger Zittern
                ANGLE_STABILITY: 0.9,    // Stabilität der Zielrichtung (0-1) - neu für weniger Zittern
                AGGRESSION: 0.4,         // Aggressivität (0-1)
                UPGRADE_STRATEGY: "balanced"
            },
            MEDIUM: {
                REACTION_TIME: 500,
                ACCURACY: 0.95,
                ANGLE_STABILITY: 0.95,
                AGGRESSION: 0.6,
                UPGRADE_STRATEGY: "offensive"
            },
            HARD: {
                REACTION_TIME: 300,
                ACCURACY: 0.98,
                ANGLE_STABILITY: 0.98,
                AGGRESSION: 0.8,
                UPGRADE_STRATEGY: "sniper"
            }
        },
        BEHAVIOR_STATES: {
            IDLE: "idle",             // Zufällig umherwandern
            COLLECTING: "collecting", // Blöcke sammeln
            PURSUING: "pursuing",     // Spieler verfolgen
            ATTACKING: "attacking",   // Spieler angreifen
            FLEEING: "fleeing",       // Fliehen bei niedriger Gesundheit
            AVOIDING: "avoiding"      // Hindernis vermeiden
        },
        UPGRADE_STRATEGIES: {
            "balanced": [
                "bulletDamage", "bulletSpeed", "maxHealth", 
                "movementSpeed", "reload", "bulletPenetration", 
                "healthRegen", "bodyDamage"
            ],
            "offensive": [
                "bulletDamage", "bulletSpeed", "bulletPenetration", 
                "reload", "movementSpeed", "maxHealth",
                "healthRegen", "bodyDamage"
            ],
            "defensive": [
                "maxHealth", "healthRegen", "movementSpeed", 
                "bulletPenetration", "bulletDamage", "reload", 
                "bulletSpeed", "bodyDamage"
            ],
            "sniper": [
                "bulletDamage", "bulletSpeed", "bulletPenetration", 
                "reload", "maxHealth", "movementSpeed",
                "healthRegen", "bodyDamage"
            ]
        },
        NO_PLAYER_TIMEOUT: 3 * 60 * 1000, // 3 Minuten ohne Spieler bevor Bots entfernt werden

        // Neue Attribute für fairere Bots mit Spielerfähigkeiten
        FIRING_DELAY: 800,           // Gleiche Feuerrate wie Spieler (ms)
        MOVEMENT_SPEED_FACTOR: 1.0,  // Gleiche Bewegungsgeschwindigkeit wie Spieler (Multiplikator)
        DAMAGE_FACTOR: 1.0,          // Gleicher Schaden wie Spieler (Multiplikator)
        TARGET_PERSISTENCE: 3000,    // Wie lange auf das gleiche Blockziel fokussieren (ms)
        TARGET_SWITCH_DELAY: 500     // Verzögerung vorm Zielwechsel nach Zerstörung (ms)
    };

    // XP für Level-Aufstiege (sollte identisch zu server.js sein)
    const BASE_XP_FOR_LEVEL = 30;

    // Bot-Verwaltung
    let bots = {};
    let botIdCounter = 0;
    let botUpdateInterval = null;
    let botSpawnInterval = null;
    let lastPlayerActivity = Date.now();
    let noPlayerTimerActive = false;

    // Zufälligen Bot-Namen generieren
    function generateBotName() {
        const nameIndex = Math.floor(Math.random() * BOT_CONFIG.NAMES.length);
        return `[BOT] ${BOT_CONFIG.NAMES[nameIndex]}`;
    }

    // Zufälligen Schwierigkeitsgrad wählen
    function getRandomDifficulty() {
        const rand = Math.random();
        if (rand < 0.5) return "EASY";
        if (rand < 0.8) return "MEDIUM";
        return "HARD";
    }

    // Zufällige Strategie wählen
    function getRandomStrategy() {
        const strategies = Object.keys(BOT_CONFIG.UPGRADE_STRATEGIES);
        return strategies[Math.floor(Math.random() * strategies.length)];
    }

    // Neue Bot-ID generieren
    function getNextBotId() {
        return `bot-${botIdCounter++}`;
    }

    // Prüfen, ob echte Spieler im Spiel sind
    function hasRealPlayers() {
        for (const id in players) {
            if (!players[id].isBot) {
                return true;
            }
        }
        return false;
    }

    // Funktion zum Zählen der echten Spieler
    function countRealPlayers() {
        let count = 0;
        for (const id in players) {
            if (!players[id].isBot) {
                count++;
            }
        }
        return count;
    }

    // Timer für Entfernung der Bots starten, wenn keine Spieler da sind
    function checkAndHandleNoPlayers() {
        if (!hasRealPlayers()) {
            if (!noPlayerTimerActive) {
                noPlayerTimerActive = true;
                lastPlayerActivity = Date.now();
                console.log("Keine Spieler erkannt. Bot-Entfernung in 3 Minuten, falls kein Spieler beitritt.");
            } else if (Date.now() - lastPlayerActivity > BOT_CONFIG.NO_PLAYER_TIMEOUT) {
                // 3 Minuten ohne Spieler - alle Bots entfernen
                console.log("3 Minuten ohne Spieler - entferne alle Bots");
                for (const botId in bots) {
                    removeBot(botId);
                }
            }
        } else {
            // Spieler ist da, Timer zurücksetzen
            noPlayerTimerActive = false;
            lastPlayerActivity = Date.now();
        }
    }

    // Funktion für sichere Bot-Spawn-Position
    function getValidBotSpawnPosition() {
        const margin = 100;
        let maxAttempts = 10;
        let bestPosition = {
            x: Math.random() * (GAME_WIDTH - 2*margin) + margin,
            y: Math.random() * (GAME_HEIGHT - 2*margin) + margin,
            safety: 0
        };

        // Mehrere Positionen ausprobieren und die sicherste wählen
        for (let i = 0; i < maxAttempts; i++) {
            const testPos = {
                x: Math.random() * (GAME_WIDTH - 2*margin) + margin,
                y: Math.random() * (GAME_HEIGHT - 2*margin) + margin
            };

            // Sicherheit dieser Position bewerten (höher = besser)
            let safety = 100;

            // Prüfen, wie weit Blöcke entfernt sind
            for (const block of blocks) {
                const dx = testPos.x - block.x;
                const dy = testPos.y - block.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Je näher ein Block ist, desto unsicherer ist die Position
                if (distance < 150) {
                    safety -= (150 - distance) / 2;
                }
            }

            // Auch Entfernung zu anderen Spielern prüfen
            for (const id in players) {
                const player = players[id];
                const dx = testPos.x - player.x;
                const dy = testPos.y - player.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Nicht zu nahe an einem Spieler spawnen
                if (distance < 300) {
                    safety -= (300 - distance) / 4;
                }
            }

            // Wenn diese Position sicherer ist, merken
            if (safety > bestPosition.safety) {
                bestPosition = {
                    x: testPos.x,
                    y: testPos.y,
                    safety: safety
                };
            }
        }

        return { x: bestPosition.x, y: bestPosition.y };
    }

    // Bot erstellen
    function createBot() {
        // Nur erstellen, wenn Spieler da sind
        if (!hasRealPlayers()) {
            return null;
        }

        const difficulty = getRandomDifficulty();
        const difficultySettings = BOT_CONFIG.DIFFICULTY_LEVELS[difficulty];
        const strategy = difficultySettings.UPGRADE_STRATEGY;

        const botId = getNextBotId();
        const spawnPos = getValidBotSpawnPosition();

        // Bot-Spieler erstellen (ähnlich wie reguläre Spieler)
        const bot = {
            id: botId,
            name: generateBotName(),
            isBot: true,
            difficulty: difficulty,
            x: spawnPos.x,
            y: spawnPos.y,
            angle: Math.random() * Math.PI * 2,
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
            maxTotalUpgrades: 45, // Erhöht auf 45 (wie bei Spielern)
            availableUpgrades: 0,
            isLeader: false,
            lastShootTime: 0,
            lastActiveTime: Date.now(),

            // Bot-spezifische Eigenschaften
            botState: BOT_CONFIG.BEHAVIOR_STATES.IDLE,
            targetId: null,              // ID des Ziel-Spielers oder -Blocks
            targetPosition: null,        // Zielposition
            lastDecisionTime: Date.now(),
            reactionTime: difficultySettings.REACTION_TIME,
            accuracy: difficultySettings.ACCURACY,
            angleStability: difficultySettings.ANGLE_STABILITY,
            aggression: difficultySettings.AGGRESSION,
            upgradeStrategy: BOT_CONFIG.UPGRADE_STRATEGIES[strategy],
            lastShot: Date.now(),
            lastMoveTime: Date.now(),
            moveDirection: { x: Math.random() * 2 - 1, y: Math.random() * 2 - 1 },
            moveDuration: 2000 + Math.random() * 3000,  // 2-5 Sekunden in eine Richtung
            lastAngle: 0, // Für stabileres Zielen
            avoidingObstacle: false,
            avoidanceDirection: { x: 0, y: 0 },
            targetAcquisitionTime: 0,    // Wann das aktuelle Ziel erfasst wurde
            currentTargetHealth: 0,      // Gesundheit des aktuellen Ziels bei Erfassung
            lastTargetSwitchTime: 0,     // Wann der Bot zuletzt das Ziel gewechselt hat
            lastHitTime: Date.now(),     // Wann der Bot zuletzt etwas getroffen hat
            blockHitCount: 0             // Wie oft der Bot den aktuellen Block getroffen hat
        };

        // Bot zum Spiel hinzufügen
        players[botId] = bot;
        bots[botId] = bot;

        // Bot in Bestenliste aufnehmen
        updateLeaderboard();

        console.log(`Bot spawned: ${bot.name} (${bot.difficulty})`);
        return bot;
    }

    // Bot-KI aktualisieren
    function updateBots() {
        const now = Date.now();

        // Prüfen, ob Spieler da sind
        checkAndHandleNoPlayers();

        // Für jeden Bot die KI-Logik ausführen
        for (const botId in bots) {
            const bot = bots[botId];
            if (!bot) continue;

            // Upgrade-Punkte SOFORT verwenden
            while (bot.availableUpgrades > 0) {
                const before = bot.availableUpgrades;
                applyBotUpgrade(bot);

                // Wenn sich nichts geändert hat, Schleife unterbrechen
                if (before === bot.availableUpgrades) break;

                console.log(`Bot ${bot.name} hat ein Upgrade angewendet! Verbleibende Upgrade-Punkte: ${bot.availableUpgrades}`);
            }

            // Prüfen, ob ein Spieler in Sichtweite ist - sofortige Reaktion
            const visiblePlayer = findNearestVisiblePlayer(bot);
            if (visiblePlayer && bot.botState !== BOT_CONFIG.BEHAVIOR_STATES.FLEEING) {
                const playerDistance = calculateDistance(bot, visiblePlayer);

                // Wenn ein Spieler gesehen wird, sofort zum Angriffsmodus wechseln
                if (playerDistance < BOT_CONFIG.VIEW_RANGE) {
                    bot.targetId = visiblePlayer.id;

                    if (playerDistance < 300) {
                        bot.botState = BOT_CONFIG.BEHAVIOR_STATES.ATTACKING;
                    } else {
                        bot.botState = BOT_CONFIG.BEHAVIOR_STATES.PURSUING;
                    }
                }
            } else {
                // Wenn kein Spieler in Sicht, Kollisionen prüfen (schon im XP-Sammeln)
                checkBotBlockCollisions(bot);
            }

            // Nur alle X ms eine Entscheidung treffen (basierend auf Reaktionszeit)
            if (now - bot.lastDecisionTime > bot.reactionTime) {
                updateBotState(bot);
                bot.lastDecisionTime = now;
            }

            // Bot-Verhalten basierend auf aktuellem Zustand ausführen
            switch (bot.botState) {
                case BOT_CONFIG.BEHAVIOR_STATES.IDLE:
                    executeBotIdleBehavior(bot);
                    break;
                case BOT_CONFIG.BEHAVIOR_STATES.COLLECTING:
                    executeBotCollectingBehavior(bot);
                    break;
                case BOT_CONFIG.BEHAVIOR_STATES.PURSUING:
                    executeBotPursuingBehavior(bot);
                    break;
                case BOT_CONFIG.BEHAVIOR_STATES.ATTACKING:
                    executeBotAttackingBehavior(bot);
                    break;
                case BOT_CONFIG.BEHAVIOR_STATES.FLEEING:
                    executeBotFleeingBehavior(bot);
                    break;
                case BOT_CONFIG.BEHAVIOR_STATES.AVOIDING:
                    executeBotAvoidingBehavior(bot);
                    break;
            }
        }
    }

    // Kollisionsprüfung für Bot mit Blöcken
    function checkBotBlockCollisions(bot) {
        // Nahe Blöcke finden
        for (const block of blocks) {
            const dx = bot.x - block.x;
            const dy = bot.y - block.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const minDistance = PLAYER_BASE_SIZE + (block.size || 30) / 2;

            // Nur sehr nah an Blöcken reagieren
            if (distance < minDistance * 1.2) {
                // Kein Schaden an Bots durch Kollisionen!

                // Bewegung vom Block weg (sanfte Push-Kraft)
                const angle = Math.atan2(dy, dx);
                const pushX = Math.cos(angle) * (minDistance - distance + 5) * 0.5;
                const pushY = Math.sin(angle) * (minDistance - distance + 5) * 0.5;

                // Position aktualisieren, nur sanft wegbewegen
                bot.x += pushX;
                bot.y += pushY;

                // Spielfeldgrenzen einhalten
                bot.x = Math.max(0, Math.min(GAME_WIDTH, bot.x));
                bot.y = Math.max(0, Math.min(GAME_HEIGHT, bot.y));

                // Auf Block zielen und schießen (direkt Punkte sammeln)
                if (Math.random() < 0.3) {
                    rotateBotTowards(bot, block.x, block.y);
                    botShoot(bot);
                }

                return true;
            }
        }
        return false;
    }

    // Bot-Zustandsaktualisierung
    function updateBotState(bot) {
        const now = Date.now();

        // Bei sehr niedrigem Leben fliehen (unter 15%)
        const healthPercentage = bot.health / bot.maxHealth;
        if (healthPercentage < 0.05) {
            bot.botState = BOT_CONFIG.BEHAVIOR_STATES.FLEEING;
            return;
        }

        // VERBESSERT: Aktuelle Blockziele nicht zu schnell aufgeben
        if (bot.botState === BOT_CONFIG.BEHAVIOR_STATES.COLLECTING && bot.targetId) {
            const targetBlock = blocks.find(b => b.id === bot.targetId);
            if (targetBlock) {
                // Wenn der Block existiert und beschädigt ist (< 90% Leben), dabei bleiben
                if (targetBlock.health < targetBlock.maxHealth * 0.9) {
                    // Block weiter angreifen
                    return;
                }
            }
        }

        // Prüfen, ob ein Spieler in Sichtweite ist - hohe Priorität
        const visiblePlayer = findNearestVisiblePlayer(bot);

        // KORREKTUR: Debug-Ausgabe für Spielererkennung
        if (visiblePlayer) {
            console.log(`Bot ${bot.id} (${bot.name}) hat Spieler ${visiblePlayer.id} (${visiblePlayer.name}) entdeckt. GodMode=${visiblePlayer.godMode || false}`);

            // WICHTIG: Nur echte God-Mode-Spieler ignorieren (nicht alle)
            if (visiblePlayer.godMode === true) {
                console.log(`Bot ${bot.id} ignoriert Spieler ${visiblePlayer.id} wegen aktiviertem God-Mode`);
            }
            else {
                const playerDistance = calculateDistance(bot, visiblePlayer);

                // KORREKTUR: Immer angreifen, wenn ein Spieler in Sichtweite ist
                if (playerDistance < BOT_CONFIG.VIEW_RANGE) {
                    console.log(`Bot ${bot.id} greift Spieler ${visiblePlayer.id} an! Distanz: ${playerDistance}`);
                    bot.targetId = visiblePlayer.id;

                    if (playerDistance < 350) {
                        bot.botState = BOT_CONFIG.BEHAVIOR_STATES.ATTACKING;
                    } else {
                        bot.botState = BOT_CONFIG.BEHAVIOR_STATES.PURSUING;
                    }
                    return;
                }
            }
        }

        // Wenn kein Spieler in Sicht, XP-Sammeln priorisieren
        const blockPriority = BOT_CONFIG.BLOCK_PRIORITY;
        // Mit hoher Wahrscheinlichkeit Blöcke sammeln
        if (Math.random() < blockPriority) {
            const bestBlock = findBestBlockTarget(bot);
            if (bestBlock) {
                const blockDistance = calculateDistance(bot, bestBlock);
                // Nur Blöcke im Sichtfeld
                if (blockDistance < BOT_CONFIG.VIEW_RANGE) {
                    // Wenn wir bereits einen Block als Ziel haben und beschädigt haben, nicht wechseln
                    if (bot.targetId && bot.targetId.startsWith('block-')) {
                        const currentBlock = blocks.find(b => b.id === bot.targetId);
                        if (currentBlock && currentBlock.health < currentBlock.maxHealth * 0.9) {
                            // Bei beschädigtem aktuellen Block bleiben
                            bot.botState = BOT_CONFIG.BEHAVIOR_STATES.COLLECTING;
                            return;
                        }
                    }

                    // Neues Ziel setzen
                    bot.targetId = bestBlock.id;
                    bot.targetAcquisitionTime = now;
                    bot.currentTargetHealth = bestBlock.health;
                    bot.botState = BOT_CONFIG.BEHAVIOR_STATES.COLLECTING;
                    return;
                }
            }
        }

        // Standard: Zufällig umherwandern auf der Suche nach Blöcken oder Spielern
        bot.botState = BOT_CONFIG.BEHAVIOR_STATES.IDLE;
    }

    // Nächsten Block finden
    function findNearestBlock(bot) {
        let nearestBlock = null;
        let shortestDistance = Number.MAX_VALUE;

        for (const block of blocks) {
            const distance = calculateDistance(bot, block);

            if (distance < shortestDistance) {
                shortestDistance = distance;
                nearestBlock = block;
            }
        }

        return nearestBlock;
    }

    // Distanz zwischen zwei Objekten berechnen
    function calculateDistance(obj1, obj2) {
        const dx = obj1.x - obj2.x;
        const dy = obj1.y - obj2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // Winkel zwischen zwei Objekten berechnen
    function calculateAngle(from, to) {
        return Math.atan2(to.y - from.y, to.x - from.x);
    }

    // Bot-Bewegung aktualisieren
    function moveBotTo(bot, targetX, targetY) {
        // Bewegungsgeschwindigkeit basierend auf Upgrades und Faktor
        const speed = BASE_STATS.movementSpeed * 
                     (1 + (bot.upgrades.movementSpeed.level - 1) * 0.1) * 
                     BOT_CONFIG.MOVEMENT_SPEED_FACTOR;

        // Richtung zum Ziel berechnen
        const dx = targetX - bot.x;
        const dy = targetY - bot.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Nur bewegen, wenn eine Mindestdistanz vorhanden ist
        if (distance > 5) {
            // Normalisierte Richtung berechnen
            const dirX = dx / distance;
            const dirY = dy / distance;

            // Bewegungsrichtung speichern
            bot.moveDirection = { x: dirX, y: dirY };

            // Position aktualisieren
            bot.x += dirX * speed;
            bot.y += dirY * speed;

            // Spielfeldgrenzen einhalten
            bot.x = Math.max(0, Math.min(GAME_WIDTH, bot.x));
            bot.y = Math.max(0, Math.min(GAME_HEIGHT, bot.y));
        }
    }

    // Bot auf ein Ziel ausrichten (mit verbesserter Stabilität)
    function rotateBotTowards(bot, targetX, targetY) {
        // Exakte Ausrichtung mit zufälliger Ungenauigkeit
        const perfectAngle = Math.atan2(targetY - bot.y, targetX - bot.x);

        // Ungenauigkeit basierend auf Bot-Genauigkeit (geringere Werte für weniger Zittern)
        const maxError = (1 - bot.accuracy) * Math.PI / 6; // Maximaler Fehler reduziert
        const error = (Math.random() * 2 - 1) * maxError;

        // Glättung mit früherem Winkel für Stabilität
        const rawAngle = perfectAngle + error;
        const smoothedAngle = bot.lastAngle * (bot.angleStability) + rawAngle * (1 - bot.angleStability);

        bot.angle = smoothedAngle;
        bot.lastAngle = smoothedAngle; // Speichern für nächste Aktualisierung
    }

    // Bot schießen lassen - liefert zurück, ob geschossen wurde
    function botShoot(bot) {
        const now = Date.now();
        const reloadTime = BOT_CONFIG.FIRING_DELAY * Math.pow(0.93, bot.upgrades.reload.level - 1);

        // Prüfen, ob Nachladezeit abgelaufen ist
        if (now - bot.lastShootTime >= reloadTime) {
            bot.lastShootTime = now;

            // Neue Kugel erstellen
            const bulletSpeed = BASE_STATS.bulletSpeed * (1 + (bot.upgrades.bulletSpeed.level - 1) * 0.1);
            const bulletSize = BULLET_BASE_SIZE * (1 + (bot.upgrades.bulletDamage.level - 1) * 0.05);

            const bullet = {
                id: `bullet-${bot.id}-${now}`,
                ownerId: bot.id,
                x: bot.x + Math.cos(bot.angle) * PLAYER_BASE_SIZE * 1.5,
                y: bot.y + Math.sin(bot.angle) * PLAYER_BASE_SIZE * 1.5,
                speedX: Math.cos(bot.angle) * bulletSpeed,
                speedY: Math.sin(bot.angle) * bulletSpeed,
                damage: BASE_STATS.bulletDamage * (1 + (bot.upgrades.bulletDamage.level - 1) * 0.1) * BOT_CONFIG.DAMAGE_FACTOR,
                size: bulletSize,
                health: BASE_STATS.bulletPenetration * (1 + (bot.upgrades.bulletPenetration.level - 1) * 0.1),
                penetration: BASE_STATS.bulletPenetration * (1 + (bot.upgrades.bulletPenetration.level - 1) * 0.1),
                createdAt: now
            };

            bullets.push(bullet);
            return true; // Schuss wurde abgegeben
        }
        return false; // Kein Schuss möglich
    }

    // Bot-Upgrade anwenden
    function applyBotUpgrade(bot) {
        if (bot.availableUpgrades <= 0) return;

        // Nächstes Upgrade aus der Bot-Strategie auswählen
        for (const skill of bot.upgradeStrategy) {
            if (bot.upgrades[skill].level < bot.upgrades[skill].max) {
                // Upgrade anwenden
                bot.upgrades[skill].level += 1;
                bot.totalUpgrades += 1;
                bot.availableUpgrades -= 1;

                // Stats aktualisieren
                updatePlayerStats(bot);

                // Log für Debugging-Zwecke
                console.log(`Bot ${bot.name} verbessert ${skill} auf Level ${bot.upgrades[skill].level}`);

                // Nicht mehr als ein Upgrade pro Aufruf
                return;
            }
        }
    }

    // Bot-Verhalten: Zufällig umherwandern
    function executeBotIdleBehavior(bot) {
        const now = Date.now();

        // Periodisch Richtung ändern
        if (now - bot.lastMoveTime > bot.moveDuration) {
            bot.moveDirection = {
                x: Math.random() * 2 - 1,
                y: Math.random() * 2 - 1
            };

            // Bewegungsrichtung normalisieren
            const magnitude = Math.sqrt(bot.moveDirection.x * bot.moveDirection.x + bot.moveDirection.y * bot.moveDirection.y);
            if (magnitude > 0) {
                bot.moveDirection.x /= magnitude;
                bot.moveDirection.y /= magnitude;
            }

            bot.moveDuration = 2000 + Math.random() * 3000; // 2-5 Sekunden
            bot.lastMoveTime = now;
        }

        // Bewegungsgeschwindigkeit basierend auf Upgrades und Faktor
        const speed = BASE_STATS.movementSpeed * 
                     (1 + (bot.upgrades.movementSpeed.level - 1) * 0.1) * 
                     BOT_CONFIG.MOVEMENT_SPEED_FACTOR;

        // Position aktualisieren
        bot.x += bot.moveDirection.x * speed;
        bot.y += bot.moveDirection.y * speed;

        // Spielfeldgrenzen einhalten
        bot.x = Math.max(0, Math.min(GAME_WIDTH, bot.x));
        bot.y = Math.max(0, Math.min(GAME_HEIGHT, bot.y));

        // Winkel in Bewegungsrichtung
        bot.angle = Math.atan2(bot.moveDirection.y, bot.moveDirection.x);
        bot.lastAngle = bot.angle; // Winkel speichern

        // Gelegentlich schießen (niedrige Wahrscheinlichkeit)
        if (Math.random() < 0.01) {
            botShoot(bot);
        }
    }

    // Bot-Verhalten: Hindernisse vermeiden
    function executeBotAvoidingBehavior(bot) {
        const speed = BASE_STATS.movementSpeed * 
                     (1 + (bot.upgrades.movementSpeed.level - 1) * 0.1) * 
                     BOT_CONFIG.MOVEMENT_SPEED_FACTOR;

        // Vom Hindernis wegbewegen mit höherer Geschwindigkeit
        bot.x -= bot.avoidanceDirection.x * speed * 2; // Doppelte Geschwindigkeit beim Ausweichen
        bot.y -= bot.avoidanceDirection.y * speed * 2;

        // Spielfeldgrenzen einhalten
        bot.x = Math.max(0, Math.min(GAME_WIDTH, bot.x));
        bot.y = Math.max(0, Math.min(GAME_HEIGHT, bot.y));

        // Winkel in Fluchtrichtung drehen, aber trotzdem Blöcke beschießen können
        if (Math.random() < 0.7) {
            // Meist in Fluchtrichtung schauen
            bot.angle = Math.atan2(-bot.avoidanceDirection.y, -bot.avoidanceDirection.x);
        } else {
            // Manchmal nach einem nahen Block suchen und darauf schießen
            const nearestBlock = findNearestBlock(bot);
            if (nearestBlock && calculateDistance(bot, nearestBlock) < BOT_CONFIG.VIEW_RANGE) {
                rotateBotTowards(bot, nearestBlock.x, nearestBlock.y);
                // Gelegentlich schießen während des Ausweichens
                if (Math.random() < 0.2) {
                    botShoot(bot);
                }
            }
        }
    }

    // Bot-Verhalten: Blöcke sammeln - VERBESSERT: Fokus auf einen Block
    function executeBotCollectingBehavior(bot) {
        const now = Date.now();

        // Zielblock finden
        const targetBlock = blocks.find(block => block.id === bot.targetId);

        if (!targetBlock) {
            // Ziel nicht gefunden, zurück zu "Idle" und Zielinfo zurücksetzen
            bot.botState = BOT_CONFIG.BEHAVIOR_STATES.IDLE;
            bot.targetId = null;
            bot.targetAcquisitionTime = 0;
            bot.currentTargetHealth = 0;
            bot.lastTargetSwitchTime = now;
            return;
        }

        // VERBESSERT: Überprüfen, ob sich die Blockgesundheit verringert hat
        // Das zeigt, dass wir den Block erfolgreich treffen
        if (bot.currentTargetHealth > targetBlock.health) {
            // Aktualisieren der gespeicherten Gesundheit, wenn wir Schaden machen
            bot.currentTargetHealth = targetBlock.health;
            // Zielerfassungszeit aktualisieren, um länger auf den Block zu fokussieren
            bot.targetAcquisitionTime = now;
        }

        // VERBESSERT: Wir bleiben länger auf dem Ziel, wenn sein Leben sinkt
        // Nur wechseln, wenn wir sehr lange schießen und die Gesundheit sich nicht ändert
        const targetTooLong = now - bot.targetAcquisitionTime > BOT_CONFIG.TARGET_PERSISTENCE * 2;
        const noHealthChange = bot.currentTargetHealth === targetBlock.health && 
                             now - bot.lastHitTime > 2000; // 2 Sekunden ohne Treffer

        // Wenn zu lange auf gleiches Ziel oder kein Schaden mehr gemacht wird, wechseln
        if (targetTooLong && noHealthChange) {
            bot.botState = BOT_CONFIG.BEHAVIOR_STATES.IDLE;
            bot.targetId = null;
            bot.targetAcquisitionTime = 0;
            bot.currentTargetHealth = 0;
            bot.lastTargetSwitchTime = now;
            return;
        }

        // Bot auf Block ausrichten
        rotateBotTowards(bot, targetBlock.x, targetBlock.y);

        // Optimale Distanz für verschiedene Blocktypen
        let optimalDistance = 150;
        if (targetBlock.shape === 'pentagon') {
            optimalDistance = 180;
        }

        // Zum optimalen Abstand bewegen
        const blockDistance = calculateDistance(bot, targetBlock);
        if (blockDistance > optimalDistance * 1.2) {
            // Näher kommen für bessere Trefferquote
            moveBotTo(bot, targetBlock.x, targetBlock.y);
        } 
        else if (blockDistance < optimalDistance * 0.7) {
            // Etwas Abstand nehmen wenn zu nah
            const angle = calculateAngle(targetBlock, bot);
            const retreatX = bot.x + Math.cos(angle) * 3;
            const retreatY = bot.y + Math.sin(angle) * 3;
            moveBotTo(bot, retreatX, retreatY);
        }
        else {
            // Leicht kreisende Bewegung für besseres Ausweichen
            const circleAngle = calculateAngle(bot, targetBlock) + Math.PI/2;
            const circleX = bot.x + Math.cos(circleAngle) * 1.5;
            const circleY = bot.y + Math.sin(circleAngle) * 1.5;
            moveBotTo(bot, circleX, circleY);
        }

        // VERBESSERT: Aggressiv schießen und Zeit des letzten Treffers verfolgen
        const didShoot = botShoot(bot);
        if (didShoot) {
            bot.lastHitTime = now; // Annahme, dass der Schuss trifft
        }

        // Während des Schießens trotzdem immer prüfen, ob Spieler in Sichtweite kommt
        // Aber nur, wenn der Block nicht fast zerstört ist (unter 20% Gesundheit)
        if (targetBlock.health > 0.2 * targetBlock.maxHealth) {
            const nearbyPlayer = findNearestVisiblePlayer(bot);
            if (nearbyPlayer) {
                const playerDistance = calculateDistance(bot, nearbyPlayer);
                // Sofort wechseln, wenn Spieler innerhalb des Sichtfelds ist
                if (playerDistance < BOT_CONFIG.VIEW_RANGE) {
                    bot.targetId = nearbyPlayer.id;
                    bot.botState = playerDistance < 300 ? 
                        BOT_CONFIG.BEHAVIOR_STATES.ATTACKING : 
                        BOT_CONFIG.BEHAVIOR_STATES.PURSUING;
                    return;
                }
            }
        }
    }

    // Bot-Verhalten: Spieler verfolgen
    function executeBotPursuingBehavior(bot) {
        // Zielspieler finden
        const targetPlayer = players[bot.targetId];

        if (!targetPlayer) {
            // Ziel nicht mehr im Spiel, zurück zu "Idle"
            bot.botState = BOT_CONFIG.BEHAVIOR_STATES.IDLE;
            bot.targetId = null;
            bot.targetAcquisitionTime = 0;
            return;
        }

        // KORREKTUR: Explizit auf godMode === true prüfen
        if (targetPlayer.godMode === true) {
            console.log(`Bot ${bot.id} stoppt Verfolgung von Spieler ${targetPlayer.id} wegen aktiviertem God-Mode`);
            bot.botState = BOT_CONFIG.BEHAVIOR_STATES.IDLE;
            bot.targetId = null;
            bot.targetAcquisitionTime = 0;
            return;
        }

        // Abstand zum Ziel
        const distance = calculateDistance(bot, targetPlayer);

        // Wenn Ziel außer Reichweite, zurück zu "Idle"
        if (distance > BOT_CONFIG.VIEW_RANGE) {
            bot.botState = BOT_CONFIG.BEHAVIOR_STATES.IDLE;
            bot.targetId = null;
            return;
        }

        // Wenn Ziel nahe genug, zum "Attacking" wechseln
        if (distance < 300) {
            bot.botState = BOT_CONFIG.BEHAVIOR_STATES.ATTACKING;
            return;
        }

        // Spieler vorhersagen (zielen, wo er sein wird, nicht wo er ist)
        let predictX = targetPlayer.x;
        let predictY = targetPlayer.y;

        // Einfache Vorhersage basierend auf der letzten bekannten Position
        if (targetPlayer.lastX && targetPlayer.lastY) {
            const moveX = targetPlayer.x - targetPlayer.lastX;
            const moveY = targetPlayer.y - targetPlayer.lastY;

            predictX += moveX * 10;
            predictY += moveY * 10;
        }

        // Zum vorhergesagten Punkt bewegen
        moveBotTo(bot, predictX, predictY);

        // Bot auf Spieler ausrichten
        rotateBotTowards(bot, targetPlayer.x, targetPlayer.y);

        // Spieler speichern für nächste Vorhersage
        targetPlayer.lastX = targetPlayer.x;
        targetPlayer.lastY = targetPlayer.y;

        // Bereits beim Verfolgen aggressiv schießen
        if (Math.random() < 0.3) {
            botShoot(bot);
        }
    }

    // Bot-Verhalten: Spieler angreifen
    function executeBotAttackingBehavior(bot) {
        // Zielspieler finden
        const targetPlayer = players[bot.targetId];

        if (!targetPlayer) {
            // Ziel nicht mehr im Spiel, zurück zu "Idle"
            bot.botState = BOT_CONFIG.BEHAVIOR_STATES.IDLE;
            bot.targetId = null;
            bot.targetAcquisitionTime = 0;
            return;
        }

        // KORREKTUR: Explizit auf godMode === true prüfen
        if (targetPlayer.godMode === true) {
            console.log(`Bot ${bot.id} stoppt Verfolgung von Spieler ${targetPlayer.id} wegen aktiviertem God-Mode`);
            bot.botState = BOT_CONFIG.BEHAVIOR_STATES.IDLE;
            bot.targetId = null;
            bot.targetAcquisitionTime = 0;
            return;
        }

        // Abstand zum Ziel
        const distance = calculateDistance(bot, targetPlayer);

        // Wenn Ziel außer Reichweite, zurück zu "Idle"
        if (distance > BOT_CONFIG.VIEW_RANGE) {
            bot.botState = BOT_CONFIG.BEHAVIOR_STATES.IDLE;
            bot.targetId = null;
            return;
        } else if (distance > 350) {
            bot.botState = BOT_CONFIG.BEHAVIOR_STATES.PURSUING;
            return;
        }

        // Optimale Angriffsposition halten
        const optimalDistance = 200;

        if (distance > optimalDistance * 1.3) {
            // Näher kommen, wenn zu weit weg
            moveBotTo(bot, targetPlayer.x, targetPlayer.y);
        } else if (distance < optimalDistance * 0.7) {
            // Etwas Abstand nehmen wenn zu nah
            const angle = calculateAngle(targetPlayer, bot);
            const retreatX = bot.x + Math.cos(angle) * 3;
            const retreatY = bot.y + Math.sin(angle) * 3;
            moveBotTo(bot, retreatX, retreatY);
        } else {
            // Seitlich bewegen (Strafing)
            const perpAngle = calculateAngle(targetPlayer, bot) + Math.PI/2 * (Math.random() > 0.5 ? 1 : -1);
            const strafeX = bot.x + Math.cos(perpAngle) * 3;
            const strafeY = bot.y + Math.sin(perpAngle) * 3;
            moveBotTo(bot, strafeX, strafeY);
        }

        // Bot gezielter auf Spieler ausrichten
        const perfectAngle = Math.atan2(targetPlayer.y - bot.y, targetPlayer.x - bot.x);

        // Vorhersage, wohin der Spieler sich bewegt
        if (targetPlayer.lastX && targetPlayer.lastY) {
            const moveX = targetPlayer.x - targetPlayer.lastX;
            const moveY = targetPlayer.y - targetPlayer.lastY;

            // Bei Bewegung ein wenig vorhalten
            if (Math.abs(moveX) > 0.1 || Math.abs(moveY) > 0.1) {
                const predictX = targetPlayer.x + moveX * 5;
                const predictY = targetPlayer.y + moveY * 5;
                const predictAngle = Math.atan2(predictY - bot.y, predictX - bot.x);

                // Gewichtete Mischung aus direktem Zielen und Vorhersage
                bot.angle = perfectAngle * 0.3 + predictAngle * 0.7;
            } else {
                bot.angle = perfectAngle;
            }
        } else {
            bot.angle = perfectAngle;
        }

        bot.lastAngle = bot.angle;

        // Spieler speichern für nächste Vorhersage
        targetPlayer.lastX = targetPlayer.x;
        targetPlayer.lastY = targetPlayer.y;

        // Aggressiv schießen im Kampfmodus
        botShoot(bot);
    }

    // Bot-Verhalten: Fliehen
    function executeBotFleeingBehavior(bot) {
        // Nächsten Spieler finden, vor dem geflohen werden soll
        let nearestPlayer = null;
        let shortestDistance = Number.MAX_VALUE;

        for (const id in players) {
            if (id === bot.id) continue;

            const player = players[id];
            // God-Mode-Spieler ignorieren
            if (player.godMode) continue;

            const distance = calculateDistance(bot, player);

            if (distance < shortestDistance) {
                shortestDistance = distance;
                nearestPlayer = player;
            }
        }

        if (!nearestPlayer) {
            // Kein Spieler in der Nähe, zurück zu "Idle"
            bot.botState = BOT_CONFIG.BEHAVIOR_STATES.IDLE;
            return;
        }

        // Vom Spieler wegbewegen
        const angle = calculateAngle(nearestPlayer, bot);
        const fleeX = bot.x + Math.cos(angle) * 300;
        const fleeY = bot.y + Math.sin(angle) * 300;

        moveBotTo(bot, fleeX, fleeY);

        // Beim Fliehen nach einem Healblock suchen
        const nearestTriangle = findNearestBlockByType(bot, 'triangle');
        const nearestPentagon = findNearestBlockByType(bot, 'pentagon');

        // Pentagone geben mehr XP
        const healBlock = nearestPentagon && calculateDistance(bot, nearestPentagon) < 400 ?
                         nearestPentagon : nearestTriangle;

        if (healBlock && calculateDistance(bot, healBlock) < 400) {
            // Richtung leicht anpassen, um beim Fliehen gleichzeitig zum Healblock zu gelangen
            const blockAngle = calculateAngle(bot, healBlock);
            // Mischung aus Flucht- und Block-Richtung (70% Flucht, 30% Richtung Block)
            const mixedAngle = angle * 0.7 + blockAngle * 0.3;

            const mixedX = bot.x + Math.cos(mixedAngle) * 300;
            const mixedY = bot.y + Math.sin(mixedAngle) * 300;

            moveBotTo(bot, mixedX, mixedY);

            // Auf Block schießen, wenn in Sichtlinie
            const angleDiff = Math.abs(normalizeAngle(blockAngle - bot.angle));
            if (angleDiff < 0.5) {
                botShoot(bot);
            }
        }

        // Bot trotzdem gelegentlich auf Spieler ausrichten, um beim Fliehen zurückzuschießen
        if (Math.random() < 0.3) {
            rotateBotTowards(bot, nearestPlayer.x, nearestPlayer.y);

            // Gelegentlich zurückschießen
            if (Math.random() < 0.2) {
                botShoot(bot);
            }
        }

        // Wenn genug Gesundheit regeneriert wurde (über 50%), Zustand aktualisieren
        if (bot.health > bot.maxHealth * 0.5) {
            updateBotState(bot);
        }
    }

    // Schaden an einen Bot anwenden
    function takeDamageFromBot(bot, type, targetId, damage) {
        // Schaden anwenden
        if (type === "block") {
            const block = blocks.find(b => b.id === targetId);
            if (!block) return;

            block.health -= damage;

            // Block respawnen, wenn zerstört und XP vergeben
            if (block.health <= 0) {
                // Punkte an Bot vergeben
                bot.score += block.points * 10;

                // XP vergeben und Level prüfen
                const gainedXp = block.xp;
                bot.xp += gainedXp;
                bot.totalXp += gainedXp;

                // Prüfen, ob Level-Aufstieg
                checkLevelUp(bot);

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

    // Prüfen, ob ein neuer Bot gespawnt werden soll
    function spawnBotIfNeeded() {
        // Aktuelle Anzahl von Bots zählen
        const botCount = Object.keys(bots).length;

        // Dynamische Bot-Anzahl berechnen
        let maxBots = BOT_CONFIG.MAX_BOTS; // Standard
        let spawnChance = BOT_CONFIG.SPAWN_CHANCE;

        // Anzahl echter Spieler zählen
        const realPlayerCount = countRealPlayers();

        if (BOT_CONFIG.DYNAMIC_BOTS) {
            if (realPlayerCount === 0) {
                // Keine Spieler - prüfen, ob Bots entfernt werden sollen
                if (botCount > 0) {
                    if (!noPlayerTimerActive) {
                        noPlayerTimerActive = true;
                        lastPlayerActivity = Date.now();
                        console.log("Keine Spieler erkannt. Bot-Entfernung in 3 Minuten, falls kein Spieler beitritt.");
                    } else if (Date.now() - lastPlayerActivity > BOT_CONFIG.NO_PLAYER_TIMEOUT) {
                        // 3 Minuten ohne Spieler - alle Bots entfernen
                        console.log("3 Minuten ohne Spieler - entferne alle Bots");
                        for (const botId in bots) {
                            removeBot(botId);
                        }
                    }
                }
                return; // Keine neuen Bots spawnen, wenn keine Spieler da sind
            } else {
                // Spieler sind da, Timer zurücksetzen
                noPlayerTimerActive = false;
                lastPlayerActivity = Date.now();

                // Fehlende Spieler bis zum Referenzwert berechnen
                const missingPlayers = Math.max(0, BOT_CONFIG.MAX_REAL_PLAYERS - realPlayerCount);

                // Dynamisch Bots basierend auf fehlenden Spielern berechnen
                maxBots = BOT_CONFIG.MIN_BOTS + (missingPlayers * BOT_CONFIG.BOTS_PER_MISSING_PLAYER);

                // Auf das konfigurierte Maximum beschränken
                maxBots = Math.min(maxBots, BOT_CONFIG.MAX_BOTS_DYNAMIC);

                // Bei weniger Spielern höhere Spawn-Chance
                spawnChance = Math.min(0.9, BOT_CONFIG.SPAWN_CHANCE + (0.1 * missingPlayers));

                console.log(`Dynamisches Bot-Limit: ${maxBots} (${realPlayerCount} echte Spieler, Spawn-Chance: ${spawnChance.toFixed(2)})`);
            }
        }

        // Wenn maximale Bot-Anzahl erreicht wurde, nicht spawnen
        if (botCount >= maxBots) return;

        // Chance prüfen, ob ein Bot gespawnt werden soll
        if (Math.random() < spawnChance) {
            createBot();
        }
    }

    // Bot aus dem Spiel entfernen
    function removeBot(botId) {
        if (bots[botId]) {
            delete bots[botId];
            delete players[botId];
            io.emit('playerLeft', botId);

            // Bestenliste aktualisieren
            updateLeaderboard();
        }
    }

    // Bot-System starten
    function start() {
        console.log("Starting bot system...");

        // Intervalle einrichten, wenn sie noch nicht existieren
        if (!botUpdateInterval) {
            // Die Bots werden in der Hauptspielschleife aktualisiert, sodass sie synchron mit dem Spiel laufen
        }

        if (!botSpawnInterval) {
            botSpawnInterval = setInterval(spawnBotIfNeeded, BOT_CONFIG.SPAWN_INTERVAL);
        }

        // Einen Bot sofort spawnen, wenn Spieler da sind
        if (hasRealPlayers()) {
            createBot();
        }
    }

    // Bot-System stoppen
    function stop() {
        console.log("Stopping bot system...");

        // Intervalle stoppen
        if (botSpawnInterval) {
            clearInterval(botSpawnInterval);
            botSpawnInterval = null;
        }

        // Alle Bots entfernen
        for (const botId in bots) {
            removeBot(botId);
        }
    }

    // NEUE HILFSFUNKTIONEN

    // Besten Block zum Sammeln finden
    function findBestBlockTarget(bot) {
        let bestBlock = null;
        let bestScore = -1;
        const now = Date.now();

        // Wenn wir bereits ein Ziel haben und nicht kürzlich gewechselt haben, dabei bleiben
        if (bot.targetId && bot.targetId.startsWith('block-') && 
            now - bot.targetAcquisitionTime < BOT_CONFIG.TARGET_PERSISTENCE &&
            now - bot.lastTargetSwitchTime > BOT_CONFIG.TARGET_SWITCH_DELAY) {

            const currentBlock = blocks.find(b => b.id === bot.targetId);
            if (currentBlock && currentBlock.health > 0) {
                return currentBlock;
            }
        }

        for (const block of blocks) {
            const distance = calculateDistance(bot, block);

            if (distance < BOT_CONFIG.VIEW_RANGE) {
                // Bewertung: XP-Wert geteilt durch Entfernung (mit Gewichtung)
                let value = block.xp;

                // Entfernung berücksichtigen - nähere Blöcke bevorzugen
                const distanceFactor = 1 / (1 + distance * 0.005);

                // Gesundheit berücksichtigen - beschädigte Blöcke bevorzugen
                const healthFactor = 1 - (block.health / block.maxHealth) * 0.5;

                // Gesamtwertung
                const score = value * distanceFactor * healthFactor;

                if (score > bestScore) {
                    bestScore = score;
                    bestBlock = block;
                }
            }
        }

        return bestBlock;
    }

    // Funktion: Finde nächsten sichtbaren Spieler (andere Spieler oder Mensch)
    function findNearestVisiblePlayer(bot) {
        let nearestPlayer = null;
        let shortestDistance = Number.MAX_VALUE;

        for (const id in players) {
            if (id === bot.id) continue;

            const potentialTarget = players[id];

            // KORREKTUR: Nur Spieler im God-Mode ignorieren, nicht alle Spieler
            // Die Prüfung war richtig, aber das Problem könnte woanders liegen
            if (potentialTarget.godMode === true) continue;

            const distance = calculateDistance(bot, potentialTarget);

            // Nur Spieler innerhalb des Sichtfelds
            if (distance < BOT_CONFIG.VIEW_RANGE) {
                // Filter: Nur Spieler, die ähnliches Level haben (macht es fairer und realistischer)
                const levelDifference = Math.abs(potentialTarget.level - bot.level);

                // Bevorzuge Spieler mit ähnlichem Level und Entfernung
                const levelFactor = Math.max(0, 10 - levelDifference) / 10;
                const distanceFactor = 1 - (distance / BOT_CONFIG.VIEW_RANGE);

                // Gewichtete Punktzahl
                const score = levelFactor * 0.7 + distanceFactor * 0.3;

                // KORREKTUR: Wahrscheinlichkeit erhöhen, dass Spieler angegriffen werden
                // Wenn ein Spieler in der Nähe ist, soll er immer angegriffen werden
                // const randomFactor = Math.random(); // Das machte Angriffe zufälliger
                const randomFactor = 0.9; // Höherer fester Wert führt zu konsequenteren Angriffen

                if (score * randomFactor > 0.2 && distance < shortestDistance) {
                    nearestPlayer = potentialTarget;
                    shortestDistance = distance;
                }
            }
        }

        return nearestPlayer;
    }

    // Hilfsfunktion: Besseren Block in der Nähe finden
    function findBetterBlockNearby(bot, currentBlock) {
        let bestBlock = null;
        let bestScore = getBlockValue(currentBlock);

        // Überprüfe Blöcke in der Nähe
        for (const block of blocks) {
            if (block.id === currentBlock.id) continue;

            const distance = calculateDistance(bot, block);

            // Nur nahe Blöcke im Sichtfeld prüfen
            if (distance < BOT_CONFIG.VIEW_RANGE * 0.7) {
                const blockScore = getBlockValue(block) * (1 - distance / BOT_CONFIG.VIEW_RANGE);

                if (blockScore > bestScore * 1.5) { // Deutlich besser
                    bestScore = blockScore;
                    bestBlock = block;
                }
            }
        }

        return bestBlock;
    }

    // Hilfsfunktion: Blockwert berechnen (basierend auf XP und Gesundheit)
    function getBlockValue(block) {
        // Grundwert ist die XP
        let value = block.xp;

        // Blockgesundheit berücksichtigen (niedrigere Gesundheit = leichter zu zerstören)
        const healthFactor = 1 + (1 - block.health / block.maxHealth);

        return value * healthFactor;
    }

    // Hilfsfunktion: Nächsten Block eines bestimmten Typs finden
    function findNearestBlockByType(bot, type) {
        let nearestBlock = null;
        let shortestDistance = Number.MAX_VALUE;

        for (const block of blocks) {
            if (block.shape === type) {
                const distance = calculateDistance(bot, block);

                if (distance < shortestDistance) {
                    shortestDistance = distance;
                    nearestBlock = block;
                }
            }
        }

        return nearestBlock;
    }

    // Hilfsfunktion: Normalisiere den Winkel auf -π bis π
    function normalizeAngle(angle) {
        while (angle > Math.PI) angle -= 2 * Math.PI;
        while (angle < -Math.PI) angle += 2 * Math.PI;
        return angle;
    }

    // Öffentliche API
    return {
        start,
        stop,
        updateBots,
        createBot,
        removeBot,
        getBots: () => bots,
        hasRealPlayers
    };
};