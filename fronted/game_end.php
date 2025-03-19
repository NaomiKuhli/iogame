<?php
// game_end.php - Spielende verarbeiten und Belohnungen vergeben
require_once 'db_config.php';

// Nur POST-Anfragen erlauben
checkRequestMethod('POST');

// Token aus Query-Parameter oder Request-Body holen
$token = '';
if (isset($_GET['token'])) {
    $token = $_GET['token'];
} else {
    $data = json_decode(file_get_contents('php://input'), true);
    if (isset($data['token'])) {
        $token = $data['token'];
    }
}

// Wenn kein Token vorhanden ist, ist der Spieler nicht angemeldet
if (!$token) {
    echo json_encode([
        'success' => true,
        'message' => 'Spiel ohne Anmeldung beendet'
    ]);
    exit;
}

// Token validieren
$user_data = validateToken($token);
if (!$user_data) {
    echo json_encode([
        'success' => false,
        'message' => 'Ungültiger oder abgelaufener Token'
    ]);
    exit;
}

// Spielstatistiken aus dem Request-Body lesen
$data = json_decode(file_get_contents('php://input'), true);

$stats = [
    'playtime' => isset($data['playtime']) ? (int)$data['playtime'] : 0,
    'kills' => isset($data['kills']) ? (int)$data['kills'] : 0,
    'max_level' => isset($data['max_level']) ? (int)$data['max_level'] : 0,
    'score' => isset($data['score']) ? (int)$data['score'] : 0
];

// Datenbankverbindung herstellen
$db = getDbConnection();
if (!$db) {
    echo json_encode([
        'success' => false,
        'message' => 'Datenbankverbindung fehlgeschlagen'
    ]);
    exit;
}

try {
    // Transaktion starten
    $db->beginTransaction();
    
    // Benutzerstatistiken aktualisieren
    $stmt = $db->prepare("
        UPDATE user_stats
        SET 
            kills = kills + :kills,
            deaths = deaths + 1,
            playtime_seconds = playtime_seconds + :playtime,
            max_level = GREATEST(max_level, :max_level),
            games_played = games_played + 1
        WHERE user_id = :user_id
    ");
    $stmt->execute([
        'kills' => $stats['kills'],
        'playtime' => $stats['playtime'],
        'max_level' => $stats['max_level'],
        'user_id' => $user_data['user_id']
    ]);
    
    // Missionsfortschritt aktualisieren
    updateMissionProgress($user_data['user_id'], 'kill_enemies', $stats['kills']);
    updateMissionProgress($user_data['user_id'], 'play_minutes', floor($stats['playtime'] / 60));
    updateMissionProgress($user_data['user_id'], 'survive_minutes', floor($stats['playtime'] / 60));
    updateMissionProgress($user_data['user_id'], 'reach_level', $stats['max_level']);
    
    // Coins basierend auf Spielstatistiken vergeben
    $coins_earned = 0;
    
    // Basis-Coins für Spielzeit
    $coins_earned += floor($stats['playtime'] / 60) * 5;
    
    // Coins für Kills
    $coins_earned += $stats['kills'] * 2;
    
    // Coins für erreichtes Level
    $coins_earned += $stats['max_level'] * 3;
    
    // Coins für Score (abgerundet auf Hunderterstellen)
    $coins_earned += floor($stats['score'] / 100);
    
    // Coins zum Benutzer hinzufügen
    if ($coins_earned > 0) {
        $stmt = $db->prepare("
            UPDATE users
            SET coins = coins + :coins
            WHERE id = :id
        ");
        $stmt->execute([
            'coins' => $coins_earned,
            'id' => $user_data['user_id']
        ]);
    }
    
    // Neue Coin-Anzahl abrufen
    $stmt = $db->prepare("SELECT coins FROM users WHERE id = :id");
    $stmt->execute(['id' => $user_data['user_id']]);
    $user = $stmt->fetch();
    
    // Transaktion abschließen
    $db->commit();
    
    // Erfolgsantwort senden
    echo json_encode([
        'success' => true,
        'message' => 'Spielstatistiken erfolgreich verarbeitet',
        'coins_earned' => $coins_earned,
        'new_total' => $user['coins']
    ]);
    
} catch (PDOException $e) {
    $db->rollBack();
    error_log("Fehler bei der Verarbeitung des Spielendes: " . $e->getMessage());
    echo json_encode([
        'success' => false,
        'message' => 'Fehler bei der Verarbeitung des Spielendes'
    ]);
}
?>