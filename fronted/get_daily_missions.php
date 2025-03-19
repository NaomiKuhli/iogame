<?php
// get_daily_missions.php - Tägliche Missionen abrufen
require_once 'db_config.php';

// Zeitzone auf Berlin setzen
date_default_timezone_set('Europe/Berlin');

// Nur GET-Anfragen erlauben
checkRequestMethod('GET');

// Benutzer entweder aus Token in URL oder aus Header abrufen
$user_data = null;

// Holen des Tokens (entweder aus URL-Parameter oder aus dem Body)
$token = '';

// 1. Aus URL-Parameter
if (isset($_GET['token'])) {
    $token = $_GET['token'];
}
// 2. Aus dem Request-Body (für POST-Anfragen)
else {
    $data = json_decode(file_get_contents('php://input'), true);
    if (isset($data['token'])) {
        $token = $data['token'];
    }
}
// 3. Aus dem Authorization-Header (fallback)
if (empty($token)) {
    $headers = getallheaders();
    if (isset($headers['Authorization'])) {
        if (preg_match('/Bearer\s+(.*)$/i', $headers['Authorization'], $matches)) {
            $token = $matches[1];
        }
    }
}

// Token validieren
if (empty($token)) {
    // Kein Token gefunden
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'message' => 'Nicht autorisiert: Token fehlt'
    ]);
    exit;
}

$user_data = validateToken($token);
if (!$user_data) {
    // Ungültiger Token
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'message' => 'Nicht autorisiert: Ungültiger oder abgelaufener Token'
    ]);
    exit;
}

// Datenbankverbindung herstellen
$db = getDbConnection();
if (!$db) {
    sendErrorResponse('Datenbankverbindung fehlgeschlagen', 500);
}

try {
    // Tägliche Missionen generieren (falls nötig)
    generateDailyMissions();
    
    // Aktive tägliche Missionen abrufen
    $stmt = $db->prepare("
        SELECT dm.*, um.progress, um.claimed
        FROM daily_missions dm
        LEFT JOIN user_missions um ON dm.id = um.mission_id AND um.user_id = :user_id
        WHERE dm.expires_at > NOW()
        ORDER BY dm.id ASC
    ");
    $stmt->execute(['user_id' => $user_data['user_id']]);
    $missions = $stmt->fetchAll();
    
    // Nächste Aktualisierung berechnen (Berliner Zeit)
    $now = new DateTime('now', new DateTimeZone('Europe/Berlin'));
    $tomorrow = new DateTime('tomorrow midnight', new DateTimeZone('Europe/Berlin'));
    $interval = $now->diff($tomorrow);
    $hours = $interval->h;
    $minutes = $interval->i;
    
    $next_update = '';
    if ($hours > 0) {
        $next_update .= $hours . ' Stunde' . ($hours != 1 ? 'n' : '');
    }
    if ($minutes > 0) {
        if ($hours > 0) $next_update .= ' und ';
        $next_update .= $minutes . ' Minute' . ($minutes != 1 ? 'n' : '');
    }
    
    // Erfolgsantwort senden
    echo json_encode([
        'success' => true,
        'missions' => $missions,
        'next_update' => $next_update
    ]);
    
} catch (PDOException $e) {
    error_log("Fehler beim Abrufen der täglichen Missionen: " . $e->getMessage());
    sendErrorResponse('Fehler beim Abrufen der täglichen Missionen', 500);
}
?>